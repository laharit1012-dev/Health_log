// Checks which Firestore rules are published, by comparing with firestore.rules in this repo.
// Run by hand from GitHub: Actions → Check database rules → Run workflow.
import admin from "firebase-admin";
import { readFileSync } from "node:fs";

if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log("FIREBASE_SERVICE_ACCOUNT secret isn't set."); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

const norm = (s) => s.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
const live = await admin.securityRules().getFirestoreRuleset();
const repo = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const src = live.source.map((f) => f.content).join("\n");
console.log(`Published: ${live.createTime}`);
for (const word of ["isAdmin", "hasAccess", "accessByEmail", "email_verified", "directory"]) {
  console.log(`  ${src.includes(word) ? "✓" : "✗"} contains ${word}`);
}
console.log(norm(src) === norm(repo)
  ? "RESULT: the published rules match firestore.rules in the repo (comments aside)."
  : "RESULT: the published rules are DIFFERENT from firestore.rules in the repo.");
