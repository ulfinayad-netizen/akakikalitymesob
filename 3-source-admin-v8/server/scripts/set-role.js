import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");
const [, , email, roleArg] = process.argv;
const VALID_ROLES = ["employee", "social_committee"];
if (!email || !VALID_ROLES.includes(roleArg)) {
  console.error("Usage: node scripts/set-role.js <email> <employee|social_committee>");
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(
    "Missing server/scripts/serviceAccountKey.json \u2014 download a service account key for the EMPLOYEE Firebase project and save it there first."
  );
  process.exit(1);
}
const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const db = getFirestore();
db.settings({ preferRest: true });
async function run() {
  const user = await auth.getUserByEmail(email);
  const ref = db.collection("roles").doc(user.uid);
  if (roleArg === "employee") {
    await ref.delete();
    console.log(`${email} (${user.uid}) now has the default 'employee' role (roles/${user.uid} removed).`);
  } else {
    await ref.set({ role: "social_committee" });
    console.log(`${email} (${user.uid}) now has the 'social_committee' role.`);
  }
}
run().catch((err) => {
  console.error("Failed to set role:", err.message || err);
  process.exit(1);
});
