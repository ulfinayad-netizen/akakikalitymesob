import { Router } from "express";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
const __dirname = dirname(fileURLToPath(import.meta.url));
const employeeKeyPath = join(__dirname, "..", "serviceAccountKey.employee.json");
const chatKeyPath = join(__dirname, "..", "serviceAccountKey.chat.json");
function loadApp(name, keyPath) {
  if (!existsSync(keyPath)) return null;
  const existing = getApps().find((a) => a.name === name);
  if (existing) return existing;
  const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
  return initializeApp({ credential: cert(serviceAccount) }, name);
}
const employeeApp = loadApp("chat-token-employee", employeeKeyPath);
const chatApp = loadApp("chat-token-chat", chatKeyPath);
const router = Router();
router.post("/", async (req, res) => {
  if (!employeeApp || !chatApp) {
    res.status(503).json({
      error: "Chat isn't configured on this server yet \u2014 missing serviceAccountKey.employee.json and/or serviceAccountKey.chat.json in server/. See server/routes/chat-token.js for setup."
    });
    return;
  }
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: "Missing Authorization: Bearer <idToken> header." });
    return;
  }
  try {
    const decoded = await getAuth(employeeApp).verifyIdToken(idToken);
    const customToken = await getAuth(chatApp).createCustomToken(decoded.uid, {
      name: decoded.name || "",
      email: decoded.email || ""
    });
    res.json({ token: customToken });
  } catch (err) {
    console.error("chat-token: failed to verify/mint", err.message);
    res.status(401).json({ error: "Invalid or expired session." });
  }
});
var chat_token_default = router;
export {
  chat_token_default as default
};
