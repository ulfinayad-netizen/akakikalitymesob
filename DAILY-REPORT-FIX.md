# Employees' Daily report not working - the fix

Why it fails: the Daily report saves to Firebase (project  addis-mesob-akaki-kaliti , collection  reportDaily ).
Firebase only lets an account write there if it has a  reportUsers/{its uid}  record that lists its department(s).
That record can ONLY be created by the script below (nobody can create it from the website). If an employee has no
record, or the rules were not published, the report page shows  permission-denied  and nothing saves.

The roster now has all 133 employees with their report department (people with no matching department get "all").

DO THIS ONCE (on any PC with Node.js, in folder 3-source-admin-v8):
1. Firebase Console > project  addis-mesob-akaki-kaliti  > Project settings > Service accounts > Generate new private key.
   Save it as   3-source-admin-v8\server\scripts\serviceAccountKey.json     (never share it).
2. Publish the rules:  Firestore > Rules > paste the contents of  3-source-admin-v8\firestore.employee.rules  > Publish
   (this must be the rules of THIS project - not firestore.admin.rules / firestore.chat.rules, which belong to other projects).
3. cd 3-source-admin-v8\server
   npm install firebase-admin
   node scripts\create-report-users.js --dry-run     (check: 157 accounts)
   node scripts\create-report-users.js               (creates the accounts; passwords go to scripts\report-credentials.csv)
   Employees sign in with their username (e.g. UlfinaY) + Mesob@123 and change it. Delete report-credentials.csv afterwards.
4. Ctrl+F5 in the browser, sign in at /login - it opens /employee/report.

If it still fails, the red message on the report page shows the Firebase error code: send me that code
(permission-denied = steps 1-3 not done for that person; unavailable/network = the PC has no internet to Firebase).
