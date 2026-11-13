"use strict";
const db = require("../db");
const hub = require("./hub");
const { blockedEitherWay } = require("./access");
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    avatarUrl: u.avatar_url || null,
    bio: u.bio || null,
    lastSeenAt: u.last_seen_at || null,
    statusText: u.status_until && u.status_until <= Date.now() ? null : u.status_text || null,
    statusEmoji: u.status_until && u.status_until <= Date.now() ? null : u.status_emoji || null,
    statusUntil: u.status_until || null,
    mustChangePassword: !!u.must_change_password
  };
}
const userCache = new Map();
function userById(id) {
  if (!userCache.has(id)) userCache.set(id, db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  return userCache.get(id);
}
function invalidateUser(id) {
  userCache.delete(id);
}
function reactionsFor(messageIds) {
  if (messageIds.length === 0) return {};
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM message_reactions WHERE message_id IN (${placeholders}) ORDER BY created_at`).all(...messageIds);
  const grouped = {};
  rows.forEach((r) => {
    const byEmoji = grouped[r.message_id] ||= {};
    (byEmoji[r.emoji] ||= []).push(r.user_id);
  });
  const out = {};
  for (const [messageId, byEmoji] of Object.entries(grouped)) {
    out[messageId] = Object.entries(byEmoji).map(([emoji, userIds]) => ({
      emoji,
      userIds,
      count: userIds.length,
      users: userIds.map((id) => publicUser(userById(id))?.displayName).filter(Boolean)
    }));
  }
  return out;
}
function mentionsFor(messageIds) {
  if (messageIds.length === 0) return {};
  const placeholders = messageIds.map(() => "?").join(",");
  const out = {};
  db.prepare(`SELECT * FROM message_mentions WHERE message_id IN (${placeholders})`).all(...messageIds).forEach((r) => {
    (out[r.message_id] ||= []).push(r.user_id);
  });
  return out;
}
function starsFor(messageIds, userId) {
  if (messageIds.length === 0 || !userId) return new Set();
  const placeholders = messageIds.map(() => "?").join(",");
  return new Set(
    db.prepare(`SELECT message_id FROM message_stars WHERE user_id = ? AND message_id IN (${placeholders})`).all(userId, ...messageIds).map((r) => r.message_id)
  );
}
function pollForMessage(messageId, viewerId) {
  const poll = db.prepare("SELECT * FROM polls WHERE message_id = ?").get(messageId);
  if (!poll) return null;
  const options = db.prepare("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY position").all(poll.id);
  const votes = db.prepare("SELECT * FROM poll_votes WHERE poll_id = ?").all(poll.id);
  const voterCount = new Set(votes.map((v) => v.user_id)).size;
  return {
    id: poll.id,
    question: poll.question,
    multi: !!poll.multi,
    anonymous: !!poll.anonymous,
    closed: !!poll.closed_at,
    createdBy: poll.created_by,
    voterCount,
    myVotes: votes.filter((v) => v.user_id === viewerId).map((v) => v.option_id),
    options: options.map((o) => {
      const mine = votes.filter((v) => v.option_id === o.id);
      return {
        id: o.id,
        text: o.text,
        count: mine.length,
        voters: poll.anonymous ? [] : mine.map((v) => publicUser(userById(v.user_id))).filter(Boolean)
      };
    })
  };
}
function replyPreview(replyToId) {
  if (!replyToId) return null;
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(replyToId);
  if (!row) return null;
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: publicUser(userById(row.sender_id))?.displayName || "Member",
    content: row.deleted_at ? "This message was deleted" : row.content || (row.attachment_url ? "Attachment" : ""),
    deleted: !!row.deleted_at,
    attachmentType: row.attachment_type || null
  };
}
function serializeMessage(row, viewerId, extras = {}) {
  const { reactions = {}, mentions = {}, starred = new Set() } = extras;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    sender: publicUser(userById(row.sender_id)),
    kind: row.kind || "text",
    content: row.deleted_at ? "" : row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    deletedAt: row.deleted_at || null,
    expiresAt: row.expires_at || null,
    pinnedAt: row.pinned_at || null,
    editCount: row.edited_at ? db.prepare("SELECT COUNT(*) c FROM message_edits WHERE message_id = ?").get(row.id).c : 0,
    attachment: row.attachment_url ? {
      url: row.attachment_url,
      type: row.attachment_type,
      name: row.attachment_name,
      size: row.attachment_size,
      duration: row.attachment_duration || null,
      waveform: row.attachment_waveform ? JSON.parse(row.attachment_waveform) : null
    } : null,
    reactions: reactions[row.id] || [],
    mentions: mentions[row.id] || [],
    starred: starred.has(row.id),
    replyTo: replyPreview(row.reply_to_id),
    forwarded: !!row.forwarded_from_id,
    poll: row.kind === "poll" ? pollForMessage(row.id, viewerId) : null
  };
}
function serializeMessages(rows, viewerId) {
  const ids = rows.map((r) => r.id);
  const extras = {
    reactions: reactionsFor(ids),
    mentions: mentionsFor(ids),
    starred: starsFor(ids, viewerId)
  };
  return rows.map((row) => serializeMessage(row, viewerId, extras));
}
function messageById(id, viewerId) {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
  return row ? serializeMessages([row], viewerId)[0] : null;
}
function previewText(m) {
  if (!m) return "";
  if (m.deleted_at) return "Message deleted";
  if (m.kind === "poll") return "Poll";
  if (m.content) return m.content;
  if (m.attachment_type === "image") return "Photo";
  if (m.attachment_type === "voice") return "Voice message";
  if (m.attachment_url) return m.attachment_name || "File";
  return "";
}
function conversationSummary(conversationId, viewerId) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) return null;
  const members = db.prepare(
    `SELECT u.*, cm.last_read_message_id, cm.is_admin, cm.joined_at
         FROM users u JOIN conversation_members cm ON cm.user_id = u.id
        WHERE cm.conversation_id = ?`
  ).all(conversationId);
  const me = db.prepare("SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, viewerId);
  const lastReadId = me?.last_read_message_id || 0;
  const lastMessage = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1").get(conversationId);
  const unread = me ? db.prepare(
    `SELECT COUNT(*) c FROM messages
            WHERE conversation_id = ? AND id > ? AND sender_id != ? AND deleted_at IS NULL AND kind != 'system'`
  ).get(conversationId, lastReadId, viewerId).c : 0;
  const unreadMentions = me ? db.prepare(
    `SELECT COUNT(*) c FROM message_mentions mm
             JOIN messages m ON m.id = mm.message_id
            WHERE mm.user_id = ? AND m.conversation_id = ? AND m.id > ? AND m.deleted_at IS NULL`
  ).get(viewerId, conversationId, lastReadId).c : 0;
  const others = members.filter((m) => m.id !== viewerId);
  const direct = !conv.is_group ? others[0] : null;
  return {
    id: conv.id,
    isGroup: !!conv.is_group,
    name: conv.is_group ? conv.name || "Group chat" : direct?.display_name || "Saved messages",
    description: conv.description || null,
    avatarColor: conv.is_group ? conv.avatar_color || "#8A6FBF" : direct?.avatar_color || null,
    avatarUrl: conv.is_group ? conv.avatar_url || null : direct?.avatar_url || null,
    createdBy: conv.created_by,
    createdAt: conv.created_at,
    ttlSeconds: conv.ttl_seconds || 0,
    counterpartId: direct?.id || null,
    members: members.map((m) => ({
      ...publicUser(m),
      online: hub.isOnline(m.id),
      lastReadMessageId: m.last_read_message_id || 0,
      isAdmin: !!m.is_admin,
      joinedAt: m.joined_at
    })),
    lastMessage: lastMessage ? {
      id: lastMessage.id,
      preview: previewText(lastMessage),
      senderId: lastMessage.sender_id,
      senderName: publicUser(userById(lastMessage.sender_id))?.displayName || "",
      kind: lastMessage.kind || "text",
      createdAt: lastMessage.created_at,
      deleted: !!lastMessage.deleted_at,
      attachmentType: lastMessage.attachment_type || null
    } : null,
    unread,
    unreadMentions,
    pinnedCount: db.prepare("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND pinned_at IS NOT NULL").get(conversationId).c,
    iAmAdmin: !!me?.is_admin,
    muted: (me?.muted_until || 0) > Date.now(),
    mutedUntil: me?.muted_until || 0,
    archived: !!me?.archived,
    pinned: !!me?.pinned,
    blocked: direct ? blockedEitherWay(viewerId, direct.id) : false,
    blockedByMe: direct ? !!db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(viewerId, direct.id) : false
  };
}
function broadcastConversation(conversationId, event = "conversation:updated") {
  hub.toConversationMembers(conversationId, (userId) => [event, conversationSummary(conversationId, userId)]);
}
module.exports = {
  publicUser,
  userById,
  invalidateUser,
  reactionsFor,
  mentionsFor,
  pollForMessage,
  replyPreview,
  serializeMessage,
  serializeMessages,
  messageById,
  conversationSummary,
  broadcastConversation,
  previewText
};
