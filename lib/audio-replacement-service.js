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
  return /youtube-age-or-login|sign in to confirm your age|inappropriate for some users|use --cookies/.test(text);
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

function createAudioReplacementService({
  rootDir,
  dataDir,
  reportsDir,
  replacementFile,
  readLibrary,
  getYtdlCookiesFile,
  getLastPlayerFailure,
  nodePath = process.execPath,
  env = process.env,
}) {
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

  async function writeList(payload) {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(replacementFile, JSON.stringify(payload, null, 2), "utf8");
    return payload;
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
    readList,
    recheckYouTubeLoginFailures,
  };
}

module.exports = {
  createAudioReplacementService,
};
