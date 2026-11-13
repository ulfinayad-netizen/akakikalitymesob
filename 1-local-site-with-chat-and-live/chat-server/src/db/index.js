"use strict";
const fs = require("fs");
const path = require("path");
const Database = require("./driver");
const { DB_PATH } = require("../config");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#3E8E8A',
  avatar_url TEXT,
  bio TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  is_group INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  description TEXT,
  avatar_color TEXT,
  avatar_url TEXT,
  ttl_seconds INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',       -- text | system | poll
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  expires_at INTEGER,
  attachment_url TEXT,
  attachment_type TEXT,
  attachment_name TEXT,
  attachment_size INTEGER,
  attachment_duration INTEGER,
  attachment_waveform TEXT,
  reply_to_id INTEGER,
  forwarded_from_id INTEGER,
  pinned_at INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS message_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  edited_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_mentions (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_stars (
  user_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, message_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  multi INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, option_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachment_json TEXT,
  reply_to_id INTEGER,
  send_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  sent_message_id INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_expiry ON messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(conversation_id, pinned_at);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON message_mentions(user_id);
CREATE INDEX IF NOT EXISTS idx_stars_user ON message_stars(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_edits_message ON message_edits(message_id, edited_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_messages(sent_at, send_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_user ON scheduled_messages(sender_id, send_at);
`);
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
function addColumn(table, column, def) {
  if (!columns(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn("users", "avatar_url", "TEXT");
addColumn("users", "bio", "TEXT");
addColumn("users", "last_seen_at", "INTEGER");
addColumn("users", "status_text", "TEXT");
addColumn("users", "status_emoji", "TEXT");
addColumn("users", "status_until", "INTEGER");
addColumn("users", "firebase_uid", "TEXT");
addColumn("users", "firebase_project", "TEXT");
addColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
addColumn("conversations", "description", "TEXT");
addColumn("conversations", "avatar_color", "TEXT");
addColumn("conversations", "avatar_url", "TEXT");
addColumn("conversations", "ttl_seconds", "INTEGER NOT NULL DEFAULT 0");
addColumn("conversation_members", "is_admin", "INTEGER NOT NULL DEFAULT 0");
addColumn("conversation_members", "muted_until", "INTEGER NOT NULL DEFAULT 0");
addColumn("conversation_members", "archived", "INTEGER NOT NULL DEFAULT 0");
addColumn("conversation_members", "pinned", "INTEGER NOT NULL DEFAULT 0");
addColumn("messages", "kind", "TEXT NOT NULL DEFAULT 'text'");
addColumn("messages", "expires_at", "INTEGER");
addColumn("messages", "attachment_duration", "INTEGER");
addColumn("messages", "attachment_waveform", "TEXT");
addColumn("messages", "reply_to_id", "INTEGER");
addColumn("messages", "forwarded_from_id", "INTEGER");
addColumn("messages", "pinned_at", "INTEGER");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase
    ON users(firebase_project, firebase_uid)
    WHERE firebase_uid IS NOT NULL
`);
db.exec(`
  UPDATE conversation_members SET is_admin = 1
  WHERE is_admin = 0
    AND user_id IN (SELECT c.created_by FROM conversations c WHERE c.id = conversation_members.conversation_id)
    AND conversation_id IN (SELECT id FROM conversations WHERE is_group = 1)
`);
let ftsEnabled = false;
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      sender_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, conversation_id, sender_id)
      VALUES (new.id, new.content, new.conversation_id, new.sender_id);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF content ON messages BEGIN
      UPDATE messages_fts SET content = new.content WHERE rowid = new.id;
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE rowid = old.id;
    END;
  `);
  const indexed = db.prepare("SELECT COUNT(*) c FROM messages_fts").get().c;
  const total = db.prepare("SELECT COUNT(*) c FROM messages").get().c;
  if (indexed === 0 && total > 0) {
    db.exec(`
      INSERT INTO messages_fts(rowid, content, conversation_id, sender_id)
      SELECT id, content, conversation_id, sender_id FROM messages
    `);
  }
  ftsEnabled = true;
} catch (err) {
  console.warn("[db] FTS5 unavailable, search will use LIKE matching:", err.message);
}
module.exports = db;
module.exports.ftsEnabled = ftsEnabled;
