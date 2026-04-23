function playbackSourceFor(track) {
  if (track.audioPath) {
    return track.audioPath;
  }

  const isLocalTrack = allTracks().some((entry) => entry.id === track.id);
  return isLocalTrack ? track.playbackPath || track.previewPath : "";
}

function embedSourceFor(track, startSeconds = 0) {
  const source = track.embedPath
    ? track.embedPath
    : track.youtubeVideoId
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(track.youtubeVideoId)}?autoplay=1&rel=0`
      : "";

  if (!source) {
    return "";
  }

  try {
    const url = new URL(source, window.location.origin);
    const safeStartSeconds = Math.floor(Math.max(0, Number(startSeconds) || 0));
    if (url.hostname.includes("youtube")) {
      url.searchParams.set("enablejsapi", "1");
      url.searchParams.set("origin", window.location.origin);
      url.searchParams.set("playsinline", "1");
      if (safeStartSeconds > 0) {
        url.searchParams.set("start", String(safeStartSeconds));
      }
    }

    return url.toString();
  } catch {
    return source;
  }
}

function currentPlaybackTrack() {
  const trackId = activePlayback?.trackId || "";
  return (
    tracks.find((track) => track.id === trackId) ||
    sessionTracks.find((track) => track.id === trackId) ||
    discoveryResults.find((track) => track.id === trackId) ||
    null
  );
}

function isPlaybackAudible() {
  if (!activePlayback || activePlayback.mode === "paused") {
    return false;
  }

  if (activePlayback.mode === "audio") {
    return !audioPreview.paused;
  }

  return true;
}

function isPlaying(trackId) {
  return activePlayback?.trackId === trackId && isPlaybackAudible();
}

function stopAudioPlayback(shouldRender = true, options = {}) {
  audioPreview.pause();
  if (options.resetTime !== false) {
    audioPreview.currentTime = 0;
  }

  if (activePlayback?.mode === "audio") {
    activePlayback = null;
    if (shouldRender) {
      renderTrackGrid();
      renderPlaylists();
      renderDiscoveryResults();
      renderPlayer();
    }
  }
}

function playbackPauseSnapshot() {
  const playback = activePlayback;
  const track = currentPlaybackTrack();
  if (!playback?.trackId || !track) {
    return null;
  }

  const duration =
    playback.mode === "audio" && Number.isFinite(audioPreview.duration) && audioPreview.duration > 0
      ? audioPreview.duration
      : Number(playback.duration) || parseDurationSeconds(track.duration);
  const currentTime =
    playback.mode === "audio" && Number.isFinite(audioPreview.currentTime)
      ? audioPreview.currentTime
      : playback.mode === "embed" && playback.startedAt
        ? Math.max(0, (Date.now() - playback.startedAt) / 1000)
        : Number(playback.currentTime) || 0;

  return {
    trackId: playback.trackId,
    mode: "paused",
    previousMode: playback.mode,
    currentTime: duration > 0 ? Math.min(duration, currentTime) : currentTime,
    duration,
  };
}

function stopSynthPlayback(shouldRender = true) {
  if (!synthPreview) {
    return;
  }

  synthPreview.oscillators.forEach((oscillator) => {
    try {
      oscillator.stop();
    } catch {
      return;
    }
  });

  try {
    synthPreview.output.disconnect();
  } catch {
    return;
  }

  window.clearTimeout(synthPreview.timeoutId);
  synthPreview = null;

  if (activePlayback?.mode === "synth") {
    activePlayback = null;
    if (shouldRender) {
      renderTrackGrid();
      renderPlaylists();
      renderDiscoveryResults();
      renderPlayer();
    }
  }
}

function clearEmbeddedTimers() {
  if (embeddedTimerId) {
    window.clearInterval(embeddedTimerId);
    embeddedTimerId = null;
  }
  if (embeddedEndTimerId) {
    window.clearTimeout(embeddedEndTimerId);
    embeddedEndTimerId = null;
  }
}

function scheduleEmbeddedProgress(duration, elapsedSeconds = 0) {
  clearEmbeddedTimers();
  embeddedTimerId = window.setInterval(() => {
    if (activePlayback?.mode === "embed" && duration > 0 && activePlayback.startedAt) {
      const elapsed = Math.max(0, (Date.now() - activePlayback.startedAt) / 1000);
      if (elapsed >= duration - 0.25) {
        void handlePlaybackEnded();
        return;
      }
    }

    renderPlayer();
  }, 500);

  if (duration > 0) {
    const remainingSeconds = Math.max(0.5, duration - Math.max(0, elapsedSeconds));
    embeddedEndTimerId = window.setTimeout(() => {
      void handlePlaybackEnded();
    }, remainingSeconds * 1000 + 500);
  }
}

function stopEmbeddedPlayback(shouldRender = true) {
  const wasEmbedded = activePlayback?.mode === "embed";
  clearEmbeddedTimers();
  dom.embeddedPlayerFrame.src = "";
  dom.embeddedPlayer.hidden = true;

  if (wasEmbedded) {
    activePlayback = null;
    if (shouldRender) {
      renderTrackGrid();
      renderPlaylists();
      renderDiscoveryResults();
      renderPlayer();
    }
  }
}

function sendEmbeddedCommand(func, args = []) {
  if (!dom.embeddedPlayerFrame.src || !dom.embeddedPlayerFrame.contentWindow) {
    return;
  }

  dom.embeddedPlayerFrame.contentWindow.postMessage(
    JSON.stringify({
      event: "command",
      func,
      args,
    }),
    "*"
  );
}

function applyEmbeddedVolume() {
  const volume = Math.round(state.playerVolume * 100);
  sendEmbeddedCommand("setVolume", [volume]);
  sendEmbeddedCommand(volume === 0 ? "mute" : "unMute");
}

function showExternalRiskWarning(trackId) {
  pendingExternalTrackId = trackId;
  dom.externalRiskMessage.textContent = externalRiskWarningText;
  dom.externalRiskModal.hidden = false;
  dom.externalRiskConfirmButton.focus();
}

function hideExternalRiskWarning() {
  pendingExternalTrackId = "";
  dom.externalRiskModal.hidden = true;
}

function stopPlayback(options = {}) {
  const shouldRender = options.render !== false;
  const pausedSnapshot = options.preserveTrack ? playbackPauseSnapshot() : null;
  const shouldPreserveEmbedded = options.preserveTrack && activePlayback?.mode === "embed";
  stopAudioPlayback(false, {
    resetTime: options.preserveTrack ? false : true,
  });
  stopSynthPlayback(false);
  if (shouldPreserveEmbedded) {
    sendEmbeddedCommand("pauseVideo");
    clearEmbeddedTimers();
    dom.embeddedPlayer.hidden = true;
  } else {
    stopEmbeddedPlayback(false);
  }
  activePlayback = pausedSnapshot;

  if (shouldRender) {
    renderTrackGrid();
    renderPlaylists();
    renderDiscoveryResults();
    renderPlayer();
  }
}

function pausePlayback(options = {}) {
  stopPlayback({
    ...options,
    preserveTrack: true,
  });
}

function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
  }

  return audioContext;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function parseDurationSeconds(value) {
  const parts = String(value || "")
    .split(":")
    .map((part) => Number(part));

  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
