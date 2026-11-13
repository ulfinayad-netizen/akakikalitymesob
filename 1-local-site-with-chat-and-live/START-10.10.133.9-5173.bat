@echo off
cd /d "%~dp0"
netsh advfirewall firewall show rule name="Mesob 5173" >nul 2>&1 || netsh advfirewall firewall add rule name="Mesob 5173" dir=in action=allow protocol=TCP localport=5173 >nul 2>&1
start "QMS bridge - port 4700" cmd /k "node qms-bridge.mjs --allow http://10.10.133.9:5173,http://localhost:5173,http://127.0.0.1:5173"
start "Mesob backup to Google Drive" /min cmd /k "node backup-chat.mjs --every 6"
echo.
echo Open:  http://10.10.133.9:5173        Chat: http://10.10.133.9:5173/chat
echo.
node serve.mjs --lan --mesob --share-api --port 5173
pause
