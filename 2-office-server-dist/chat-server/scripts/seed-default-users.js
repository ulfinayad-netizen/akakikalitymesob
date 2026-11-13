"use strict";
const bcrypt = require("bcryptjs");
const db = require("../src/db");
const { AVATAR_COLORS } = require("../src/config");
const DEFAULT_PASSWORD = "Mesob@123";
const resetPasswords = process.argv.includes("--reset-passwords");
const ROSTER = require("./hr-roster.json").map(({ username, name }) => ({ username, displayName: name }));
const insert = db.prepare(
  "INSERT INTO users (username, password_hash, display_name, avatar_color, created_at, last_seen_at, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)"
);
const updatePassword = db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?");
const findByUsername = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE");
let created = 0;
let resetCount = 0;
let skipped = 0;
const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
const run = db.transaction((people) => {
  people.forEach(({ username, displayName }, i) => {
    const existing = findByUsername.get(username);
    if (existing) {
      if (resetPasswords) {
        updatePassword.run(hash, existing.id);
        resetCount++;
      } else {
        skipped++;
      }
      return;
    }
    const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
    insert.run(username, hash, displayName, color, Date.now(), Date.now());
    created++;
  });
});
run(ROSTER);
console.log(`Created ${created} account(s).`);
if (skipped) console.log(`Skipped ${skipped} that already existed (use --reset-passwords to force them back to the default).`);
if (resetCount) console.log(`Reset ${resetCount} existing account(s) to the default password.`);
console.log(`
Default password for every new/reset account: ${DEFAULT_PASSWORD}`);
const listed = new Set(ROSTER.map((r) => r.username.toLowerCase()));
const strays = db.prepare("SELECT username FROM users WHERE must_change_password = 1").all().map((u) => u.username).filter((u) => !listed.has(u.toLowerCase()));
if (strays.length) {
  console.log(`
${strays.length} unused default account(s) are not in the HR list: ${strays.join(", ")}`);
  console.log("If they are duplicates of someone above, delete them in chat.db.");
}
console.log("Each person should change it after their first sign-in: Employee Portal > My Profile > Password.");
