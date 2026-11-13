"use strict";
const bcrypt = require("bcryptjs");
const db = require("../src/db");
const { AVATAR_COLORS } = require("../src/config");
const [username, password, displayName] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: npm run create-account -- <username> <password> ["Display Name"]');
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters.");
  process.exit(1);
}
const existing = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
const hash = bcrypt.hashSync(password, 10);
const name = (displayName || username).slice(0, 64);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, display_name = ? WHERE id = ?").run(hash, name, existing.id);
  console.log(`Updated existing account "${username}" (id ${existing.id}) with the new password.`);
} else {
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const info = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, avatar_color, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(username, hash, name, color, Date.now(), Date.now());
  console.log(`Created account "${username}" (id ${info.lastInsertRowid}). You can sign in with this username and password now.`);
}
