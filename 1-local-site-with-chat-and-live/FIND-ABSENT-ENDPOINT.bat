@echo off
cd /d "%~dp0"
echo Looking for where the QMS keeps absent tickets (read-only, changes nothing)...
node qms-bridge.mjs --discover
echo.
echo Copy the lines that start with FOUND and send them.
pause
