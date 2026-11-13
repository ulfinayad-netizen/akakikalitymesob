import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.admin.json");
const [, , email, ...flags] = process.argv;
const createIdx = flags.indexOf("--create");
const createName = createIdx >= 0 ? flags[createIdx + 1] : null;
const revoke = flags.includes("--revoke");
if (!email || !email.includes("@") || createIdx >= 0 && !createName) {
  console.error('Usage: node scripts/grant-super-admin.js <email> [--create "Full Name" | --revoke]');
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error("Missing server/scripts/serviceAccountKey.admin.json \u2014 see the setup notes at the top of this file.");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf-8"))) });
const auth = getAuth();
const db = getFirestore();
db.settings({ preferRest: true });
let user;
try {
  user = await auth.getUserByEmail(email);
} catch (e) {
  if (e.code !== "auth/user-not-found") throw e;
  if (!createName) {
    console.error(`No account for ${email}. Re-run with --create "Full Name" to create it.`);
    process.exit(1);
  }
  user = await auth.createUser({ email, displayName: createName, emailVerified: true });
  const link = await auth.generatePasswordResetLink(email);
  console.log(`Created account ${email}. Send her this link so she can choose a password:
${link}
`);
}
if (revoke) {
  await db.doc(`roles/${user.uid}`).set({ role: "admin" });
  console.log(`${email} is now a regular admin.`);
} else {
  await db.doc(`roles/${user.uid}`).set({ role: "superadmin", name: user.displayName || "" });
  console.log(`${email} (uid ${user.uid}) is now a Super Admin.`);
}
