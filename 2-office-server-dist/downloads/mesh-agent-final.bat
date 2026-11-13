@echo off
setlocal EnableExtensions
title IT Tool


set "SERVER=10.10.133.9"
set "PORT=443"
set "SITE=__SITE__"
if "%SITE:~0,2%"=="__" set "SITE="
set "MESHID="
set "SVC=Mesh Agent"
set "HERE=%~dp0"
set "DATADIR=%ProgramData%\MeshDeploy"
set "LOG=%DATADIR%\mesh-install.log"
set "REPORT=%DATADIR%\mesh-report.txt"
set "V=0"
set "DIAG=0"
set "RC=0"

for %%a in (%*) do if /i "%%a"=="/verbose" set "V=1"
for %%a in (%*) do if /i "%%a"=="/diag" set "DIAG=1" & set "V=1"

set "WS=Hidden"
if "%V%"=="1" set "WS=Normal"
fltmc >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%* /elevated' -Verb RunAs -WindowStyle %WS%"
  exit /b
)

if not exist "%DATADIR%" mkdir "%DATADIR%" >nul 2>&1
>"%REPORT%" echo Mesh Agent report - %COMPUTERNAME% - %DATE% %TIME%
call :log "Start on %COMPUTERNAME% diag=%DIAG%"
call :out "=========================================="
call :out " Mesh Agent on %COMPUTERNAME%"
call :out " Server: %SERVER%:%PORT%"
call :out "=========================================="

call :out ""
call :out "[1] This PC network"
ipconfig | findstr /i /c:"IPv4" /c:"Subnet Mask" /c:"Default Gateway" > "%DATADIR%\tmp.txt"
call :dump "%DATADIR%\tmp.txt"
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i /c:"IPv4"') do if not defined MYIP set "MYIP=%%i"
if defined MYIP set "MYIP=%MYIP: =%"
set "ISSERVER=0"
if "%MYIP%"=="%SERVER%" set "ISSERVER=1"
if "%ISSERVER%"=="1" call :out "   NOTE: this IS the server PC. Run this script on a different PC to test the network."
ipconfig | findstr /i "Default Gateway" | findstr /r "[0-9]" >nul
if errorlevel 1 call :out "   WARNING: no default gateway - this PC cannot leave its own subnet."

call :out ""
call :out "[2] Reaching %SERVER%:%PORT%"
call :tcptest %SERVER% %PORT%
set "T443=%errorlevel%"
if "%T443%"=="0" call :out "   TCP %PORT%: OK"
if "%T443%"=="2" call :out "   TCP %PORT%: TIMEOUT - a router or firewall is dropping the traffic"
if "%T443%"=="1" call :out "   TCP %PORT%: REFUSED - reachable, but nothing listening (server down?)"

if "%T443%"=="0" goto :skiptrace
call :out "   Route (last hop shown is where it stops):"
tracert -d -h 6 -w 800 %SERVER% > "%DATADIR%\tmp.txt" 2>&1
call :dump "%DATADIR%\tmp.txt"
:skiptrace

call :out ""
call :out "[3] Agent on this PC"
call :findagent
if defined AGENTDIR (call :out "   Folder: %AGENTDIR%") else (call :out "   Not installed yet.")
sc query "%SVC%" >nul 2>&1
if errorlevel 1 (call :out "   Service: not installed") else (call :out "   Service: installed")
sc query "%SVC%" 2>nul | findstr /i "RUNNING" >nul
if not errorlevel 1 call :out "   Service state: RUNNING"
if defined MSH (
  findstr /i "MeshServer" "%MSH%" > "%DATADIR%\tmp.txt" 2>nul
  call :dump "%DATADIR%\tmp.txt"
)

if "%DIAG%"=="1" goto :verdict

call :out ""
call :out "[4] Install / repair"
sc query "%SVC%" >nul 2>&1
if not errorlevel 1 goto :configure

