param(
  [string]$ClearWaveUrl = "http://10.30.10.142:3000",
  [ValidateSet("chrome", "edge", "firefox", "brave", "chromium")]
  [string]$Browser = "chrome",
  [string]$Username = "admin",
  [string]$YtDlpPath = "",
  [string]$CookieFile = "",
  [string]$ExistingCookieFile = "",
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

function Stop-WithHttpError {
  param(
    [System.Management.Automation.ErrorRecord]$ErrorRecord,
    [string]$FallbackMessage
  )

  $response = $ErrorRecord.Exception.Response
  $statusCode = 0
  if ($response -and $response.StatusCode) {
    $statusCode = [int]$response.StatusCode
  }

  if ($statusCode -eq 401) {
    Stop-WithMessage "Login ClearWave non riuscito: password admin non valida. Usa la stessa password con cui entri nell'app web."
  }

  if ($statusCode -eq 403) {
    Stop-WithMessage "Login riuscito ma l'utente non e' admin. Usa un account amministratore ClearWave."
  }

  if ($statusCode -gt 0) {
    Stop-WithMessage "$FallbackMessage Codice HTTP: $statusCode."
  }

  Stop-WithMessage "$FallbackMessage $($ErrorRecord.Exception.Message)"
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

function Resolve-ChromePath {
  $command = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidatePaths = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )

  foreach ($candidatePath in $candidatePaths) {
    if ($candidatePath -and (Test-Path -LiteralPath $candidatePath)) {
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

function Invoke-ChromeDevToolsCommand {
  param(
    [string]$WebSocketUrl,
    [string]$Method,
    [hashtable]$Params = @{}
  )

  Add-Type -AssemblyName System.Net.WebSockets.Client
  $client = [System.Net.WebSockets.ClientWebSocket]::new()
  $client.Options.SetRequestHeader("Origin", "http://127.0.0.1")
  $id = Get-Random -Minimum 1000 -Maximum 999999
  $message = @{
    id = $id
    method = $Method
    params = $Params
  } | ConvertTo-Json -Compress -Depth 20

  try {
    $client.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $segment = [ArraySegment[byte]]::new($bytes)
    $client.SendAsync(
      $segment,
      [System.Net.WebSockets.WebSocketMessageType]::Text,
      $true,
      [Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()

    $buffer = New-Object byte[] 1048576
    while ($true) {
      $builder = [Text.StringBuilder]::new()
      do {
        $result = $client.ReceiveAsync(
          [ArraySegment[byte]]::new($buffer),
          [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()

        if ($result.Count -gt 0) {
          [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count))
        }
      } while (-not $result.EndOfMessage)

      $payload = $builder.ToString() | ConvertFrom-Json
      if ($payload.id -eq $id) {
        if ($payload.error) {
          throw "Chrome DevTools errore $($payload.error.code): $($payload.error.message)"
        }
        return $payload.result
      }
    }
  } finally {
    if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $client.CloseAsync(
        [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
        "done",
        [Threading.CancellationToken]::None
      ).GetAwaiter().GetResult()
    }
    $client.Dispose()
  }
}

function ConvertTo-NetscapeCookieText {
  param([array]$Cookies)

  $lines = @(
    "# Netscape HTTP Cookie File",
    "# Generated by ClearWave helper. Treat this file like a password."
  )

  foreach ($cookie in $Cookies) {
    $domain = [string]$cookie.domain
    if (-not $domain -or $domain -notmatch "youtube\.com|google\.com") {
      continue
    }

    $httpOnlyPrefix = ""
    if ($cookie.httpOnly) {
      $httpOnlyPrefix = "#HttpOnly_"
    }

    $includeSubdomains = if ($domain.StartsWith(".")) { "TRUE" } else { "FALSE" }
    $path = if ($cookie.path) { [string]$cookie.path } else { "/" }
    $secure = if ($cookie.secure) { "TRUE" } else { "FALSE" }
    $expires = 0
    if ($cookie.expires -and [double]$cookie.expires -gt 0) {
      $expires = [int64][double]$cookie.expires
    }

    $name = ([string]$cookie.name).Replace("`t", "")
    $value = ([string]$cookie.value).Replace("`t", "")
    if ($name) {
      $lines += "{0}{1}`t{2}`t{3}`t{4}`t{5}`t{6}`t{7}" -f $httpOnlyPrefix, $domain, $includeSubdomains, $path, $secure, $expires, $name, $value
    }
  }

  return ($lines -join "`n") + "`n"
}

function Find-RecentChromeCookieExport {
  $folders = @(
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop")
  )

  $candidates = @()
  foreach ($folder in $folders) {
    if (Test-Path -LiteralPath $folder) {
      $candidates += Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.Extension -eq ".txt" -and
          ($_.Name -match "cookie|youtube|google") -and
          $_.LastWriteTime -gt (Get-Date).AddHours(-2)
        }
    }
  }

  return $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

function Request-ChromeCookieExportFile {
  $extensionUrl = "https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
  $youtubeUrl = "https://www.youtube.com"
  $chromePath = Resolve-ChromePath

  Write-Host ""
  Write-Host "Chrome non ha permesso l'export automatico dei cookie." -ForegroundColor Yellow
  Write-Host "Uso il fallback Google Chrome con esportazione file, poi carico il file su ClearWave."
  Write-Host "1. Installa/usa l'estensione Get cookies.txt LOCALLY."
  Write-Host "2. Apri YouTube loggato."
  Write-Host "3. Esporta in formato Netscape e salva il file nei Download o sul Desktop."
  Write-Host "4. Torna qui e premi Invio."

  if ($chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList $extensionUrl | Out-Null
    Start-Sleep -Seconds 1
    Start-Process -FilePath $chromePath -ArgumentList $youtubeUrl | Out-Null
  } else {
    Start-Process $extensionUrl | Out-Null
    Start-Process $youtubeUrl | Out-Null
  }

  while ($true) {
    $manualPath = Read-Host "Premi Invio dopo l'export, oppure incolla qui il percorso del file cookies.txt"
    if ($manualPath) {
      $cleanPath = $manualPath.Trim().Trim('"')
      if (Test-Path -LiteralPath $cleanPath) {
        return (Resolve-Path -LiteralPath $cleanPath).Path
      }
      Write-Host "File non trovato: $cleanPath" -ForegroundColor Yellow
      continue
    }

    $recentFile = Find-RecentChromeCookieExport
    if ($recentFile) {
      Write-Host "File trovato: $($recentFile.FullName)"
      return $recentFile.FullName
    }

    Write-Host "Non trovo un cookies.txt recente in Download/Desktop. Esporta il file e premi di nuovo Invio." -ForegroundColor Yellow
  }
}

function Export-ChromeCookiesWithDevTools {
  param(
    [string]$TargetFile,
    [int]$Port = 9222
  )

  $chromePath = Resolve-ChromePath
  if (-not $chromePath) {
    Stop-WithMessage "Chrome non trovato. Installa Google Chrome o passa un file gia' esportato con -ExistingCookieFile."
  }

  Stop-BrowserForCookieExport "chrome"
  Write-Host "Apro Chrome in modalita' DevTools locale per leggere i cookie dal profilo Google..."
  $chromeArgs = @(
    "--remote-debugging-port=$Port",
    "--remote-allow-origins=http://127.0.0.1",
    "--no-first-run",
    "https://www.youtube.com"
  )
  Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -WindowStyle Minimized | Out-Null

  $versionEndpoint = "http://127.0.0.1:$Port/json/version"
  $targetsEndpoint = "http://127.0.0.1:$Port/json/list"
  $targets = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      Invoke-RestMethod -Uri $versionEndpoint -TimeoutSec 1 | Out-Null
      $targets = Invoke-RestMethod -Uri $targetsEndpoint -TimeoutSec 1
      if ($targets) {
        break
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  if (-not $targets) {
    Stop-BrowserForCookieExport "chrome"
    return Request-ChromeCookieExportFile
  }

  $pageTarget = $targets | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1
  if (-not $pageTarget) {
    Stop-BrowserForCookieExport "chrome"
    return Request-ChromeCookieExportFile
  }

  try {
    [void](Invoke-ChromeDevToolsCommand -WebSocketUrl $pageTarget.webSocketDebuggerUrl -Method "Network.enable")
    $result = Invoke-ChromeDevToolsCommand -WebSocketUrl $pageTarget.webSocketDebuggerUrl -Method "Network.getAllCookies"
    $cookies = @($result.cookies)
    $cookieText = ConvertTo-NetscapeCookieText $cookies
    if ($cookieText -notmatch "youtube\.com|google\.com") {
      return Request-ChromeCookieExportFile
    }
    Set-Content -LiteralPath $TargetFile -Value $cookieText -Encoding UTF8
    return $TargetFile
  } finally {
    Stop-BrowserForCookieExport "chrome"
  }
}

$ytDlpCommand = Resolve-YtDlpPath $YtDlpPath
if (-not $ytDlpCommand -and -not $ExistingCookieFile -and $Browser -ne "chrome") {
  Stop-WithMessage "yt-dlp non trovato. Installa con winget install yt-dlp.yt-dlp, poi riapri PowerShell e rilancia lo script."
}

$baseUrl = $ClearWaveUrl.TrimEnd("/")
$shouldDeleteCookieFile = $false
if (-not $CookieFile) {
  $CookieFile = Join-Path $env:TEMP ("clearwave-youtube-cookies-{0}.txt" -f (Get-Date -Format "yyyyMMddHHmmss"))
  $shouldDeleteCookieFile = -not $KeepFile
}

Write-Host "ClearWave: $baseUrl"
Write-Host "Browser: $Browser"
Write-Host "yt-dlp: $(if ($ytDlpCommand) { $ytDlpCommand } else { 'non trovato, uso fallback Chrome DevTools' })"

if ($ExistingCookieFile) {
  if (-not (Test-Path -LiteralPath $ExistingCookieFile)) {
    Stop-WithMessage "File cookie esistente non trovato: $ExistingCookieFile"
  }

  Write-Host "Uso file cookie gia' esportato: $ExistingCookieFile"
  $CookieFile = (Resolve-Path -LiteralPath $ExistingCookieFile).Path
  $shouldDeleteCookieFile = $false
} else {
  if ($CloseBrowser) {
    Stop-BrowserForCookieExport $Browser
  }

  if (-not $ytDlpCommand -and $Browser -eq "chrome") {
    $exportedCookieFile = Export-ChromeCookiesWithDevTools -TargetFile $CookieFile
    if ($exportedCookieFile -and $exportedCookieFile -ne $CookieFile) {
      $CookieFile = $exportedCookieFile
      $shouldDeleteCookieFile = $false
    }
  } else {
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

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $ytDlpOutput = & $ytDlpCommand @ytDlpArgs 2>&1
      $ytDlpExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    $ytDlpOutput | ForEach-Object { Write-Host $_ }
    if ($ytDlpExitCode -ne 0) {
      $outputText = $ytDlpOutput -join "`n"
      if ($Browser -eq "chrome" -and $outputText -match "Could not copy .*cookie database|Failed to decrypt with DPAPI") {
        Write-Host "yt-dlp non riesce a leggere Chrome. Provo fallback Chrome DevTools..." -ForegroundColor Yellow
        $exportedCookieFile = Export-ChromeCookiesWithDevTools -TargetFile $CookieFile
        if ($exportedCookieFile -and $exportedCookieFile -ne $CookieFile) {
          $CookieFile = $exportedCookieFile
          $shouldDeleteCookieFile = $false
        }
      } elseif ($outputText -match "Could not copy .*cookie database") {
        Stop-WithMessage "Il browser sta bloccando il database cookie. Rilancia con -CloseBrowser oppure chiudilo completamente e riprova."
      } elseif ($outputText -match "Failed to decrypt with DPAPI") {
        Stop-WithMessage "Windows non ha permesso a yt-dlp di decifrare i cookie. Esporta cookies.txt con estensione browser e rilancia con -ExistingCookieFile."
      } else {
        Stop-WithMessage "Export cookie non riuscito. Verifica di essere loggato su YouTube nello stesso browser scelto."
      }
    }
  }
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

  try {
    $loginResponse = Invoke-RestMethod `
      -Uri "$baseUrl/api/auth/login" `
      -Method Post `
      -ContentType "application/json; charset=utf-8" `
      -Body $loginPayload
  } catch {
    Stop-WithHttpError $_ "Login ClearWave non riuscito."
  }

  if (-not $loginResponse.token) {
    Stop-WithMessage "Login ClearWave riuscito senza token: risposta non valida."
  }

  Write-Host "Carico cookie nel backend..."
  $uploadPayload = @{
    cookiesText = $cookiesText
  } | ConvertTo-Json -Compress

  try {
    $uploadResponse = Invoke-RestMethod `
      -Uri "$baseUrl/api/admin/youtube-cookies" `
      -Method Post `
      -ContentType "application/json; charset=utf-8" `
      -Headers @{ Authorization = "Bearer $($loginResponse.token)" } `
      -Body $uploadPayload
  } catch {
    Stop-WithHttpError $_ "Upload cookie ClearWave non riuscito."
  }

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

  if ($shouldDeleteCookieFile -and (Test-Path -LiteralPath $CookieFile)) {
    Remove-Item -LiteralPath $CookieFile -Force -ErrorAction SilentlyContinue
  }
}
