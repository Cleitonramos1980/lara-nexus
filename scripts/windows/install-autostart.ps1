$ErrorActionPreference = "Stop"

$taskName = "LaraNexus-AutoStart"
$startupScript = (Resolve-Path (Join-Path $PSScriptRoot "start-lara.ps1")).Path

if (-not (Test-Path $startupScript)) {
  throw "Script de inicializacao nao encontrado: $startupScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startupScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

try {
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Inicia automaticamente o backend (3333) e frontend (8080) da Lara no logon." `
    -Force | Out-Null
} catch {
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Inicia automaticamente o backend (3333) e frontend (8080) da Lara no logon." `
    -Force | Out-Null
}

Write-Host "Tarefa '$taskName' criada/atualizada com sucesso."
Write-Host "Script configurado: $startupScript"
