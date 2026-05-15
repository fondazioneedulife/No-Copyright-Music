const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function youtubeVideoIdFromUrl(value) {
  const raw = firstString(value);
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") {
      return firstString(parsed.pathname.split("/").filter(Boolean)[0]);
    }
    if (host.endsWith("youtube.com")) {
      return firstString(
        parsed.searchParams.get("v"),
        parsed.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/i)?.[1]
      );
    }
  } catch {
    // I vecchi import possono contenere frammenti non URL; sotto proviamo un match testuale.
  }

  return firstString(
    raw.match(/[?&]v=([^&#]+)/i)?.[1],
    raw.match(/youtu\.be\/([^/?#]+)/i)?.[1],
    raw.match(/youtube\.com\/(?:embed|shorts|live)\/([^/?#]+)/i)?.[1]
  );
}

function createYouTubeAudioCacheService(options = {}) {
  const downloads = new Map();
  const audioFormat = firstString(options.audioFormat, "mp3").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp3";
  const cacheDir = options.cacheDir || path.join(options.audioDir || "uploads/audio", "youtube-cache");
  const requestPrefix = firstString(options.requestPrefix, "/uploads/audio/youtube-cache");
  const timeoutMs = Math.max(60000, Math.min(1800000, Number(options.timeoutMs || 600000) || 600000));
  const friendlyError = options.friendlyError || ((message) => firstString(message, "Errore YouTube."));

  function videoIdForTrack(track) {
    return firstString(track?.youtubeVideoId, youtubeVideoIdFromUrl(track?.sourceUrl), youtubeVideoIdFromUrl(track?.embedPath));
  }

  function cachePathsForTrack(track) {
    const videoId = videoIdForTrack(track).replace(/[^a-z0-9_-]/gi, "");
    if (!videoId) {
      return null;
    }

    const fileName = `youtube-${videoId}.${audioFormat}`;
    return {
      videoId,
      requestPath: `${requestPrefix}/${fileName}`,
      localPath: path.join(cacheDir, fileName),
    };
  }

  function isEligibleTrack(track) {
    // Cache solo per catalogo whitelist: le playlist temporanee restano prova utente e non vengono archiviate.
    const normalized = options.normalizeTrack ? options.normalizeTrack(track || {}) : track || {};
    return Boolean(
      options.enabled &&
        options.onPlay &&
        firstString(normalized.externalProvider) === "youtube_curated" &&
        videoIdForTrack(normalized)
    );
  }

  function appendYtDlpPlaybackArgs(args, overrides = {}) {
    if (options.ytdlJsRuntime) {
      args.push("--js-runtimes", options.ytdlJsRuntime);
    }

    const extractorArgs = firstString(overrides.extractorArgs, options.ytdlExtractorArgs);
    if (extractorArgs) {
      args.push("--extractor-args", extractorArgs);
    }

    const cookiesFile = options.getCookiesFile ? options.getCookiesFile() : "";
    if (cookiesFile) {
      args.push("--cookies", cookiesFile);
    }

    return args;
  }

  async function ensureStorage() {
    await fs.mkdir(cacheDir, { recursive: true });
  }

  async function cleanupTempFiles(tempStem) {
    try {
      const names = await fs.readdir(cacheDir);
      await Promise.all(
        names
          .filter((name) => name.startsWith(tempStem))
          .map((name) => fs.unlink(path.join(cacheDir, name)).catch(() => {}))
      );
    } catch {
      // La pulizia e' best effort: non deve bloccare la riproduzione.
    }
  }

  async function persistCachePath(track, cacheRequestPath) {
    const trackId = firstString(track?.id);
    const videoId = videoIdForTrack(track);
    if (!trackId && !videoId) {
      return;
    }

    const library = await options.readLibrary();
    let changed = false;
    const updatedAt = new Date().toISOString();
    const updatedLibrary = library.map((item) => {
      const sameTrack = (trackId && firstString(item.id) === trackId) || (videoId && videoIdForTrack(item) === videoId);
      if (!sameTrack || firstString(item.audioPath) === cacheRequestPath) {
        return item;
      }

      changed = true;
      return {
        ...item,
        audioPath: cacheRequestPath,
        audioOriginalName: path.basename(cacheRequestPath),
        cacheProvider: "youtube",
        cacheStatus: "ready",
        cachedAt: updatedAt,
        updatedAt,
      };
    });

    if (changed) {
      await options.writeLibrary(updatedLibrary);
    }
  }

  async function downloadAudio(track, cachePaths) {
    const youtubeUrl = options.canonicalYouTubePlaybackUrl(track);
    if (!youtubeUrl) {
      throw httpError(400, "Traccia YouTube senza URL originale valido per la cache.");
    }

    await ensureStorage();
    const tempStem = `.tmp-${cachePaths.videoId}-${process.pid}-${Date.now()}`;
    const tempOutput = path.join(cacheDir, `${tempStem}.%(ext)s`);
    const args = [
      "--no-playlist",
      "--no-continue",
      "--force-overwrites",
      "--socket-timeout",
      "30",
      "-f",
      firstString(options.ytdlFormat, "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best"),
      "-x",
      "--audio-format",
      audioFormat,
      "--audio-quality",
      "5",
      "-o",
      tempOutput,
    ];
    appendYtDlpPlaybackArgs(args);
    args.push(youtubeUrl);

    options.recordEvent?.("cache", `Cache YouTube in corso: ${firstString(track.title, cachePaths.videoId)}`, {
      trackId: firstString(track.id),
      videoId: cachePaths.videoId,
    });

    const result = await options.runCommand(options.ytDlpCommand(), args, timeoutMs);
    if (!result.ok) {
      await cleanupTempFiles(tempStem);
      const message = friendlyError(
        firstString(result.stderr, result.stdout, result.error, `yt-dlp terminato con codice ${result.code ?? "n/d"}`)
      );
      throw httpError(502, `Cache YouTube non riuscita: ${message}`);
    }

    const expectedTempPath = path.join(cacheDir, `${tempStem}.${audioFormat}`);
    let producedPath = expectedTempPath;
    if (!fsSync.existsSync(producedPath)) {
      const names = await fs.readdir(cacheDir);
      const producedName = names.find((name) => name.startsWith(`${tempStem}.`));
      if (producedName) {
        producedPath = path.join(cacheDir, producedName);
      }
    }

    if (!fsSync.existsSync(producedPath)) {
      await cleanupTempFiles(tempStem);
      throw httpError(502, "Cache YouTube non riuscita: yt-dlp non ha prodotto un file audio.");
    }

    await fs.rm(cachePaths.localPath, { force: true });
    await fs.rename(producedPath, cachePaths.localPath);
    await cleanupTempFiles(tempStem);
    await persistCachePath(track, cachePaths.requestPath);
    options.recordEvent?.("cache", `Cache YouTube pronta: ${firstString(track.title, cachePaths.videoId)}`, {
      trackId: firstString(track.id),
      videoId: cachePaths.videoId,
      path: cachePaths.requestPath,
    });

    return cachePaths;
  }

  async function ensureCachedForTrack(track) {
    if (!isEligibleTrack(track)) {
      return null;
    }

    const cachePaths = cachePathsForTrack(track);
    if (!cachePaths) {
      return null;
    }

    if (fsSync.existsSync(cachePaths.localPath)) {
      await persistCachePath(track, cachePaths.requestPath);
      return cachePaths;
    }

    const existingDownload = downloads.get(cachePaths.videoId);
    if (existingDownload) {
      return existingDownload;
    }

    const downloadPromise = downloadAudio(track, cachePaths)
      .catch((error) => {
        options.recordEvent?.("warn", friendlyError(error.message || error), {
          trackId: firstString(track.id),
          videoId: cachePaths.videoId,
        });
        throw error;
      })
      .finally(() => {
        downloads.delete(cachePaths.videoId);
      });
    downloads.set(cachePaths.videoId, downloadPromise);
    return downloadPromise;
  }

  function status() {
    return {
      enabled: Boolean(options.enabled),
      onPlay: Boolean(options.onPlay),
      dir: cacheDir,
      audioFormat,
      timeoutMs,
      pendingDownloads: downloads.size,
    };
  }

  return {
    cachePathsForTrack,
    ensureCachedForTrack,
    ensureStorage,
    status,
    videoIdForTrack,
  };
}

module.exports = {
  createYouTubeAudioCacheService,
  youtubeVideoIdFromUrl,
};
