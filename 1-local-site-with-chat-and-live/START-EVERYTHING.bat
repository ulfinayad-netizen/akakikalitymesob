@echo off
cd /d "%~dp0"
start "QMS bridge - port 4700" cmd /k "node qms-bridge.mjs"
node serve.mjs --lan --mesob --port 5173
pause
