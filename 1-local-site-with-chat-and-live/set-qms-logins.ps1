$ErrorActionPreference = 'Stop'
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$file = Join-Path $dir 'qms.env'
function Plain([System.Security.SecureString]$s) { $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) } }
$lines = @(); if (Test-Path $file) { $lines = @(Get-Content $file -Encoding UTF8) }
function SetKey($k, $v) { $script:lines = @($script:lines | Where-Object { $_ -notmatch ("^\s*" + [regex]::Escape($k) + "\s*=") }) + ($k + "=" + $v) }
function Ask($label, $ukey, $pkey) {
  Write-Host ""; Write-Host $label -ForegroundColor Cyan
  $u = Read-Host '  Username (press Enter to keep what is saved)'
  if ($u) { $p = Plain (Read-Host '  Password (hidden)' -AsSecureString); SetKey $ukey $u; SetKey $pkey $p; Write-Host '  saved.' -ForegroundColor Green }
  else { Write-Host '  kept as it was.' }
}
Write-Host 'QMS logins - they are saved only on this computer (qms.env).' -ForegroundColor Yellow
Ask 'MAIN QMS (http://10.10.41.70)' 'QMS_USER' 'QMS_PASS'
$bf = Join-Path $dir 'branches.json'
if (Test-Path $bf) {
  foreach ($b in (Get-Content $bf -Raw -Encoding UTF8 | ConvertFrom-Json)) {
    if ($b.base) { $k = ($b.code.ToString().ToUpper() -replace '[^A-Z0-9]', '_'); Ask ("$($b.name) QMS (" + $b.site + ")") "QMS_USER_$k" "QMS_PASS_$k" }
  }
}
[System.IO.File]::WriteAllLines($file, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
& icacls $file /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' ($env:USERNAME + ':R') | Out-Null
Write-Host ""; Write-Host 'Done. Restart the QMS bridge window (or START-...bat) and it will not ask again.' -ForegroundColor Green
