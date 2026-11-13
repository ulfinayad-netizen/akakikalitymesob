import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");
const libDir = join(__dirname, "../../client/src/lib/report");
const MARK = "Sample data";
const remove = process.argv.includes("--remove");
if (!existsSync(keyPath)) {
  console.error("Missing server/scripts/serviceAccountKey.json \u2014 see the setup notes at the top of this file.");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf-8"))) });
const db = getFirestore();
db.settings({ preferRest: true });
const col = db.collection("reportDaily");
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function removeSamples() {
  const snap = await col.where("updatedByName", "==", MARK).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  console.log(`Removed ${snap.size} example documents.`);
}
async function addSamples() {
  const { departments } = JSON.parse(readFileSync(join(libDir, "schema.json"), "utf-8"));
  const { weeks } = JSON.parse(readFileSync(join(libDir, "sample-month.json"), "utf-8"));
  let written = 0;
  let skipped = 0;
  let batch = db.batch();
  let pending = 0;
  for (const week of weeks) {
    for (let i = 0; i < week.dayCount; i++) {
      const date = addDays(week.weekStart, i);
      for (const dept of departments) {
        const cells = {};
        for (const s of dept.services) {
          const v = week.data[s.id]?.[i];
          if (v !== null && v !== void 0) cells[s.id] = v;
        }
        if (!Object.keys(cells).length) continue;
        const ref = col.doc(`${date}__${dept.id}`);
        const existing = await ref.get();
        if (existing.exists && existing.data().updatedByName !== MARK) {
          skipped++;
          continue;
        }
        batch.set(ref, {
          date,
          departmentId: dept.id,
          cells,
          final: true,
          finalAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedByName: MARK
        });
        written++;
        if (++pending === 400) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
    }
  }
  if (pending) await batch.commit();
  console.log(`Wrote ${written} example documents${skipped ? `, skipped ${skipped} that hold real entries` : ""}.`);
}
await (remove ? removeSamples() : addSamples());
