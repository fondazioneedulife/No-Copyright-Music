param(
  [string]$ClearWaveUrl = "http://10.30.10.142:3000",
  [ValidateSet("chrome", "edge", "firefox", "brave", "chromium")]
  [string]$Browser = "chrome",
  [string]$Username = "admin",
  [string]$CookieFile = "",
  [switch]$KeepFile
)

$ErrorActionPreference = "Stop"

function Stop-WithMessage {
  param([string]$Message)
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  exit 1
}

function Convert-SecureStringToPlainText {
  param([securestring]$SecureValue)
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    if ($ptr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }
}

$ytDlpCommand = Get-Command yt-dlp -ErrorAction SilentlyContinue
if (-not $ytDlpCommand) {
  $ytDlpCommand = Get-Command yt-dlp.exe -ErrorAction SilentlyContinue
}

if (-not $ytDlpCommand) {
  Stop-WithMessage "yt-dlp non trovato. Installa con: winget install yt-dlp.yt-dlp"
}

$baseUrl = $ClearWaveUrl.TrimEnd("/")
if (-not $CookieFile) {
  $CookieFile = Join-Path $env:TEMP ("clearwave-youtube-cookies-{0}.txt" -f (Get-Date -Format "yyyyMMddHHmmss"))
}

Write-Host "ClearWave: $baseUrl"
Write-Host "Browser: $Browser"
Write-Host "Esporto cookie YouTube dal browser..."

$testVideoUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
$ytDlpArgs = @(
  "--cookies-from-browser",
  $Browser,
  "--cookies",
  $CookieFile,
  "--simulate",
  $testVideoUrl
)

& $ytDlpCommand.Source @ytDlpArgs
if ($LASTEXITCODE -ne 0) {
  Stop-WithMessage "Export cookie non riuscito. Chiudi il browser, riaprilo su YouTube loggato e rilancia lo script."
}

if (-not (Test-Path -LiteralPath $CookieFile)) {
  Stop-WithMessage "yt-dlp non ha creato il file cookie."
}

$cookiesText = Get-Content -LiteralPath $CookieFile -Raw
if ($cookiesText -notmatch "youtube\.com|google\.com") {
  Stop-WithMessage "Il file creato non contiene cookie YouTube/Google validi."
}

$password = $null
try {
  $securePassword = Read-Host "Password admin ClearWave per $Username" -AsSecureString
  $password = Convert-SecureStringToPlainText $securePassword

  Write-Host "Login admin ClearWave..."
  $loginPayload = @{
    username = $Username
    password = $password
  } | ConvertTo-Json -Compress

  $loginResponse = Invoke-RestMethod `
    -Uri "$baseUrl/api/auth/login" `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body $loginPayload

  if (-not $loginResponse.token) {
    Stop-WithMessage "Login ClearWave riuscito senza token: risposta non valida."
  }

  Write-Host "Carico cookie nel backend..."
  $uploadPayload = @{
    cookiesText = $cookiesText
  } | ConvertTo-Json -Compress

  $uploadResponse = Invoke-RestMethod `
    -Uri "$baseUrl/api/admin/youtube-cookies" `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Headers @{ Authorization = "Bearer $($loginResponse.token)" } `
    -Body $uploadPayload

  if (-not $uploadResponse.cookies.available) {
    Stop-WithMessage "Cookie inviati, ma ClearWave non li vede come disponibili."
  }

  Write-Host ""
  Write-Host "Cookie YouTube installati correttamente." -ForegroundColor Green
  Write-Host "Apri Admin -> Diagnostica audio/server e premi Aggiorna diagnostica."
  Write-Host "Poi usa Ricontrolla login YouTube per riprovare le tracce bloccate."
} finally {
  if ($password) {
    $password = $null
  }

  if (-not $KeepFile -and (Test-Path -LiteralPath $CookieFile)) {
    Remove-Item -LiteralPath $CookieFile -Force -ErrorAction SilentlyContinue
  }
}
