function renderPlayer() {
  const track = currentPlaybackTrack();
  const isActive = Boolean(track);
  const hasQueue = queueTracks().length > 0;
  const isAudioMode = activePlayback?.mode === "audio";
  const isSynthMode = activePlayback?.mode === "synth";
  const isEmbedMode = activePlayback?.mode === "embed";
  const isPausedMode = activePlayback?.mode === "paused";
  const isAudioPlaying = isAudioMode && !audioPreview.paused;
  const isAudible = isPlaybackAudible();

  dom.playerDock.classList.toggle("is-playing", isAudible);
  dom.playerDock.classList.toggle("is-paused", isActive && !isAudible);
  renderPlaybackModeControls();
  renderVolumeControl();
  dom.playerPrevButton.disabled = !hasQueue;
  dom.playerNextButton.disabled = !hasQueue;
  dom.playerToggleButton.disabled = !hasQueue && !isActive;

  if (!track) {
    dom.playerArt.innerHTML = "";
    dom.playerArt.textContent = "CW";
    dom.playerArt.style.setProperty("background", "linear-gradient(145deg, #ff5fb7, #7c5cff)", "important");
    dom.playerArt.style.setProperty("background-image", "none", "important");
    dom.playerTitle.textContent = "Nessuna traccia in ascolto";
    dom.playerMeta.textContent = "Apri una preview o un file dal catalogo.";
    dom.playerState.textContent = "Idle";
    dom.playerRailState.textContent = "Idle";
    setPlayerToggleIcon(false);
    dom.playerToggleButton.title = "Riproduci";
    dom.playerProgress.style.width = "0%";
    dom.playerSeekRange.value = "0";
    dom.playerSeekRange.max = "100";
    dom.playerSeekRange.disabled = true;
    dom.playerTime.textContent = "0:00 / 0:00";
    return;
  }

  const initials = track.title
    .split(" ")
    .map((entry) => entry[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (track.coverPath) {
    dom.playerArt.textContent = "";
    dom.playerArt.innerHTML = `<img src="${escapeHtml(track.coverPath)}" alt="${escapeHtml(track.coverAlt || `${track.title} cover`)}" loading="lazy" onerror="this.remove()" />`;
    dom.playerArt.style.setProperty("background", "#181818", "important");
    dom.playerArt.style.setProperty("background-image", "none", "important");
  } else {
    dom.playerArt.innerHTML = "";
    dom.playerArt.textContent = initials || "CW";
    dom.playerArt.style.setProperty(
      "background",
      `linear-gradient(145deg, ${track.accent || "#7c5cff"}, #ff5fb7)`,
      "important"
    );
    dom.playerArt.style.setProperty("background-image", "none", "important");
  }
  dom.playerTitle.textContent = track.title;
  dom.playerMeta.textContent = `${getTrackGenre(track)} | ${track.subtitle || track.license || "Track"} | ${
    isEmbedMode || activePlayback?.previousMode === "embed"
      ? "stream interno"
      : track.audioPath
        ? "file live"
        : isAudioMode || activePlayback?.previousMode === "audio"
          ? "preview locale"
          : "preview synth"
  }`;

  const stateLabel = isPausedMode
    ? "In pausa"
    : isSynthMode
    ? "Synth preview"
    : isEmbedMode
      ? "Playing stream"
    : isAudioPlaying
      ? track.audioPath ? "Playing live file" : "Playing local preview"
      : "In pausa";
  const trackDuration = parseDurationSeconds(track.duration);
  const storedDuration = Number(activePlayback?.duration) || 0;
  const duration =
    isAudioMode && Number.isFinite(audioPreview.duration) && audioPreview.duration > 0
      ? audioPreview.duration
      : isAudioMode
        ? storedDuration || trackDuration
      : isEmbedMode
        ? storedDuration || trackDuration
        : isSynthMode
          ? storedDuration || trackDuration
        : isPausedMode
          ? storedDuration || trackDuration
        : trackDuration;
  const timedElapsed = (isEmbedMode || isSynthMode) && activePlayback?.startedAt
    ? Math.max(0, (Date.now() - activePlayback.startedAt) / 1000)
    : 0;
  const currentTime =
    isAudioMode && Number.isFinite(audioPreview.currentTime)
      ? audioPreview.currentTime
      : isEmbedMode || isSynthMode
        ? Math.min(duration || timedElapsed, timedElapsed)
        : isPausedMode
          ? Math.min(duration || Number(activePlayback.currentTime) || 0, Number(activePlayback.currentTime) || 0)
        : 0;
  const progressPercent = duration > 0
    ? Math.min(100, (currentTime / duration) * 100)
    : isSynthMode || isEmbedMode ? 35 : 0;

  if (
    isAudible &&
    (isEmbedMode || isSynthMode) &&
    duration > 0 &&
    currentTime >= duration - 0.75
  ) {
    if (!playbackAdvanceScheduled) {
      playbackAdvanceScheduled = true;
      window.setTimeout(() => {
        void handlePlaybackEnded();
      }, 80);
    }
  } else if (duration > 0 && currentTime < duration - 1.5) {
    playbackAdvanceScheduled = false;
  }

  dom.playerState.textContent = stateLabel;
  dom.playerRailState.textContent = [
    stateLabel,
    state.shuffleEnabled ? "Shuffle" : "",
    state.repeatMode === "one" ? "Repeat 1" : state.repeatMode === "all" ? "Repeat" : "",
  ].filter(Boolean).join(" | ");
  setPlayerToggleIcon(isAudible);
  dom.playerToggleButton.title = isAudible ? "Pausa" : "Riproduci";
  dom.playerProgress.style.width = `${progressPercent}%`;
  dom.playerSeekRange.disabled =
    duration <= 0 || isSynthMode || (isPausedMode && activePlayback.previousMode === "synth");
  dom.playerSeekRange.max = String(Math.max(1, Math.floor(duration || 100)));
  dom.playerSeekRange.value = String(Math.floor(currentTime));
  dom.playerSeekRange.style.setProperty("--seek-level", `${progressPercent}%`);
  dom.playerTime.textContent = `${formatTime(currentTime)} / ${duration > 0 ? formatTime(duration) : "stream"}`;
  dom.playerTime.title = "Tempo corrente / durata totale";
}

function setPlayerToggleIcon(isPlaying) {
  dom.playerToggleButton.dataset.playing = isPlaying ? "true" : "false";
  dom.playerToggleButton.innerHTML = isPlaying
    ? '<span class="player-pause-icon" aria-hidden="true"></span>'
    : '<span class="player-play-icon" aria-hidden="true"></span>';
}

function renderAll() {
  renderAccountPanel();
  renderSessionPanel();
  renderTrackGrid();
  renderPlaylists();
  renderQueue();
  renderSelection();
  renderMetrics();
  renderReport();
  renderArchive();
  renderDiscoveryResults();
  renderPlayer();
}

