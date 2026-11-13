"use strict";
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../lib/auth");
const {
  UPLOAD_DIR,
  MAX_UPLOAD_BYTES,
  AVATAR_COLORS,
  QUICK_REACTIONS,
  TTL_PRESETS,
  STATUS_PRESETS,
  LIMITS
} = require("../config");
const router = express.Router();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, "");
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES }
});
function classify(mimetype) {
  if (mimetype.startsWith("audio/")) return "voice";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "file";
}
router.post("/upload", requireAuth, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `Files must be under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` : "Upload failed"
      });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({
      url: `/uploads/${req.file.filename}`,
      type: classify(req.file.mimetype),
      mime: req.file.mimetype,
      name: req.file.originalname,
      size: req.file.size
    });
  });
});
router.get("/config", (req, res) => {
  res.json({
    avatarColors: AVATAR_COLORS,
    quickReactions: QUICK_REACTIONS,
    ttlPresets: TTL_PRESETS,
    statusPresets: STATUS_PRESETS,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    limits: LIMITS
  });
});
router.get("/health", (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));
module.exports = router;
