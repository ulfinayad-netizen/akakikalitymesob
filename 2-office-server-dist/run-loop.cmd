@echo off
cd /d "%~dp0"
if not defined NODE set "NODE=node"
if not defined MESOB_PORT set "MESOB_PORT=8080"
:again
if /i "%1"=="bridge" goto bridge
set "EXTRA="
if defined MESOB_USER set "EXTRA=--mesob --share-api"
"%NODE%" serve.mjs --lan --port %MESOB_PORT% %EXTRA%
goto wait
:bridge
ping -n 1 -w 1500 10.10.41.70 | find "TTL=" >nul
if errorlevel 1 (ping -n 16 127.0.0.1 >nul & goto bridge)
"%NODE%" qms-bridge.mjs
:wait
ping -n 6 127.0.0.1 >nul
goto again
