"use strict";
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const { createApp } = require("./src/app");
const { register } = require("./src/realtime");
const { PORT, HOST, JWT_SECRET } = require("./src/config");
if (JWT_SECRET === "dev-secret-change-me-in-production" && process.env.NODE_ENV === "production") {
  console.warn("[mesob] JWT_SECRET is unset \u2014 set it before running in production.");
}
const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e6 });
register(io);
server.listen(PORT, HOST, () => console.log(`Mesob Chat server listening on http://${HOST}:${PORT}`));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`
[mesob] ${signal} received, shutting down`);
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3e3).unref();
  });
}
