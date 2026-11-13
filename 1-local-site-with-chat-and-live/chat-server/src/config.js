"use strict";
const path = require("path");
const root = path.join(__dirname, "..");
module.exports = {
  PORT: Number(process.env.PORT || 3e3),
  HOST: process.env.HOST || "0.0.0.0",
  JWT_SECRET: process.env.JWT_SECRET || "dev-secret-change-me-in-production",
  JWT_TTL: process.env.JWT_TTL || "30d",
  DB_PATH: process.env.DB_PATH || path.join(root, "chat.db"),
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(root, "uploads"),
  CLIENT_DIST: path.join(root, "..", "client", "dist"),
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  ALLOW_SELF_REGISTRATION: process.env.ALLOW_SELF_REGISTRATION === "true",
  AVATAR_COLORS: ["#0066FF", "#2F80ED", "#0047B3", "#3F6FB5", "#5B8DEF", "#1F4E9C", "#7AA2E3", "#004C99"],
  QUICK_REACTIONS: ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F389}", "\u{1F525}", "\u{1F440}"],
  STATUS_PRESETS: [
    { emoji: "\u{1F7E2}", key: "status.available" },
    { emoji: "\u{1F534}", key: "status.busy" },
    { emoji: "\u{1F4C5}", key: "status.inMeeting" },
    { emoji: "\u{1F6B6}", key: "status.away" },
    { emoji: "\u{1F334}", key: "status.onLeave" }
  ],
  TTL_PRESETS: [
    { label: "Off", seconds: 0 },
    { label: "1 hour", seconds: 3600 },
    { label: "1 day", seconds: 86400 },
    { label: "1 week", seconds: 604800 }
  ],
  LIMITS: {
    messageContent: 4e3,
    displayName: 60,
    bio: 280,
    groupName: 80,
    groupDescription: 200,
    emoji: 16,
    statusText: 80,
    pageSize: 50,
    pollOptions: 10,
    sendBurst: 20,
    sendRefillPerSec: 3,
    scheduleMaxDays: 30,
    scheduleMaxPending: 50
  }
};
