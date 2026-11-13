import { readFileSync, existsSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");
const DOMAIN = "mesob.local";
if (!existsSync(keyPath)) {
  console.error(
    "Missing server/scripts/serviceAccountKey.json \u2014 download a service account key for the EMPLOYEE Firebase project and save it there first."
  );
  process.exit(1);
}
const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
const roster = JSON.parse(readFileSync(join(__dirname, "employees-seed.json"), "utf-8"));
initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const db = getFirestore();
db.settings({ preferRest: true });
function slugify(name) {
  return name.normalize("NFKD").replace(/[^a-zA-Z\s]/g, "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}
function emailFor(name, taken) {
  const parts = slugify(name);
  const base = parts.length >= 2 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || "employee";
  let email = `${base}@${DOMAIN}`;
  let n = 2;
  while (taken.has(email)) {
    email = `${base}${n}@${DOMAIN}`;
    n += 1;
  }
  taken.add(email);
  return email;
}
function tempPassword() {
  return randomBytes(8).toString("base64url").slice(0, 10);
}
async function run() {
  const existingAuthEmails = new Set();
  const empSnap = await db.collection("employees").get();
  const byName = new Map(empSnap.docs.map((d) => [d.data().name, { id: d.id, ...d.data() }]));
  const results = [];
  let created = 0;
  let linked = 0;
  let skipped = 0;
  for (const person of roster) {
    const existingDoc = byName.get(person.name);
    if (!existingDoc) {
      console.warn(`Skipping "${person.name}" \u2014 no matching employees doc (run seed-employees.js first).`);
      skipped += 1;
      continue;
    }
    if (existingDoc.uid) {
      linked += 1;
      continue;
    }
    const email = emailFor(person.name, existingAuthEmails);
    const password = tempPassword();
    let userRecord;
    try {
      userRecord = await auth.createUser({ email, password, displayName: person.name });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        userRecord = await auth.getUserByEmail(email);
      } else {
        console.error(`Failed to create account for ${person.name}:`, err.message || err);
        continue;
      }
    }
    await db.collection("employees").doc(existingDoc.id).set({ uid: userRecord.uid }, { merge: true });
    results.push({ name: person.name, email, password, department: person.department || "" });
    created += 1;
  }
  if (results.length) {
    const csvLines = [
      "Name,Email,Temporary Password,Department",
      ...results.map((r) => `"${r.name}","${r.email}","${r.password}","${r.department}"`)
    ];
    const outPath = join(__dirname, "employee-credentials.csv");
    writeFileSync(outPath, csvLines.join("\n") + "\n", "utf-8");
    console.log(`Wrote ${results.length} new login(s) to ${outPath} \u2014 hand these out, then delete the file.`);
  }
  console.log(`Done. Created ${created}, already linked ${linked}, skipped (no directory match) ${skipped}.`);
}
run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
