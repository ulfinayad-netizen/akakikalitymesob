"use strict";
const express = require("express");
const db = require("../db");
const hub = require("../lib/hub");
const { requireAuth } = require("../lib/auth");
const { publicUser, conversationSummary } = require("../lib/serialize");
const { isBlocked } = require("../lib/access");
const router = express.Router();
router.get("/users", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const rows = db.prepare("SELECT * FROM users WHERE id != ? ORDER BY display_name COLLATE NOCASE").all(req.user.id);
  const filtered = q ? rows.filter(
    (u) => u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
  ) : rows;
  res.json(
    filtered.map((u) => ({
      ...publicUser(u),
      online: hub.isOnline(u.id),
      blockedByMe: isBlocked(req.user.id, u.id),
      blockingMe: isBlocked(u.id, req.user.id)
    }))
  );
});
router.get("/users/:id", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    ...publicUser(user),
    online: hub.isOnline(user.id),
    blockedByMe: isBlocked(req.user.id, user.id)
  });
});
router.get("/blocked", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC").all(req.user.id);
  res.json(rows.map(publicUser));
});
function refreshDirectChats(userId, otherId) {
  const rows = db.prepare(
    `SELECT c.id FROM conversations c
         JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
         JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
        WHERE c.is_group = 0`
  ).all(userId, otherId);
  rows.forEach(
    ({ id }) => hub.toConversationMembers(id, (uid) => ["conversation:updated", conversationSummary(id, uid)])
  );
}
router.post("/users/:id/block", requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: "You can't block yourself" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(targetId)) {
    return res.status(404).json({ error: "User not found" });
  }
  db.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(
    req.user.id,
    targetId,
    Date.now()
  );
  refreshDirectChats(req.user.id, targetId);
  res.json({ ok: true });
});
router.delete("/users/:id/block", requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(req.user.id, targetId);
  refreshDirectChats(req.user.id, targetId);
  res.json({ ok: true });
});
module.exports = router;
