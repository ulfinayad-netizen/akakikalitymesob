"use strict";
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { UPLOAD_DIR, CLIENT_DIST } = require("./config");
function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));
  const API = ["/api", "/chat-api"];
  app.use(API, require("./routes/misc"));
  app.use(API, require("./routes/auth"));
  app.use(API, require("./routes/users"));
  app.use(API, require("./routes/conversations"));
  app.use(API, require("./routes/messages"));
  app.use(API, require("./routes/search"));
  app.use(API, require("./routes/scheduled"));
  app.use(API, (req, res) => res.status(404).json({ error: "Unknown endpoint" }));
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/socket.io")) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
      if (err) res.status(404).send("Client build not found \u2014 run `npm run build` in client/.");
    });
  });
  app.use((err, req, res, next) => {
    console.error("[api]", err);
    res.status(500).json({ error: "Something went wrong" });
  });
  return app;
}
module.exports = { createApp };
