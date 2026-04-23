$ErrorActionPreference = "Stop"

# Copia questo file in start-local.ps1 e inserisci le tue chiavi reali.
# Non committare mai start-local.ps1: contiene segreti locali.

$env:JAMENDO_CLIENT_ID = "INSERISCI_CLIENT_ID_JAMENDO"
$env:YOUTUBE_API_KEY = "INSERISCI_API_KEY_YOUTUBE"
$env:AUDIUS_API_KEY = "INSERISCI_API_KEY_AUDIUS"
$env:THEAUDIODB_API_KEY = "INSERISCI_API_KEY_THEAUDIODB"

# Password temporanea del primo admin quando il database SQLite viene creato da zero.
$env:CLEARWAVE_ADMIN_PASSWORD = "CAMBIA_QUESTA_PASSWORD"

# Opzioni locali.
$env:CLEARWAVE_ENABLE_DEMOS = "0"
$env:CLEARWAVE_AUTO_EXPAND = "0"

$port = 3000
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  $listeners |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne $PID } |
    ForEach-Object {
      Write-Host "Chiudo server precedente su porta $port (PID $_)..."
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
  Start-Sleep -Milliseconds 600
}

node server.js
