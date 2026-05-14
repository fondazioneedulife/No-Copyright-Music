#!/usr/bin/env node
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.CLEARWAVE_DATA_DIR || path.join(ROOT_DIR, "data");
const UPLOADS_DIR = process.env.CLEARWAVE_UPLOADS_DIR || path.join(ROOT_DIR, "uploads");
const LIBRARY_FILE = process.env.CLEARWAVE_LIBRARY_FILE || path.join(DATA_DIR, "library.json");
const DEFAULT_SERVER_BASE_URL =
  process.env.CLEARWAVE_CHECK_SERVER_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const DEFAULT_YTDL_PATH = process.env.CLEARWAVE_YTDL_PATH || "/usr/bin/yt-dlp";
const DEFAULT_YTDL_FORMAT =
  process.env.CLEARWAVE_YTDL_FORMAT || "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best";
const DEFAULT_YTDL_COOKIES_FILE = process.env.CLEARWAVE_YTDL_COOKIES_FILE || "";
const DEFAULT_YTDL_JS_RUNTIME = process.env.CLEARWAVE_YTDL_JS_RUNTIME || "";

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function numberOption(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseArgs(argv) {
  const modes = new Set(["source", "metadata", "probe"]);
  const knownProviders = new Set(["all", "youtube", "jamendo", "direct", "upload", "audius", "unknown"]);
  const positionals = [];
  const options = {
    mode: process.env.CLEARWAVE_CHECK_MODE || "probe",
    provider: process.env.CLEARWAVE_CHECK_PROVIDER || "all",
    limit: 0,
    offset: 0,
    concurrency: numberOption(process.env.CLEARWAVE_CHECK_CONCURRENCY, 2, 1, 8),
    timeoutMs: numberOption(process.env.CLEARWAVE_CHECK_TIMEOUT_MS, 30000, 3000, 180000),
    sampleSeconds: numberOption(process.env.CLEARWAVE_CHECK_SAMPLE_SECONDS, 6, 1, 60),
    reportDir: process.env.CLEARWAVE_CHECK_REPORT_DIR || path.join(DATA_DIR, "reports"),
    serverBaseUrl: DEFAULT_SERVER_BASE_URL,
    ytdlPath: DEFAULT_YTDL_PATH,
    ytdlFormat: DEFAULT_YTDL_FORMAT,
    ytdlCookiesFile: DEFAULT_YTDL_COOKIES_FILE,
    ytdlJsRuntime: DEFAULT_YTDL_JS_RUNTIME,
    ids: [],
    idSet: new Set(),
    verbose: false,
    onlyErrors: false,
    csv: true,
    failOnBroken: false,
    includeArchived: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        index += 1;
        return argv[index];
      }
      return "1";
    };

    switch (rawName) {
      case "mode":
        options.mode = nextValue();
        break;
      case "provider":
        options.provider = nextValue();
        break;
      case "limit":
        options.limit = numberOption(nextValue(), 0, 0, 100000);
        break;
      case "offset":
        options.offset = numberOption(nextValue(), 0, 0, 100000);
        break;
      case "concurrency":
        options.concurrency = numberOption(nextValue(), options.concurrency, 1, 8);
        break;
      case "timeout-ms":
        options.timeoutMs = numberOption(nextValue(), options.timeoutMs, 3000, 180000);
        break;
      case "sample-seconds":
        options.sampleSeconds = numberOption(nextValue(), options.sampleSeconds, 1, 60);
        break;
      case "report-dir":
        options.reportDir = path.resolve(nextValue());
        break;
      case "server-base-url":
        options.serverBaseUrl = nextValue().replace(/\/+$/, "");
        break;
      case "ytdl-path":
        options.ytdlPath = nextValue();
        break;
      case "ytdl-format":
        options.ytdlFormat = nextValue();
        break;
      case "ytdl-cookies":
        options.ytdlCookiesFile = nextValue();
        break;
      case "ytdl-js-runtime":
        options.ytdlJsRuntime = nextValue();
        break;
      case "ids":
        options.ids = nextValue()
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "verbose":
        options.verbose = true;
        break;
      case "only-errors":
        options.onlyErrors = true;
        break;
      case "no-csv":
        options.csv = false;
        break;
      case "fail-on-broken":
        options.failOnBroken = true;
        break;
      case "include-archived":
        options.includeArchived = true;
        break;
      default:
        throw new Error(`Opzione non riconosciuta: --${rawName}`);
    }
  }

  // npm su alcune versioni puo' trasformare "--mode probe --limit 5" in "probe 5";
  // questi fallback rendono il comando usabile sia da shell sia da docker compose exec.
  for (const value of positionals) {
    const normalized = String(value || "").trim().toLowerCase();
    if (modes.has(normalized)) {
      options.mode = normalized;
    } else if (knownProviders.has(normalized)) {
      options.provider = normalized;
    } else if (/^\d+$/.test(normalized) && !options.limit) {
      options.limit = numberOption(normalized, options.limit, 0, 100000);
    }
  }

  options.mode = modes.has(options.mode) ? options.mode : "probe";
  options.providerSet = new Set(
    String(options.provider || "all")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  options.idSet = new Set(options.ids);
  return options;
}

