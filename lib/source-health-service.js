const fsSync = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)/i.test(String(value || ""));
}

function isGoogleVideoUrl(value) {
  return /googlevideo\.com\/videoplayback/i.test(String(value || ""));
}

function sourceLabel(result) {
  if (result.ok) {
    return "OK";
  }
  if (result.skipped) {
    return "Saltato";
  }
  return "KO";
}

function commandMessage(result) {
  return firstString(result?.stderr, result?.stdout, result?.error, `Codice ${result?.code ?? "n/d"}`).slice(0, 800);
}

function classifyYouTubeFailure(message) {
  const text = String(message || "");
  if (/sign in to confirm|not a bot|inappropriate for some users|use --cookies|cookies-from-browser/i.test(text)) {
    return "youtube-age-or-login";
  }
  if (/403 forbidden|failed to open|avformat_open_input|googlevideo\.com/i.test(text)) {
    return "youtube-stream-open-failed";
  }
  if (/video unavailable|private video|this video is unavailable|not available/i.test(text)) {
    return "youtube-unavailable";
  }
  if (/No supported JavaScript runtime|js-runtimes|deno/i.test(text)) {
    return "youtube-js-runtime";
  }
  if (/timeout|timed out/i.test(text)) {
    return "timeout";
  }
  return "youtube-error";
}

function firstHttpLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => isHttpUrl(line)) || "";
}

function publicSourceForTrack(track = {}) {
  return firstString(track.audioPath, track.playbackPath, track.previewPath, track.sourceUrl);
}

function jamendoSourceForTrack(track = {}) {
  const values = [track.audioPath, track.playbackPath, track.previewPath, track.sourceUrl];
  return firstString(...values.filter((value) => isHttpUrl(value) && !isYouTubeUrl(value) && !isGoogleVideoUrl(value)));
}

function isJamendoTrack(track = {}) {
  const provider = firstString(track.externalProvider, track.sourceType).toLowerCase();
  const source = [track.sourceUrl, track.audioPath, track.playbackPath, track.providerIdentity]
    .map((value) => String(value || ""))
    .join(" ");
  return provider.includes("jamendo") || /jamendo|trackid=\d+/i.test(source);
}

function isVisibleTrack(track = {}) {
  return !track.hiddenFromCatalog && String(track.availabilityStatus || "").toLowerCase() !== "unavailable";
}

function pickYouTubeTrack(tracks = []) {
  return tracks.find((track) => isVisibleTrack(track) && (track.youtubeVideoId || isYouTubeUrl(track.sourceUrl))) || null;
}

function pickJamendoTrack(tracks = []) {
  return tracks.find((track) => isVisibleTrack(track) && isJamendoTrack(track) && jamendoSourceForTrack(track)) || null;
}

function localUploadPath(rootDir, requestPath) {
  if (!requestPath?.startsWith("/uploads/")) {
    return "";
  }
  return path.join(rootDir, requestPath.replace(/^\/+/, ""));
}

function checkHttpOpen(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 12000);
  const redirectsLeft = Number(options.redirectsLeft ?? 3);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
    };

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      finish({ ok: false, statusCode: 0, message: "URL non valido." });
      return;
    }

    const client = parsed.protocol === "http:" ? http : https;
    const request = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          Accept: "*/*",
          Range: "bytes=0-2047",
          "User-Agent": "ClearWave-SourceHealth/1.0",
        },
        timeout: timeoutMs,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectsLeft > 0) {
          response.resume();
          const nextUrl = new URL(location, parsed).toString();
          checkHttpOpen(nextUrl, { timeoutMs, redirectsLeft: redirectsLeft - 1 }).then(finish);
          return;
        }

        finish({
          ok: statusCode >= 200 && statusCode < 400,
          statusCode,
          message: statusCode >= 200 && statusCode < 400 ? "Stream apribile." : `HTTP ${statusCode}.`,
        });
        response.resume();
        request.destroy();
      }
    );

    request.on("timeout", () => {
      request.destroy();
      finish({ ok: false, statusCode: 0, message: `Timeout dopo ${timeoutMs}ms.` });
    });
    request.on("error", (error) => finish({ ok: false, statusCode: 0, message: error.message }));
    request.end();
  });
}