set "ARCH=32"
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "ARCH=64"
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "ARCH=64"
set "SRC="
for %%i in ("%HERE%meshagent%ARCH%*.exe") do set "SRC=%%~fi"
if not defined SRC call :fetchagent
if not defined SRC (
  call :out "   No agent installed and the installer could not be found or downloaded."
  call :out "   Put a file starting with meshagent%ARCH% next to this script, or ask IT to add it to the website downloads folder."
  call :log "FAILED installer missing"
  goto :verdict
)

call :out "   Using installer: %SRC%"
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%HERE%' -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue"
powershell -NoProfile -Command "if ((Get-Item -LiteralPath $env:SRC).Length -gt 500KB) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  call :out "   The installer looks damaged or incomplete (under 500 KB)."
  call :out "   Download it again from https://%SERVER% -^> Add Agent."
  call :log "FAILED installer too small"
  goto :verdict
)

set "TRY=0"
:tryinstall
set /a TRY+=1
call :out "   Installing Mesh Agent, attempt %TRY% of 2..."
copy /y "%SRC%" "%TEMP%\meshagent.exe" >nul
powershell -NoProfile -Command "Unblock-File -LiteralPath (Join-Path $env:TEMP 'meshagent.exe') -ErrorAction SilentlyContinue"
start "" /wait "%TEMP%\meshagent.exe" -fullinstall
set "IRC=%errorlevel%"
call :log "installer exit code %IRC% attempt %TRY%"
del /f /q "%TEMP%\meshagent.exe" >nul 2>&1

set "W=0"
:waitsvc
sc query "%SVC%" >nul 2>&1
if not errorlevel 1 goto :configure
set /a W+=1
if %W% GEQ 30 (
  if %TRY% LSS 2 goto :tryinstall
  call :out "   Install failed: the service was never created."
  call :out "   Check Windows Security -^> Protection history for a blocked/quarantined meshagent."
  call :out "   Also check Smart App Control (Windows 11) - it can block unsigned-for-you installers silently."
  call :log "FAILED service not created"
  goto :verdict
)
ping -n 2 127.0.0.1 >nul
goto :waitsvc

:configure
set "MSH="
set "W=0"
:waitmsh
call :findagent
if defined MSH goto :patch
set /a W+=1
if %W% GEQ 15 (
  call :out "   MeshAgent.msh not found - cannot set the server address."
  call :log "FAILED msh not found"
  goto :verdict
)
ping -n 2 127.0.0.1 >nul
goto :waitmsh

:patch
net stop "%SVC%" >nul 2>&1
ping -n 4 127.0.0.1 >nul
powershell -NoProfile -Command "$p=$env:MSH; $s='MeshServer=wss://'+$env:SERVER+':'+$env:PORT+'/agent.ashx'; $c=@(Get-Content $p); if($c -match '^MeshServer='){ $n=$c -replace '^MeshServer=.*',$s } else { $n=$c+$s }; if(($c -join ';') -ne ($n -join ';')){ Set-Content -Path $p -Value $n -Encoding ASCII; exit 10 } else { exit 0 }"
if errorlevel 10 (call :out "   Server address set to %SERVER%:%PORT%.") else (call :out "   Server address was already correct.")

sc config "%SVC%" start= auto >nul 2>&1
sc failure "%SVC%" reset= 86400 actions= restart/10000/restart/10000/restart/30000 >nul 2>&1
sc failureflag "%SVC%" 1 >nul 2>&1
call :out "   Service set to start automatically and restart itself if it stops."

net start "%SVC%" >nul 2>&1
set "W=0"
:waitrun
sc query "%SVC%" | findstr /i "RUNNING" >nul && goto :running
set /a W+=1
if %W% GEQ 15 (
  call :out "   Service did not start."
  call :log "FAILED service not running"
  goto :verdict
)
ping -n 2 127.0.0.1 >nul
goto :waitrun

