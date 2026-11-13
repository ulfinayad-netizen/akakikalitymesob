"use strict";
const jwt = require("jsonwebtoken");
const { JWT_SECRET, JWT_TTL } = require("../config");
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_TTL });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
module.exports = { signToken, verifyToken, requireAuth };
