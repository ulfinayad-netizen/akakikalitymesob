@echo off
setlocal EnableExtensions
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
set "NODEPATH="
for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODEPATH set "NODEPATH=%%n"
if not defined NODEPATH (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
> "%~dp0node-path.txt" echo %NODEPATH%

echo.
set "PORT=8080"
set /p PORT=Website port [8080]: 

set "KEEP="
if exist "%~dp0qms.env" set /p KEEP=Saved logins found. Keep them? [Y/n]: 
if /i "%KEEP%"=="n" del /f /q "%~dp0qms.env" >nul 2>&1
if not exist "%~dp0qms.env" call :asklogins
if not exist "%~dp0qms.env" > "%~dp0qms.env" echo # Mesob settings
findstr /v /b /c:"MESOB_PORT=" "%~dp0qms.env" > "%~dp0qms.env.tmp"
>> "%~dp0qms.env.tmp" echo MESOB_PORT=%PORT%
move /y "%~dp0qms.env.tmp" "%~dp0qms.env" >nul
icacls "%~dp0qms.env" /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" >nul

echo.
echo Opening port %PORT% in Windows Firewall...
netsh advfirewall firewall delete rule name="Mesob site" >nul 2>&1
netsh advfirewall firewall add rule name="Mesob site" dir=in action=allow protocol=TCP localport=%PORT% >nul

echo Turning off sleep while plugged in (a sleeping PC cannot serve the website)...
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1

echo Creating the startup task...
schtasks /Delete /TN "Mesob" /F >nul 2>&1
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart-task.ps1" -Dir "%DIR%"
if errorlevel 1 (
  echo Could not create the startup task.
  pause
  exit /b 1
)
echo.
echo Done. The website now starts by itself:
echo   - when the computer starts (nobody needs to log in)
echo   - when the computer wakes up from sleep
echo   - when the network connects again
echo   - and it is restarted automatically if it ever stops.
echo.
echo Open http://localhost:%PORT% here, or http://THIS-COMPUTER-IP:%PORT% on other PCs.
pause
exit /b 0

:asklogins
setlocal EnableDelayedExpansion
set "QU=" & set "QP=" & set "MU=" & set "MP="
if exist "%~dp0qms-bridge.mjs" (
  echo.
  echo QMS login for the bridge - saved only on this computer. Leave empty to skip.
  set /p QU=QMS username: 
  set /p QP=QMS password: 
)
echo.
echo Live MESOB data login - optional. Leave empty to skip.
set /p MU=MESOB username: 
set /p MP=MESOB password: 
> "%~dp0qms.env" echo # Mesob settings
if defined QU >> "%~dp0qms.env" echo QMS_USER=!QU!
if defined QP >> "%~dp0qms.env" echo QMS_PASS=!QP!
if defined MU >> "%~dp0qms.env" echo MESOB_USER=!MU!
if defined MP >> "%~dp0qms.env" echo MESOB_PASS=!MP!
endlocal
exit /b 0
