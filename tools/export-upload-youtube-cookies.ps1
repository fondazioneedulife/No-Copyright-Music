param(
  [string]$ClearWaveUrl = "http://10.30.10.142:3000",
  [ValidateSet("chrome", "edge", "firefox", "brave", "chromium")]
  [string]$Browser = "chrome",
  [string]$Username = "admin",
  [string]$YtDlpPath = "",
  [string]$CookieFile = "",
  [switch]$CloseBrowser,
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

function Resolve-YtDlpPath {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (Test-Path -LiteralPath $ExplicitPath) {
      return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }
    Stop-WithMessage "YtDlpPath non trovato: $ExplicitPath"
  }

  foreach ($commandName in @("yt-dlp", "yt-dlp.exe")) {
    $command = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  $candidatePaths = @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\yt-dlp.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\yt-dlp.exe")
  )

  $wingetPackagesDir = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path -LiteralPath $wingetPackagesDir) {
    $wingetPackages = Get-ChildItem -LiteralPath $wingetPackagesDir -Directory -Filter "yt-dlp.yt-dlp_*" -ErrorAction SilentlyContinue
    foreach ($packageDir in $wingetPackages) {
      $candidatePaths += Join-Path $packageDir.FullName "yt-dlp.exe"
    }
  }

  foreach ($candidatePath in $candidatePaths) {
    if (Test-Path -LiteralPath $candidatePath) {
      return (Resolve-Path -LiteralPath $candidatePath).Path
    }
  }

  return ""
}

function Browser-ProcessNames {
  param([string]$BrowserName)

  switch ($BrowserName) {
    "chrome" { return @("chrome") }
    "edge" { return @("msedge") }
    "firefox" { return @("firefox") }
    "brave" { return @("brave") }
    "chromium" { return @("chromium") }
    default { return @($BrowserName) }
  }
}

function Stop-BrowserForCookieExport {
  param([string]$BrowserName)

  $processNames = Browser-ProcessNames $BrowserName
  foreach ($processName in $processNames) {
    $processes = Get-Process -Name $processName -ErrorAction SilentlyContinue
    if ($processes) {
      Write-Host "Chiudo $processName per sbloccare il database cookie..."
      $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 2
}

$ytDlpCommand = Resolve-YtDlpPath $YtDlpPath
if (-not $ytDlpCommand) {
  Stop-WithMessage "yt-dlp non trovato. Installa con winget install yt-dlp.yt-dlp, poi riapri PowerShell e rilancia lo script."
}

$baseUrl = $ClearWaveUrl.TrimEnd("/")
if (-not $CookieFile) {
  $CookieFile = Join-Path $env:TEMP ("clearwave-youtube-cookies-{0}.txt" -f (Get-Date -Format "yyyyMMddHHmmss"))
}

Write-Host "ClearWave: $baseUrl"
Write-Host "Browser: $Browser"
Write-Host "yt-dlp: $ytDlpCommand"

if ($CloseBrowser) {
  Stop-BrowserForCookieExport $Browser
}

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

$ytDlpOutput = & $ytDlpCommand @ytDlpArgs 2>&1
$ytDlpExitCode = $LASTEXITCODE
$ytDlpOutput | ForEach-Object { Write-Host $_ }
if ($ytDlpExitCode -ne 0) {
  $outputText = $ytDlpOutput -join "`n"
  if ($outputText -match "Could not copy .*cookie database") {
    Stop-WithMessage "Chrome/Edge sta bloccando il database cookie. Rilancia con -CloseBrowser oppure chiudi completamente il browser e riprova."
  }
  Stop-WithMessage "Export cookie non riuscito. Verifica di essere loggato su YouTube nello stesso browser scelto."
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
