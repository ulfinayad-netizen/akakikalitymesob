"use strict";
const express = require("express");
const db = require("../db");
const hub = require("../lib/hub");
const { requireAuth } = require("../lib/auth");
const { serializeMessages, messageById, conversationSummary } = require("../lib/serialize");
const { isMember, blockedEitherWay, counterpart } = require("../lib/access");
const { createMessage } = require("../lib/messageService");
const router = express.Router();
function loadVisible(messageId, userId) {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
  if (!row || !isMember(row.conversation_id, userId)) return null;
  return row;
}
router.get("/starred", requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT m.* FROM message_stars s JOIN messages m ON m.id = s.message_id
        WHERE s.user_id = ? AND m.deleted_at IS NULL
        ORDER BY s.created_at DESC LIMIT 100`
  ).all(req.user.id);
  const messages = serializeMessages(rows, req.user.id).map((m) => ({
    ...m,
    conversationName: conversationSummary(m.conversationId, req.user.id)?.name || ""
  }));
  res.json(messages);
});
router.post("/messages/:id/star", requireAuth, (req, res) => {
  const row = loadVisible(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: "Message not found" });
  db.prepare("INSERT OR IGNORE INTO message_stars (user_id, message_id, created_at) VALUES (?, ?, ?)").run(
    req.user.id,
    row.id,
    Date.now()
  );
  hub.toUser(req.user.id, "message:updated", messageById(row.id, req.user.id));
  res.json({ ok: true });
});
router.delete("/messages/:id/star", requireAuth, (req, res) => {
  const row = loadVisible(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: "Message not found" });
  db.prepare("DELETE FROM message_stars WHERE user_id = ? AND message_id = ?").run(req.user.id, row.id);
  hub.toUser(req.user.id, "message:updated", messageById(row.id, req.user.id));
  res.json({ ok: true });
});
router.get("/messages/:id/history", requireAuth, (req, res) => {
  const row = loadVisible(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: "Message not found" });
  const revisions = db.prepare("SELECT content, edited_at FROM message_edits WHERE message_id = ? ORDER BY edited_at").all(row.id).map((r) => ({ content: r.content, editedAt: r.edited_at }));
  res.json([...revisions, { content: row.content, editedAt: row.edited_at || row.created_at, current: true }]);
});
router.post("/messages/:id/forward", requireAuth, (req, res) => {
  const source = loadVisible(Number(req.params.id), req.user.id);
  if (!source || source.deleted_at) return res.status(404).json({ error: "Message not found" });
  const targets = (req.body?.conversationIds || []).map(Number).filter((id) => isMember(id, req.user.id));
  if (targets.length === 0) return res.status(400).json({ error: "Pick at least one chat" });
  const delivered = [];
  for (const conversationId of targets) {
    const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
    if (!conv.is_group) {
      const other = counterpart(conversationId, req.user.id);
      if (other && blockedEitherWay(req.user.id, other.id)) continue;
    }
    delivered.push(
      createMessage({
        conversationId,
        senderId: req.user.id,
        content: source.content,
        attachment: source.attachment_url ? {
          url: source.attachment_url,
          type: source.attachment_type,
          name: source.attachment_name,
          size: source.attachment_size,
          duration: source.attachment_duration,
          waveform: source.attachment_waveform ? JSON.parse(source.attachment_waveform) : null
        } : null,
        forwardedFromId: source.id
      })
    );
  }
  res.json({ ok: true, count: delivered.length, messages: delivered });
});
module.exports = router;
