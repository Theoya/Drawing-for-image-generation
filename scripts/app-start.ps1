param([string]$Mode = "start")
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if ($Mode -eq "start") {
  Start-Process -FilePath "$root\node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory $root
}
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  try {
    $c = (Invoke-WebRequest -Uri "http://127.0.0.1:8391/health" -UseBasicParsing -TimeoutSec 2).Content
    Write-Output "HEALTH: $c"
    exit 0
  } catch { }
}
Write-Output "NOT UP after 20s"
exit 1
