#!/usr/bin/env node
import http from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { gzip as _gzip, brotliCompress as _brotli, constants as ZC } from "node:zlib";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { join, extname, normalize, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
const root = fileURLToPath(new URL(".", import.meta.url));
const i = process.argv.indexOf("--port");
const PORT = Number(i > -1 ? process.argv[i + 1] : 5173);
const LAN = process.argv.includes("--lan");
const MESOB = process.argv.includes("--mesob") || !!process.env.MESOB_USER;
const SHARE = process.argv.includes("--share-api");
const MBASE = (process.env.MESOB_API || "https://dashboardapi.mesobcenter.et/api").replace(/\/$/, "");
const MORIGIN = (process.env.MESOB_ORIGIN || "https://dashboard.mesobcenter.et").replace(/\/$/, "");
const jar = new Map();
let mtoken = null;
let mcreds = null;
const ask = (q, hidden) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!hidden });
  let muted = false;
  if (hidden) rl._writeToOutput = (s) => {
    if (!muted) rl.output.write(s);
    else if (/[\r\n]/.test(s)) rl.output.write("\n");
    else rl.output.write("*");
  };
  rl.question(q, (a) => {
    rl.close();
    res(a.trim());
  });
  muted = true;
});
const eat = (r) => {
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const k = kv.indexOf("=");
    jar.set(kv.slice(0, k).trim(), kv.slice(k + 1).trim());
  }
};
async function mcall(path, method = "GET", body) {
  const h = { "Content-Type": "application/json", Accept: "application/json", Origin: MORIGIN, Referer: MORIGIN + "/center/my-branch", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Mesob-local-dashboard" };
  if (mtoken) h.Authorization = `Bearer ${mtoken}`;
  if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (jar.get("csrfToken")) h["x-csrf-token"] = decodeURIComponent(jar.get("csrfToken"));
  const r = await fetch(MBASE + path, { method, headers: h, body: body ? JSON.stringify(body) : void 0 });
  eat(r);
  return r;
}
let lastLogin = 0, loginShape = "";
const findTok = (o, d = 0) => {
  if (!o || typeof o !== "object" || d > 3) return null;
  for (const [k, v] of Object.entries(o)) if (/^(access_?token|token|jwt|idToken)$/i.test(k) && typeof v === "string" && v.length > 20) return v;
  for (const v of Object.values(o)) {
    const f = findTok(v, d + 1);
    if (f) return f;
  }
  return null;
};
const keyNames = (o, pre = "", d = 0) => !o || typeof o !== "object" || d > 2 ? [] : Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" && !Array.isArray(v) ? keyNames(v, pre + k + ".", d + 1) : [pre + k]);
async function mlogin() {
  jar.clear();
  mtoken = null;
  const r = await mcall("/auth/login", "POST", mcreds);
  if (!r.ok) throw new Error(`MESOB login failed: HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  if (j.mfaRequired) throw new Error("MESOB account needs MFA");
  mtoken = findTok(j) || (jar.get("accessToken") ? decodeURIComponent(jar.get("accessToken")) : null) || (jar.get("token") ? decodeURIComponent(jar.get("token")) : null);
  lastLogin = Date.now();
  loginShape = `login reply fields: ${keyNames(j).join(", ") || "(none)"} | cookies: ${[...jar.keys()].join(", ") || "(none)"} | bearer token: ${mtoken ? "found" : "NOT found"}`;
  console.log("MESOB login OK -", loginShape);
}
async function proxy(req, res, path, search) {
  const ip = req.socket.remoteAddress || "";
  const own = new Set(Object.values(networkInterfaces()).flat().filter(Boolean).map((n) => n.address));
  const rip = ip.replace(/^::ffff:/, "");
  if (!SHARE && !/^(::1|127\.0\.0\.1)$/.test(rip) && !own.has(rip)) {
    res.writeHead(403);
    return res.end("API proxy is local-only (use --share-api to let other computers see live data)");
  }
  if (!MESOB || !mcreds) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "start the server with --mesob" }));
  }
  if (req.method !== "GET") {
    res.writeHead(405);
    return res.end("read-only");
  }
  try {
    if (!mtoken && !jar.size) await mlogin();
    let r = await mcall(path + search);
    if ((r.status === 401 || r.status === 403) && Date.now() - lastLogin > 2e4) {
      await mlogin();
      r = await mcall(path + search);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) console.log(`[mesob] HTTP ${r.status} ${path}${search}  ->  ${buf.toString().slice(0, 300)}`);
    res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json", "Cache-Control": "no-store" });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}
const okOrigin = (o) => {
  if (!o) return false;
  if (o === "null") return true;
  try {
    const h = new URL(o).hostname;
    return h === "localhost" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  } catch {
    return false;
  }
};
const corsHeaders = (req) => okOrigin(req.headers.origin) ? { "Access-Control-Allow-Origin": req.headers.origin, "Access-Control-Allow-Private-Network": "true", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" } : {};
async function diag(req, res) {
  const rip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const own = new Set(Object.values(networkInterfaces()).flat().filter(Boolean).map((n) => n.address));
  if (!SHARE && !/^(::1|127\.0\.0\.1)$/.test(rip) && !own.has(rip)) {
    res.writeHead(403);
    return res.end("local-only");
  }
  const out = { note: "No passwords or tokens are shown here." };
  try {
    if (!MESOB || !mcreds) throw new Error("server not started with --mesob");
    await mlogin();
    out.login = loginShape;
    const get = async (p) => {
      const r = await mcall(p);
      const t = await r.text();
      let j;
      try {
        j = JSON.parse(t);
      } catch {
        j = t;
      }
      return { status: r.status, body: j };
    };
    const me = await get("/auth/me");
    out.me = { status: me.status, role: me.body?.role ?? me.body?.user?.role, permissions: me.body?.permissions, branch: me.body?.branch ?? me.body?.user?.branch, fields: keyNames(me.body) };
    const br = await get("/branches/my/branch");
    out.myBranch = { status: br.status, _id: br.body?._id, slug: br.body?.slug, name: br.body?.name, region: br.body?.region?.slug ?? br.body?.region };
    const keys = [...new Set([br.body?.slug, br.body?._id, br.body?.name, me.body?.branch?.slug, me.body?.user?.branch?.slug].filter(Boolean))];
    out.analytics = {};
    for (const k of keys) {
      const g = await get(`/analytics/branch/${encodeURIComponent(k)}/qms/stats?timeframe=all`);
      out.analytics[k] = { status: g.status, body: JSON.stringify(g.body).slice(0, 400) };
    }
    const tf = await get("/analytics/timeframes");
    out.timeframes = { status: tf.status, body: JSON.stringify(tf.body).slice(0, 300) };
  } catch (e) {
    out.error = String(e.message || e);
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(out, null, 2));
}
if (MESOB) {
  const tty = process.stdin.isTTY;
  mcreds = { username: process.env.MESOB_USER || (tty ? await ask("MESOB username: ") : ""), password: process.env.MESOB_PASS || (tty ? await ask("MESOB password (hidden): ", true) : "") };
  if (!mcreds.username || !mcreds.password) {
    console.log("MESOB_USER / MESOB_PASS not set - live data disabled");
    mcreds = null;
  }
  if (mcreds) try {
    await mlogin();
  } catch (e) {
    console.log(String(e.message));
  }
}
const argOf = (n) => {
  const k = process.argv.indexOf(n);
  return k > -1 ? process.argv[k + 1] : void 0;
};
const CHAT_DIR = join(root, "chat-server");
const CHAT_DATA = join(CHAT_DIR, "data");
const CHAT_PORT = Number(argOf("--chat-port") || process.env.CHAT_PORT || 3100);
let chatUp = !process.argv.includes("--no-chat") && existsSync(join(CHAT_DIR, "server.js"));
let chatChild = null, chatStopping = false;
const nodeVer = process.versions.node.split(".").map(Number);
function stopChat() {
  chatStopping = true;
  try {
    chatChild?.kill();
  } catch {
  }
}
process.on("exit", stopChat);
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => {
  stopChat();
  process.exit(0);
});
async function startChat() {
  if (!chatUp) return;
  const [maj, min] = nodeVer;
  if (maj < 22 || maj === 22 && min < 5) {
    console.log(`[chat] Mesob Chat needs Node.js 22.13 or newer (this is ${process.versions.node}). Install the LTS from https://nodejs.org - chat is OFF, the rest of the site works.`);
    chatUp = false;
    return;
  }
  const nodeFlags = maj === 22 && min < 13 ? ["--experimental-sqlite"] : [];
  mkdirSync(join(CHAT_DATA, "uploads"), { recursive: true });
  const secretFile = join(CHAT_DATA, "jwt-secret.txt");
  if (!process.env.JWT_SECRET && !existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString("hex"));
  const env = { ...process.env, NODE_ENV: "production", PORT: String(CHAT_PORT), HOST: "127.0.0.1", DB_PATH: join(CHAT_DATA, "chat.db"), UPLOAD_DIR: join(CHAT_DATA, "uploads"), JWT_SECRET: process.env.JWT_SECRET || readFileSync(secretFile, "utf8").trim() };
  if (!existsSync(join(CHAT_DIR, "node_modules", "express"))) {
    console.log("[chat] first start: installing the chat server's packages (needs internet, one time) ...");
    const npm = process.platform === "win32" ? existsSync(join(dirname(process.execPath), "npm.cmd")) ? `"${join(dirname(process.execPath), "npm.cmd")}"` : "npm.cmd" : "npm";
    const r = spawnSync(npm, ["install", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"], { cwd: CHAT_DIR, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) {
      console.log("[chat] could not install the packages. Run  npm install  inside the chat-server folder. Chat is OFF for now.");
      chatUp = false;
      return;
    }
  }
  if (!existsSync(env.DB_PATH)) {
    console.log("[chat] first start: creating the default chat accounts from the HR list ...");
    const r = spawnSync(process.execPath, [...nodeFlags, "scripts/seed-default-users.js"], { cwd: CHAT_DIR, env, stdio: "inherit" });
    if (r.status !== 0) {
      console.log("[chat] could not create the chat database (see above). Chat is OFF for now.");
      chatUp = false;
      return;
    }
  }
  let quick = 0;
  const launch = () => {
    const t0 = Date.now();
    chatChild = spawn(process.execPath, [...nodeFlags, "server.js"], { cwd: CHAT_DIR, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    for (const st of [chatChild.stdout, chatChild.stderr]) {
      let buf = "";
      st.on("data", (d) => {
        buf += d;
        let n;
        while ((n = buf.indexOf("\n")) > -1) {
          console.log("[chat] " + buf.slice(0, n).replace(/\r$/, ""));
          buf = buf.slice(n + 1);
        }
      });
    }
    chatChild.on("exit", (code) => {
      if (chatStopping) return;
      quick = Date.now() - t0 < 5e3 ? quick + 1 : 0;
      if (quick >= 3) {
        console.log(`[chat] keeps failing to start (port ${CHAT_PORT} busy? try --chat-port 3200). Chat is OFF; the rest of the site still works.`);
        chatUp = false;
        return;
      }
      console.log(`[chat] stopped (code ${code}), restarting in 3 s`);
      setTimeout(launch, 3e3);
    });
  };
  launch();
}
function chatProxy(req, res) {
  if (!chatUp) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Mesob Chat is not running on this server." }));
  }
  const up = http.request({ host: "127.0.0.1", port: CHAT_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${CHAT_PORT}` } }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Mesob Chat is starting - try again in a few seconds." }));
  });
  req.pipe(up);
}
function chatUpgrade(req, socket, head) {
  if (!chatUp || !req.url.startsWith("/socket.io")) return socket.destroy();
  const up = net.connect(CHAT_PORT, "127.0.0.1", () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r
`;
    for (let k = 0; k < req.rawHeaders.length; k += 2) raw += `${req.rawHeaders[k]}: ${req.rawHeaders[k + 1]}\r
`;
    up.write(raw + "\r\n");
    if (head?.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
  up.on("close", () => socket.destroy());
  socket.on("close", () => up.destroy());
}
const BLOCKED = /(^|\/)(chat-server|tools|node_modules|downloads|\.git)(\/|$)|(^|\/)(qms\.env|node-path\.txt|serve\.mjs|qms-(bridge|sync)\.mjs|install-live\.mjs|[^/]*\.(bat|cmd|bak|ps1)|\.[^/]*)$/i;
await startChat();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
async function pick(p) {
  const full = normalize(join(root, p));
  if (full !== root.replace(/[\\/]$/, "") && !full.startsWith(root)) return null;
  try {
    const s = await stat(full);
    if (s.isDirectory()) return pick(join(p, "index.html"));
    return s.isFile() ? full : null;
  } catch {
    return null;
  }
}
const BRIDGE_PORT = (() => {
  const i2 = process.argv.indexOf("--bridge-port");
  return i2 > 0 ? Number(process.argv[i2 + 1]) || 4700 : 4700;
})();
function bridgeProxy(req, res, rest, search) {
  const rip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (!/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(rip)) {
    res.writeHead(403);
    return res.end("Office network only");
  }
  const p = http.request({ host: "127.0.0.1", port: BRIDGE_PORT, path: (rest || "/") + search, method: req.method === "POST" ? "POST" : "GET", headers: { "content-type": req.headers["content-type"] || "application/json" } }, (r) => {
    res.writeHead(r.statusCode || 502, { "Content-Type": r.headers["content-type"] || "application/json", "Cache-Control": "no-store" });
    r.pipe(res);
  });
  p.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "QMS bridge is not running on this computer. Start qms-bridge.mjs (START-EVERYTHING.bat does it)." }));
  });
  p.setTimeout(125e3, () => p.destroy());
  req.pipe(p);
}
const gzipP = promisify(_gzip), brP = promisify(_brotli);
const FILE_CACHE = new Map();
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|txt|csv|ttf|map)$/i;
async function loadFile(file) {
  const st = await stat(file);
  const hit = FILE_CACHE.get(file);
  if (hit && hit.m === st.mtimeMs && hit.sz === st.size) return hit;
  const raw = await readFile(file);
  const c = { m: st.mtimeMs, sz: st.size, raw, etag: createHash("sha1").update(raw).digest("base64url").slice(0, 20), br: null, gz: null };
  if (raw.length <= 12 * 1024 * 1024) FILE_CACHE.set(file, c);
  return c;
}
async function sendStatic(req, res, file, u) {
  const c = await loadFile(file);
  const ext = extname(file).toLowerCase();
  const versioned = u.searchParams.has("v") || /[-.][A-Za-z0-9_-]{8}\.(js|css|png|woff2?|jpg|svg)$/.test(file);
  const ae = String(req.headers["accept-encoding"] || "");
  const enc = COMPRESSIBLE.test(file) && c.raw.length > 1024 ? /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gzip" : "" : "";
  const etag = `"${c.etag}${enc ? "-" + enc : ""}"`;
  const h = { "Content-Type": TYPES[ext] || "application/octet-stream", ETag: etag, Vary: "Accept-Encoding", "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "no-cache" };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, h);
    return res.end();
  }
  let body = c.raw;
  if (enc === "br") body = c.br || (c.br = await brP(c.raw, { params: { [ZC.BROTLI_PARAM_QUALITY]: 9, [ZC.BROTLI_PARAM_SIZE_HINT]: c.raw.length } }));
  else if (enc === "gzip") body = c.gz || (c.gz = await gzipP(c.raw, { level: 9 }));
  if (enc) h["Content-Encoding"] = enc;
  h["Content-Length"] = body.length;
  res.writeHead(200, h);
  res.end(req.method === "HEAD" ? void 0 : body);
}
(async () => {
  try {
    for (const f of await readdir(join(root, "assets"))) {
      if (/\.(js|css)$/.test(f)) {
        const c = await loadFile(join(root, "assets", f));
        if (c.raw.length > 1024) {
          c.gz = await gzipP(c.raw, { level: 9 });
          c.br = await brP(c.raw, { params: { [ZC.BROTLI_PARAM_QUALITY]: 9 } });
        }
      }
    }
    await loadFile(join(root, "index.html"));
  } catch {
  }
})();
const server = http.createServer(async (req, res) => {
  if (/^\/(chat-api|uploads|socket\.io)(\/|$|\?)/.test(req.url || "")) return chatProxy(req, res);
  const wh = res.writeHead.bind(res);
  res.writeHead = (c, h = {}) => wh(c, { ...h, ...corsHeaders(req) });
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const u = new URL(req.url, "http://x");
  let path;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (path === "/bridge" || path.startsWith("/bridge/")) return bridgeProxy(req, res, path.slice(7), u.search);
  if (path === "/mesob-diag") return diag(req, res);
  if (path.startsWith("/mesob-api/")) return proxy(req, res, path.slice(10), u.search);
  if (path === "/downloads/mesh-agent-final.bat" || path === "/downloads/agent") {
    const rip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    if (!/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(rip)) {
      res.writeHead(403);
      return res.end("Office network only");
    }
    try {
      const dir = join(root, "downloads");
      if (path.endsWith(".bat")) {
        const host = /^[A-Za-z0-9.\-:\[\]]+$/.test(String(req.headers.host || "")) ? "http://" + req.headers.host : "";
        const body2 = Buffer.from((await readFile(join(dir, "mesh-agent-final.bat"), "utf8")).replace(/__SITE__/g, host), "utf8");
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="mesh-agent-final.bat"', "Content-Length": body2.length, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
        return res.end(body2);
      }
      const arch = u.searchParams.get("arch") === "32" ? "32" : "64";
      const f = (await readdir(dir)).find((x) => new RegExp("^meshagent" + arch + ".*\\.exe$", "i").test(x));
      if (!f) {
        res.writeHead(404);
        return res.end("Agent installer not on the server");
      }
      const body = await readFile(join(dir, f));
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${f.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "Content-Length": body.length, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
      return res.end(body);
    } catch {
      res.writeHead(404);
      return res.end("Not found");
    }
  }
  if (BLOCKED.test(path)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const file = await pick(path) || await pick("/index.html");
  try {
    await sendStatic(req, res, file, u);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.on("upgrade", chatUpgrade);
server.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Mesob site running on http://localhost:${PORT}  (Ctrl+C to stop)`);
  if (chatUp) console.log(`Mesob Chat is on the same address: http://localhost:${PORT}/chat   (sign in e.g. UlfinaY / Mesob@123)`);
  if (LAN) {
    const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
    console.log("Other computers on the network can open:");
    ips.forEach((ip) => console.log(`   http://${ip}:${PORT}`));
    console.log("If they cannot connect, allow port " + PORT + " in Windows Firewall (see the instructions).");
  }
});
