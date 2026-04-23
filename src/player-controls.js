function toggleShuffle() {
  state.shuffleEnabled = !state.shuffleEnabled;
  if (state.shuffleEnabled) {
    refillShuffleQueue(activePlayback?.trackId || "");
  } else {
    shuffleQueueIds = [];
  }

  saveState();
  renderPlayer();
}

function cycleRepeatMode() {
  state.repeatMode =
    state.repeatMode === "off"
      ? "all"
      : state.repeatMode === "all"
        ? "one"
        : "off";
  saveState();
  renderPlayer();
}

function renderPlaybackModeControls() {
  dom.playerShuffleButton.textContent = playerIcons.shuffle;
  dom.playerPrevButton.textContent = playerIcons.previous;
  dom.playerNextButton.textContent = playerIcons.next;
  dom.playerShuffleButton.classList.toggle("is-active", state.shuffleEnabled);
  dom.playerShuffleButton.setAttribute("aria-pressed", String(state.shuffleEnabled));
  dom.playerShuffleButton.title = state.shuffleEnabled
    ? "Shuffle attivo"
    : "Shuffle disattivato";

  const repeatActive = state.repeatMode !== "off";
  dom.playerRepeatButton.classList.toggle("is-active", repeatActive);
  dom.playerRepeatButton.classList.toggle("is-repeat-one", state.repeatMode === "one");
  dom.playerRepeatButton.setAttribute("aria-pressed", String(repeatActive));
  dom.playerRepeatButton.textContent =
    state.repeatMode === "one" ? playerIcons.repeatOne : playerIcons.repeat;
  dom.playerRepeatButton.title =
    state.repeatMode === "one"
      ? "Ripeti la traccia corrente"
      : state.repeatMode === "all"
        ? "Ripeti tutta la coda"
        : "Repeat disattivato";
}

function renderVolumeControl() {
  const volumePercent = Math.round(state.playerVolume * 100);
  dom.playerVolumeRange.value = String(volumePercent);
  dom.playerVolumeRange.style.setProperty("--volume-level", `${volumePercent}%`);
  dom.playerVolumeIcon.textContent = volumePercent === 0 ? "Mute" : "Vol";
  dom.playerVolumeValue.textContent = `${volumePercent}%`;
}

function updatePlayerVolume(value) {
  const numericValue = Number(value);
  state.playerVolume = Number.isFinite(numericValue)
    ? Math.max(0, Math.min(1, numericValue / 100))
    : defaultState.playerVolume;
  audioPreview.volume = state.playerVolume;

  if (synthPreview?.output) {
    synthPreview.output.gain.value = 0.14 * state.playerVolume;
  }

  if (activePlayback?.mode === "embed") {
    applyEmbeddedVolume();
  }

  saveState();
  renderPlayer();
}

function seekPlayer(value) {
  const track = currentPlaybackTrack();
  const trackDuration = parseDurationSeconds(track?.duration);
  const duration =
    activePlayback?.mode === "audio" && Number.isFinite(audioPreview.duration) && audioPreview.duration > 0
      ? audioPreview.duration
      : Number(activePlayback?.duration) || trackDuration;
  const numericValue = Number(value);

  if (!track || !Number.isFinite(numericValue) || duration <= 0) {
    return;
  }

  const targetSeconds = Math.max(0, Math.min(duration, numericValue));

  if (activePlayback?.mode === "audio") {
    audioPreview.currentTime = targetSeconds;
  } else if (activePlayback?.mode === "embed") {
    activePlayback.startedAt = Date.now() - targetSeconds * 1000;
    sendEmbeddedCommand("seekTo", [targetSeconds, true]);
  } else if (activePlayback?.mode === "paused") {
    activePlayback.currentTime = targetSeconds;
    if (activePlayback.previousMode === "audio") {
      audioPreview.currentTime = targetSeconds;
    }
  }

  renderPlayer();
}
