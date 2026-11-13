"use strict";
const db = require("../db");
const membership = (conversationId, userId) => db.prepare("SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, userId);
const isMember = (conversationId, userId) => !!membership(conversationId, userId);
const isAdmin = (conversationId, userId) => !!membership(conversationId, userId)?.is_admin;
const isBlocked = (blockerId, blockedId) => !!db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(blockerId, blockedId);
const blockedEitherWay = (a, b) => isBlocked(a, b) || isBlocked(b, a);
function counterpart(conversationId, userId) {
  return db.prepare(
    `SELECT u.* FROM users u
         JOIN conversation_members cm ON cm.user_id = u.id
        WHERE cm.conversation_id = ? AND u.id != ?`
  ).get(conversationId, userId);
}
function requireGroupAdmin(conversationId, userId) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!conv || !conv.is_group) return { ok: false, status: 404, error: "Group not found" };
  const member = membership(conversationId, userId);
  if (!member) return { ok: false, status: 403, error: "Not a member of this group" };
  if (!member.is_admin) return { ok: false, status: 403, error: "Only group admins can do that" };
  return { ok: true, conv };
}
function requireMember(conversationId, userId) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) return { ok: false, status: 404, error: "Conversation not found" };
  if (!isMember(conversationId, userId)) return { ok: false, status: 403, error: "Not a member of this conversation" };
  return { ok: true, conv };
}
module.exports = {
  membership,
  isMember,
  isAdmin,
  isBlocked,
  blockedEitherWay,
  counterpart,
  requireGroupAdmin,
  requireMember
};
