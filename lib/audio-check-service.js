const path = require("node:path");
const { spawn } = require("node:child_process");

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeAudioCheckMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return ["source", "metadata", "probe"].includes(mode) ? mode : "probe";
}

function createAudioCheckConfig(env, dataDir) {
  return {
    enabled: env.CLEARWAVE_AUDIO_CHECK_ENABLED === "1",
    onStart: env.CLEARWAVE_AUDIO_CHECK_ON_START !== "0",
    mode: sanitizeAudioCheckMode(env.CLEARWAVE_AUDIO_CHECK_MODE || "probe"),
    provider: String(env.CLEARWAVE_AUDIO_CHECK_PROVIDER || "all").trim() || "all",
    concurrency: boundedNumber(env.CLEARWAVE_AUDIO_CHECK_CONCURRENCY, 2, 1, 8),
    timeoutMs: boundedNumber(env.CLEARWAVE_AUDIO_CHECK_TIMEOUT_MS, 30000, 3000, 180000),
    sampleSeconds: boundedNumber(env.CLEARWAVE_AUDIO_CHECK_SAMPLE_SECONDS, 6, 1, 60),
    limit: boundedNumber(env.CLEARWAVE_AUDIO_CHECK_LIMIT, 0, 0, 100000),
    intervalHours: boundedNumber(env.CLEARWAVE_AUDIO_CHECK_INTERVAL_HOURS, 24, 0, 24 * 30),
    startDelaySeconds: boundedNumber(env.CLEARWAVE_AUDIO_CHECK_START_DELAY_SECONDS, 45, 0, 3600),
    onlyErrors: env.CLEARWAVE_AUDIO_CHECK_ONLY_ERRORS !== "0",
    reportDir: env.CLEARWAVE_AUDIO_CHECK_REPORT_DIR || path.join(dataDir, "reports"),
    ytdlCookiesFile: String(env.CLEARWAVE_YTDL_COOKIES_FILE || "").trim(),
  };
}

function createInitialState(config) {
  return {
    enabled: config.enabled,
    running: false,
    lastStartedAt: "",
    lastFinishedAt: "",
    lastExitCode: null,
    lastSignal: "",
    lastError: "",
    lastSummary: null,
    lastReportJson: "",
    lastReportCsv: "",
    logTail: [],
  };
}

