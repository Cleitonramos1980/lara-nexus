$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backendRoot = Join-Path $projectRoot "backend"
$logsDir = Join-Path $projectRoot ".autostart"

if (-not (Test-Path $logsDir)) {
  New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
}

function Test-NodeCandidate {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path $Path)) { return $false }
  try {
    & $Path -v *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Resolve-NodePath {
  $candidates = New-Object System.Collections.Generic.List[string]

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand -and $nodeCommand.Source) {
    $candidates.Add($nodeCommand.Source)
  }

  $candidates.Add("C:\Program Files\nodejs\node.exe")
  $candidates.Add("C:\Users\$env:USERNAME\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")

  foreach ($candidate in $candidates) {
    if (Test-NodeCandidate -Path $candidate) {
      return $candidate
    }
  }

  throw "Node.js nao encontrado ou sem permissao de execucao."
}

function Get-PortOwnerInfo {
  param([Parameter(Mandatory = $true)][int]$Port)

  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return $null }

  $procId = [int]$listener.OwningProcess
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
  $commandLine = ""
  if ($process -and $null -ne $process.CommandLine) {
    $commandLine = [string]$process.CommandLine
  }
  return [pscustomobject]@{
    Port = $Port
    Pid = $procId
    CommandLine = $commandLine
  }
}

function Test-ListenerOwnedByLara {
  param([Parameter(Mandatory = $true)][int]$Port)

  $ownerInfo = Get-PortOwnerInfo -Port $Port
  if (-not $ownerInfo) { return $false }

  $commandLine = [string]$ownerInfo.CommandLine
  if ($commandLine -match "lara-nexus") { return $true }

  if ($Port -eq 3333 -and $commandLine -match "src/server\.ts") { return $true }
  if ($Port -eq 8080 -and $commandLine -match "vite\.js" -and $commandLine -match "--port 8080") { return $true }

  return $false
}

function Resolve-KnownPortConflict {
  param([Parameter(Mandatory = $true)]$OwnerInfo)

  $commandLine = [string]$OwnerInfo.CommandLine
  if ($commandLine -match "quality-navigator") {
    try {
      Stop-Process -Id $OwnerInfo.Pid -Force -ErrorAction Stop
      Start-Sleep -Seconds 1
      Write-Host "Conflito resolvido na porta $($OwnerInfo.Port): processo do quality-navigator encerrado (PID $($OwnerInfo.Pid))."
      return $true
    } catch {
      Write-Warning "Falha ao encerrar processo em conflito na porta $($OwnerInfo.Port) (PID $($OwnerInfo.Pid))."
      return $false
    }
  }

  return $false
}

function Start-LaraBackend {
  param([Parameter(Mandatory = $true)][string]$NodePath)

  $ownerInfo = Get-PortOwnerInfo -Port 3333
  if ($ownerInfo) {
    if (Test-ListenerOwnedByLara -Port 3333) {
      Write-Host "Backend Lara ja esta ativo na porta 3333 (PID $($ownerInfo.Pid))."
      return
    }
    if (-not (Resolve-KnownPortConflict -OwnerInfo $ownerInfo)) {
      Write-Warning "Porta 3333 ocupada por outro processo (PID $($ownerInfo.Pid)). Backend Lara nao foi iniciado."
      return
    }
  }

  Start-Process -FilePath $NodePath `
    -ArgumentList "node_modules\tsx\dist\cli.mjs", "watch", "src/server.ts" `
    -WorkingDirectory $backendRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsDir "lara-backend.out.log") `
    -RedirectStandardError (Join-Path $logsDir "lara-backend.err.log")

  Write-Host "Backend Lara inicializado (porta 3333)."
}

function Start-LaraFrontend {
  param([Parameter(Mandatory = $true)][string]$NodePath)

  $ownerInfo = Get-PortOwnerInfo -Port 8080
  if ($ownerInfo) {
    if (Test-ListenerOwnedByLara -Port 8080) {
      Write-Host "Frontend Lara ja esta ativo na porta 8080 (PID $($ownerInfo.Pid))."
      return
    }
    if (-not (Resolve-KnownPortConflict -OwnerInfo $ownerInfo)) {
      Write-Warning "Porta 8080 ocupada por outro processo (PID $($ownerInfo.Pid)). Frontend Lara nao foi iniciado."
      return
    }
  }

  Start-Process -FilePath $NodePath `
    -ArgumentList "node_modules\vite\bin\vite.js", "--host", "0.0.0.0", "--port", "8080" `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsDir "lara-frontend.out.log") `
    -RedirectStandardError (Join-Path $logsDir "lara-frontend.err.log")

  Write-Host "Frontend Lara inicializado (porta 8080)."
}

$nodePath = Resolve-NodePath
Write-Host "Node selecionado: $nodePath"

Start-LaraBackend -NodePath $nodePath
Start-LaraFrontend -NodePath $nodePath

Start-Sleep -Seconds 3

$backendUp = [bool](Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue)
$frontendUp = [bool](Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)

Write-Host "Status final -> Backend(3333): $backendUp | Frontend(8080): $frontendUp"