:running
call :out "   Waiting for the connection to the server..."
set "W=0"
:waitconn
netstat -n -p tcp | findstr /c:"%SERVER%:%PORT%" | findstr /i "ESTABLISHED" >nul
if not errorlevel 1 goto :verdict
set /a W+=1
if %W% GEQ 20 goto :verdict
ping -n 3 127.0.0.1 >nul
goto :waitconn

:verdict
call :out ""
call :out "================ RESULT ================"
netstat -n -p tcp | findstr /c:"%SERVER%:%PORT%" | findstr /i "ESTABLISHED" >nul
if not errorlevel 1 goto :v_ok
set "RC=1"
if "%ISSERVER%"=="1" call :out " This is the SERVER PC - run this script on another PC to test connectivity."
if not "%T443%"=="0" goto :v_blocked
call :out " NOT CONNECTED - network looks fine but the agent has not linked up."
call :out " Try running this script again, or check the service with: sc query ""Mesh Agent"""
call :log "RESULT agent not connected"
goto :finish

:v_blocked
call :out " NOT CONNECTED - this PC cannot reach %SERVER%:%PORT%."
call :out " This is a network block, not an agent problem."
call :out " Ask the network admin to allow TCP %PORT% from %MYIP% (this subnet) to %SERVER%."
call :log "RESULT blocked t443=%T443%"
goto :finish

:v_ok
call :out " CONNECTED - this PC has a live link to %SERVER%:%PORT%."
call :out " It should be listed in the MeshCentral console now."
if "%ISSERVER%"=="1" call :out " (This is the server's own agent talking to itself - not a test of other PCs.)"
call :log "RESULT connected"
set "RC=0"

:finish
call :out ""
call :out "Report: %REPORT%"
goto :end

:out
if "%V%"=="1" echo(%~1
>>"%REPORT%" echo(%~1
exit /b 0

:log
>>"%LOG%" echo %DATE% %TIME% - %~1
exit /b 0

:dump
if exist "%~1" (
  if "%V%"=="1" type "%~1"
  type "%~1" >>"%REPORT%"
  del /f /q "%~1" >nul 2>&1
)
exit /b 0

:fetchagent
set "DL=%DATADIR%\meshagent%ARCH%.exe"
del /f /q "%DL%" >nul 2>&1
call :out "   No installer next to this script - downloading it..."
if defined SITE call :getfile "%SITE%/downloads/agent?arch=%ARCH%" "%DL%"
if exist "%DL%" goto :fetched
if not defined MESHID goto :fetchfail
set "AID=4"
if "%ARCH%"=="32" set "AID=3"
call :getfile "https://%SERVER%:%PORT%/meshagents?id=%AID%&meshid=%MESHID%&installflags=0" "%DL%"
:fetched
if exist "%DL%" set "SRC=%DL%"
if exist "%DL%" call :out "   Downloaded the agent installer."
exit /b 0
:fetchfail
call :out "   Download not possible (no website address and no MESHID set)."
exit /b 0

:getfile
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; [Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; (New-Object Net.WebClient).DownloadFile('%~1','%~2'); exit 0 } catch { exit 1 }"
if errorlevel 1 del /f /q "%~2" >nul 2>&1
exit /b 0

:findagent
set "AGENTDIR="
set "MSH="
if exist "%ProgramFiles%\Mesh Agent\MeshAgent.exe" set "AGENTDIR=%ProgramFiles%\Mesh Agent"
if exist "C:\Program Files (x86)\Mesh Agent\MeshAgent.exe" set "AGENTDIR=C:\Program Files (x86)\Mesh Agent"
if defined AGENTDIR if exist "%AGENTDIR%\MeshAgent.msh" set "MSH=%AGENTDIR%\MeshAgent.msh"
exit /b 0

:tcptest
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient; $a=$c.BeginConnect('%~1',%~2,$null,$null); if($a.AsyncWaitHandle.WaitOne(4000)){ try { $c.EndConnect($a); $c.Close(); exit 0 } catch { exit 1 } } else { exit 2 } } catch { exit 1 }"
exit /b %errorlevel%

:end
if "%V%"=="1" pause
endlocal & exit /b %RC%
