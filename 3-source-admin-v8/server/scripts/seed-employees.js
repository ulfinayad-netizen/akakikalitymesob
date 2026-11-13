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
const employees = JSON.parse(readFileSync(join(__dirname, "employees-seed.json"), "utf-8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
db.settings({ preferRest: true });
async function run() {
  const col = db.collection("employees");
  const existing = await col.get();
  const byName = new Map(existing.docs.map((d) => [d.data().name, d.id]));
  let created = 0;
  let updated = 0;
  const batch = db.batch();
  for (const emp of employees) {
    const existingId = byName.get(emp.name);
    if (existingId) {
      batch.set(col.doc(existingId), emp, { merge: true });
      updated += 1;
    } else {
      batch.set(col.doc(), emp);
      created += 1;
    }
  }
  await batch.commit();
  console.log(`Done. Created ${created}, updated ${updated}, total ${employees.length}.`);
}
run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
