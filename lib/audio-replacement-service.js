const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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

async function readJsonFileIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw || "null") ?? fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function isYouTubeTrack(track) {
  const provider = firstString(track?.externalProvider, track?.sourceType).toLowerCase();
  const sourceUrl = firstString(track?.sourceUrl, track?.embedPath);
  return provider.includes("youtube") || Boolean(track?.youtubeVideoId) || /(?:youtube\.com|youtu\.be)/i.test(sourceUrl);
}

function isYouTubeLoginFailure(result) {
  const text = `${result?.reason || ""} ${result?.message || ""}`.toLowerCase();
  return /youtube-age-or-login|sign in to confirm|not a bot|inappropriate for some users|use --cookies|cookies-from-browser/.test(
    text
  );
}

function isHardBrokenReason(reason) {
  return new Set([
    "youtube-unavailable",
    "youtube-format",
    "stream-not-playable",
    "missing-source",
    "missing-file",
    "not-found",
    "forbidden",
  ]).has(String(reason || "").toLowerCase());
}

function replacementListFallback() {
  return {
    updatedAt: "",
    source: "",
    summary: {
      checked: 0,
      replaceCount: 0,
      waitingForCookies: 0,
    },
    items: [],
  };
}

function replacementItemFromResult(result, trackById, reportJson, checkedAt) {
  const track = trackById.get(result.id) || {};
  return {
    id: result.id,
    title: firstString(result.title, track.title, result.id),
    artist: firstString(track.artist, track.subtitle, track.creatorName),
    provider: result.provider || "youtube",
    reason: result.reason || "unknown",
    message: firstString(result.message, "Errore non specificato.").slice(0, 500),
    source: firstString(result.source, track.sourceUrl),
    checkedAt,
    reportJson: reportJson ? path.basename(reportJson) : "",
  };
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function createAudioReplacementService({
  rootDir,
  dataDir,
  reportsDir,
  replacementFile,
  readLibrary,
  writeLibrary,
  getYtdlCookiesFile,
  getLastPlayerFailure,
  nodePath = process.execPath,
  env = process.env,
}) {
  const fullAuditState = {
    running: false,
    startedAt: "",
    finishedAt: "",
    lastError: "",
    lastExitCode: null,
    lastSignal: "",
    checked: 0,
    total: 0,
    catalogTotal: 0,
    loginFailures: 0,
    earlyAbort: false,
    reportJson: "",
    summary: null,
    logTail: [],
    config: null,
  };
  let fullAuditProcess = null;

  async function readList() {
    const parsed = await readJsonFileIfExists(replacementFile, replacementListFallback());
    return {
      ...replacementListFallback(),
      ...parsed,
      summary: {
        ...replacementListFallback().summary,
        ...(parsed?.summary || {}),
      },
      items: Array.isArray(parsed?.items) ? parsed.items : [],
    };
  }

  function pushAuditLog(line) {
    const cleanLine = String(line || "").trim();
    if (!cleanLine) {
      return;
    }

    fullAuditState.logTail.push(cleanLine);
    if (fullAuditState.logTail.length > 40) {
      fullAuditState.logTail.shift();
    }

    const catalogMatch = cleanLine.match(/^\[check\]\s+Catalogo:\s+(\d+)\s+tracce/i);
    if (catalogMatch) {
      fullAuditState.catalogTotal = Number(catalogMatch[1]);
      return;
    }

    const selectedMatch = cleanLine.match(/^\[check\]\s+Selezionate:\s+(\d+)\s+tracce/i);
    if (selectedMatch) {
      fullAuditState.total = Number(selectedMatch[1]);
      return;
    }

    const progressMatch = cleanLine.match(/^\[(\d+)\/(\d+)\]\s+(OK|KO)\s+/i);
    if (progressMatch) {
      fullAuditState.checked = Number(progressMatch[1]);
      fullAuditState.total = Number(progressMatch[2]);
      if (
        progressMatch[3].toUpperCase() === "KO" &&
        /youtube-age-or-login|sign in to confirm|not a bot|use --cookies/i.test(cleanLine)
      ) {
        fullAuditState.loginFailures += 1;
        if (fullAuditState.checked >= 10 && fullAuditState.loginFailures >= 10 && fullAuditProcess) {
          fullAuditState.earlyAbort = true;
          fullAuditState.lastError =
            "Audit YouTube fermato: troppe tracce iniziali chiedono login/anti-bot. Rigenera cookies.txt o verifica l'account YouTube prima di rilanciare.";
          try {
            fullAuditProcess.kill("SIGTERM");
          } catch {
            // Se il processo e' gia' chiuso, lo stato di errore sopra resta comunque utile in UI.
          }
        }
      }
      return;
    }

    const okMatch = cleanLine.match(/^\[check\]\s+OK:\s+(\d+)/i);
    if (okMatch) {
      fullAuditState.summary = {
        ...(fullAuditState.summary || {}),
        ok: Number(okMatch[1]),
      };
      return;
    }

    const failedMatch = cleanLine.match(/^\[check\]\s+KO:\s+(\d+)/i);
    if (failedMatch) {
      fullAuditState.summary = {
        ...(fullAuditState.summary || {}),
        failed: Number(failedMatch[1]),
      };
      return;
    }

    const reasonsMatch = cleanLine.match(/^\[check\]\s+Motivi:\s+(.+)$/i);
    if (reasonsMatch) {
      try {
        fullAuditState.summary = {
          ...(fullAuditState.summary || {}),
          byReason: JSON.parse(reasonsMatch[1]),
        };
      } catch {
        fullAuditState.summary = {
          ...(fullAuditState.summary || {}),
          reasonsText: reasonsMatch[1],
        };
      }
      return;
    }

    const reportMatch = cleanLine.match(/^\[check\]\s+Report JSON:\s+(.+)$/i);
    if (reportMatch) {
      fullAuditState.reportJson = reportMatch[1];
    }
  }

  function appendAuditOutput(chunk) {
    String(chunk || "")
      .split(/\r?\n/)
      .forEach(pushAuditLog);
  }

  function auditStatus() {
    return {
      ...fullAuditState,
      logTail: [...fullAuditState.logTail],
      summary: fullAuditState.summary ? { ...fullAuditState.summary } : null,
      config: fullAuditState.config ? { ...fullAuditState.config } : null,
      progress:
        fullAuditState.total > 0 ? Math.round((fullAuditState.checked / fullAuditState.total) * 100) : 0,
    };
  }

  async function writeList(payload) {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(replacementFile, JSON.stringify(payload, null, 2), "utf8");
    return payload;
  }

  async function backupLibraryBeforeCleanup(library) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(dataDir, `library-before-audio-cleanup-${stamp}.json`);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(backupFile, JSON.stringify({ tracks: library }, null, 2), "utf8");
    return backupFile;
  }

  async function cleanupHardBrokenTracks(options = {}) {
    if (fullAuditState.running) {
      throw new Error("Aspetta la fine della verifica YouTube prima di pulire il catalogo.");
    }

    if (typeof writeLibrary !== "function") {
      throw new Error("Cleanup catalogo non configurato: writeLibrary mancante.");
    }

    const replacementList = await readList();
    const items = Array.isArray(replacementList.items) ? replacementList.items : [];
    const requestedReasons = Array.isArray(options.reasons)
      ? new Set(options.reasons.map((reason) => String(reason || "").toLowerCase()).filter(Boolean))
      : null;
    const removableItems = items.filter((item) =>
      requestedReasons ? requestedReasons.has(String(item.reason || "").toLowerCase()) : isHardBrokenReason(item.reason)
    );
    const removableIds = new Set(removableItems.map((item) => firstString(item.id)).filter(Boolean));

    if (removableIds.size === 0) {
      return {
        ok: true,
        message: "Nessuna traccia rotta confermata da rimuovere.",
        removed: 0,
        kept: items.length,
        backupFile: "",
        replacementList,
      };
    }

    const library = await readLibrary();
    const backupFile = await backupLibraryBeforeCleanup(library);
    const nextLibrary = library.filter((track) => !removableIds.has(firstString(track.id)));
    const removed = library.length - nextLibrary.length;
    await writeLibrary(nextLibrary);

    const keptItems = items.filter((item) => !removableIds.has(firstString(item.id)));
    const reasonCounts = removableItems.reduce((counts, item) => {
      const reason = firstString(item.reason, "unknown");
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {});
    const nextList = await writeList({
      ...replacementListFallback(),
      ...replacementList,
      updatedAt: new Date().toISOString(),
      source: "audio-cleanup",
      summary: {
        ...(replacementList.summary || {}),
        cleanupRemoved: removed,
        replaceCount: keptItems.length,
        hardBrokenRemaining: keptItems.filter((item) => isHardBrokenReason(item.reason)).length,
      },
      items: keptItems,
    });

    return {
      ok: true,
      message: `Pulizia completata: ${removed} tracce YouTube non disponibili rimosse dal catalogo.`,
      removed,
      kept: keptItems.length,
      backupFile: path.basename(backupFile),
      reasonCounts,
      replacementList: nextList,
    };
  }

  async function recentReports(limit = 8) {
    try {
      const entries = await fs.readdir(reportsDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^library-audio-check-.+\.json$/i.test(entry.name))
          .map(async (entry) => {
            const filePath = path.join(reportsDir, entry.name);
            const stat = await fs.stat(filePath);
            return { filePath, mtimeMs: stat.mtimeMs };
          })
      );
      return files
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(0, limit);
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async function collectYouTubeLoginCandidateIds() {
    // I candidati arrivano dagli ultimi report: cosi' il pulsante admin non rianalizza tutto il catalogo.
    const ids = new Set();
    const reports = await recentReports();

    for (const reportInfo of reports) {
      const report = await readJsonFileIfExists(reportInfo.filePath, null);
      const results = Array.isArray(report?.results) ? report.results : [];
      results
        .filter((result) => result?.provider === "youtube" && isYouTubeLoginFailure(result))
        .forEach((result) => {
          if (result.id) {
            ids.add(result.id);
          }
        });
    }

    const lastFailure = getLastPlayerFailure?.() || {};
    if (lastFailure.track?.id && isYouTubeLoginFailure({ message: lastFailure.error })) {
      ids.add(lastFailure.track.id);
    }

    return {
      ids: Array.from(ids),
      reportsRead: reports.length,
    };
  }

  async function runCatalogAudioCheckForIds(ids, options = {}) {
    // Riusa il checker CLI con filtro --ids: stessa logica del report generale, ma su un gruppo piccolo.
    await fs.mkdir(reportsDir, { recursive: true });
    const mode = options.mode || "probe";
    const timeoutMs = Number(options.timeoutMs) || 45000;
    const concurrency = Math.max(1, Math.min(3, Number(options.concurrency) || 1));
    const args = [
      path.join(rootDir, "tools", "check-library-audio.js"),
      "--mode",
      mode,
      "--provider",
      "youtube",
      "--concurrency",
      String(concurrency),
      "--timeout-ms",
      String(timeoutMs),
      "--sample-seconds",
      String(Number(options.sampleSeconds) || 6),
      "--report-dir",
      reportsDir,
      "--only-errors",
    ];

    if (ids.length > 0) {
      args.push("--ids", ids.join(","));
    }

    const cookiesFile = getYtdlCookiesFile?.() || "";
    if (cookiesFile && fsSync.existsSync(cookiesFile)) {
      args.push("--ytdl-cookies", cookiesFile);
    }

    const processTimeoutMs = Math.min(15 * 60 * 1000, 30000 + Math.ceil(ids.length / concurrency) * timeoutMs);
    return new Promise((resolve, reject) => {
      const processRef = spawn(nodePath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        processRef.kill("SIGTERM");
        reject(new Error("Ricontrollo YouTube troppo lento: prova con meno tracce o aumenta il timeout."));
      }, processTimeoutMs);

      processRef.stdout.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-12000);
      });
      processRef.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-12000);
      });
      processRef.once("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Check audio non avviabile: ${error.message || "node non disponibile"}.`));
        }
      });
      processRef.once("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const reportJson = firstString(
          stdout.match(/\[check\]\s+Report JSON:\s+(.+)$/im)?.[1],
          stderr.match(/\[check\]\s+Report JSON:\s+(.+)$/im)?.[1]
        );
        resolve({ code, stdout, stderr, reportJson });
      });
    });
  }

  async function finalizeFullYouTubeAudit(reportJson, source) {
    const report = reportJson ? await readJsonFileIfExists(reportJson, null) : null;
    if (!report || !Array.isArray(report.results)) {
      return readList();
    }

    const library = (await readLibrary()).filter(isYouTubeTrack);
    const trackById = new Map(library.map((track) => [track.id, track]));
    const results = report.results;
    const failed = results.filter((entry) => entry.status === "failed");
    const checkedAt = new Date().toISOString();
    const cookiesFile = getYtdlCookiesFile?.() || "";
    const cookiesAvailable = Boolean(cookiesFile && fsSync.existsSync(cookiesFile));
    const waitingForCookies = failed.filter((entry) => isYouTubeLoginFailure(entry) && !cookiesAvailable);
    const replacements = failed.filter((entry) => cookiesAvailable || !isYouTubeLoginFailure(entry));

    const replacementList = await writeList({
      updatedAt: checkedAt,
      source,
      reportJson: reportJson ? path.basename(reportJson) : "",
      summary: {
        candidates: library.length,
        checked: results.length,
        ok: results.filter((entry) => entry.status === "ok").length,
        failed: failed.length,
        replaceCount: replacements.length,
        waitingForCookies: waitingForCookies.length,
        cookiesAvailable,
        truncated: Number(report.checkedCount || results.length) < library.length,
      },
      items: replacements.map((entry) => replacementItemFromResult(entry, trackById, reportJson, checkedAt)),
    });

    fullAuditState.summary = {
      ...(fullAuditState.summary || {}),
      ok: replacementList.summary.ok,
      failed: replacementList.summary.failed,
      replaceCount: replacementList.summary.replaceCount,
      waitingForCookies: replacementList.summary.waitingForCookies,
      byReason: report?.summary?.byReason || fullAuditState.summary?.byReason || {},
    };

    return replacementList;
  }

  function startFullYouTubeAudit(options = {}) {
    if (fullAuditState.running) {
      return {
        ok: true,
        message: "Verifica YouTube gia' in corso.",
        audit: auditStatus(),
      };
    }

    const requestedMode = String(options.mode || env.CLEARWAVE_YOUTUBE_FULL_AUDIT_MODE || "").toLowerCase();
    const mode = ["source", "metadata", "probe"].includes(requestedMode)
      ? requestedMode
      : "metadata";
    const concurrency = boundedNumber(
      options.concurrency ?? env.CLEARWAVE_YOUTUBE_FULL_AUDIT_CONCURRENCY,
      3,
      1,
      6
    );
    const timeoutMs = boundedNumber(
      options.timeoutMs ?? env.CLEARWAVE_YOUTUBE_FULL_AUDIT_TIMEOUT_MS,
      25000,
      3000,
      180000
    );
    const sampleSeconds = boundedNumber(
      options.sampleSeconds ?? env.CLEARWAVE_YOUTUBE_FULL_AUDIT_SAMPLE_SECONDS,
      4,
      1,
      30
    );
    const limit = boundedNumber(options.limit ?? env.CLEARWAVE_YOUTUBE_FULL_AUDIT_LIMIT, 0, 0, 100000);

    fullAuditState.running = true;
    fullAuditState.startedAt = new Date().toISOString();
    fullAuditState.finishedAt = "";
    fullAuditState.lastError = "";
    fullAuditState.lastExitCode = null;
    fullAuditState.lastSignal = "";
    fullAuditState.checked = 0;
    fullAuditState.total = 0;
    fullAuditState.catalogTotal = 0;
    fullAuditState.loginFailures = 0;
    fullAuditState.earlyAbort = false;
    fullAuditState.reportJson = "";
    fullAuditState.summary = null;
    fullAuditState.logTail = [];
    fullAuditState.config = {
      mode,
      concurrency,
      timeoutMs,
      sampleSeconds,
      limit,
    };

    const args = [
      path.join(rootDir, "tools", "check-library-audio.js"),
      "--mode",
      mode,
      "--provider",
      "youtube",
      "--concurrency",
      String(concurrency),
      "--timeout-ms",
      String(timeoutMs),
      "--sample-seconds",
      String(sampleSeconds),
      "--report-dir",
      reportsDir,
    ];

    if (limit > 0) {
      args.push("--limit", String(limit));
    }

    const cookiesFile = getYtdlCookiesFile?.() || "";
    if (cookiesFile && fsSync.existsSync(cookiesFile)) {
      args.push("--ytdl-cookies", cookiesFile);
    }

    fs.mkdir(reportsDir, { recursive: true })
      .then(
        () =>
          new Promise((resolve) => {
            let processRef;
            try {
              processRef = spawn(nodePath, args, {
                env: {
                  ...env,
                  CLEARWAVE_DATA_DIR: dataDir,
                },
                stdio: ["ignore", "pipe", "pipe"],
              });
              fullAuditProcess = processRef;
            } catch (error) {
              fullAuditState.lastError = error.message || String(error);
              fullAuditState.running = false;
              fullAuditState.finishedAt = new Date().toISOString();
              resolve();
              return;
            }

            processRef.stdout.on("data", appendAuditOutput);
            processRef.stderr.on("data", appendAuditOutput);
            processRef.once("error", (error) => {
              fullAuditState.lastError = error.message || String(error);
            });
            processRef.once("close", (code, signal) => {
              fullAuditState.lastExitCode = code;
              fullAuditState.lastSignal = signal || "";
              fullAuditState.finishedAt = new Date().toISOString();
              if (fullAuditState.earlyAbort && !fullAuditState.lastError) {
                fullAuditState.lastError =
                  "Audit YouTube fermato: troppi KO login/anti-bot all'inizio. Rigenera cookies.txt e rilancia.";
              } else if (code !== 0 && !fullAuditState.lastError) {
                fullAuditState.lastError = `Verifica YouTube terminata con codice ${code ?? signal ?? "n/d"}.`;
              }

              const finalize = fullAuditState.earlyAbort
                ? Promise.resolve()
                : finalizeFullYouTubeAudit(fullAuditState.reportJson, "youtube-full-audit");

              finalize
                .catch((error) => {
                  fullAuditState.lastError = error.message || String(error);
                })
                .finally(() => {
                  fullAuditState.running = false;
                  if (fullAuditProcess === processRef) {
                    fullAuditProcess = null;
                  }
                  resolve();
                });
            });
          })
      )
      .catch((error) => {
        fullAuditState.lastError = error.message || String(error);
        fullAuditState.running = false;
        fullAuditState.finishedAt = new Date().toISOString();
      });

    return {
      ok: true,
      message:
        mode === "metadata"
          ? "Verifica completa YouTube avviata in background: controllo cookie/yt-dlp su tutto il catalogo."
          : "Verifica completa YouTube avviata in background.",
      audit: auditStatus(),
    };
  }

  async function recheckYouTubeLoginFailures() {
    // Dopo il ricontrollo con eventuali cookie, solo i fallimenti residui diventano "da sostituire".
    const { ids, reportsRead } = await collectYouTubeLoginCandidateIds();
    const maxTracks = Math.max(1, Math.min(250, Number(env.CLEARWAVE_YOUTUBE_LOGIN_RECHECK_LIMIT) || 80));
    const selectedIds = ids.slice(0, maxTracks);

    if (selectedIds.length === 0) {
      return {
        ok: true,
        message: "Nessuna traccia YouTube con errore login trovata negli ultimi report.",
        candidates: 0,
        checked: 0,
        truncated: false,
        replacementList: await readList(),
      };
    }

    const library = (await readLibrary()).filter(isYouTubeTrack);
    const trackById = new Map(library.map((track) => [track.id, track]));
    const result = await runCatalogAudioCheckForIds(selectedIds);
    const report = result.reportJson ? await readJsonFileIfExists(result.reportJson, null) : null;
    const results = Array.isArray(report?.results) ? report.results : [];
    const cookiesFile = getYtdlCookiesFile?.() || "";
    const cookiesAvailable = Boolean(cookiesFile && fsSync.existsSync(cookiesFile));
    const failed = results.filter((entry) => entry.status === "failed");
    const waitingForCookies = failed.filter((entry) => isYouTubeLoginFailure(entry) && !cookiesAvailable);
    const replacements = failed.filter((entry) => cookiesAvailable || !isYouTubeLoginFailure(entry));
    const checkedAt = new Date().toISOString();
    const replacementList = await writeList({
      updatedAt: checkedAt,
      source: "youtube-login-recheck",
      reportJson: result.reportJson ? path.basename(result.reportJson) : "",
      summary: {
        candidates: ids.length,
        checked: results.length,
        ok: results.filter((entry) => entry.status === "ok").length,
        failed: failed.length,
        replaceCount: replacements.length,
        waitingForCookies: waitingForCookies.length,
        cookiesAvailable,
        truncated: ids.length > selectedIds.length,
      },
      items: replacements.map((entry) => replacementItemFromResult(entry, trackById, result.reportJson, checkedAt)),
    });

    return {
      ok: true,
      message:
        replacements.length > 0
          ? `Ricontrollo completato: ${replacements.length} tracce da sostituire.`
          : waitingForCookies.length > 0
            ? `Ricontrollo completato: ${waitingForCookies.length} tracce richiedono ancora cookie YouTube attivi.`
            : "Ricontrollo completato: nessuna traccia da sostituire.",
      candidates: ids.length,
      checked: results.length,
      reportsRead,
      truncated: ids.length > selectedIds.length,
      reportJson: result.reportJson ? path.basename(result.reportJson) : "",
      replacementList,
    };
  }

  return {
    cleanupHardBrokenTracks,
    auditStatus,
    readList,
    recheckYouTubeLoginFailures,
    startFullYouTubeAudit,
  };
}

module.exports = {
  createAudioReplacementService,
};
