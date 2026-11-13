@echo off
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0node-path.txt" set /p NODE=<"%~dp0node-path.txt"
if exist "%~dp0qms.env" for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%~dp0qms.env") do set "%%a=%%b"
if not defined MESOB_PORT set "MESOB_PORT=8080"
if exist "%~dp0qms-bridge.mjs" (
  netstat -ano | findstr ":4700 " | findstr LISTENING >nul
  if errorlevel 1 start "mesob-bridge" /min cmd /c ""%~dp0run-loop.cmd" bridge"
)
call "%~dp0run-loop.cmd" site
