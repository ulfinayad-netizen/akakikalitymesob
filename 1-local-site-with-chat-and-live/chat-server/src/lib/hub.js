"use strict";
const db = require("../db");
let io = null;
const online = new Map();
function attach(server) {
  io = server;
}
function toUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}
function toConversation(conversationId, event, payload) {
  if (io) io.to(`conv:${conversationId}`).emit(event, payload);
}
function toConversationMembers(conversationId, build) {
  db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(conversationId).forEach(({ user_id: userId }) => {
    const [event, payload] = build(userId);
    toUser(userId, event, payload);
  });
}
function socketsForUser(userId) {
  if (!io) return [];
  return [...online.get(userId) || []].map((id) => io.sockets.sockets.get(id)).filter(Boolean);
}
function joinConversation(userId, conversationId) {
  socketsForUser(userId).forEach((s) => s.join(`conv:${conversationId}`));
}
function leaveConversation(userId, conversationId) {
  socketsForUser(userId).forEach((s) => s.leave(`conv:${conversationId}`));
}
const isOnline = (userId) => (online.get(userId)?.size || 0) > 0;
function addSocket(userId, socketId) {
  const wasOffline = !isOnline(userId);
  if (!online.has(userId)) online.set(userId, new Set());
  online.get(userId).add(socketId);
  return wasOffline;
}
function removeSocket(userId, socketId) {
  const set = online.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size > 0) return false;
  online.delete(userId);
  return true;
}
function peersOf(userId) {
  return db.prepare(
    `SELECT DISTINCT b.user_id AS id
         FROM conversation_members a
         JOIN conversation_members b ON a.conversation_id = b.conversation_id
        WHERE a.user_id = ? AND b.user_id != ?`
  ).all(userId, userId).map((r) => r.id);
}
function broadcastPresence(userId, online_, lastSeenAt) {
  peersOf(userId).forEach((id) => toUser(id, "presence:update", { userId, online: online_, lastSeenAt }));
}
module.exports = {
  attach,
  get io() {
    return io;
  },
  toUser,
  toConversation,
  toConversationMembers,
  socketsForUser,
  joinConversation,
  leaveConversation,
  isOnline,
  addSocket,
  removeSocket,
  peersOf,
  broadcastPresence
};