function ytdlCookiesFileIfAvailable(options) {
  const cookiesFile = String(options.ytdlCookiesFile || "").trim();
  return cookiesFile && fsSync.existsSync(cookiesFile) ? cookiesFile : "";
}

function printHelp() {
  console.log(`ClearWave catalog audio check

Uso:
  npm run check:tracks:probe
  npm run check:tracks:quick
  node tools/check-library-audio.js --mode metadata --provider youtube --limit 100

Modalita:
  source    controlla solo che ogni traccia abbia una sorgente valida
  metadata  risolve YouTube con yt-dlp e apre gli stream diretti con una richiesta corta
  probe     prova l'avvio reale con mpv --ao=null per alcuni secondi, senza audio in uscita

Opzioni utili:
  --provider all|youtube|jamendo|direct|upload|audius
  --limit 100
  --offset 200
  --concurrency 1..8
  --timeout-ms 30000
  --sample-seconds 6
  --ytdl-cookies /app/data/youtube-cookies.txt
  --ytdl-js-runtime deno:/usr/local/bin/deno
  --ids track-a,track-b
  --only-errors
  --fail-on-broken
  --include-archived
`);
}

async function readLibrary(options = {}) {
  const raw = await fs.readFile(LIBRARY_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.tracks)) {
    throw new Error(`Catalogo non valido: ${LIBRARY_FILE} non contiene tracks[].`);
  }
  if (options.includeArchived) {
    return parsed.tracks;
  }
  return parsed.tracks.filter(
    (track) => !track?.hiddenFromCatalog && String(track?.availabilityStatus || "").toLowerCase() !== "unavailable"
  );
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)/i.test(String(value || ""));
}

function isGoogleVideoTemporaryUrl(value) {
  return /googlevideo\.com\/videoplayback/i.test(String(value || ""));
}

function youtubeWatchUrl(track) {
  const videoId = firstString(track.youtubeVideoId);
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : "";
}

function canonicalYouTubePlaybackUrl(track) {
  // Non usare URL googlevideo salvati: sono temporanei e fanno falsi KO quando scadono.
  return firstString(youtubeWatchUrl(track), isYouTubeUrl(track?.sourceUrl) ? track.sourceUrl : "");
}

function jamendoTrackIdFromTrack(track) {
  const explicit = firstString(track.jamendoTrackId);
  if (explicit) {
    return explicit.match(/\d+/)?.[0] || "";
  }

  const text = [
    track.sourceUrl,
    track.description,
    track.audioPath,
    track.providerIdentity,
  ]
    .map((value) => String(value || ""))
    .join(" ");
  return firstString(
    text.match(/(?:track\/|\/t\/|trackid=)(\d+)/i)?.[1],
    text.match(/jamendo[^0-9]+(\d{4,})/i)?.[1]
  );
}

