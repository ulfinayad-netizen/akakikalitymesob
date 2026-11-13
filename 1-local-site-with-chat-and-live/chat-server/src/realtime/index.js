"use strict";
const db = require("../db");
const hub = require("../lib/hub");
const { verifyToken } = require("../lib/auth");
const { LIMITS } = require("../config");
const { createLimiter } = require("../lib/rateLimit");
const { isMember, isAdmin, blockedEitherWay, counterpart } = require("../lib/access");
const {
  conversationSummary,
  messageById,
  publicUser,
  userById,
  invalidateUser
} = require("../lib/serialize");
const { createMessage, syncMessage, sweepExpired, sweepScheduled } = require("../lib/messageService");
const sendLimiter = createLimiter({ burst: LIMITS.sendBurst, refillPerSec: LIMITS.sendRefillPerSec });
const reply = (ack, payload) => typeof ack === "function" && ack(payload);
function register(io) {
  hub.attach(io);
  io.use((socket, next) => {
    try {
      socket.user = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);
    db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id = ?").all(userId).forEach(({ conversation_id: id }) => socket.join(`conv:${id}`));
    if (hub.addSocket(userId, socket.id)) hub.broadcastPresence(userId, true, null);
    socket.on("message:send", ({ conversationId, content, attachment, replyToId } = {}, ack) => {
      const text = String(content || "").trim();
      if (!text && !attachment) return reply(ack, { error: "Nothing to send" });
      if (!isMember(conversationId, userId)) return reply(ack, { error: "Not a member of this conversation" });
      if (!sendLimiter(userId)) return reply(ack, { error: "Slow down a moment" });
      const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
      if (!conv.is_group) {
        const other = counterpart(conversationId, userId);
        if (other && blockedEitherWay(userId, other.id)) return reply(ack, { error: "You cannot message this user" });
      }
      const message = createMessage({ conversationId, senderId: userId, content: text, attachment, replyToId });
      reply(ack, { message });
    });
    socket.on("message:edit", ({ messageId, content } = {}, ack) => {
      const text = String(content || "").trim();
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
      if (!row || row.sender_id !== userId || row.deleted_at || row.kind !== "text" || !text) {
        return reply(ack, { error: "Could not edit message" });
      }
      const editedAt = Date.now();
      db.transaction(() => {
        db.prepare("INSERT INTO message_edits (message_id, content, edited_at) VALUES (?, ?, ?)").run(
          row.id,
          row.content,
          row.edited_at || row.created_at
        );
        db.prepare("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?").run(text, editedAt, row.id);
      })();
      syncMessage(row.conversation_id, row.id);
      hub.toConversationMembers(row.conversation_id, (uid) => [
        "conversation:updated",
        conversationSummary(row.conversation_id, uid)
      ]);
      reply(ack, { ok: true });
    });
    socket.on("message:delete", ({ messageId } = {}, ack) => {
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
      if (!row || row.deleted_at) return reply(ack, { error: "Could not delete message" });
      const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(row.conversation_id);
      const mayDelete = row.sender_id === userId || conv.is_group && isAdmin(row.conversation_id, userId);
      if (!mayDelete) return reply(ack, { error: "Only the sender or a group admin can delete this" });
      db.prepare("UPDATE messages SET deleted_at = ?, content = ?, pinned_at = NULL WHERE id = ?").run(Date.now(), "", row.id);
      syncMessage(row.conversation_id, row.id);
      hub.toConversationMembers(row.conversation_id, (uid) => [
        "conversation:updated",
        conversationSummary(row.conversation_id, uid)
      ]);
      reply(ack, { ok: true });
    });
    socket.on("message:pin", ({ messageId, pinned } = {}, ack) => {
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
      if (!row || !isMember(row.conversation_id, userId) || row.deleted_at) {
        return reply(ack, { error: "Could not pin message" });
      }
      db.prepare("UPDATE messages SET pinned_at = ? WHERE id = ?").run(pinned ? Date.now() : null, row.id);
      syncMessage(row.conversation_id, row.id);
      hub.toConversationMembers(row.conversation_id, (uid) => [
        "conversation:updated",
        conversationSummary(row.conversation_id, uid)
      ]);
      reply(ack, { ok: true });
    });
    socket.on("reaction:toggle", ({ messageId, emoji } = {}, ack) => {
      const clean = String(emoji || "").slice(0, LIMITS.emoji);
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
      if (!row || !clean || !isMember(row.conversation_id, userId)) return reply(ack, { error: "Could not react" });
      const existing = db.prepare("SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(row.id, userId, clean);
      if (existing) {
        db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").run(row.id, userId, clean);
      } else {
        db.prepare("INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)").run(
          row.id,
          userId,
          clean,
          Date.now()
        );
      }
      syncMessage(row.conversation_id, row.id);
      reply(ack, { ok: true });
    });
    socket.on("poll:create", ({ conversationId, question, options, multi, anonymous } = {}, ack) => {
      if (!isMember(conversationId, userId)) return reply(ack, { error: "Not a member of this conversation" });
      const q = String(question || "").trim().slice(0, 200);
      const choices = (options || []).map((o) => String(o || "").trim().slice(0, 80)).filter(Boolean).slice(0, LIMITS.pollOptions);
      if (!q || choices.length < 2) return reply(ack, { error: "A poll needs a question and two options" });
      const message = createMessage({ conversationId, senderId: userId, content: q, kind: "poll" });
      const info = db.prepare(
        "INSERT INTO polls (message_id, conversation_id, question, multi, anonymous, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(message.id, conversationId, q, multi ? 1 : 0, anonymous ? 1 : 0, userId, Date.now());
      const insertOption = db.prepare("INSERT INTO poll_options (poll_id, text, position) VALUES (?, ?, ?)");
      choices.forEach((text, i) => insertOption.run(info.lastInsertRowid, text, i));
      syncMessage(conversationId, message.id);
      reply(ack, { message: messageById(message.id, userId) });
    });
    socket.on("poll:vote", ({ pollId, optionId } = {}, ack) => {
      const poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(pollId);
      if (!poll || !isMember(poll.conversation_id, userId)) return reply(ack, { error: "Poll not found" });
      if (poll.closed_at) return reply(ack, { error: "This poll is closed" });
      const option = db.prepare("SELECT * FROM poll_options WHERE id = ? AND poll_id = ?").get(optionId, pollId);
      if (!option) return reply(ack, { error: "Unknown option" });
      const mine = db.prepare("SELECT 1 FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?").get(pollId, optionId, userId);
      db.transaction(() => {
        if (mine) {
          db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?").run(pollId, optionId, userId);
        } else {
          if (!poll.multi) db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?").run(pollId, userId);
          db.prepare("INSERT INTO poll_votes (poll_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)").run(
            pollId,
            optionId,
            userId,
            Date.now()
          );
        }
      })();
      syncMessage(poll.conversation_id, poll.message_id);
      reply(ack, { ok: true });
    });
    socket.on("poll:close", ({ pollId } = {}, ack) => {
      const poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(pollId);
      if (!poll) return reply(ack, { error: "Poll not found" });
      if (poll.created_by !== userId && !isAdmin(poll.conversation_id, userId)) {
        return reply(ack, { error: "Only the poll author or an admin can close it" });
      }
      db.prepare("UPDATE polls SET closed_at = ? WHERE id = ?").run(Date.now(), pollId);
      syncMessage(poll.conversation_id, poll.message_id);
      reply(ack, { ok: true });
    });
    socket.on("typing", ({ conversationId, isTyping } = {}) => {
      if (!isMember(conversationId, userId)) return;
      socket.to(`conv:${conversationId}`).emit("typing", {
        conversationId,
        userId,
        displayName: publicUser(userById(userId))?.displayName || "",
        isTyping: !!isTyping
      });
    });
    socket.on("conversation:join", ({ conversationId } = {}) => {
      if (isMember(conversationId, userId)) socket.join(`conv:${conversationId}`);
    });
    socket.on("disconnect", () => {
      if (!hub.removeSocket(userId, socket.id)) return;
      const lastSeenAt = Date.now();
      db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(lastSeenAt, userId);
      invalidateUser(userId);
      hub.broadcastPresence(userId, false, lastSeenAt);
    });
  });
  const timer = setInterval(() => {
    sweepExpired();
    sweepScheduled();
  }, 3e4);
  sweepScheduled();
  timer.unref?.();
}
module.exports = { register };