function createAutomaticAudioCheckService({
  rootDir,
  dataDir,
  uploadsDir,
  env = process.env,
  logger = console,
  nodePath = process.execPath,
}) {
  const config = createAudioCheckConfig(env, dataDir);
  const state = createInitialState(config);
  let scheduled = false;

  // Mantiene in un solo punto gli argomenti passati al tool di verifica catalogo.
  function args() {
    const commandArgs = [
      path.join(rootDir, "tools", "check-library-audio.js"),
      "--mode",
      config.mode,
      "--provider",
      config.provider,
      "--concurrency",
      String(config.concurrency),
      "--timeout-ms",
      String(config.timeoutMs),
      "--sample-seconds",
      String(config.sampleSeconds),
      "--report-dir",
      config.reportDir,
    ];

    if (config.limit > 0) {
      commandArgs.push("--limit", String(config.limit));
    }
    if (config.onlyErrors) {
      commandArgs.push("--only-errors");
    }
    if (config.ytdlCookiesFile) {
      commandArgs.push("--ytdl-cookies", config.ytdlCookiesFile);
    }

    return commandArgs;
  }

  // Il tool stampa riepiloghi testuali: qui li traduciamo nello stato usato dalla diagnostica UI.
  function appendOutput(chunk) {
    const lines = String(chunk || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      state.logTail.push(line);
      if (state.logTail.length > 30) {
        state.logTail.shift();
      }

      const okMatch = line.match(/^\[check\]\s+OK:\s+(\d+)/i);
      if (okMatch) {
        state.lastSummary = {
          ...(state.lastSummary || {}),
          ok: Number(okMatch[1]),
        };
        continue;
      }

      const failedMatch = line.match(/^\[check\]\s+KO:\s+(\d+)/i);
      if (failedMatch) {
        state.lastSummary = {
          ...(state.lastSummary || {}),
          failed: Number(failedMatch[1]),
        };
        continue;
      }

      const reasonsMatch = line.match(/^\[check\]\s+Motivi:\s+(.+)$/i);
      if (reasonsMatch) {
        try {
          state.lastSummary = {
            ...(state.lastSummary || {}),
            byReason: JSON.parse(reasonsMatch[1]),
          };
        } catch {
          state.lastSummary = {
            ...(state.lastSummary || {}),
            reasonsText: reasonsMatch[1],
          };
        }
        continue;
      }

      const jsonReportMatch = line.match(/^\[check\]\s+Report JSON:\s+(.+)$/i);
      if (jsonReportMatch) {
        state.lastReportJson = jsonReportMatch[1];
        continue;
      }

      const csvReportMatch = line.match(/^\[check\]\s+Report CSV:\s+(.+)$/i);
      if (csvReportMatch) {
        state.lastReportCsv = csvReportMatch[1];
      }
    }
  }

  function status() {
    return {
      ...state,
      config: {
        mode: config.mode,
        provider: config.provider,
        concurrency: config.concurrency,
        timeoutMs: config.timeoutMs,
        sampleSeconds: config.sampleSeconds,
        limit: config.limit,
        intervalHours: config.intervalHours,
        startDelaySeconds: config.startDelaySeconds,
        onlyErrors: config.onlyErrors,
        reportDir: config.reportDir,
        ytdlCookiesConfigured: Boolean(config.ytdlCookiesFile),
      },
    };
  }

  function run(reason = "scheduled") {
    if (!config.enabled) {
      return;
    }

    if (state.running) {
      logger.log(`[audio-check] Controllo gia' in corso, salto run ${reason}.`);
      return;
    }

    state.running = true;
    state.lastStartedAt = new Date().toISOString();
    state.lastFinishedAt = "";
    state.lastExitCode = null;
    state.lastSignal = "";
    state.lastError = "";
    state.lastSummary = null;
    state.lastReportJson = "";
    state.lastReportCsv = "";
    state.logTail = [];

    const commandArgs = args();
    logger.log(
      `[audio-check] Avvio controllo catalogo automatico (${reason}): node ${commandArgs
        .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
        .join(" ")}`
    );

    let processRef;
    try {
      processRef = spawn(nodePath, commandArgs, {
        env: {
          ...env,
          CLEARWAVE_DATA_DIR: dataDir,
          CLEARWAVE_UPLOADS_DIR: uploadsDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
      state.lastError = error.message || String(error);
      logger.error(`[audio-check] Avvio non riuscito: ${state.lastError}`);
      return;
    }

    processRef.stdout.on("data", appendOutput);
    processRef.stderr.on("data", appendOutput);
    processRef.once("error", (error) => {
      state.lastError = error.message || String(error);
    });
    processRef.once("close", (code, signal) => {
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
      state.lastExitCode = code;
      state.lastSignal = signal || "";
      if (code !== 0 && !state.lastError) {
        state.lastError = `Check terminato con codice ${code ?? signal ?? "n/d"}.`;
      }

      const summary = state.lastSummary || {};
      logger.log(
        `[audio-check] Fine controllo catalogo: codice=${code ?? signal ?? "n/d"}, ok=${
          summary.ok ?? "n/d"
        }, ko=${summary.failed ?? "n/d"}, report=${state.lastReportJson || "n/d"}`
      );
    });
  }

  // La schedulazione resta opzionale e idempotente: il server puo' chiamarla senza duplicare timer.
  function schedule() {
    if (!config.enabled || scheduled) {
      return;
    }

    scheduled = true;
    logger.log(
      `[audio-check] Automatico attivo: mode=${config.mode}, provider=${config.provider}, startDelay=${config.startDelaySeconds}s, interval=${config.intervalHours}h.`
    );

    if (config.onStart) {
      const startTimer = setTimeout(() => run("startup"), config.startDelaySeconds * 1000);
      startTimer.unref?.();
    }

    if (config.intervalHours > 0) {
      const intervalTimer = setInterval(() => run("interval"), config.intervalHours * 60 * 60 * 1000);
      intervalTimer.unref?.();
    }
  }

  return {
    run,
    schedule,
    status,
  };
}

module.exports = {
  createAutomaticAudioCheckService,
};
