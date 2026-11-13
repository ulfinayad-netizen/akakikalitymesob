import { readFileSync, existsSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");
const seedPath = join(__dirname, "report-users-seed.json");
const rosterPath = join(__dirname, "hr-roster.json");
const schemaPath = join(__dirname, "..", "..", "client", "src", "lib", "report", "schema.json");
const DEFAULT_PASSWORD = "Mesob@123";
const dryRun = process.argv.includes("--dry-run");
const resetPasswords = process.argv.includes("--reset-passwords");
const DOMAIN = "mesob-report.local";
if (!dryRun && !existsSync(keyPath)) {
  console.error(
    "Missing server/scripts/serviceAccountKey.json \u2014 download a service account key for the EMPLOYEE Firebase project and save it there first."
  );
  process.exit(1);
}
if (!existsSync(seedPath)) {
  console.error("Missing server/scripts/report-users-seed.json.");
  process.exit(1);
}
const allDepartmentIds = JSON.parse(readFileSync(schemaPath, "utf-8")).departments.map((d) => d.id);
const shared = JSON.parse(readFileSync(seedPath, "utf-8"));
const hrPeople = existsSync(rosterPath) ? JSON.parse(readFileSync(rosterPath, "utf-8")) : [];
if (!hrPeople.length) console.warn("No hr-roster.json found \u2014 run node scripts/build-hr-roster.js to include the HR list.");
const seen = new Set(shared.map((p) => String(p.username || "").trim().toLowerCase()));
const seed = [...shared];
for (const p of hrPeople) {
  if (seen.has(p.username.toLowerCase())) {
    console.warn(`HR list username "${p.username}" clashes with a shared account \u2014 skipped.`);
    continue;
  }
  seen.add(p.username.toLowerCase());
  const isCoordinator = p.role === "coordinator";
  seed.push({
    username: p.username,
    name: p.name,
    role: isCoordinator ? "coordinator" : "department",
    departmentIds: isCoordinator ? [] : p.reportDepartments === "all" ? allDepartmentIds : p.reportDepartments,
    hr: true
  });
}
let auth = null;
let db = null;
if (!dryRun) {
  const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
  initializeApp({ credential: cert(serviceAccount) });
  auth = getAuth();
  db = getFirestore();
  db.settings({ preferRest: true });
}
function tempPassword() {
  return randomBytes(8).toString("base64url").slice(0, 10);
}
async function run() {
  const results = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const person of seed) {
    const username = (person.username || "").trim();
    if (!username) {
      console.warn("Skipping an entry with no username:", person);
      skipped += 1;
      continue;
    }
    const role = person.role === "coordinator" ? "coordinator" : "department";
    const departmentIds = role === "coordinator" ? [] : Array.isArray(person.departmentIds) ? person.departmentIds : [];
    if (role === "department" && departmentIds.length === 0) {
      console.warn(`Skipping "${username}" \u2014 a department account needs at least one department id.`);
      skipped += 1;
      continue;
    }
    const email = `${username.toLowerCase()}@${DOMAIN}`;
    if (dryRun) {
      const scope = departmentIds.length === allDepartmentIds.length && role === "department" ? "ALL departments" : departmentIds.join(", ") || "(coordinator: all)";
      console.log(`${username.padEnd(20)} ${role.padEnd(11)} ${scope}`);
      created += 1;
      continue;
    }
    let userRecord = null;
    let isNew = false;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch {
      userRecord = null;
    }
    if (userRecord) {
      if (person.hr && resetPasswords) {
        await auth.updateUser(userRecord.uid, { password: DEFAULT_PASSWORD });
        console.log(`Reset ${username} to the default password.`);
      }
    } else {
      const password = person.hr ? DEFAULT_PASSWORD : tempPassword();
      userRecord = await auth.createUser({ email, password, displayName: person.name || username });
      isNew = true;
      if (!person.hr) results.push({ username, email, password, name: person.name || "", role, departments: departmentIds.join(" ") });
    }
    await db.collection("reportUsers").doc(userRecord.uid).set(
      { username, name: person.name || username, role, departmentIds },
      { merge: false }
    );
    if (isNew) created += 1;
    else updated += 1;
  }
  if (results.length) {
    const csvLines = [
      "Username,Email,Temporary Password,Name,Role,Departments",
      ...results.map((r) => `"${r.username}","${r.email}","${r.password}","${r.name}","${r.role}","${r.departments}"`)
    ];
    const outPath = join(__dirname, "report-credentials.csv");
    writeFileSync(outPath, csvLines.join("\n") + "\n", "utf-8");
    console.log(`Wrote ${results.length} new login(s) to ${outPath} \u2014 hand these out, then delete the file.`);
  }
  if (dryRun) {
    console.log(`
Dry run: ${created} account(s) would be created or re-synced, ${skipped} skipped. Nothing was written.`);
    return;
  }
  console.log(`Done. Created ${created}, already existed / re-synced ${updated}, skipped ${skipped}.`);
  if (seed.some((p) => p.hr)) console.log(`HR-list accounts use the default password ${DEFAULT_PASSWORD} \u2014 each person should change it after first sign-in.`);
}
run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
