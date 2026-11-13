import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
const here = resolve(".");
const isSite = (d) => existsSync(join(d, "index.html")) && existsSync(join(d, "assets")) && readFileSync(join(d, "index.html"), "utf8").includes("/assets/");
function find(d, depth) {
  if (isSite(d)) return d;
  if (depth === 0) return null;
  let subs = [];
  try {
    subs = readdirSync(d).filter((n) => !/^(node_modules|admin|\.git)$/i.test(n)).map((n) => join(d, n)).filter((p) => statSync(p).isDirectory());
  } catch {
  }
  for (const s of subs) {
    const r = find(s, depth - 1);
    if (r) return r;
  }
  return null;
}
const site = find(here, 4);
if (!site) {
  console.error(`No Mesob site folder found under ${here}.
It is the folder that contains index.html AND an "assets" folder.
If your site is still in a .zip (mesob-local-modern.zip / mesob-dist-v3-modern.zip), right-click > Extract All first, then run this again.`);
  process.exit(1);
}
console.log("Mesob site folder:", site);
for (const f of ["live.html", "live-link.js", "serve.mjs", "start-8080.bat"]) {
  if (existsSync(join(here, f))) {
    if (resolve(here, f) !== resolve(site, f)) copyFileSync(join(here, f), join(site, f));
    console.log("  ready:", f);
  } else if (!existsSync(join(site, f))) console.log("  ! missing:", f, "(put it next to install-live.mjs)");
}
const ip = join(site, "index.html");
let h = readFileSync(ip, "utf8");
if (!h.includes("live-link.js")) {
  copyFileSync(ip, ip + ".bak");
  writeFileSync(ip, h.replace("</body>", '  <script src="/live-link.js" defer></script>\n  </body>'));
  console.log("index.html patched (backup: index.html.bak)");
} else console.log("index.html already patched");
console.log(`
Now run:
  cd /d "${site}"
  node serve.mjs --lan --mesob --port 8080
Then open http://10.10.133.9:8080/live.html`);
