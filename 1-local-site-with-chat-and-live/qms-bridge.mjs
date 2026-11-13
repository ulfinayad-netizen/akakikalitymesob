#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc, [])
);
const BASE = (args.base || process.env.QMS_API || "http://10.10.41.70/api").replace(/\/$/, "");
const PORT = Number(args.port || 4700);
const TZ = "Africa/Addis_Ababa";
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "qms-cache");
const CONCURRENCY = Number(args.concurrency || 2);
const RATE = Number(args.rate || 90);
const CACHE_SECONDS = Number(args["cache-seconds"] || 60);
const gate = (S) => {
  const now = Date.now();
  S.nextAt = Math.max(S.nextAt || 0, now);
  const wait = S.nextAt - now;
  S.nextAt += 6e4 / RATE;
  return wait > 0 ? new Promise((ok) => setTimeout(ok, wait)) : null;
};
const ALLOWED = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "http://10.10.133.9:5173", "https://transcendent-croquembouche-ab8228.netlify.app", ...String(args.allow || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean)]);
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
for (const p of [new URL("../qms.env", import.meta.url), new URL("./qms.env", import.meta.url)]) {
  try {
    for (const line of fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
  }
}
const defUser = args.user || process.env.QMS_USER || await ask(`MAIN QMS (${BASE}) username: `);
const defPass = process.env.QMS_PASS || await askHidden("MAIN QMS password (typing is hidden): ");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const slug = (x) => String(x || "default").replace(/[^a-z0-9_-]/gi, "_");
function loadBranches() {
  for (const p of [path.join(HERE, "..", "branches.json"), path.join(HERE, "branches.json"), path.join(process.cwd(), "branches.json")]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (Array.isArray(j)) return j;
    } catch {
    }
  }
  return [];
}
const sessions = new Map();
function ctxFor(code) {
  const b = code ? loadBranches().find((x) => String(x.code).toLowerCase() === code.toLowerCase()) : null;
  const own = !!(b && b.base);
  const base = own ? String(b.base).trim().replace(/\/+$/, "") : BASE;
  let S = sessions.get(base);
  if (!S) {
    const envKey = b ? String(b.code).toUpperCase().replace(/[^A-Z0-9]/g, "_") : "";
    S = {
      key: base,
      base,
      label: own ? b.name : "Main QMS",
      candidates: own ? /\/api$/i.test(base) ? [base] : [`${base}/api`, base] : [base],
      absentPath: own && b.absentPath || args["absent-path"] || void 0,
      loginPaths: own ? [b.loginPath, "/users/universal-login", "/users/login", "/auth/login"].filter(Boolean) : ["/users/universal-login"],
      token: null,
      loginP: null,
      tenant: own ? b.tenant || null : args.tenant || process.env.QMS_TENANT || null,
      user: own && process.env[`QMS_USER_${envKey}`] || defUser,
      pass: own && process.env[`QMS_PASS_${envKey}`] || defPass,
      envKey
    };
    sessions.set(base, S);
  }
  return { sess: S, header: own ? b.tenant || S.tenant : code || S.tenant, name: b?.name || code || "default" };
}
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
async function call(ctx, p, { method = "GET", body, auth = true } = {}, retried = false) {
  const S = ctx.sess;
  const tn = ctx.header || S.tenant;
  if (auth && S.token && S.expAt && Date.now() - (S.loginAt || 0) > 3e4 && Date.now() > S.expAt - S.margin - (S.skew || 0)) {
    S.token = null;
    await login(ctx);
  }
  {
    const w = gate(S);
    if (w) await w;
  }
  S.requests = (S.requests || 0) + 1;
  const t0 = Date.now();
  const res = await fetch(`${S.base}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...auth && S.token ? { Authorization: `Bearer ${S.token}` } : {}, ...tn ? { "X-Tenant-ID": tn } : {} },
    body: body ? JSON.stringify(body) : void 0
  });
  {
    const d = Date.parse(res.headers.get("date") || "");
    if (!Number.isNaN(d)) S.skew = d - (t0 + Date.now()) / 2;
  }
  if (res.status === 401 && auth && !retried) {
    S.token = null;
    await login(ctx);
    return call(ctx, p, { method, body, auth }, true);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
  }
  if (!res.ok) throw new Error(`${method} ${p} -> HTTP ${res.status}${json?.message ? `: ${json.message}` : ""}`);
  return json;
}
function login(ctx) {
  const S = ctx.sess;
  if (S.loginP) return S.loginP;
  if (S.blockedUntil && Date.now() < S.blockedUntil) {
    return Promise.reject(new Error(`${S.label}: not signing in again for ${Math.ceil((S.blockedUntil - Date.now()) / 6e4)} more minute(s) because the last try failed (${S.blockedWhy}). Fix the login with SET-QMS-LOGINS.bat and restart the bridge.`));
  }
  S.loginP = (async () => {
    try {
      const attempt = async (u, pw) => {
        let last, rejectErr = null;
        for (const c of S.candidates) {
          S.base = c;
          for (const lp of S.loginPaths) {
            try {
              const rr = await call(ctx, lp, { method: "POST", body: { username: u, password: pw }, auth: false });
              S.candidates = [c];
              S.loginPaths = [lp];
              return rr;
            } catch (e) {
              last = e;
              if (/HTTP (400|401|403)/.test(e.message)) {
                rejectErr = rejectErr || e;
                continue;
              }
              if (!/HTTP 404|HTTP 405|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND/i.test(e.message)) throw e;
            }
          }
        }
        throw rejectErr || last;
      };
      let r;
      try {
        r = await attempt(S.user, S.pass);
      } catch (e) {
        const rejected = /HTTP (400|401|403)/.test(e.message);
        if (!rejected) throw e;
        const own = S.key !== BASE, uk = own ? `QMS_USER_${S.envKey}` : "QMS_USER", pk = own ? `QMS_PASS_${S.envKey}` : "QMS_PASS";
        if (process.env[uk]) throw new Error(`${S.label} refused the login saved as ${uk} / ${pk}. Run SET-QMS-LOGINS.bat to correct it.`);
        if (!process.stdin.isTTY) throw new Error(`${S.label} did not accept the QMS login. Run SET-QMS-LOGINS.bat once to save the right username and password for it.`);
        console.log(`${S.label} (${S.base}) refused that username/password. Type the one for THIS server (it is kept only until the bridge is closed):`);
        S.user = await ask(`${S.label} QMS username: `);
        S.pass = await askHidden(`${S.label} QMS password (typing is hidden): `);
        r = await attempt(S.user, S.pass);
      }
      S.token = r?.accessToken || r?.token;
      if (!S.token) throw new Error("Login worked but no token came back \u2014 check the username/password");
      S.blockedUntil = 0;
      S.logins = (S.logins || 0) + 1;
      S.loginAt = Date.now();
      if (Math.abs(S.skew || 0) > 6e4) console.log(`[${S.label}] WARNING: this computer's clock is ${Math.round(Math.abs(S.skew) / 6e4)} minute(s) ${S.skew > 0 ? "behind" : "ahead of"} the QMS. Correct it in Windows (Settings > Time & language > Sync now) - a wrong clock makes passes look expired.`);
      console.log(`[${S.label}] Login OK at ${S.base}. Reply fields: ${keysOf(r).join(", ")}`);
      let claims = null;
      try {
        claims = JSON.parse(Buffer.from(S.token.split(".")[1], "base64url").toString());
      } catch {
      }
      if (claims && claims.exp) {
        S.expAt = claims.exp * 1e3;
        const life = S.expAt - (claims.iat ? claims.iat * 1e3 : Date.now());
        S.margin = Math.min(9e4, Math.max(1e3, life * 0.25));
        console.log(`[${S.label}] Pass-card lasts ${life >= 12e4 ? Math.round(life / 6e4) + " minutes" : Math.round(life / 1e3) + " seconds"}; it is renewed shortly before ${new Date(S.expAt).toLocaleTimeString()}.`);
      } else {
        S.expAt = 0;
      }
      if (!S.tenant) {
        if (claims) console.log(`[${S.label}] Token fields: ${keysOf(claims).join(", ")}`);
        S.tenant = findTenant(r) || findTenant(claims);
      }
      console.log(S.tenant ? `[${S.label}] Using tenant id: ${S.tenant}` : S.key !== BASE ? `[${S.label}] This server gives no tenant id - fine when it has a single office (otherwise add "tenant" for it in branches.json)` : `[${S.label}] No tenant id found - restart with --tenant`);
    } catch (err) {
      S.blockedUntil = Date.now() + (/HTTP (400|401|403)|refused|did not accept/.test(err.message) ? 10 : 2) * 6e4;
      S.blockedWhy = err.message.slice(0, 120);
      throw err;
    } finally {
      S.loginP = null;
    }
  })();
  return S.loginP;
}
const arrayOf = (r) => Array.isArray(r) ? r : r && typeof r === "object" ? Object.values(r).find(Array.isArray) : null;
async function findAbsentPath(ctx) {
  const S = ctx.sess;
  if (S.absentPath !== void 0) return S.absentPath;
  const today = fmtDay(new Date());
  for (const n of ["absentTickets", "absent-Tickets", "absentTicket", "absent", "missedTickets", "skippedTickets", "noShowTickets"]) {
    for (const q of [`?date=${today}`]) {
      const p = `/tickets/${n}`;
      try {
        const r = await call(ctx, p + q);
        if (r && typeof r === "object" && r.success !== false && arrayOf(r)) {
          S.absentPath = p;
          console.log(`[${S.label}] Absent-ticket address found: ${p}`);
          return p;
        }
      } catch {
      }
    }
  }
  S.absentPath = null;
  console.log(`[${S.label}] No absent-ticket address found automatically. Run FIND-ABSENT-ENDPOINT.bat and send the FOUND lines.`);
  return null;
}
async function buildExport(from, to, ctx) {
  if (!ctx.sess.token) await login(ctx);
  let services = [];
  try {
    const sl = await call(ctx, "/serviceList/allCompanyServices");
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
  const absentWhy = new Map();
  let calledTodayOpen = 0;
  const ABSENT = /absent|no.?show|missed|skip|not.?present|did.?not.?(come|attend|show)/i;
  const dayData = new Map();
  const cacheKey = (d) => `${slug(ctx.sess.key)}__${slug(ctx.header || ctx.sess.tenant)}_${d}.json`;
  const noTickets = (e) => /HTTP 404/.test(e.message) && /no tickets/i.test(e.message);
  const loadDay = async (day) => {
    const file = path.join(CACHE_DIR, cacheKey(day));
    if (day < today) {
      try {
        dayData.set(day, JSON.parse(fs.readFileSync(file, "utf8")));
        return;
      } catch {
      }
    }
    let r = null;
    try {
      r = await call(ctx, `/tickets/search?date=${day}`);
    } catch (e1) {
      if (noTickets(e1)) r = { data: [] };
      else {
        try {
          await new Promise((ok) => setTimeout(ok, 800));
          r = await call(ctx, `/tickets/search?date=${day}`);
        } catch (e2) {
          if (noTickets(e2)) r = { data: [] };
          else {
            errors.push(`${day}: ${e2.message}`);
            console.error(`Day ${day} failed: ${e2.message}`);
            return;
          }
        }
      }
    }
    dayData.set(day, r);
    if (day < today) {
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(r));
      } catch {
      }
    }
  };
  {
    const queue = days(from, to);
    const worker = async () => {
      while (queue.length) await loadDay(queue.shift());
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }
  for (const day of days(from, to)) {
    const r = dayData.get(day);
    if (!r) continue;
    for (const t of r?.data || []) {
      if (!sampleKeys) sampleKeys = Object.keys(t);
      for (const [k, v] of Object.entries(t)) if (/status|state|result|outcome/i.test(k) && (typeof v === "string" || typeof v === "boolean")) {
        const key = `${k}=${v}`;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      const statusText = ["status", "state", "ticketStatus", "result", "outcome", "stage", "action", "callStatus", "queueStatus", "servedStatus"].map((k) => t[k]).filter((v) => typeof v === "string").join(" ");
      const flagKey = Object.keys(t).find((k) => /absent|no.?show|missed|skipp?ed|not.?present/i.test(k) && t[k] && !/^(false|0|no|null|undefined)$/i.test(String(t[k])));
      const isAbsent = ABSENT.test(statusText) || !!flagKey;
      if (isAbsent) {
        const why = flagKey ? `field ${flagKey}` : `status text "${statusText.trim().slice(0, 30)}"`;
        absentWhy.set(why, (absentWhy.get(why) || 0) + 1);
      }
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
      if (!isAbsent && ms >= 0) {
        const at = new Date(t.ticketCreatedAt || t.servedDate);
        const wms = t.ticketCreatedAt && t.calledAt ? new Date(t.calledAt) - new Date(t.ticketCreatedAt) : NaN;
        const wait = wms >= 0 ? Math.round(wms / 6e3) / 10 : void 0;
        tickets.push({ ticket: t.ticketNumber, company: t.companyName, counter: t.roomName, date: fmtDay(at), time: fmtTime(at), minutes: Math.floor(ms / 6e4), lt1: ms < 6e4, wait, service, staff: staffName, status: "served" });
      } else if (isAbsent || t.calledAt && !t.servedDate && day < today) {
        if (!isAbsent) absentWhy.set("called, never finished (old day)", (absentWhy.get("called, never finished (old day)") || 0) + 1);
        const at = new Date(t.ticketCreatedAt || t.calledAt);
        if (Number.isNaN(at.getTime())) continue;
        tickets.push({ ticket: t.ticketNumber, company: t.companyName, counter: t.roomName, date: fmtDay(at), time: fmtTime(at), minutes: 0, lt1: false, service, staff: staffName, status: "absent" });
      } else if (t.calledAt && !t.servedDate && day >= today) {
        calledTodayOpen++;
      } else if (!t.calledAt && !t.servedDate && t.ticketCreatedAt) {
        const at = new Date(t.ticketCreatedAt);
        if (!Number.isNaN(at.getTime())) waiting.push({ ticket: t.ticketNumber, company: t.companyName, service, date: fmtDay(at), time: fmtTime(at), createdAt: at.toISOString() });
      }
    }
  }
  try {
    const apath = await findAbsentPath(ctx);
    if (apath) {
      const have = new Set(tickets.map((x) => `${x.ticket}|${x.date}`));
      const queue = days(from, to);
      let added = 0, listed = 0;
      const worker = async () => {
        while (queue.length) {
          const day = queue.shift();
          const file = path.join(CACHE_DIR, cacheKey(day).replace(/\.json$/, "_abs.json"));
          let rows = null;
          if (day < today) {
            try {
              rows = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
            }
          }
          if (!rows) {
            rows = [];
            let r = null;
            try {
              r = await call(ctx, `${apath}?date=${day}`);
            } catch {
              try {
                r = await call(ctx, apath);
              } catch {
                continue;
              }
            }
            for (const t of arrayOf(r) || []) {
              if (!t || typeof t !== "object") continue;
              const when = t.ticketCreatedAt || t.calledAt || t.createdAt || t.updatedAt;
              const at = when ? new Date(when) : null;
              if (at && !Number.isNaN(at.getTime())) {
                if (fmtDay(at) !== day) continue;
              } else if (day !== today) continue;
              const when2 = at && !Number.isNaN(at.getTime()) ? at : new Date();
              rows.push({ ticket: t.ticketNumber, company: t.companyName || nameOf(t.company), counter: t.roomName || nameOf(t.room), date: fmtDay(when2), time: fmtTime(when2), minutes: 0, lt1: false, service: nameOf(t.serviceName) || nameOf(t.service) || void 0, staff: nameOf(t.calledBy) || nameOf(t.servedBy) || nameOf(t.employee) || void 0, status: "absent" });
            }
            if (day < today) {
              try {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
                fs.writeFileSync(file, JSON.stringify(rows));
              } catch {
              }
            }
          }
          for (const row of rows) {
            listed++;
            const k = `${row.ticket}|${row.date}`;
            if (!have.has(k)) {
              have.add(k);
              tickets.push(row);
              added++;
            }
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (added) absentWhy.set(`absent list ${apath}`, added);
      console.log(`Absent list ${apath}: ${listed} found, ${added} added to the report`);
    }
  } catch (e) {
    console.log(`Absent list not used: ${e.message}`);
  }
  console.log(`Absent recognised by: ${[...absentWhy].map(([k, n]) => `${k} (${n})`).join(", ") || "nothing"}. Called today but not finished yet (in service, or absent without a status): ${calledTodayOpen}`);
  console.log(`Fetched ${from}..${to}: ${tickets.filter((x) => x.status === "served").length} served, ${tickets.filter((x) => x.status === "absent").length} absent. QMS status fields: ${[...seen].map(([k, n]) => `${k} (${n})`).join(", ") || "none"}`);
  let queueNow = null;
  if (to >= today) {
    queueNow = { at: (new Date()).toISOString() };
    try {
      const st = await call(ctx, "/tickets/ticketStatus/all");
      queueNow.todayTickets = Number(st?.todayTickets);
      queueNow.totalTickets = Number(st?.totalTickets);
      console.log(`ticketStatus: ${JSON.stringify(st).slice(0, 160)}`);
      if (from <= today && Number.isFinite(queueNow.todayTickets)) {
        const known = tickets.filter((t) => t.date === today).length + waiting.filter((w) => w.date === today).length;
        queueNow.issuedKnown = known;
        queueNow.estWaiting = Math.max(0, queueNow.todayTickets - known);
        console.log(`Tickets issued today (QMS): ${queueNow.todayTickets}; in our list: ${known}; difference: ${queueNow.estWaiting} (taken today but not in the served list: absent, cancelled, or still waiting - the QMS does not say which)`);
      }
    } catch (e) {
      console.log(`ticketStatus not available: ${e.message}`);
    }
    try {
      const un = await call(ctx, "/tickets/unserved-Tickets");
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
  ctx.sess.last = { branch: ctx.name, at: (new Date()).toISOString(), from, to, served: tickets.filter((x) => x.status === "served").length, absent: tickets.filter((x) => x.status === "absent").length, waiting: waiting.length, issuedToday: queueNow?.todayTickets ?? null, notInServedList: queueNow?.estWaiting ?? null, absentRecognisedBy: [...absentWhy].map(([k, n]) => `${k} (${n})`) };
  return { source: "qms", exportedAt: (new Date()).toISOString(), from, to, tickets, waiting, queueNow, services, errors };
}
if (args.discover) {
  const ctx = ctxFor(args.discover === true || args.discover === "true" ? "" : String(args.discover));
  await login(ctx);
  const day = fmtDay(new Date());
  const names = ["absentTickets", "absent-Tickets", "absent", "missedTickets", "skippedTickets", "noShowTickets", "cancelledTickets", "canceledTickets", "unservedTickets", "unserved-Tickets", "servedTickets", "served-Tickets", "pendingTickets", "recalledTickets", "transferredTickets", "allTickets", "todayTickets"];
  console.log(`Looking at ${ctx.sess.base} (read-only)...`);
  for (const n of names) for (const q of ["", `?date=${day}`]) {
    const p = `/tickets/${n}${q}`;
    try {
      const r = await call(ctx, p);
      const arr = Array.isArray(r) ? r : Object.values(r || {}).find(Array.isArray);
      const first = arr && arr[0] && typeof arr[0] === "object" ? arr[0] : null;
      const sv = new Set();
      for (const it of (arr || []).slice(0, 50)) if (it && typeof it === "object") {
        for (const [k, v] of Object.entries(it)) if (/status|state|reason|type/i.test(k) && typeof v === "string") sv.add(`${k}=${v}`);
      }
      console.log(`FOUND ${p}  keys: ${Object.keys(r || {}).join(",")}  items: ${arr ? arr.length : "-"}${first ? `  item fields: ${Object.keys(first).join(",")}` : ""}${sv.size ? `  values: ${[...sv].slice(0, 8).join(" | ")}` : ""}`);
    } catch (e) {
      if (!/HTTP 404/.test(e.message)) console.log(`      ${p}  ${e.message.replace(/^.*-> /, "")}`);
    }
  }
  console.log("Done. Copy every line that starts with FOUND and send it.");
  process.exit(0);
}
const exportCache = new Map();
function cachedExport(from, to, ctx) {
  const today = fmtDay(new Date());
  const key = `${ctx.sess.key}|${ctx.header || ""}|${from}|${to}`;
  const ttl = (to >= today ? CACHE_SECONDS : 600) * 1e3;
  const hit = exportCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.p;
  const p = buildExport(from, to, ctx);
  exportCache.set(key, { at: Date.now(), p });
  p.catch(() => {
    if (exportCache.get(key)?.p === p) exportCache.delete(key);
  });
  if (exportCache.size > 60) exportCache.delete(exportCache.keys().next().value);
  return p;
}
http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    if (!ALLOWED.has(origin)) return send(403, { error: `Origin ${origin} is not allowed. Restart the bridge with --allow ${origin}` });
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") return send(200, {
    ok: true,
    base: BASE,
    branches: loadBranches().map((b) => ({ name: b.name, code: b.code, server: b.base || BASE })),
    signedIn: [...sessions.values()].filter((x) => x.token).map((x) => x.label),
    servers: [...sessions.values()].map((x) => ({ name: x.label, address: x.base, signedIn: !!x.token, logins: x.logins || 0, requestsSent: x.requests || 0, absentTicketAddress: x.absentPath === void 0 ? "not looked for yet (fetch once)" : x.absentPath || "NONE FOUND", lastFetch: x.last || null }))
  });
  if (url.pathname === "/branches") return send(200, loadBranches());
  if (url.pathname === "/export") {
    const today = fmtDay(new Date());
    const from = url.searchParams.get("from") || today;
    const to = url.searchParams.get("to") || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return send(400, { error: "Use from/to as YYYY-MM-DD with from <= to" });
    if (days(from, to).length > 400) return send(400, { error: "Ask for 400 days or fewer at a time" });
    const code = (url.searchParams.get("branch") || "").trim();
    const ctx = ctxFor(code);
    console.log(`Branch selected: ${ctx.name}${ctx.sess.key !== BASE ? ` (server ${ctx.sess.key})` : ""}`);
    try {
      return send(200, await cachedExport(from, to, ctx));
    } catch (e) {
      return send(502, { error: e.message });
    }
  }
  send(404, { error: "Not found" });
}).listen(PORT, "127.0.0.1", async () => {
  console.log(`QMS bridge running on http://localhost:${PORT}  (QMS: ${BASE})`);
  console.log(`Allowed websites: ${[...ALLOWED].join(", ")}`);
  try {
    await login(ctxFor(""));
    console.log("Signed in to the QMS. Other branches sign in the first time you choose them. Keep this window open.");
  } catch (e) {
    console.error(`Could not sign in to the QMS yet: ${e.message}`);
  }
  const warm = Number(args.warm || 0);
  if (warm > 0) {
    const to = fmtDay(new Date()), from = fmtDay(new Date(Date.now() - (warm - 1) * 864e5));
    for (const b of [{ code: "" }, ...loadBranches()]) {
      try {
        await buildExport(from, to, ctxFor(b.code));
        console.log(`Warm-up done: ${b.name || "default"}`);
      } catch (e) {
        console.log(`Warm-up skipped for ${b.name || "default"}: ${e.message}`);
      }
    }
  }
});
