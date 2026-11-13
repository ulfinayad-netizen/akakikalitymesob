import { Router } from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, "..", "data", "submissions.json");
const router = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this address. Please try again later." }
});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function appendSubmission(entry) {
  let existing = [];
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    existing = JSON.parse(raw);
  } catch {
  }
  existing.push(entry);
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(existing, null, 2), "utf-8");
}
function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}
router.post("/", limiter, async (req, res) => {
  const { name, email, phone, topic, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email, and message are required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (String(message).length > 5e3) {
    return res.status(400).json({ error: "Message is too long." });
  }
  const entry = {
    name: String(name).slice(0, 200),
    email: String(email).slice(0, 200),
    phone: phone ? String(phone).slice(0, 50) : null,
    topic: topic ? String(topic).slice(0, 200) : "General inquiry",
    message: String(message).slice(0, 5e3),
    submittedAt: (new Date()).toISOString(),
    ip: req.ip
  };
  try {
    await appendSubmission(entry);
    const transport = buildTransport();
    if (transport) {
      const toAddress = process.env.CONTACT_TO_EMAIL || process.env.SMTP_USER;
      await transport.sendMail({
        from: `"Mesob Website" <${process.env.SMTP_USER}>`,
        to: toAddress,
        replyTo: entry.email,
        subject: `[Akaki Kality Mesob] ${entry.topic} \u2014 ${entry.name}`,
        text: `Name: ${entry.name}
Email: ${entry.email}
Phone: ${entry.phone || "\u2014"}
Topic: ${entry.topic}

${entry.message}`
      });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("Contact submission failed:", err);
    res.status(500).json({ error: "Couldn't process your message right now. Please try again shortly." });
  }
});
var contact_default = router;
export {
  contact_default as default
};
