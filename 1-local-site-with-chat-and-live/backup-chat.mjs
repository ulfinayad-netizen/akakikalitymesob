#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => {
  const i = process.argv.indexOf("--" + n);
  return i > -1 ? process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "true" : null;
};
const DATA = process.env.MESOB_CHAT_DATA || path.join(here, "chat-server", "data");
const DB = path.join(DATA, "chat.db"), UPLOADS = path.join(DATA, "uploads");
const KEEP = Number(arg("keep") || 30);
function findDrive() {
  const h = os.homedir(), c = [arg("to"), process.env.MESOB_BACKUP_DIR, "G:\\My Drive", "H:\\My Drive", "D:\\My Drive", path.join(h, "Google Drive"), path.join(h, "My Drive"), path.join(h, "Google Drive", "My Drive"), "/Volumes/GoogleDrive/My Drive", path.join(h, "storage", "shared")];
  for (const p of c) if (p && fs.existsSync(p)) return p;
  return null;
}
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};
function mirror(src, dst) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += mirror(s, d);
    else {
      const st = fs.statSync(s);
      if (!fs.existsSync(d) || fs.statSync(d).size !== st.size) {
        fs.copyFileSync(s, d);
        n++;
      }
    }
  }
  return n;
}
function backup() {
  const root = findDrive();
  if (!root) {
    console.log('Google Drive folder not found. Install Google Drive for desktop (sign in as ulfinayadessa2017@gmail.com) or use  --to "<folder>".');
    return false;
  }
  if (!fs.existsSync(DB)) {
    console.log(`No chat database yet at ${DB} (start the site once).`);
    return false;
  }
  const out = path.join(root, "MesobBackup"), dbDir = path.join(out, "chat-db");
  fs.mkdirSync(dbDir, { recursive: true });
  const file = path.join(dbDir, `chat-${stamp()}.db`);
  const db = new DatabaseSync(DB);
  try {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const files = mirror(UPLOADS, path.join(out, "uploads"));
  for (const f of ["staff-list.json", "branches.json"]) if (fs.existsSync(path.join(here, f))) fs.copyFileSync(path.join(here, f), path.join(out, f));
  const old = fs.readdirSync(dbDir).filter((f) => /^chat-.*\.db$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.unlinkSync(path.join(dbDir, f));
  console.log(`[${(new Date()).toLocaleString()}] Backup saved to ${out}  (database + ${files} new upload file(s); ${old.length} old copy removed)`);
  return true;
}
const restore = arg("restore");
if (restore) {
  if (!fs.existsSync(restore)) {
    console.log("File not found: " + restore);
    process.exit(1);
  }
  fs.mkdirSync(DATA, { recursive: true });
  if (fs.existsSync(DB)) fs.copyFileSync(DB, DB + ".before-restore");
  for (const x of ["-wal", "-shm"]) try {
    fs.unlinkSync(DB + x);
  } catch {
  }
  fs.copyFileSync(restore, DB);
  console.log("Restored. Start the site again. (The old file was kept as chat.db.before-restore)");
} else {
  backup();
  const h = Number(arg("every"));
  if (h > 0) {
    console.log(`Repeating every ${h} hour(s). Keep this window open.`);
    setInterval(backup, h * 3600 * 1e3);
  }
}