function createSourceHealthService(options = {}) {
  const config = {
    appendYtDlpCommonArgs: options.appendYtDlpCommonArgs,
    canonicalYouTubePlaybackUrl: options.canonicalYouTubePlaybackUrl,
    readLibrary: options.readLibrary,
    rootDir: options.rootDir,
    runCommand: options.runCommand,
    ytdlExtractorArgs: options.ytdlExtractorArgs,
    ytdlFormat: options.ytdlFormat,
    ytDlpCommand: options.ytDlpCommand,
  };
  let running = false;
  let lastResult = {
    checkedAt: "",
    checks: [],
    ok: false,
    running: false,
    summary: "Test sorgenti non ancora eseguito.",
  };

  async function readVisibleLibrary() {
    try {
      return await config.readLibrary();
    } catch (error) {
      return [];
    }
  }

  async function checkYouTube(tracks) {
    const track = pickYouTubeTrack(tracks);
    const targetUrl = track ? config.canonicalYouTubePlaybackUrl(track) : "";
    if (!targetUrl) {
      return [
        {
          detail: "Nessun brano YouTube visibile nel catalogo.",
          key: "youtube-candidate",
          label: "YouTube",
          ok: false,
          skipped: true,
          status: "Saltato",
        },
      ];
    }

    const args = ["--no-warnings", "--no-playlist", "--socket-timeout", "20", "--get-url"];
    if (config.ytdlFormat) {
      args.push("-f", config.ytdlFormat);
    }
    if (config.ytdlExtractorArgs) {
      args.push("--extractor-args", config.ytdlExtractorArgs);
    }
    if (config.appendYtDlpCommonArgs) {
      config.appendYtDlpCommonArgs(args);
    }
    args.push(targetUrl);

    const resolveResult = await config.runCommand(config.ytDlpCommand(), args, 45000);
    const resolveMessage = commandMessage(resolveResult);
    const streamUrl = firstHttpLine(resolveResult.stdout);
    const resolveCheck = {
      detail: resolveResult.ok
        ? `yt-dlp ha risolto: ${firstString(track.title, targetUrl)}`
        : resolveMessage,
      durationMs: resolveResult.durationMs,
      key: "youtube-resolve",
      label: "YouTube yt-dlp",
      ok: Boolean(resolveResult.ok && streamUrl),
      reason: resolveResult.ok && streamUrl ? "ok" : classifyYouTubeFailure(resolveMessage),
      status: sourceLabel({ ok: Boolean(resolveResult.ok && streamUrl) }),
      title: firstString(track.title),
      url: targetUrl,
    };

    if (!resolveCheck.ok) {
      return [resolveCheck];
    }

    const streamResult = await checkHttpOpen(streamUrl, { timeoutMs: 14000 });
    return [
      resolveCheck,
      {
        detail: streamResult.ok
          ? "Il link googlevideo firmato si apre dal server."
          : `yt-dlp risolve il link, ma lo stream risponde ${streamResult.message}`,
        key: "youtube-stream",
        label: "YouTube stream",
        ok: streamResult.ok,
        reason: streamResult.ok ? "ok" : classifyYouTubeFailure(streamResult.message),
        status: sourceLabel(streamResult),
        statusCode: streamResult.statusCode,
        title: firstString(track.title),
      },
    ];
  }

  async function checkJamendo(tracks) {
    const track = pickJamendoTrack(tracks);
    if (!track) {
      return {
        detail: "Nessun brano Jamendo con URL audio remoto nel catalogo.",
        key: "jamendo-stream",
        label: "Jamendo stream",
        ok: false,
        skipped: true,
        status: "Saltato",
      };
    }

    const source = jamendoSourceForTrack(track);
    const result = await checkHttpOpen(source, { timeoutMs: 12000 });
    return {
      detail: result.ok ? "Jamendo risponde con uno stream apribile." : result.message,
      key: "jamendo-stream",
      label: "Jamendo stream",
      ok: result.ok,
      reason: result.ok ? "ok" : "stream-open-failed",
      status: sourceLabel(result),
      statusCode: result.statusCode,
      title: firstString(track.title),
    };
  }

  async function checkLocalAudio(tracks) {
    const localTrack = tracks.find((track) => isVisibleTrack(track) && publicSourceForTrack(track).startsWith("/uploads/"));
    if (!localTrack) {
      return {
        detail: "Nessun file audio locale visibile nel catalogo.",
        key: "local-audio",
        label: "File locali",
        ok: false,
        skipped: true,
        status: "Saltato",
      };
    }

    const source = publicSourceForTrack(localTrack);
    const filePath = localUploadPath(config.rootDir, source);
    const exists = Boolean(filePath && fsSync.existsSync(filePath));
    return {
      detail: exists ? "Il file locale esiste sul filesystem del server." : `File non trovato: ${source}`,
      key: "local-audio",
      label: "File locali",
      ok: exists,
      reason: exists ? "ok" : "missing-file",
      status: sourceLabel({ ok: exists }),
      title: firstString(localTrack.title),
    };
  }

  async function run() {
    if (running) {
      return { ...lastResult, running: true, summary: "Test sorgenti gia' in corso." };
    }

    running = true;
    lastResult = { ...lastResult, running: true, summary: "Test sorgenti in corso..." };
    try {
      const tracks = await readVisibleLibrary();
      const youtubeChecks = await checkYouTube(tracks);
      const jamendoCheck = await checkJamendo(tracks);
      const localCheck = await checkLocalAudio(tracks);
      const checks = [...youtubeChecks, jamendoCheck, localCheck];
      const executedChecks = checks.filter((check) => !check.skipped);
      const ok = executedChecks.length > 0 && executedChecks.every((check) => check.ok);
      lastResult = {
        checkedAt: new Date().toISOString(),
        checks,
        ok,
        running: false,
        summary: ok
          ? "Sorgenti principali raggiungibili."
          : "Almeno una sorgente non risponde correttamente: apri il dettaglio sotto.",
      };
      return lastResult;
    } catch (error) {
      lastResult = {
        checkedAt: new Date().toISOString(),
        checks: [],
        ok: false,
        running: false,
        summary: error.message || "Test sorgenti non riuscito.",
      };
      return lastResult;
    } finally {
      running = false;
    }
  }

  function status() {
    return { ...lastResult, running };
  }

  return {
    run,
    status,
  };
}

module.exports = {
  createSourceHealthService,
};
