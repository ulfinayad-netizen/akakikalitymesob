@echo off
cd /d "%~dp0"
echo Backing up Mesob chat to Google Drive every 6 hours. Keep this window open.
node backup-chat.mjs --every 6
pause
