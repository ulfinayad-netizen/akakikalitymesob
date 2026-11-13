#!/usr/bin/env node
import { createInterface } from "node:readline";
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc, [])
);
const BASE = (args.base || process.env.QMS_API || "http://10.10.41.70/api").replace(/\/$/, "");
const TZ = "Africa/Addis_Ababa";
const EVERY = Math.max(1, Number(args.every || 5));
const BACKFILL = Math.min(60, Math.max(0, Number(args.backfill ?? 14)));
const FB_KEY = "AIzaSyAOmb7ABEV4C3VJWRkfGTSdJTD26Js212U";
const FB_PROJECT = "addis-mesob-akaki-kaliti";
const FS = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/serviceTimeDaily`;
const ask = (q) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => {
    rl.close();
    res(a.trim());
  });
});
const askHidden = (q) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  rl._writeToOutput = (str) => {
    if (!muted) rl.output.write(str);
    else if (str.includes("\n") || str.includes("\r")) rl.output.write("\n");
    else rl.output.write("*");
  };
  rl.question(q, (a) => {
    rl.close();
    res(a.trim());
  });
  muted = true;
});
const fmtDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const fmtTime = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const days = (from, to) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const username = args.user || process.env.QMS_USER || await ask("QMS username: ");
const password = process.env.QMS_PASS || await askHidden("QMS password (typing is hidden): ");
let token = null;
let tenant = args.tenant || process.env.QMS_TENANT || null;
function findTenant(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/^(tenant_?id|tenant|tenantIdentifier|organi[sz]ationId|orgId)$/i.test(k)) {
      if (typeof v === "string" || typeof v === "number") return String(v);
      if (v && typeof v === "object") {
        const id = v._id || v.id || v.tenantId;
        if (id) return String(id);
      }
    }
  }
  for (const v of Object.values(obj)) {
    const f = typeof v === "object" ? findTenant(v) : null;
    if (f) return f;
  }
  return null;
}
const keysOf = (o, pre = "") => !o || typeof o !== "object" ? [] : Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" && !Array.isArray(v) ? keysOf(v, `${pre}${k}.`) : [`${pre}${k}`]);
async function call(path, { method = "GET", body, auth = true } = {}, retried = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...auth && token ? { Authorization: `Bearer ${token}` } : {}, ...tenant ? { "X-Tenant-ID": tenant } : {} },
    body: body ? JSON.stringify(body) : void 0
  });
  if (res.status === 401 && auth && !retried) {
    await login();
    return call(path, { method, body, auth }, true);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
  }
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}${json?.message ? `: ${json.message}` : ""}`);
  return json;
}
async function login() {
  const r = await call("/users/universal-login", { method: "POST", body: { username, password }, auth: false });
  token = r?.accessToken || r?.token;
  if (!token) throw new Error("Login worked but no token came back \u2014 check the username/password");
  console.log(`Login reply fields: ${keysOf(r).join(", ")}`);
  if (!tenant) {
    let claims = null;
    try {
      claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      console.log(`Token fields: ${keysOf(claims).join(", ")}`);
    } catch {
    }
    tenant = findTenant(r) || findTenant(claims);
  }
  console.log(tenant ? `Using tenant id: ${tenant}` : "No tenant id found - restart with --tenant YOUR_TENANT_ID");
}
async function buildExport(from, to) {
  if (!token) await login();
  let services = [];
  try {
    const sl = await call("/serviceList/allCompanyServices");
    services = (sl?.result || []).flatMap((c) => (c.services || []).map((s) => ({ id: String(s._id || s.id || ""), company: c.companyName || c.companyId?.name || "", service: s.name || "", durationMin: Number(s.duration) || null })));
  } catch {
  }
  const svcById = new Map(services.filter((x) => x.id).map((x) => [x.id, x.service]));
  const nameOf = (v) => typeof v === "string" ? v : v && typeof v === "object" ? v.name || v.serviceName || v.title || "" : "";
  let noService = 0, noServiceSample = null;
  const tickets = [];
  const errors = [];
  const today = fmtDay(new Date());
  const waiting = [];
  let sampleKeys = null;
  const seen = new Map();
  const ABSENT = /absent|no.?show|missed|skip|not.?present|did.?not.?(come|attend|show)/i;
  for (const day of days(from, to)) {
    let r = null;
    const noTickets = (e) => /HTTP 404/.test(e.message) && /no tickets/i.test(e.message);
    try {
      r = await call(`/tickets/search?date=${day}`);
    } catch (e1) {
      if (noTickets(e1)) r = { data: [] };
      else {
        try {
          await new Promise((ok) => setTimeout(ok, 800));
          r = await call(`/tickets/search?date=${day}`);
        } catch (e2) {
          if (noTickets(e2)) r = { data: [] };
          else {
            errors.push(`${day}: ${e2.message}`);
            console.error(`Day ${day} failed: ${e2.message}`);
            continue;
          }
        }
      }
    }
    for (const t of r?.data || []) {
      if (!sampleKeys) sampleKeys = Object.keys(t);
      for (const [k, v] of Object.entries(t)) if (/status|state|result|outcome/i.test(k) && (typeof v === "string" || typeof v === "boolean")) {
        const key = `${k}=${v}`;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      const statusText = ["status", "state", "ticketStatus", "result", "outcome"].map((k) => t[k]).filter((v) => typeof v === "string").join(" ");
      const sid = String(t.serviceId?._id ?? t.serviceId ?? t.service_id ?? t.service?._id ?? "");
      let service = nameOf(t.serviceName) || nameOf(t.service) || nameOf(t.serviceType) || nameOf(t.services?.[0]) || (typeof t.serviceId === "object" ? nameOf(t.serviceId) : "") || svcById.get(sid) || void 0;
      if (service && svcById.has(service)) service = svcById.get(service);
      if (service && /^[0-9a-f]{24}$/i.test(service)) service = void 0;
      if (!service) {
        noService++;
        if (!noServiceSample) noServiceSample = Object.fromEntries(Object.entries(t).filter(([k]) => /service|company|room|status|called|served|created|type/i.test(k)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 40) : typeof v === "object" ? "{" + Object.keys(v || {}).join(",") + "}" : v]));
      }
      const staffName = nameOf(t.servedBy) || nameOf(t.servedByName) || nameOf(t.employee) || nameOf(t.employeeName) || nameOf(t.agent) || nameOf(t.agentName) || nameOf(t.operator) || nameOf(t.userName) || nameOf(t.user) || nameOf(t.calledBy) || void 0;
      const ms = t.calledAt && t.servedDate ? new Date(t.servedDate) - new Date(t.calledAt) : NaN;
      if (ms >= 0) {
        const at = new Date(t.ticketCreatedAt || t.servedDate);
        const wms = t.ticketCreatedAt && t.calledAt ? new Date(t.calledAt) - new Date(t.ticketCreatedAt) : NaN;
        const wait = wms >= 0 ? Math.round(wms / 6e3) / 10 : void 0;
        tickets.push({ ticket: t.ticketNumber, company: t.companyName, counter: t.roomName, date: fmtDay(at), time: fmtTime(at), minutes: Math.floor(ms / 6e4), lt1: ms < 6e4, wait, service, staff: staffName, status: "served" });
      } else if (ABSENT.test(statusText) || t.calledAt && !t.servedDate && day < today) {
        const at = new Date(t.ticketCreatedAt || t.calledAt);
        if (Number.isNaN(at.getTime())) continue;
        tickets.push({ ticket: t.ticketNumber, company: t.companyName, counter: t.roomName, date: fmtDay(at), time: fmtTime(at), minutes: 0, lt1: false, service, staff: staffName, status: "absent" });
      } else if (!t.calledAt && !t.servedDate && t.ticketCreatedAt) {
        const at = new Date(t.ticketCreatedAt);
        if (!Number.isNaN(at.getTime())) waiting.push({ ticket: t.ticketNumber, company: t.companyName, service, date: fmtDay(at), time: fmtTime(at), createdAt: at.toISOString() });
      }
    }
  }
  console.log(`Fetched ${from}..${to}: ${tickets.filter((x) => x.status === "served").length} served, ${tickets.filter((x) => x.status === "absent").length} absent. QMS status fields: ${[...seen].map(([k, n]) => `${k} (${n})`).join(", ") || "none"}`);
  let queueNow = null;
  if (to >= today) {
    queueNow = { at: (new Date()).toISOString() };
    try {
      const st = await call("/tickets/ticketStatus/all");
      queueNow.todayTickets = Number(st?.todayTickets);
      queueNow.totalTickets = Number(st?.totalTickets);
      console.log(`ticketStatus: ${JSON.stringify(st).slice(0, 160)}`);
      if (from <= today && Number.isFinite(queueNow.todayTickets)) {
        const known = tickets.filter((t) => t.date === today).length + waiting.filter((w) => w.date === today).length;
        queueNow.issuedKnown = known;
        queueNow.estWaiting = Math.max(0, queueNow.todayTickets - known);
        console.log(`Tickets issued today (QMS): ${queueNow.todayTickets}; in our list: ${known}; not called yet (difference): ${queueNow.estWaiting}`);
      }
    } catch (e) {
      console.log(`ticketStatus not available: ${e.message}`);
    }
    try {
      const un = await call("/tickets/unserved-Tickets");
      console.log(`unserved-Tickets: ${JSON.stringify(un).slice(0, 240)}`);
      queueNow.unserved = Number(un?.totalTicket ?? un?.total ?? un?.count);
      const arr = Object.values(un || {}).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
      if (arr) for (const t of arr) {
        const created = t.ticketCreatedAt || t.createdAt;
        if (!created || t.calledAt || t.servedDate) continue;
        const at = new Date(created);
        if (Number.isNaN(at.getTime())) continue;
        const ticket = t.ticketNumber, d = fmtDay(at);
        if (!waiting.some((w) => w.ticket === ticket && w.date === d)) waiting.push({ ticket, company: t.companyName || t.company?.name, service: t.serviceName || t.service?.name, date: d, time: fmtTime(at), createdAt: at.toISOString() });
      }
    } catch (e) {
      console.log(`unserved-Tickets not available: ${e.message}`);
    }
    for (const k of Object.keys(queueNow)) if (k !== "at" && !Number.isFinite(queueNow[k])) delete queueNow[k];
  }
  if (noService) console.log(`WARNING: ${noService} ticket(s) have no service name, so the Mesob Report cannot place them. Sample fields: ${JSON.stringify(noServiceSample)}`);
  console.log(`Waiting (ticket taken, not called yet): ${waiting.length}. Ticket fields: ${sampleKeys ? sampleKeys.join(", ") : "none"}`);
  if (errors.length && !tickets.length) throw new Error(errors[0]);
  return { source: "qms", exportedAt: (new Date()).toISOString(), from, to, tickets, waiting, queueNow, services, errors };
}
let fbToken = null;
async function fbLogin() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: fbEmail, password: fbPass, returnSecureToken: true })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mesob Report sign-in failed: ${j?.error?.message || res.status}`);
  fbToken = j.idToken;
}
async function fs(method, path, body, retried = false) {
  if (!fbToken) await fbLogin();
  const res = await fetch(`${FS}/${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${fbToken}` }, body: body ? JSON.stringify(body) : void 0 });
  if ((res.status === 401 || res.status === 403) && !retried) {
    await fbLogin();
    return fs(method, path, body, true);
  }
  if (res.status === 404) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Database ${method} ${path} -> HTTP ${res.status}${j?.error?.message ? `: ${j.error.message}` : ""}`);
  return j;
}
const isFinal = (doc) => doc?.fields?.final?.booleanValue === true;
function pack(list) {
  const keys = [...new Set(list.flatMap((o) => Object.keys(o)))];
  const d = {}, maps = {};
  keys.forEach((k, i) => {
    const vals = list.map((o) => o[k]);
    if (!vals.every((v) => typeof v === "string" || v == null)) return;
    const u = [...new Set(vals.filter((v) => typeof v === "string"))];
    if (u.length && u.length * 3 < list.length + 3) {
      d[i] = u;
      maps[i] = new Map(u.map((v, j) => [v, j]));
    }
  });
  const r = list.map((o) => keys.map((k, i) => {
    const v = o[k];
    if (v === void 0 || v === null) return null;
    return maps[i] && typeof v === "string" ? maps[i].get(v) : v;
  }));
  return { k: keys, d, r };
}
async function saveDay(day, exp, today) {
  const json = JSON.stringify(pack(exp.tickets));
  const wait = (exp.waiting || []).filter((w) => w.date === day);
  const wjson = JSON.stringify(pack(wait));
  if (Buffer.byteLength(json) > 95e4) throw new Error(`${day}: ${exp.tickets.length} tickets are too many for one record`);
  await fs("PATCH", day, { fields: {
    date: { stringValue: day },
    count: { integerValue: String(exp.tickets.length) },
    json: { stringValue: json },
    qnow: { stringValue: JSON.stringify(exp.queueNow || null) },
    wjson: { stringValue: wjson },
    wcount: { integerValue: String(wait.length) },
    fmt: { stringValue: "export-packed" },
    final: { booleanValue: day < today },
    savedAt: { stringValue: (new Date()).toISOString() }
  } });
}
let running = false;
async function cycle() {
  if (running) return;
  running = true;
  const stamp = () => (new Date()).toLocaleTimeString("en-GB", { timeZone: TZ });
  try {
    const today = fmtDay(new Date());
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - BACKFILL);
    const todo = [];
    for (const d of days(start.toISOString().slice(0, 10), today)) {
      if (d === today || args.redo) {
        todo.push(d);
        continue;
      }
      const doc = await fs("GET", d);
      if (!isFinal(doc)) todo.push(d);
    }
    let saved = 0;
    for (const d of todo) {
      try {
        const exp = await buildExport(d, d);
        await saveDay(d, exp, today);
        saved++;
      } catch (e) {
        console.error(`[${stamp()}] ${d} not saved: ${e.message}`);
      }
    }
    console.log(`[${stamp()}] Synced ${saved}/${todo.length} day(s). Next in ${EVERY} min.`);
  } catch (e) {
    console.error(`[${fmtTime(new Date())}] Sync problem: ${e.message}`);
  }
  running = false;
}
const fbEmail = args.fbemail || process.env.FB_EMAIL || await ask("Mesob Report login email: ");
const fbPass = process.env.FB_PASS || await askHidden("Mesob Report password (typing is hidden): ");
await fbLogin();
console.log("Signed in to the Mesob Report database.");
try {
  await login();
  console.log("Signed in to the QMS.");
} catch (e) {
  console.error(`
QMS sign-in FAILED: ${e.message}`);
  console.error("Check the QMS username and password - they are NOT the Mesob Report ones. Stopped on purpose so the QMS account is not locked by repeated wrong attempts.");
  process.exit(1);
}
await cycle();
setInterval(cycle, EVERY * 6e4);
