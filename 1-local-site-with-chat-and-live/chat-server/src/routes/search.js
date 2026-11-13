"use strict";
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../lib/auth");
const { serializeMessages, conversationSummary } = require("../lib/serialize");
const router = express.Router();
const ftsEnabled = db.ftsEnabled;
function parseQuery(raw) {
  const filters = { from: null, has: null, starred: false, conversationId: null };
  const words = [];
  raw.split(/\s+/).forEach((token) => {
    const [key, value] = token.split(":");
    if (value && key === "from") filters.from = value.toLowerCase();
    else if (value && key === "has") filters.has = value.toLowerCase();
    else if (value && key === "is" && value.toLowerCase() === "starred") filters.starred = true;
    else if (value && key === "in") filters.conversationId = Number(value) || null;
    else if (token) words.push(token);
  });
  return { filters, text: words.join(" ").trim() };
}
const ftsExpression = (text) => text.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, "")}"*`).join(" AND ");
router.get("/search", requireAuth, (req, res) => {
  const raw = String(req.query.q || "").trim();
  if (!raw) return res.json([]);
  const { filters, text } = parseQuery(raw);
  const convIds = db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id = ?").all(req.user.id).map((r) => r.conversation_id).filter((id) => !filters.conversationId || id === filters.conversationId);
  if (convIds.length === 0) return res.json([]);
  const scope = convIds.map(() => "?").join(",");
  const where = [`m.conversation_id IN (${scope})`, "m.deleted_at IS NULL", "m.kind != 'system'"];
  const params = [...convIds];
  if (filters.from) {
    where.push("LOWER(u.username) = ? OR LOWER(u.display_name) = ?");
    params.push(filters.from, filters.from);
  }
  if (filters.has === "link") where.push("m.content LIKE '%http%'");
  else if (filters.has) {
    where.push("m.attachment_type = ?");
    params.push(filters.has);
  }
  if (filters.starred) {
    where.push("EXISTS (SELECT 1 FROM message_stars s WHERE s.message_id = m.id AND s.user_id = ?)");
    params.push(req.user.id);
  }
  let rows;
  if (text && ftsEnabled) {
    const sql = `
      SELECT m.* FROM messages_fts f
        JOIN messages m ON m.id = f.rowid
        JOIN users u ON u.id = m.sender_id
       WHERE messages_fts MATCH ? AND ${where.join(" AND ")}
       ORDER BY bm25(messages_fts) ASC, m.id DESC
       LIMIT 50`;
    try {
      rows = db.prepare(sql).all(ftsExpression(text), ...params);
    } catch {
      rows = null;
    }
  }
  if (!rows) {
    const like = text ? "AND m.content LIKE ?" : "";
    rows = db.prepare(
      `SELECT m.* FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE ${where.join(" AND ")} ${like}
          ORDER BY m.id DESC LIMIT 50`
    ).all(...params, ...text ? [`%${text}%`] : []);
  }
  const nameCache = new Map();
  const results = serializeMessages(rows, req.user.id).map((m) => {
    if (!nameCache.has(m.conversationId)) {
      nameCache.set(m.conversationId, conversationSummary(m.conversationId, req.user.id)?.name || "");
    }
    return { ...m, conversationName: nameCache.get(m.conversationId) };
  });
  res.json(results);
});
module.exports = router;
