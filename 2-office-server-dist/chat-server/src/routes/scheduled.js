"use strict";
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../lib/auth");
const { requireMember, blockedEitherWay, counterpart } = require("../lib/access");
const { LIMITS } = require("../config");
const router = express.Router();
function serialize(row) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(row.conversation_id);
  const other = conv && !conv.is_group ? db.prepare(
    `SELECT u.display_name FROM users u
             JOIN conversation_members cm ON cm.user_id = u.id
            WHERE cm.conversation_id = ? AND u.id != ?`
  ).get(row.conversation_id, row.sender_id) : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    conversationName: conv?.is_group ? conv.name || "Group chat" : other?.display_name || "Chat",
    content: row.content,
    attachment: row.attachment_json ? JSON.parse(row.attachment_json) : null,
    replyToId: row.reply_to_id || null,
    sendAt: row.send_at,
    createdAt: row.created_at
  };
}
router.get("/scheduled", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM scheduled_messages WHERE sender_id = ? AND sent_at IS NULL ORDER BY send_at").all(req.user.id);
  res.json(rows.map(serialize));
});
router.post("/conversations/:id/schedule", requireAuth, (req, res) => {
  const conversationId = Number(req.params.id);
  const guard = requireMember(conversationId, req.user.id);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  const { content = "", attachment = null, replyToId = null, sendAt } = req.body || {};
  const when = Number(sendAt);
  const text = String(content || "").slice(0, LIMITS.messageContent).trim();
  if (!text && !attachment) return res.status(400).json({ error: "Nothing to schedule" });
  if (!Number.isFinite(when)) return res.status(400).json({ error: "A send time is required" });
  if (when < Date.now() + 3e4) return res.status(400).json({ error: "Pick a time at least a minute from now" });
  if (when > Date.now() + LIMITS.scheduleMaxDays * 864e5) {
    return res.status(400).json({ error: `Messages can be scheduled up to ${LIMITS.scheduleMaxDays} days ahead` });
  }
  if (!guard.conv.is_group) {
    const other = counterpart(conversationId, req.user.id);
    if (other && blockedEitherWay(req.user.id, other.id)) {
      return res.status(403).json({ error: "You can't message this person" });
    }
  }
  const pending = db.prepare("SELECT COUNT(*) c FROM scheduled_messages WHERE sender_id = ? AND sent_at IS NULL").get(req.user.id).c;
  if (pending >= LIMITS.scheduleMaxPending) {
    return res.status(429).json({ error: "You already have the maximum number of scheduled messages" });
  }
  const validReplyTo = replyToId ? db.prepare("SELECT id FROM messages WHERE id = ? AND conversation_id = ?").get(replyToId, conversationId)?.id ?? null : null;
  const info = db.prepare(
    `INSERT INTO scheduled_messages
         (conversation_id, sender_id, content, attachment_json, reply_to_id, send_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    conversationId,
    req.user.id,
    text,
    attachment ? JSON.stringify(attachment) : null,
    validReplyTo,
    when,
    Date.now()
  );
  res.json(serialize(db.prepare("SELECT * FROM scheduled_messages WHERE id = ?").get(info.lastInsertRowid)));
});
router.delete("/scheduled/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM scheduled_messages WHERE id = ?").get(Number(req.params.id));
  if (!row || row.sender_id !== req.user.id) return res.status(404).json({ error: "Scheduled message not found" });
  if (row.sent_at) return res.status(409).json({ error: "That message has already been sent" });
  db.prepare("DELETE FROM scheduled_messages WHERE id = ?").run(row.id);
  res.json({ ok: true });
});
module.exports = router;
