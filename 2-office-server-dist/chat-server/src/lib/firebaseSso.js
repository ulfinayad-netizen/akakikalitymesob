"use strict";
const fs = require("fs");
const path = require("path");
const KEYS = {
  employee: "serviceAccountKey.employee.json",
  admin: "serviceAccountKey.admin.json"
};
let admin = null;
try {
  admin = require("firebase-admin");
} catch {
  admin = null;
}
const apps = {};
function appFor(project) {
  if (!admin) return null;
  if (project in apps) return apps[project];
  const keyFile = KEYS[project];
  const keyPath = keyFile && path.join(__dirname, "..", "..", keyFile);
  if (!keyPath || !fs.existsSync(keyPath)) {
    apps[project] = null;
    return null;
  }
  const name = `chat-sso-${project}`;
  const existing = admin.apps.find((a) => a && a.name === name);
  apps[project] = existing || admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf-8"))) }, name);
  return apps[project];
}
function ssoAvailable() {
  return Boolean(admin) && Object.keys(KEYS).some((p) => appFor(p));
}
async function verifyIdToken(idToken, project) {
  const app = appFor(project);
  if (!app) throw new Error(`SSO is not configured for the "${project}" project`);
  const decoded = await admin.auth(app).verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    displayName: decoded.name || null
  };
}
module.exports = { ssoAvailable, verifyIdToken, PROJECTS: Object.keys(KEYS) };
