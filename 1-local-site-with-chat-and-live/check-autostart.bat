@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "MESOB_PORT=8080"
if exist "%~dp0qms.env" for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%~dp0qms.env") do if /i "%%a"=="MESOB_PORT" set "MESOB_PORT=%%b"
echo === Startup task ===
schtasks /Query /TN "Mesob" /FO LIST 2>nul | findstr /i "TaskName Status Next"
if errorlevel 1 echo Not installed - run install-autostart.bat as administrator.
echo.
echo === Website on port %MESOB_PORT% ===
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://localhost:%MESOB_PORT%/ ; 'RUNNING (HTTP ' + $r.StatusCode + ')' } catch { 'NOT RUNNING' }"
echo.
echo === Sleep (plugged in) - 0 means never ===
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | findstr /i "Current AC"
echo.
pause
