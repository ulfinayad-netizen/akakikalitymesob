"use strict";
const express = require("express");
const db = require("../db");
const hub = require("../lib/hub");
const { requireAuth } = require("../lib/auth");
const { LIMITS, TTL_PRESETS } = require("../config");
const { conversationSummary, serializeMessages, publicUser, userById } = require("../lib/serialize");
const { requireMember, requireGroupAdmin, blockedEitherWay, isMember } = require("../lib/access");
const { systemMessage, actorName } = require("../lib/messageService");
const router = express.Router();
const num = (v, fallback = null) => v === void 0 || v === null || v === "" ? fallback : Number(v);
router.get("/conversations", requireAuth, (req, res) => {
  const includeArchived = req.query.archived === "1";
  const list = db.prepare("SELECT conversation_id, archived FROM conversation_members WHERE user_id = ?").all(req.user.id).filter((r) => includeArchived || !r.archived).map((r) => conversationSummary(r.conversation_id, req.user.id)).filter(Boolean);
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt);
  });
  res.json(list);
});
router.post("/conversations", requireAuth, (req, res) => {
  const { memberIds, isGroup, name, description } = req.body || {};
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: "Pick at least one person" });
  }
  const ids = [...new Set([req.user.id, ...memberIds.map(Number)])];
  if (!isGroup) {
    if (ids.length !== 2) return res.status(400).json({ error: "Direct chats need exactly one other person" });
    const other = ids.find((id) => id !== req.user.id);
    if (blockedEitherWay(req.user.id, other)) {
      return res.status(403).json({ error: "You cannot start a conversation with this user" });
    }
    const existing = db.prepare(
      `SELECT a.conversation_id AS id FROM conversation_members a
           JOIN conversation_members b ON a.conversation_id = b.conversation_id
           JOIN conversations c ON c.id = a.conversation_id
          WHERE c.is_group = 0 AND a.user_id = ? AND b.user_id = ?`
    ).get(ids[0], ids[1]);
    if (existing) return res.json(conversationSummary(existing.id, req.user.id));
  }
  const now = Date.now();
  const info = db.prepare("INSERT INTO conversations (is_group, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(
    isGroup ? 1 : 0,
    isGroup ? String(name || "").trim().slice(0, LIMITS.groupName) || null : null,
    isGroup ? String(description || "").trim().slice(0, LIMITS.groupDescription) || null : null,
    req.user.id,
    now
  );
  const convId = Number(info.lastInsertRowid);
  const insert = db.prepare(
    "INSERT INTO conversation_members (conversation_id, user_id, joined_at, is_admin) VALUES (?, ?, ?, ?)"
  );
  ids.forEach((uid) => {
    insert.run(convId, uid, now, isGroup && uid === req.user.id ? 1 : 0);
    hub.joinConversation(uid, convId);
  });
  ids.forEach((uid) => hub.toUser(uid, "conversation:new", conversationSummary(convId, uid)));
  if (isGroup) systemMessage(convId, req.user.id, `${actorName(req.user.id)} created this group`);
  res.json(conversationSummary(convId, req.user.id));
});
router.patch("/conversations/:id", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireGroupAdmin(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const { name, description, ttlSeconds, avatarColor, avatarUrl } = req.body || {};
  const conv = check.conv;
  const notes = [];
  if (name !== void 0) {
    const nextName = String(name).trim().slice(0, LIMITS.groupName) || null;
    if (nextName !== conv.name) notes.push(`${actorName(req.user.id)} renamed the group to \u201C${nextName || "Group chat"}\u201D`);
    db.prepare("UPDATE conversations SET name = ? WHERE id = ?").run(nextName, convId);
  }
  if (description !== void 0) {
    db.prepare("UPDATE conversations SET description = ? WHERE id = ?").run(
      String(description).trim().slice(0, LIMITS.groupDescription) || null,
      convId
    );
  }
  if (avatarColor !== void 0) db.prepare("UPDATE conversations SET avatar_color = ? WHERE id = ?").run(avatarColor || null, convId);
  if (avatarUrl !== void 0) db.prepare("UPDATE conversations SET avatar_url = ? WHERE id = ?").run(avatarUrl || null, convId);
  if (ttlSeconds !== void 0) {
    const seconds = Number(ttlSeconds) || 0;
    if (!TTL_PRESETS.some((p) => p.seconds === seconds)) {
      return res.status(400).json({ error: "Unsupported disappearing-message timer" });
    }
    if (seconds !== conv.ttl_seconds) {
      const label = TTL_PRESETS.find((p) => p.seconds === seconds).label;
      notes.push(
        seconds === 0 ? `${actorName(req.user.id)} turned off disappearing messages` : `${actorName(req.user.id)} set messages to disappear after ${label.toLowerCase()}`
      );
    }
    db.prepare("UPDATE conversations SET ttl_seconds = ? WHERE id = ?").run(seconds, convId);
  }
  hub.toConversationMembers(convId, (uid) => ["conversation:updated", conversationSummary(convId, uid)]);
  notes.forEach((note) => systemMessage(convId, req.user.id, note));
  res.json(conversationSummary(convId, req.user.id));
});
router.patch("/conversations/:id/prefs", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireMember(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const { mutedUntil, archived, pinned } = req.body || {};
  if (mutedUntil !== void 0) {
    db.prepare("UPDATE conversation_members SET muted_until = ? WHERE conversation_id = ? AND user_id = ?").run(
      Math.max(0, Number(mutedUntil) || 0),
      convId,
      req.user.id
    );
  }
  if (archived !== void 0) {
    db.prepare("UPDATE conversation_members SET archived = ? WHERE conversation_id = ? AND user_id = ?").run(
      archived ? 1 : 0,
      convId,
      req.user.id
    );
  }
  if (pinned !== void 0) {
    db.prepare("UPDATE conversation_members SET pinned = ? WHERE conversation_id = ? AND user_id = ?").run(
      pinned ? 1 : 0,
      convId,
      req.user.id
    );
  }
  const summary = conversationSummary(convId, req.user.id);
  hub.toUser(req.user.id, "conversation:updated", summary);
  res.json(summary);
});
router.post("/conversations/:id/members", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireGroupAdmin(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const { memberIds } = req.body || {};
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: "Pick at least one person to add" });
  }
  const now = Date.now();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at, is_admin) VALUES (?, ?, ?, 0)"
  );
  const added = [];
  memberIds.map(Number).forEach((uid) => {
    if (isMember(convId, uid)) return;
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(uid)) return;
    insert.run(convId, uid, now);
    hub.joinConversation(uid, convId);
    added.push(uid);
  });
  added.forEach((uid) => hub.toUser(uid, "conversation:new", conversationSummary(convId, uid)));
  hub.toConversationMembers(convId, (uid) => ["conversation:updated", conversationSummary(convId, uid)]);
  if (added.length) {
    const names = added.map((id) => publicUser(userById(id))?.displayName).filter(Boolean).join(", ");
    systemMessage(convId, req.user.id, `${actorName(req.user.id)} added ${names}`);
  }
  res.json(conversationSummary(convId, req.user.id));
});
router.delete("/conversations/:id/members/:userId", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const targetId = num(req.params.userId);
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId);
  if (!conv || !conv.is_group) return res.status(404).json({ error: "Group not found" });
  if (!isMember(convId, req.user.id)) return res.status(403).json({ error: "Not a member of this group" });
  const leaving = targetId === req.user.id;
  if (!leaving) {
    const check = requireGroupAdmin(convId, req.user.id);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  if (!isMember(convId, targetId)) return res.status(404).json({ error: "That person is not in this group" });
  const name = publicUser(userById(targetId))?.displayName || "Someone";
  db.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?").run(convId, targetId);
  hub.leaveConversation(targetId, convId);
  hub.toUser(targetId, "conversation:removed", { conversationId: convId });
  const remaining = db.prepare("SELECT COUNT(*) c FROM conversation_members WHERE conversation_id = ?").get(convId).c;
  if (remaining === 0) {
    db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);
    return res.json({ ok: true, deleted: true });
  }
  const admins = db.prepare("SELECT COUNT(*) c FROM conversation_members WHERE conversation_id = ? AND is_admin = 1").get(convId).c;
  if (admins === 0) {
    const next = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at LIMIT 1").get(convId);
    db.prepare("UPDATE conversation_members SET is_admin = 1 WHERE conversation_id = ? AND user_id = ?").run(convId, next.user_id);
  }
  hub.toConversationMembers(convId, (uid) => ["conversation:updated", conversationSummary(convId, uid)]);
  systemMessage(convId, req.user.id, leaving ? `${name} left the group` : `${actorName(req.user.id)} removed ${name}`);
  res.json({ ok: true });
});
router.post("/conversations/:id/admins/:userId", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const targetId = num(req.params.userId);
  const check = requireGroupAdmin(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  db.prepare("UPDATE conversation_members SET is_admin = 1 WHERE conversation_id = ? AND user_id = ?").run(convId, targetId);
  hub.toConversationMembers(convId, (uid) => ["conversation:updated", conversationSummary(convId, uid)]);
  systemMessage(convId, req.user.id, `${publicUser(userById(targetId))?.displayName} is now an admin`);
  res.json(conversationSummary(convId, req.user.id));
});
router.delete("/conversations/:id/admins/:userId", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const targetId = num(req.params.userId);
  const check = requireGroupAdmin(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  if (targetId === check.conv.created_by) return res.status(403).json({ error: "The group's creator stays an admin" });
  db.prepare("UPDATE conversation_members SET is_admin = 0 WHERE conversation_id = ? AND user_id = ?").run(convId, targetId);
  hub.toConversationMembers(convId, (uid) => ["conversation:updated", conversationSummary(convId, uid)]);
  res.json(conversationSummary(convId, req.user.id));
});
router.get("/conversations/:id/messages", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireMember(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const limit = Math.min(Number(req.query.limit) || LIMITS.pageSize, 100);
  const before = num(req.query.before);
  const after = num(req.query.after);
  const around = num(req.query.around);
  let rows;
  if (around) {
    const half = Math.floor(limit / 2);
    const earlier = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND id <= ? ORDER BY id DESC LIMIT ?").all(convId, around, half).reverse();
    const later = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT ?").all(convId, around, half);
    rows = [...earlier, ...later];
  } else if (before) {
    rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?").all(convId, before, limit).reverse();
  } else if (after) {
    rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT ?").all(convId, after, limit);
  } else {
    rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?").all(convId, limit).reverse();
  }
  const oldest = rows[0]?.id;
  const hasMore = oldest ? !!db.prepare("SELECT 1 FROM messages WHERE conversation_id = ? AND id < ?").get(convId, oldest) : false;
  res.json({ messages: serializeMessages(rows, req.user.id), hasMore });
});
router.get("/conversations/:id/pinned", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireMember(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC").all(convId);
  res.json(serializeMessages(rows, req.user.id));
});
router.get("/conversations/:id/media", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireMember(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const type = req.query.type;
  const rows = db.prepare(
    `SELECT * FROM messages
        WHERE conversation_id = ? AND attachment_url IS NOT NULL AND deleted_at IS NULL
          AND (? IS NULL OR attachment_type = ?)
        ORDER BY id DESC LIMIT 120`
  ).all(convId, type || null, type || null);
  res.json(serializeMessages(rows, req.user.id));
});
router.post("/conversations/:id/read", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireMember(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const last = db.prepare("SELECT MAX(id) m FROM messages WHERE conversation_id = ?").get(convId).m || 0;
  db.prepare("UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?").run(
    last,
    convId,
    req.user.id
  );
  hub.toConversation(convId, "read:update", { conversationId: convId, userId: req.user.id, lastReadMessageId: last });
  hub.toUser(req.user.id, "conversation:updated", conversationSummary(convId, req.user.id));
  res.json({ ok: true, lastReadMessageId: last });
});
router.get("/conversations/:id/export", requireAuth, (req, res) => {
  const convId = num(req.params.id);
  const check = requireMember(convId, req.user.id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const summary = conversationSummary(convId, req.user.id);
  const rows = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id").all(convId);
  const messages = serializeMessages(rows, req.user.id);
  const slug = summary.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  if (req.query.format === "txt") {
    const lines = messages.map((m) => {
      const when = new Date(m.createdAt).toISOString().replace("T", " ").slice(0, 16);
      if (m.kind === "system") return `[${when}] * ${m.content}`;
      const body = m.deletedAt ? "(deleted)" : m.content || `(${m.attachment?.type || "attachment"})`;
      return `[${when}] ${m.sender?.displayName}: ${body}`;
    });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}.txt"`);
    return res.send([`# ${summary.name}`, "", ...lines].join("\n"));
  }
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.json"`);
  res.json({ conversation: summary, messages, exportedAt: Date.now() });
});
module.exports = router;