function providerForTrack(track) {
  const provider = firstString(track.externalProvider, track.sourceType).toLowerCase();
  const sourceUrl = firstString(track.sourceUrl);
  const audioPath = firstString(track.audioPath, track.playbackPath);

  if (provider.includes("youtube") || track.youtubeVideoId || isYouTubeUrl(sourceUrl)) {
    return "youtube";
  }
  if (provider.includes("jamendo") || jamendoTrackIdFromTrack(track)) {
    return "jamendo";
  }
  if (audioPath.startsWith("/uploads/audio/")) {
    return "upload";
  }
  if (audioPath.startsWith("/api/providers/audius/")) {
    return "audius";
  }
  if (isHttpUrl(audioPath) || isHttpUrl(sourceUrl)) {
    return "direct";
  }
  return "unknown";
}

function providerAllowed(provider, providerSet) {
  return providerSet.has("all") || providerSet.has(provider);
}

function localUploadPath(publicPath) {
  const safePart = String(publicPath || "").replace(/^\/uploads\//, "").replace(/^\/+/, "");
  return path.normalize(path.join(UPLOADS_DIR, safePart));
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ClearWave catalog checker/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function freshJamendoAudioSource(track, timeoutMs) {
  const trackId = jamendoTrackIdFromTrack(track);
  const clientId = process.env.JAMENDO_CLIENT_ID || process.env.JAMIENDO_CLIENT_ID;
  if (!trackId || !clientId) {
    return "";
  }

  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("id", trackId);
  url.searchParams.set("audioformat", "mp32");
  url.searchParams.set("include", "licenses+musicinfo");
  url.searchParams.set("prolicensing", "true");
  url.searchParams.set("ccnc", "false");

  const payload = await fetchJson(url, timeoutMs);
  const item = Array.isArray(payload.results) ? payload.results[0] : null;
  return firstString(item?.audio, item?.audiodownload);
}

async function sourceForTrack(track, options) {
  const provider = providerForTrack(track);
  const audioPath = firstString(track.audioPath, track.playbackPath);
  const sourceUrl = firstString(track.sourceUrl);

  if (audioPath.startsWith("/uploads/audio/")) {
    const localPath = localUploadPath(audioPath);
    return { provider, source: localPath, sourceKind: "file" };
  }

  if (provider === "youtube") {
    const source = canonicalYouTubePlaybackUrl(track);
    if (!source && isGoogleVideoTemporaryUrl(firstString(sourceUrl, audioPath))) {
      return { provider, source: "", sourceKind: "expired-youtube-url" };
    }
    return { provider, source, sourceKind: "youtube" };
  }

  if (provider === "jamendo") {
    const freshSource = await freshJamendoAudioSource(track, options.timeoutMs).catch(() => "");
    const source = firstString(freshSource, audioPath, sourceUrl);
    return { provider, source, sourceKind: isHttpUrl(source) ? "direct" : "unknown" };
  }

  if (isHttpUrl(audioPath)) {
    if (isGoogleVideoTemporaryUrl(audioPath)) {
      return { provider: "youtube", source: "", sourceKind: "expired-youtube-url" };
    }
    return { provider, source: audioPath, sourceKind: "direct" };
  }

  if (audioPath.startsWith("/api/")) {
    return { provider, source: `${options.serverBaseUrl}${audioPath}`, sourceKind: "internal-api" };
  }

  if (isHttpUrl(sourceUrl)) {
    if (isGoogleVideoTemporaryUrl(sourceUrl)) {
      return { provider: "youtube", source: "", sourceKind: "expired-youtube-url" };
    }
    return { provider, source: sourceUrl, sourceKind: isYouTubeUrl(sourceUrl) ? "youtube" : "direct" };
  }

  return { provider, source: "", sourceKind: "none" };
}

function sourceForReport(source) {
  if (!isHttpUrl(source)) {
    return source;
  }
  try {
    const url = new URL(source);
    if (url.searchParams.has("from")) {
      url.searchParams.set("from", "redacted");
    }
    return url.toString();
  } catch {
    return source;
  }
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        ...result,
      });
    };

    const timer = setTimeout(() => {
      if (child && child.exitCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {
          // Il processo puo' essere gia' uscito, il risultato timeout resta corretto.
        }
      }
      finish({ ok: false, code: null, timedOut: true, error: `Timeout dopo ${timeoutMs}ms` });
    }, timeoutMs);

    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ ok: false, code: null, error: error.message });
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-6000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-6000);
    });
    child.once("error", (error) => finish({ ok: false, code: null, error: error.message }));
    child.once("close", (code) => finish({ ok: code === 0, code, error: "" }));
  });
}

