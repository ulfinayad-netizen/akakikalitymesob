import "dotenv/config";
import express from "express";
import cors from "cors";
import contactRouter from "./routes/contact.js";
import chatTokenRouter from "./routes/chat-token.js";
const app = express();
const PORT = process.env.PORT || 4e3;
app.use(cors());
app.use(express.json());
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "mesob-server" });
});
app.use("/api/contact", contactRouter);
app.use("/api/chat-token", chatTokenRouter);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});
app.listen(PORT, () => {
  console.log(`Mesob API listening on http://localhost:${PORT}`);
});
