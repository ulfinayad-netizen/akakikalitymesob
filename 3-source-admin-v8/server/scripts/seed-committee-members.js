import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");
if (!existsSync(keyPath)) {
  console.error(
    "Missing server/scripts/serviceAccountKey.json \u2014 download a service account key for the employee Firebase project and save it there first."
  );
  process.exit(1);
}
const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
const members = JSON.parse(readFileSync(join(__dirname, "committee-members-seed.json"), "utf-8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
db.settings({ preferRest: true });
async function run() {
  const employeesCol = db.collection("employees");
  const membersCol = db.collection("committeeMembers");
  const [employeesSnap, membersSnap] = await Promise.all([employeesCol.get(), membersCol.get()]);
  const employeeIdByName = new Map(employeesSnap.docs.map((d) => [d.data().name, d.id]));
  const memberDocIdByEmployeeId = new Map(membersSnap.docs.map((d) => [d.data().employeeId, d.id]));
  const batch = db.batch();
  let created = 0;
  let updated = 0;
  const notFound = [];
  for (const m of members) {
    const employeeId = employeeIdByName.get(m.name);
    if (!employeeId) {
      notFound.push(m.name);
      continue;
    }
    const existingDocId = memberDocIdByEmployeeId.get(employeeId);
    if (existingDocId) {
      batch.set(membersCol.doc(existingDocId), { name: m.name, role: m.role || "member" }, { merge: true });
      updated += 1;
    } else {
      batch.set(membersCol.doc(), {
        employeeId,
        name: m.name,
        role: m.role || "member",
        joinedAt: Date.now()
      });
      created += 1;
    }
  }
  await batch.commit();
  console.log(`Done. Created ${created}, updated ${updated}, total matched ${created + updated}.`);
  if (notFound.length) {
    console.log(`Skipped (no matching employee doc \u2014 run seed-employees.js first): ${notFound.join(", ")}`);
  }
}
run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
