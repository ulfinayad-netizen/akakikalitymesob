MESOB CHAT in this folder

Netlify (static hosting) cannot run the chat server - it needs a computer that stays on.
Pick one:

A) Office computer / server (simplest)
   1. Install Node.js 22.13+ (LTS) from https://nodejs.org
   2. Double-click start-with-chat.bat   (or: node serve.mjs --lan --port 8080)
   3. Open http://THIS-COMPUTER-IP:8080/chat  - sign in e.g. UlfinaY / Mesob@123, then change the password.
   The first start creates every chat account from the HR list. Chat data: chat-server\data\ (back it up).

B) Keep the site on Netlify and run only the chat on a server
   Run  node chat-server/server.js  on the server (env: PORT, JWT_SECRET, DB_PATH, UPLOAD_DIR), run
   node chat-server/scripts/seed-default-users.js once, put a reverse proxy (Caddy/nginx) in front
   that forwards /chat-api, /uploads and /socket.io (websockets) to it, and serve the site from the same
   domain. Netlify rewrites cannot carry websockets, so the proxy must sit in front of both.

SECURITY: the _redirects file hides /chat-server and serve.mjs from the public site. serve.mjs also
refuses to hand out chat-server, *.bat, qms.env etc. Never publish chat-server\data\.