async function fetchRangeCheck(source, timeoutMs) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source, {
      headers: {
        Range: "bytes=0-65535",
        "User-Agent": "ClearWave catalog checker/1.0",
      },
      signal: controller.signal,
    });
    const statusOk = response.status >= 200 && response.status < 400;
    const contentType = response.headers.get("content-type") || "";
    let bytesRead = 0;

    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        const firstChunk = await reader.read();
        bytesRead = firstChunk.value?.byteLength || 0;
      } finally {
        await reader.cancel().catch(() => {});
      }
    }

    const looksHtml = /text\/html/i.test(contentType);
    return {
      ok: statusOk && !looksHtml,
      code: response.status,
      durationMs: Date.now() - startedAt,
      message: `${response.status} ${response.statusText || ""} ${contentType}`.trim(),
      bytesRead,
    };
  } catch (error) {
    return {
      ok: false,
      code: null,
      durationMs: Date.now() - startedAt,
      message: error.name === "AbortError" ? `Timeout dopo ${timeoutMs}ms` : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkWithYtDlp(source, options) {
  const args = [
    "--quiet",
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--socket-timeout",
    String(Math.ceil(options.timeoutMs / 1000)),
    "--print",
    "%(id)s\t%(duration)s\t%(availability)s",
  ];
  if (options.ytdlFormat) {
    args.push("-f", options.ytdlFormat);
  }
  if (options.ytdlJsRuntime) {
    args.push("--js-runtimes", options.ytdlJsRuntime);
  }
  const cookiesFile = ytdlCookiesFileIfAvailable(options);
  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  }
  args.push(source);
  const result = await runCommand(options.ytdlPath, args, options.timeoutMs);
  const fallbackMessage =
    result.ok || result.timedOut
      ? ""
      : `yt-dlp terminato con codice ${result.code ?? "n/d"} senza dettagli aggiuntivi.`;
  return {
    ok: result.ok,
    code: result.code,
    durationMs: result.durationMs,
    message: firstString(result.stderr, result.stdout, result.error, fallbackMessage),
    timedOut: result.timedOut,
  };
}

async function checkWithMpv(source, sourceKind, options) {
  const args = [
    "--no-video",
    "--force-window=no",
    "--idle=no",
    "--no-config",
    "--ao=null",
    "--volume=0",
    `--length=${options.sampleSeconds}`,
    "--msg-level=all=warn,ytdl_hook=info",
  ];

  if (sourceKind === "youtube") {
    args.push("--ytdl=yes");
    if (options.ytdlFormat) {
      args.push(`--ytdl-format=${options.ytdlFormat}`);
    }
    if (options.ytdlPath) {
      args.push(`--script-opts=ytdl_hook-ytdl_path=${options.ytdlPath}`);
    }
    const cookiesFile = ytdlCookiesFileIfAvailable(options);
    const rawOptions = [];
    if (options.ytdlJsRuntime) {
      rawOptions.push(`js-runtimes=${options.ytdlJsRuntime}`);
    }
    if (cookiesFile) {
      rawOptions.push(`cookies=${cookiesFile}`);
    }
    if (rawOptions.length > 0) {
      args.push(`--ytdl-raw-options=${rawOptions.join(",")}`);
    }
  } else {
    args.push("--ytdl=no");
  }

  args.push(source);
  const result = await runCommand("mpv", args, options.timeoutMs);
  const fallbackMessage =
    result.ok || result.timedOut
      ? ""
      : `mpv terminato con codice ${result.code ?? "n/d"} senza dettagli aggiuntivi.`;
  return {
    ok: result.ok,
    code: result.code,
    durationMs: result.durationMs,
    message: firstString(result.stderr, result.stdout, result.error, fallbackMessage),
    timedOut: result.timedOut,
  };
}

function classifyFailure(message, code, timedOut, sourceKind) {
  const text = String(message || "");
  if (timedOut || /timeout|timed out/i.test(text)) {
    return "timeout";
  }
  if (/sign in to confirm|not a bot|inappropriate for some users|cookies-from-browser|use --cookies/i.test(text)) {
    return "youtube-age-or-login";
  }
  if (/No supported JavaScript runtime|js runtime|js-runtimes|deno/i.test(text)) {
    return "youtube-js-runtime";
  }
  if (/private video|video unavailable|removed|not available|copyright/i.test(text)) {
    return "youtube-unavailable";
  }
  if (/requested format is not available|no video formats|no formats/i.test(text)) {
    return "youtube-format";
  }
  if (/failed to open .*googlevideo\.com|googlevideo\.com\/videoplayback/i.test(text)) {
    return "youtube-stream-open-failed";
  }
  if (/403|401|forbidden|unauthorized/i.test(text)) {
    return "forbidden";
  }
  if (/404|not found/i.test(text)) {
    return "not-found";
  }
  if (/failed to recognize file format|invalid data|could not open/i.test(text)) {
    return "stream-not-playable";
  }
  if (/network|tls|ssl|connection|econnreset|enotfound|temporary failure/i.test(text)) {
    return "network";
  }
  if (/ENOENT/i.test(text)) {
    return "missing-tool";
  }
  if (sourceKind === "youtube" && code === 1) {
    return "youtube-error";
  }
  return code === null || code === undefined ? "unknown" : `exit-${code}`;
}

async function checkTrack(track, catalogIndex, options) {
  const startedAt = Date.now();
  const { provider, source, sourceKind } = await sourceForTrack(track, options);
  const title = firstString(track.title, track.id, `Traccia ${catalogIndex + 1}`);
  const base = {
    index: catalogIndex,
    id: firstString(track.id),
    title,
    provider,
    sourceKind,
    source: sourceForReport(source),
  };

  if (!source) {
    return {
      ...base,
      status: "failed",
      reason: sourceKind === "expired-youtube-url" ? "youtube-expired-url" : "missing-source",
      message:
        sourceKind === "expired-youtube-url"
          ? "La traccia contiene solo un URL googlevideo temporaneo: reimporta il video YouTube originale o aggiungi youtubeVideoId."
          : "La traccia non ha audioPath, sourceUrl o youtubeVideoId utilizzabile.",
      durationMs: Date.now() - startedAt,
    };
  }

  if (sourceKind === "file") {
    const exists = fsSync.existsSync(source);
    return {
      ...base,
      status: exists ? "ok" : "failed",
      reason: exists ? "ok" : "missing-file",
      message: exists ? "File locale trovato." : "File locale non trovato.",
      durationMs: Date.now() - startedAt,
    };
  }

  if (options.mode === "source") {
    return {
      ...base,
      status: "ok",
      reason: "source-present",
      message: "Sorgente presente. Nessun controllo rete eseguito.",
      durationMs: Date.now() - startedAt,
    };
  }

  let result;
  if (options.mode === "metadata" && sourceKind === "youtube") {
    result = await checkWithYtDlp(source, options);
  } else if (options.mode === "metadata") {
    result = await fetchRangeCheck(source, options.timeoutMs);
  } else {
    result = await checkWithMpv(source, sourceKind, options);
  }

  const ok = Boolean(result.ok);
  return {
    ...base,
    status: ok ? "ok" : "failed",
    reason: ok ? "ok" : classifyFailure(result.message, result.code, result.timedOut, sourceKind),
    exitCode: result.code,
    message: firstString(result.message, ok ? "Riproduzione verificata." : "Errore sconosciuto").slice(0, 1000),
    durationMs: result.durationMs || Date.now() - startedAt,
  };
}

function summarize(results) {
  const summary = {
    ok: 0,
    failed: 0,
    byProvider: {},
    byReason: {},
  };

  for (const result of results) {
    summary[result.status] = (summary[result.status] || 0) + 1;
    summary.byProvider[result.provider] = summary.byProvider[result.provider] || { ok: 0, failed: 0 };
    summary.byProvider[result.provider][result.status] =
      (summary.byProvider[result.provider][result.status] || 0) + 1;
    summary.byReason[result.reason] = (summary.byReason[result.reason] || 0) + 1;
  }

  return summary;
}

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function writeReports(report, options) {
  await fs.mkdir(options.reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(options.reportDir, `library-audio-check-${stamp}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  let csvPath = "";
  if (options.csv) {
    csvPath = path.join(options.reportDir, `library-audio-check-${stamp}.csv`);
    const columns = ["index", "status", "reason", "provider", "title", "id", "sourceKind", "source", "message"];
    const rows = [
      columns.join(","),
      ...report.results.map((result) => columns.map((column) => csvValue(result[column])).join(",")),
    ];
    await fs.writeFile(csvPath, rows.join("\n"), "utf8");
  }

  return { jsonPath, csvPath };
}

function printResult(result, checked, total, options) {
  if (options.onlyErrors && result.status === "ok") {
    return;
  }
  if (!options.verbose && result.status === "ok" && checked % 25 !== 0 && checked !== total) {
    return;
  }

  const marker = result.status === "ok" ? "OK" : "KO";
  const detail =
    result.status === "ok"
      ? ""
      : ` - ${String(result.message || "nessun dettaglio")
          .replace(/\s+/g, " ")
          .slice(0, 220)}`;
  console.log(`[${checked}/${total}] ${marker} ${result.provider} - ${result.title} (${result.reason})${detail}`);
}

async function runChecks(tracks, options) {
  const selected = tracks
    .map((track, index) => ({ track, index, provider: providerForTrack(track) }))
    .filter((entry) => providerAllowed(entry.provider, options.providerSet))
    .filter((entry) => options.idSet.size === 0 || options.idSet.has(firstString(entry.track.id)))
    .slice(options.offset, options.limit ? options.offset + options.limit : undefined);

  console.log(`[check] Selezionate: ${selected.length} tracce da controllare.`);

  const results = new Array(selected.length);
  let cursor = 0;
  let checked = 0;

  async function worker() {
    while (cursor < selected.length) {
      const current = cursor;
      cursor += 1;
      const entry = selected[current];
      const result = await checkTrack(entry.track, entry.index, options).catch((error) => ({
        index: entry.index,
        id: firstString(entry.track.id),
        title: firstString(entry.track.title, entry.track.id),
        provider: entry.provider,
        status: "failed",
        reason: "checker-error",
        message: error.message || String(error),
        durationMs: 0,
      }));
      results[current] = result;
      checked += 1;
      printResult(result, checked, selected.length, options);
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, selected.length) }, worker));
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  const tracks = await readLibrary(options);
  console.log(
    `[check] Catalogo: ${tracks.length} tracce. Modalita ${options.mode}, provider ${options.provider}, concorrenza ${options.concurrency}.`
  );
  if (options.mode === "probe") {
    console.log(
      `[check] Prova reale: mpv --ao=null per ${options.sampleSeconds}s a traccia. Non esce audio fisico.`
    );
  }

  const startedAt = Date.now();
  const results = await runChecks(tracks, options);
  const summary = summarize(results);
  const report = {
    createdAt: new Date().toISOString(),
    libraryFile: LIBRARY_FILE,
    mode: options.mode,
    provider: options.provider,
    checkedCount: results.length,
    totalCatalogTracks: tracks.length,
    durationMs: Date.now() - startedAt,
    summary,
    options: {
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      sampleSeconds: options.sampleSeconds,
      serverBaseUrl: options.serverBaseUrl,
      ytdlPath: options.ytdlPath,
      ytdlFormat: options.ytdlFormat,
      ytdlJsRuntime: options.ytdlJsRuntime,
      ytdlCookiesConfigured: Boolean(options.ytdlCookiesFile),
      ytdlCookiesAvailable: Boolean(ytdlCookiesFileIfAvailable(options)),
      ids: options.ids,
    },
    results,
  };
  const paths = await writeReports(report, options);

  console.log(`[check] OK: ${summary.ok || 0}`);
  console.log(`[check] KO: ${summary.failed || 0}`);
  console.log(`[check] Motivi: ${JSON.stringify(summary.byReason)}`);
  console.log(`[check] Report JSON: ${paths.jsonPath}`);
  if (paths.csvPath) {
    console.log(`[check] Report CSV: ${paths.csvPath}`);
  }

  if (options.failOnBroken && (summary.failed || 0) > 0) {
    return 2;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[check] Errore: ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
