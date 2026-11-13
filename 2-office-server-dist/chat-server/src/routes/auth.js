"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const hub = require("../lib/hub");
const { signToken, requireAuth } = require("../lib/auth");
const { ssoAvailable, verifyIdToken, PROJECTS } = require("../lib/firebaseSso");
const { publicUser, invalidateUser, conversationSummary } = require("../lib/serialize");
const { AVATAR_COLORS, LIMITS, ALLOW_SELF_REGISTRATION } = require("../config");
const router = express.Router();
const USERNAME_RE = /^[a-zA-Z0-9_.@+-]{3,64}$/;
router.post("/register", (req, res) => {
  if (!ALLOW_SELF_REGISTRATION) {
    return res.status(403).json({ error: "Sign-up is closed \u2014 ask an administrator for an account" });
  }
  const { username, password, displayName } = req.body || {};
  if (!USERNAME_RE.test(username || "")) {
    return res.status(400).json({ error: "Use an email address, or 3\u201364 characters: letters, numbers, . _ - @" });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  if (db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username)) {
    return res.status(409).json({ error: "That username is already taken" });
  }
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const info = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, avatar_color, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(username, bcrypt.hashSync(password, 10), (displayName || username).slice(0, LIMITS.displayName), color, Date.now(), Date.now());
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.json({ token: signToken(user), user: publicUser(user) });
});
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const identifier = String(username || "").trim();
  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(identifier);
  if (!user || user.firebase_uid || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});
router.post("/sso", async (req, res) => {
  const { idToken, project } = req.body || {};
  if (!ssoAvailable()) {
    return res.status(503).json({
      error: "Single sign-on is not configured on the chat server \u2014 add serviceAccountKey.employee.json and/or serviceAccountKey.admin.json to chat-server/. See src/lib/firebaseSso.js."
    });
  }
  if (!idToken || !PROJECTS.includes(project)) {
    return res.status(400).json({ error: "Expected { idToken, project } with a known project" });
  }
  let identity;
  try {
    identity = await verifyIdToken(idToken, project);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  let user = db.prepare("SELECT * FROM users WHERE firebase_project = ? AND firebase_uid = ?").get(project, identity.uid);
  if (!user) {
    const preferred = identity.email || `${project}:${identity.uid}`;
    const existing = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(preferred);
    if (existing && !existing.firebase_uid) {
      db.prepare("UPDATE users SET firebase_uid = ?, firebase_project = ? WHERE id = ?").run(
        identity.uid,
        project,
        existing.id
      );
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
    } else {
      const username = existing ? `${project}:${identity.uid}` : preferred;
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
      const unusable = bcrypt.hashSync(require("crypto").randomBytes(32).toString("hex"), 10);
      const now = Date.now();
      const info = db.prepare(
        `INSERT INTO users (username, password_hash, display_name, avatar_color, created_at, last_seen_at,
                              firebase_uid, firebase_project)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        username,
        unusable,
        (identity.displayName || identity.email || username).slice(0, LIMITS.displayName),
        color,
        now,
        now,
        identity.uid,
        project
      );
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    }
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});
router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(publicUser(user));
});
router.patch("/me", requireAuth, (req, res) => {
  const { displayName, bio, avatarColor, avatarUrl, statusText, statusEmoji, statusUntil } = req.body || {};
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!current) return res.status(404).json({ error: "User not found" });
  const next = {
    displayName: displayName !== void 0 ? String(displayName).trim().slice(0, LIMITS.displayName) || current.display_name : current.display_name,
    bio: bio !== void 0 ? String(bio).slice(0, LIMITS.bio) : current.bio,
    avatarColor: avatarColor && AVATAR_COLORS.includes(avatarColor) ? avatarColor : current.avatar_color,
    avatarUrl: avatarUrl !== void 0 ? avatarUrl || null : current.avatar_url,
    statusText: statusText !== void 0 ? String(statusText || "").trim().slice(0, LIMITS.statusText) || null : current.status_text,
    statusEmoji: statusEmoji !== void 0 ? String(statusEmoji || "").slice(0, LIMITS.emoji) || null : current.status_emoji,
    statusUntil: statusUntil !== void 0 ? Number(statusUntil) || null : current.status_until
  };
  db.prepare(
    `UPDATE users SET display_name = ?, bio = ?, avatar_color = ?, avatar_url = ?,
                      status_text = ?, status_emoji = ?, status_until = ?
      WHERE id = ?`
  ).run(
    next.displayName,
    next.bio,
    next.avatarColor,
    next.avatarUrl,
    next.statusText,
    next.statusEmoji,
    next.statusUntil,
    req.user.id
  );
  invalidateUser(req.user.id);
  const updated = publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id));
  hub.peersOf(req.user.id).forEach((id) => hub.toUser(id, "user:updated", updated));
  db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id = ?").all(req.user.id).forEach(
    ({ conversation_id: cid }) => hub.toConversationMembers(cid, (userId) => ["conversation:updated", conversationSummary(cid, userId)])
  );
  res.json(updated);
});
router.post("/me/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword || "", user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    bcrypt.hashSync(newPassword, 10),
    req.user.id
  );
  res.json({ ok: true });
});
module.exports = router;
