@echo off
net session >nul 2>&1
if errorlevel 1 (
  echo Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
schtasks /Delete /TN "Mesob" /F
netsh advfirewall firewall delete rule name="Mesob site" >nul 2>&1
echo Auto-start removed. Programs that are running now stay running until you restart the computer.
echo (Sleep settings were not changed back. Change them in Windows Settings - Power if you want.)
pause
