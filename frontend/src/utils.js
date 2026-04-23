export const pageSize = 20;

export function cx(...classes) {
  // Piccolo helper per comporre classi CSS senza importare librerie esterne.
  return classes.filter(Boolean).join(" ");
}

export function getGenre(track) {
  // Fallback utile per tracce importate con metadata incompleti.
  return track.genre || track.instrument || "Altro";
}

export function getSource(track) {
  // Normalizza i provider reali in filtri semplici per la UI: Jamendo, YouTube o Altro.
  if (track.externalProvider === "jamendo") {
    return "jamendo";
  }

  if (
    track.externalProvider === "youtube_curated" ||
    track.externalProvider === "youtube_session" ||
    track.youtubeVideoId
  ) {
    return "youtube";
  }

  return "other";
}

export function sourceLabel(source) {
  if (source === "jamendo") {
    return "Jamendo";
  }

  if (source === "youtube") {
    return "YouTube";
  }

  return "Altro";
}

export function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export function trackMatchesSearch(track, query) {
  if (!query) {
    return true;
  }

  return [
    track.title,
    track.subtitle,
    track.creatorName,
    track.license,
    track.tags?.join(" "),
    getGenre(track),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function playableSourceFor(track) {
  // Ordine di preferenza: audio reale, playback del provider, preview backend.
  return (
    track.audioPath ||
    track.playbackPath ||
    track.previewPath ||
    `/api/tracks/${encodeURIComponent(track.id)}/preview.wav`
  );
}

export function isYouTubeTrack(track) {
  return getSource(track) === "youtube" && Boolean(track.embedPath || track.youtubeVideoId);
}

export function youtubeEmbedSourceFor(track, startSeconds = 0) {
  const source = track.embedPath
    ? track.embedPath
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(track.youtubeVideoId)}?autoplay=1&rel=0`;
  const safeStart = Math.floor(Math.max(0, Number(startSeconds) || 0));

  try {
    const url = new URL(source, window.location.origin);
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("origin", window.location.origin);
    url.searchParams.set("playsinline", "1");
    if (safeStart > 0) {
      url.searchParams.set("start", String(safeStart));
    } else {
      url.searchParams.delete("start");
    }
    return url.toString();
  } catch {
    return source;
  }
}

export function durationSecondsFor(track) {
  if (Number.isFinite(track?.durationSeconds)) {
    return Math.max(0, Number(track.durationSeconds));
  }

  const raw = String(track?.duration || "");
  const parts = raw.split(":").map((entry) => Number(entry));
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return 0;
}

export function formatClockTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function readableDuration(track) {
  return track.duration || "stream";
}
