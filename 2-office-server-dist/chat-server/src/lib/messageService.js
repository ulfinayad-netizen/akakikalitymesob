"use strict";
const db = require("../db");
const hub = require("./hub");
const { LIMITS } = require("../config");
const { conversationSummary, messageById, userById, publicUser } = require("./serialize");
const MENTION_RE = /@([a-zA-Z0-9_.-]{2,32})/g;
function extractMentions(content, members) {
  if (!content) return [];
  const tokens = [...content.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase());
  if (tokens.length === 0) return [];
  const all = tokens.includes("all") || tokens.includes("everyone") || tokens.includes("channel");
  const hits = new Set();
  members.forEach((m) => {
    if (all) return hits.add(m.id);
    const username = (m.username || "").toLowerCase();
    const display = (m.display_name || "").toLowerCase().replace(/\s+/g, "");
    if (tokens.includes(username) || tokens.includes(display)) hits.add(m.id);
  });
  return [...hits];
}
function membersOf(conversationId) {
  return db.prepare("SELECT u.* FROM users u JOIN conversation_members cm ON cm.user_id = u.id WHERE cm.conversation_id = ?").all(conversationId);
}
function createMessage({
  conversationId,
  senderId,
  content = "",
  kind = "text",
  attachment = null,
  replyToId = null,
  forwardedFromId = null
}) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) throw new Error("Conversation not found");
  const now = Date.now();
  const trimmed = String(content || "").slice(0, LIMITS.messageContent).trim();
  const expiresAt = conv.ttl_seconds > 0 && kind !== "system" ? now + conv.ttl_seconds * 1e3 : null;
  const validReplyTo = replyToId ? db.prepare("SELECT id FROM messages WHERE id = ? AND conversation_id = ?").get(replyToId, conversationId)?.id ?? null : null;
  const info = db.prepare(
    `INSERT INTO messages
         (conversation_id, sender_id, kind, content, created_at, expires_at,
          attachment_url, attachment_type, attachment_name, attachment_size, attachment_duration, attachment_waveform,
          reply_to_id, forwarded_from_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    conversationId,
    senderId,
    kind,
    trimmed,
    now,
    expiresAt,
    attachment?.url || null,
    attachment?.type || null,
    attachment?.name || null,
    attachment?.size || null,
    attachment?.duration || null,
    attachment?.waveform ? JSON.stringify(attachment.waveform.slice(0, 64)) : null,
    validReplyTo,
    forwardedFromId
  );
  const messageId = Number(info.lastInsertRowid);
  if (conv.is_group && kind === "text" && trimmed.includes("@")) {
    const mentioned = extractMentions(trimmed, membersOf(conversationId)).filter((id) => id !== senderId);
    const insert = db.prepare("INSERT OR IGNORE INTO message_mentions (message_id, user_id) VALUES (?, ?)");
    mentioned.forEach((uid) => insert.run(messageId, uid));
  }
  fanOut(conversationId, messageId);
  return messageById(messageId, senderId);
}
function fanOut(conversationId, messageId) {
  db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(conversationId).forEach(({ user_id: userId }) => {
    hub.toUser(userId, "message:new", messageById(messageId, userId));
    hub.toUser(userId, "conversation:updated", conversationSummary(conversationId, userId));
  });
}
function syncMessage(conversationId, messageId) {
  db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(conversationId).forEach(({ user_id: userId }) => {
    const message = messageById(messageId, userId);
    if (message) hub.toUser(userId, "message:updated", message);
  });
}
function systemMessage(conversationId, actorId, text) {
  return createMessage({ conversationId, senderId: actorId, content: text, kind: "system" });
}
function actorName(userId) {
  return publicUser(userById(userId))?.displayName || "Someone";
}
function sweepExpired() {
  const now = Date.now();
  const rows = db.prepare("SELECT id, conversation_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?").all(now);
  if (rows.length === 0) return 0;
  const del = db.prepare("DELETE FROM messages WHERE id = ?");
  const tx = db.transaction((list) => list.forEach((r) => del.run(r.id)));
  tx(rows);
  const touched = new Set();
  rows.forEach((r) => {
    hub.toConversation(r.conversation_id, "message:expired", { id: r.id, conversationId: r.conversation_id });
    touched.add(r.conversation_id);
  });
  touched.forEach(
    (conversationId) => hub.toConversationMembers(conversationId, (userId) => [
      "conversation:updated",
      conversationSummary(conversationId, userId)
    ])
  );
  return rows.length;
}
function sweepScheduled() {
  const now = Date.now();
  const due = db.prepare("SELECT * FROM scheduled_messages WHERE sent_at IS NULL AND send_at <= ? ORDER BY send_at LIMIT 100").all(now);
  if (due.length === 0) return 0;
  const markSent = db.prepare("UPDATE scheduled_messages SET sent_at = ?, sent_message_id = ? WHERE id = ?");
  const markFailed = db.prepare("UPDATE scheduled_messages SET sent_at = ? WHERE id = ?");
  let delivered = 0;
  due.forEach((row) => {
    const stillMember = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(row.conversation_id, row.sender_id);
    if (!stillMember) {
      markFailed.run(Date.now(), row.id);
      hub.toUser(row.sender_id, "scheduled:failed", { id: row.id, reason: "no-longer-a-member" });
      return;
    }
    try {
      const message = createMessage({
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        content: row.content,
        attachment: row.attachment_json ? JSON.parse(row.attachment_json) : null,
        replyToId: row.reply_to_id || null
      });
      markSent.run(Date.now(), message.id, row.id);
      hub.toUser(row.sender_id, "scheduled:sent", { id: row.id, message });
      delivered += 1;
    } catch (err) {
      markFailed.run(Date.now(), row.id);
      hub.toUser(row.sender_id, "scheduled:failed", { id: row.id, reason: err.message });
    }
  });
  return delivered;
}
module.exports = {
  createMessage,
  sweepScheduled,
  syncMessage,
  fanOut,
  systemMessage,
  actorName,
  sweepExpired,
  extractMentions,
  membersOf
};
