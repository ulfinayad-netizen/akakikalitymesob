"use strict";
const path = require("path");
const db = require("../src/db");
const { DB_PATH } = require("../src/config");
const filter = (process.argv[2] || "").toLowerCase();
const rows = db.prepare("SELECT id, username, display_name, firebase_uid, must_change_password, created_at, last_seen_at FROM users ORDER BY username COLLATE NOCASE").all();
console.log(`Database: ${path.resolve(DB_PATH)}`);
console.log(`Accounts: ${rows.length}
`);
if (rows.length === 0) {
  console.log("There are no accounts at all, which is why every sign-in fails.");
  console.log("Create the staff roster with:   npm run seed-users");
  console.log('Or a single account with:       npm run create-account -- <username> <password> "Display Name"');
  process.exit(0);
}
const shown = filter ? rows.filter((r) => `${r.username} ${r.display_name || ""}`.toLowerCase().includes(filter)) : rows;
if (shown.length === 0) {
  console.log(`No account matches "${filter}".`);
  console.log('Sign-in uses the USERNAME column below, which for seeded staff is a name like "UlfinaY", not an email address.');
  process.exit(0);
}
const pad = (s, n) => String(s === null || s === void 0 ? "" : s).padEnd(n).slice(0, n);
console.log(pad("USERNAME", 22) + pad("DISPLAY NAME", 26) + pad("SIGN-IN METHOD", 20) + "NOTE");
console.log("-".repeat(92));
let ssoCount = 0;
for (const r of shown) {
  const sso = Boolean(r.firebase_uid);
  if (sso) ssoCount++;
  console.log(
    pad(r.username, 22) + pad(r.display_name, 26) + pad(sso ? "Firebase SSO" : "Password", 20) + (sso ? "no password \u2014 sign in with the Firebase account" : r.must_change_password ? "must change password on first sign-in" : "")
  );
}
console.log("");
if (ssoCount > 0) {
  console.log(`${ssoCount} account(s) are single sign-on only. Typing a password for those will always be rejected \u2014`);
  console.log("they are reached by signing in with the Firebase email that created them.");
}
console.log('To set or reset a password:  npm run create-account -- <username> <password> "Display Name"');
