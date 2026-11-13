param([string]$Dir)
$ErrorActionPreference = 'Stop'
$Dir = $Dir.TrimEnd('\')
$cmd = Join-Path $Dir 'start-mesob.cmd'
$act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ""{0}""' -f $cmd) -WorkingDirectory $Dir

$cls = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
function New-EventTrigger([string]$xml) {
  $t = New-CimInstance -CimClass $cls -ClientOnly
  $t.Subscription = $xml
  $t.Enabled = $true
  return $t
}
$resume = New-EventTrigger "<QueryList><Query Id=""0"" Path=""System""><Select Path=""System"">*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and (EventID=1)]]</Select></Query></QueryList>"
$network = New-EventTrigger "<QueryList><Query Id=""0"" Path=""Microsoft-Windows-NetworkProfile/Operational""><Select Path=""Microsoft-Windows-NetworkProfile/Operational"">*[System[(EventID=10000)]]</Select></Query></QueryList>"

$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  $resume,
  $network,
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650))
)
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$pr = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName 'Mesob' -Action $act -Trigger $triggers -Settings $set -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName 'Mesob'
Write-Host 'Startup task "Mesob" created and started.'
