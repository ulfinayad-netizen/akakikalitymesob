# MESOB - everything, and how to run it

Needs Node.js 22.13+ (LTS) from https://nodejs.org . Chat uses Node's built-in SQLite.

## Folders
1-local-site-with-chat-and-live  READY TO RUN. Built site + chat server + live MESOB data page + QMS tools. Use this.
2-office-server-dist             Same site built for an office server / Netlify (start-with-chat.bat).
3-source-admin-v8                Editable source: React client, API server, chat-server, docs.
4-loose-files-as-uploaded        The loose files you uploaded (old serve.mjs inside - see note there).

## A. Quickest: run the site + chat (folder 1)
1. cd into 1-local-site-with-chat-and-live
2. Double-click start-local-lan.bat      (same as:  node serve.mjs --lan)
3. Open http://localhost:5173            Chat: http://localhost:5173/chat
   Other PCs: http://THIS-PC-IP:5173     (find IP with: ipconfig)
4. Chat login: HR username (e.g. UlfinaY) + Mesob@123, then change it.
   First start creates all chat accounts itself. Data: chat-server\data\ (back it up).
   Options: node serve.mjs --no-chat | --chat-port 3200 | --port 8080

## B. With LIVE MESOB data (live.html)
Double-click start-8080.bat   (node serve.mjs --lan --mesob --port 8080)
Type the MESOB staff username/password when asked (kept in memory only).
Open http://localhost:8080/live.html  (also a "Live MESOB data" link in the admin sidebar).
Add --share-api to the line in start-8080.bat so other PCs see live data too.
Folder 1 already has live.html, live-link.js and the patched index.html - do NOT run install-live.mjs.

## C. QMS tools (folder 1)
node tools\qms-sync.mjs     saves QMS data to the database
node tools\qms-bridge.mjs   live fetch from the QMS (asks for QMS user/password)

## D. Start by itself at boot (Windows)
Right-click install-autostart.bat -> Run as administrator, enter QMS user/password.
Starts site + QMS bridge hidden, restarts if they stop. Remove: uninstall-autostart.bat (as admin).

## E. Office server (folder 2)
start-with-chat.bat  (node serve.mjs --lan --port 8080) -> http://SERVER-IP:8080/chat

## F. Developer mode from source (folder 3)
Windows: INSTALL-ALL.bat then START-ALL.bat.  Linux/Termux: ./install-all.sh then ./start-all.sh
Website http://localhost:5173 | chat server :3000 | API :4000
Set JWT_SECRET in 3-source-admin-v8/chat-server/.env, then once:
  cd chat-server && node scripts/seed-default-users.js

## Security
- Firebase service-account keys were removed from folder 3. The ones in your original v8 zip were shared: delete them in Firebase and create new ones.
- Change Mesob@123 for everyone. Never share chat-server\data\ or qms.env.

## FINAL UPDATE (folders 1 and 2 are the final builds)
- Login shows only the form; employees land on /employee/report; dashboard removed except admin/super admin.
- Service time is a Metabase-style dashboard; report catalogue rebuilt from QMS (service-catalogue-from-qms.csv).
- One-click: 1-local-site-with-chat-and-live\START-EVERYTHING.bat  (site + chat + live MESOB + QMS bridge on port 5173).
- Press Ctrl+F5 after starting. 3-source-admin-v8 is the older source and does NOT contain these changes.

## FINAL PATCH (2026-11-10)
- Start for the whole office:  1-local-site-with-chat-and-live\START-10.10.133.9-5173.bat  -> http://10.10.133.9:5173  (chat: /chat)
- Calendar popup no longer cut off; annual view loads faster (6 days at once + saved days in tools\qms-cache; restart the bridge).
- Chat roster = the 133 employees. Run once:  cd chat-server  &&  node scripts\seed-default-users.js
- Chat backup to Google Drive: BACKUP-TO-DRIVE.bat (Google Drive for desktop signed in as ulfinayadessa2017@gmail.com).
- Press Ctrl+F5 in the browser after starting.

## BRANCHES (2026-11-11)
- Pick a branch in the page: no command, no restart. Bole is on its own QMS server (branches.json -> "base": "http://10.10.41.10:7092").
- If Bole needs a different QMS login: type it once in the bridge window, or set QMS_USER_BOLE / QMS_PASS_BOLE.
- Fast first look at every branch:  node qms-bridge.mjs --warm 30
- Absent tickets: see the "Absent recognised by" line printed in the bridge window after each fetch.

## QMS LOGINS (simple way)  - 2026-11-11
Double-click  1-local-site-with-chat-and-live\SET-QMS-LOGINS.bat  once. It asks, one by one:
  1) the MAIN QMS username/password (http://10.10.41.70)   2) the BOLE QMS username/password (http://10.10.41.10:7092)
The passwords are typed hidden and saved only on this computer in qms.env. Then start the bridge as usual - it will not ask again.
To change a password later, run SET-QMS-LOGINS.bat again.

## FIND WHERE THE QMS KEEPS ABSENT TICKETS
Double-click 1-local-site-with-chat-and-live\FIND-ABSENT-ENDPOINT.bat (read-only, changes nothing in the QMS).
For Bole:  node qms-bridge.mjs --discover BOLE     Send the lines that start with FOUND.

## ABSENT TICKETS (automatic)
The bridge now looks by itself for the QMS's absent-ticket list (/tickets/absentTickets and similar) and adds those tickets to the report.
The terminal shows:  "Absent-ticket address found: ..."  or  "No absent-ticket address found automatically".
If it does not find it: run FIND-ABSENT-ENDPOINT.bat, then put the real address in branches.json ("absentPath": "/tickets/NAME") or start with  --absent-path /tickets/NAME

## BEING GENTLE WITH THE QMS (IP was blocked for too many logins/requests)
- The bridge signs in once per server, waits 10 minutes after a refused login, limits to 90 requests/min per server, 2 days at a time,
  and shares one answer for 60 seconds between all users. Options: --rate 90  --concurrency 2  --cache-seconds 60
- Do NOT run several bridge windows at once. --warm is no longer used by START-10.10.133.9-5173.bat.
- Ask the QMS administrators to unblock the bridge computer (10.10.133.9). Check http://localhost:4700/health : logins / requestsSent.

## GIT (Git Bash)
  git init -b main && git add . && git status      (check that qms.env, serviceAccountKey.json and chat-server/data are NOT listed)
  git commit -m "Mesob" && git remote add origin https://github.com/YOURNAME/mesob.git && git push -u origin main
After "git clone" on another PC:  cd 1-local-site-with-chat-and-live/chat-server && npm install   then run SET-QMS-LOGINS.bat.
Use a PRIVATE repository (staff-list.json holds employee names).
