$ErrorActionPreference = "Stop"

# Avvio sviluppo React completo: Vite resta su 5173, mentre /api viene proxyato al backend locale.
# Questo evita il classico errore di login quando React e' acceso ma server.js non sta girando.
$backendUrl = "http://localhost:3000"
$healthUrl = "$backendUrl/api/health"

function Test-BackendHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-BackendHealth)) {
  Write-Host "Avvio backend ClearWave su porta 3000..."
  Start-Process `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\start-local.ps1") `
    -WorkingDirectory (Get-Location).Path `
    -WindowStyle Minimized

  $ready = $false
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-BackendHealth) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "Backend non raggiungibile su $healthUrl. Controlla start-local.ps1 o la porta 3000."
  }
}

Write-Host "Backend collegato: $healthUrl"
Write-Host "Avvio React/Vite su http://localhost:5173 con proxy API verso $backendUrl..."
npm --prefix frontend run dev
