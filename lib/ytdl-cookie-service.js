const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const ytdlSessionCookieNames = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "SIDCC",
  "LSID",
  "OSID",
  "LOGIN_INFO",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PSIDTS",
  "__Secure-3PSIDTS",
  "__Secure-1PSIDCC",
  "__Secure-3PSIDCC",
]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

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

function parseYtdlCookieRows(rawText) {
  const rows = [];
  String(rawText || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .forEach((line) => {
      const cleanLine = line.trim();
      if (!cleanLine) {
        return;
      }

      const cookieLine = cleanLine.startsWith("#HttpOnly_") ? cleanLine.slice("#HttpOnly_".length) : cleanLine;
      if (cookieLine.startsWith("#")) {
        return;
      }

      const columns = cookieLine.split("\t");
      if (columns.length < 7) {
        return;
      }

      rows.push({
        domain: columns[0].trim(),
        includeSubdomains: columns[1].trim(),
        path: columns[2].trim(),
        secure: columns[3].trim(),
        expires: Number(columns[4]) || 0,
        name: columns[5].trim(),
      });
    });

  return rows;
}

function analyzeYtdlCookieText(rawText, expiryWarningDays) {
  // Analisi volutamente senza valori: i cookie sono credenziali private e non devono finire nei log o in UI.
  const rows = parseYtdlCookieRows(rawText);
  const youtubeRows = rows.filter((row) =>
    /(^|\.)youtube\.com$|(^|\.)google\.com$|(^|\.)youtube-nocookie\.com$/i.test(row.domain)
  );
  const names = new Set(youtubeRows.map((row) => row.name).filter(Boolean));
  const sessionCookieNames = Array.from(ytdlSessionCookieNames).filter((name) => names.has(name));
  const expiringSessionCookies = youtubeRows
    .filter((row) => ytdlSessionCookieNames.has(row.name) && row.expires > 0)
    .map((row) => row.expires);
  const latestExpiresAt =
    expiringSessionCookies.length > 0 ? new Date(Math.max(...expiringSessionCookies) * 1000).toISOString() : "";
  const earliestExpiresAt =
    expiringSessionCookies.length > 0 ? new Date(Math.min(...expiringSessionCookies) * 1000).toISOString() : "";
  const expiresInDays = earliestExpiresAt
    ? Math.floor((Date.parse(earliestExpiresAt) - Date.now()) / 86400000)
    : null;
  const expired = Number.isFinite(expiresInDays) ? expiresInDays < 0 : false;
  const expiresSoon = Number.isFinite(expiresInDays) ? expiresInDays <= expiryWarningDays : false;

  return {
    validRows: rows.length,
    youtubeRows: youtubeRows.length,
    sessionCookieCount: sessionCookieNames.length,
    sessionCookieNames,
    hasSessionCookies: sessionCookieNames.length > 0,
    sessionCookieThreshold: 1,
    expiresAt: latestExpiresAt,
    earliestExpiresAt,
    latestExpiresAt,
    expiresInDays,
    expired,
    expiresSoon,
    warningDays: expiryWarningDays,
  };
}

function ytdlCookieWarning(analysis) {
  if (!analysis) {
    return { shouldAlert: false, level: "none", message: "" };
  }

  if (!analysis.hasSessionCookies) {
    return {
      shouldAlert: true,
      level: "error",
      message: "Cookie YouTube presenti ma senza sessione login completa: carica un cookies.txt nuovo.",
    };
  }

  if (analysis.expired) {
    return {
      shouldAlert: true,
      level: "error",
      message: "Cookie YouTube scaduti: carica un cookies.txt nuovo per evitare KO sulle tracce YouTube.",
    };
  }

  if (analysis.expiresSoon) {
    return {
      shouldAlert: true,
      level: "warning",
      message: `Cookie YouTube in scadenza tra ${Math.max(0, analysis.expiresInDays)} giorni: prepara un cookies.txt nuovo.`,
    };
  }

  if (!Number.isFinite(analysis.expiresInDays)) {
    return {
      shouldAlert: false,
      level: "ok",
      message: "Cookie YouTube validi; scadenza critica non rilevata nel file.",
    };
  }

  return {
    shouldAlert: false,
    level: "ok",
    message: `Cookie YouTube validi: prossima scadenza critica tra ${analysis.expiresInDays} giorni.`,
  };
}

function classifyYtdlCookieProbe(result) {
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}\n${result?.error || ""}`;
  if (result?.ok) {
    return {
      ok: true,
      reason: "ok",
      message: firstString(result.stdout, "yt-dlp ha letto YouTube usando i cookie caricati."),
    };
  }

  if (/sign in to confirm|not a bot|inappropriate for some users|use --cookies|cookies-from-browser/i.test(text)) {
    return {
      ok: false,
      reason: "youtube-age-or-login",
      message:
        "YouTube rifiuta ancora la sessione dal Raspberry: rigenera cookies.txt da YouTube gia' loggato oppure attendi e riprova con lo stesso account.",
    };
  }

  if (/No supported JavaScript runtime|js runtime|deno|js-runtimes/i.test(text)) {
    return {
      ok: false,
      reason: "youtube-js-runtime",
      message: "yt-dlp non vede Deno/JavaScript runtime: ricostruisci Docker e controlla CLEARWAVE_YTDL_JS_RUNTIME.",
    };
  }

  if (/private video|video unavailable|removed|not available/i.test(text)) {
    return {
      ok: false,
      reason: "youtube-unavailable",
      message: "Il video test non e' disponibile da YouTube. Cambia CLEARWAVE_YTDL_COOKIE_PROBE_URL.",
    };
  }

  if (/network|tls|ssl|connection|econnreset|enotfound|temporary failure/i.test(text)) {
    return {
      ok: false,
      reason: "network",
      message: "Il container non riesce a raggiungere YouTube in modo stabile.",
    };
  }

  return {
    ok: false,
    reason: "unknown",
    message: firstString(result?.stderr, result?.stdout, result?.error, "Test cookie YouTube non riuscito."),
  };
}

function ytdlCookieAccountAuthorization(classified, probeTarget) {
  const targetSource = firstString(probeTarget?.source, "default");
  const usesProblemTrack = !["default", "manual"].includes(targetSource);

  if (classified.ok && usesProblemTrack) {
    return {
      status: "authorized",
      label: "Account YouTube autorizzato",
      conclusive: true,
      message: "Account YouTube autorizzato: il Raspberry ha aperto una traccia che prima chiedeva login/eta.",
    };
  }

  if (classified.ok && targetSource === "manual") {
    return {
      status: "authorized",
      label: "Account YouTube autorizzato sul video test",
      conclusive: true,
      message: "Account YouTube autorizzato su questo video: il Raspberry lo ha letto con i cookie caricati.",
    };
  }

  if (classified.ok) {
    return {
      status: "inconclusive",
      label: "Test non conclusivo",
      conclusive: false,
      message:
        "Cookie leggibili, ma il test ha usato un video pubblico: serve una traccia problematica per confermare l'account.",
    };
  }

  if (classified.reason === "youtube-age-or-login") {
    return {
      status: "not_authorized",
      label: "Account YouTube non autorizzato",
      conclusive: true,
      message: "Account YouTube non autorizzato dal Raspberry: YouTube chiede ancora login, eta o verifica anti-bot.",
    };
  }

  if (classified.reason === "youtube-unavailable") {
    return {
      status: "inconclusive",
      label: "Video test non disponibile",
      conclusive: false,
      message: "Il video usato per il test non e' disponibile: prova un altro link con -ProbeUrl.",
    };
  }

  if (classified.reason === "youtube-js-runtime" || classified.reason === "network") {
    return {
      status: "infrastructure_error",
      label: "Test account bloccato dal runtime",
      conclusive: false,
      message: classified.message,
    };
  }

  return {
    status: "unknown",
    label: "Test account non riuscito",
    conclusive: false,
    message: classified.message,
  };
}

function isYtdlCookieLoginProblem(value) {
  return /youtube-age-or-login|sign in to confirm|not a bot|inappropriate for some users|use --cookies|cookies-from-browser/i.test(
    String(value || "")
  );
}

function createYtdlCookieService(options = {}) {
  const config = {
    dataDir: options.dataDir,
    defaultCookiesFile: options.defaultCookiesFile,
    cookiesFile: options.cookiesFile,
    cookiesFileFromEnv: options.cookiesFileFromEnv,
    cookieProbeUrl: options.cookieProbeUrl,
    expiryWarningDays: options.expiryWarningDays,
    ytdlFormat: options.ytdlFormat,
    ytdlJsRuntime: options.ytdlJsRuntime,
    attachComputedFields: options.attachComputedFields,
    cookieProbeCandidate: options.cookieProbeCandidate,
    diagnosticCommandResult: options.diagnosticCommandResult,
    getLastPlayerFailure: options.getLastPlayerFailure,
    youtubeWatchUrl: options.youtubeWatchUrl,
    ytDlpCommand: options.ytDlpCommand,
  };

  function cookiesConfigured() {
    // Se l'env non e' impostato, il Raspberry usa automaticamente data/youtube-cookies.txt quando esiste.
    return Boolean(config.cookiesFileFromEnv || fsSync.existsSync(config.defaultCookiesFile));
  }

  function cookiesFileIfAvailable() {
    return fsSync.existsSync(config.cookiesFile) ? config.cookiesFile : "";
  }

  function readCookieAnalysis(filePath) {
    try {
      return analyzeYtdlCookieText(fsSync.readFileSync(filePath, "utf8"), config.expiryWarningDays);
    } catch {
      return null;
    }
  }

  function cookieStatus() {
    const availableFile = cookiesFileIfAvailable();
    const analysis = availableFile ? readCookieAnalysis(availableFile) : null;
    const warning = availableFile
      ? ytdlCookieWarning(analysis)
      : {
          shouldAlert: true,
          level: "warning",
          message: "Cookie YouTube non presenti: carica cookies.txt per ridurre i KO delle tracce YouTube.",
        };
    return {
      configured: cookiesConfigured(),
      available: Boolean(availableFile),
      path: config.cookiesFile,
      source: config.cookiesFileFromEnv ? "env" : "default",
      analysis,
      warning,
    };
  }

  function cookiesUploadTargetFile() {
    const dataRoot = path.resolve(config.dataDir);
    const targetFile = path.resolve(config.cookiesFile || config.defaultCookiesFile);
    if (targetFile !== dataRoot && !targetFile.startsWith(`${dataRoot}${path.sep}`)) {
      throw httpError(
        400,
        "Il percorso cookie configurato non e' dentro la cartella data. Copia il file manualmente o usa /app/data/youtube-cookies.txt."
      );
    }
    return targetFile;
  }

  function normalizeUploadedCookies(rawText) {
    const text = String(rawText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    const byteLength = Buffer.byteLength(text, "utf8");

    if (!text) {
      throw httpError(400, "File cookie vuoto.");
    }

    if (byteLength > 8 * 1024 * 1024) {
      throw httpError(413, "File cookie troppo grande.");
    }

    const analysis = analyzeYtdlCookieText(text, config.expiryWarningDays);

    if (analysis.youtubeRows <= 0) {
      throw httpError(
        400,
        "Il file deve essere un cookies.txt Netscape e contenere cookie YouTube/Google esportati da una sessione autorizzata."
      );
    }

    if (!analysis.hasSessionCookies) {
      throw httpError(
        400,
        "Il file contiene cookie YouTube/Google, ma non abbastanza cookie di sessione login. Esporta cookies.txt dopo aver aperto YouTube con l'account gia' loggato."
      );
    }

    return `${text}\n`;
  }

  async function installCookies(payload = {}) {
    // Salva il cookies.txt nel volume data: il contenuto non viene mai loggato o restituito alla UI.
    const normalized = normalizeUploadedCookies(payload.cookiesText);
    const targetFile = cookiesUploadTargetFile();
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    const tempFile = `${targetFile}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempFile, normalized, { mode: 0o600 });
    try {
      await fs.chmod(tempFile, 0o600);
    } catch {
      // chmod non e' disponibile su tutti i filesystem Windows, Docker lo gestisce su Linux.
    }
    await fs.rename(tempFile, targetFile);

    return {
      ok: true,
      message: "Cookie YouTube installati. Il prossimo play usa la sessione autorizzata.",
      cookies: cookieStatus(),
    };
  }

  function appendYtDlpCommonArgs(args) {
    if (config.ytdlJsRuntime) {
      args.push("--js-runtimes", config.ytdlJsRuntime);
    }

    const cookiesFile = cookiesFileIfAvailable();
    if (cookiesFile) {
      args.push("--cookies", cookiesFile);
    }
    return args;
  }

  function youtubeProbeUrlFromTrack(track) {
    const normalized = config.attachComputedFields ? config.attachComputedFields(track || {}) : track || {};
    return firstString(normalized.sourceUrl, config.youtubeWatchUrl ? config.youtubeWatchUrl(normalized) : "");
  }

  async function selectProbeTarget(payload = {}) {
    const explicitUrl = firstString(payload.url);
    if (explicitUrl) {
      return { url: explicitUrl, source: "manual", title: "", reason: "" };
    }

    try {
      const loginItem = await config.cookieProbeCandidate?.();
      if (loginItem?.source) {
        return {
          url: loginItem.source,
          source: firstString(loginItem.from, "audio-replacement-list"),
          title: firstString(loginItem.title),
          reason: firstString(loginItem.reason),
        };
      }
    } catch {
      // Se il file replacement non esiste o non e' leggibile, usiamo il video di probe standard.
    }

    const lastFailure = config.getLastPlayerFailure?.() || {};
    const lastFailedTrack = lastFailure.track;
    const lastFailedUrl = youtubeProbeUrlFromTrack(lastFailedTrack);
    if (lastFailedUrl && isYtdlCookieLoginProblem(lastFailure.error)) {
      return {
        url: lastFailedUrl,
        source: "last-player-failure",
        title: firstString(lastFailedTrack?.title),
        reason: "youtube-age-or-login",
      };
    }

    return { url: config.cookieProbeUrl, source: "default", title: "", reason: "" };
  }

  async function probeCookies(payload = {}) {
    const cookies = cookieStatus();
    if (!cookies.available) {
      throw httpError(400, "Cookie YouTube non presenti nel container: carica cookies.txt prima del test.");
    }

    if (!cookies.analysis?.hasSessionCookies) {
      throw httpError(
        400,
        "Cookie presenti ma senza sessione login completa: esporta di nuovo cookies.txt da YouTube gia' loggato."
      );
    }

    const probeTarget = await selectProbeTarget(payload);
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      "--socket-timeout",
      "20",
      "--print",
      "%(title)s | %(availability)s",
    ];
    if (config.ytdlFormat) {
      args.push("-f", config.ytdlFormat);
    }
    appendYtDlpCommonArgs(args);
    args.push(probeTarget.url);

    const result = await config.diagnosticCommandResult(config.ytDlpCommand(), args, 35000);
    const classified = classifyYtdlCookieProbe(result);
    const authorization = ytdlCookieAccountAuthorization(classified, probeTarget);

    return {
      ok: classified.ok,
      reason: classified.reason,
      message: firstString(authorization.message, classified.message).slice(0, 600),
      authorization,
      cookies: cookieStatus(),
      probe: {
        url: probeTarget.url,
        source: probeTarget.source,
        candidateTitle: probeTarget.title,
        candidateReason: probeTarget.reason,
        durationMs: result.durationMs,
        exitCode: result.code ?? null,
        message: classified.message.slice(0, 600),
        title: classified.ok ? String(result.stdout || "").split(/\r?\n/).find(Boolean) || "" : "",
      },
    };
  }

  async function removeCookies() {
    const targetFile = cookiesUploadTargetFile();
    if (fsSync.existsSync(targetFile)) {
      await fs.unlink(targetFile);
    }
    return { cookies: cookieStatus(), message: "File dei cookie rimosso con successo." };
  }

  return {
    appendYtDlpCommonArgs,
    cookieStatus,
    cookiesConfigured,
    cookiesFileIfAvailable,
    installCookies,
    probeCookies,
    removeCookies,
  };
}

module.exports = {
  createYtdlCookieService,
};
