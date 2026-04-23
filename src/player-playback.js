async function playAudioTrack(track) {
  const source = playbackSourceFor(track);
  if (!source) {
    throw new Error("Nessuna sorgente audio disponibile.");
  }

  audioPreview.src = source;
  audioPreview.volume = state.playerVolume;
  activePlayback = {
    trackId: track.id,
    mode: "audio",
    duration: parseDurationSeconds(track.duration),
  };

  try {
    await audioPreview.play();
    renderTrackGrid();
    renderPlaylists();
    renderDiscoveryResults();
    renderPlayer();
  } catch {
    activePlayback = null;
    setStatus(dom.libraryStatus, "Riproduzione audio non disponibile in questo browser.", "error");
    renderTrackGrid();
    renderPlaylists();
    renderDiscoveryResults();
    renderPlayer();
  }
}

function playSynthTrack(track) {
  const context = ensureAudioContext();
  if (context.state === "suspended") {
    void context.resume();
  }

  const output = context.createGain();
  output.gain.value = 0.14 * state.playerVolume;
  output.connect(context.destination);

  const previewNotes = Array.isArray(track.preview) && track.preview.length > 0
    ? track.preview
    : [261.63, 329.63, 392, 523.25];
  const oscillators = [];
  const targetDurationSeconds = Math.min(
    60,
    Math.max(24, parseDurationSeconds(track.duration) || 32)
  );
  const noteLength = 0.36;
  const totalNotes = Math.ceil(targetDurationSeconds / noteLength);
  const motifTransposes = [0, 2, -3, 5, 0, -5, 7, 2];
  const startTime = context.currentTime + 0.05;

  for (let index = 0; index < totalNotes; index += 1) {
    const sectionIndex = Math.floor(index / previewNotes.length);
    const transpose = motifTransposes[sectionIndex % motifTransposes.length];
    const baseFrequency = Number(previewNotes[index % previewNotes.length]) || 220;
    const frequency = baseFrequency * 2 ** (transpose / 12);
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const noteStart = startTime + index * noteLength;
    const noteEnd = noteStart + noteLength * 0.92;

    oscillator.type = track.wave || "sine";
    oscillator.frequency.setValueAtTime(frequency, noteStart);

    gainNode.gain.setValueAtTime(0.0001, noteStart);
    gainNode.gain.linearRampToValueAtTime(0.22, noteStart + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

    oscillator.connect(gainNode);
    gainNode.connect(output);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
    oscillators.push(oscillator);
  }

  const timeoutId = window.setTimeout(() => {
    try {
      synthPreview?.output?.disconnect();
    } catch {
      // The sound has already ended; cleanup should not block queue advance.
    }
    synthPreview = null;
    void handlePlaybackEnded();
  }, targetDurationSeconds * 1000 + 220);

  synthPreview = { oscillators, output, timeoutId };
  activePlayback = {
    trackId: track.id,
    mode: "synth",
    startedAt: Date.now(),
    duration: targetDurationSeconds,
  };
  renderTrackGrid();
  renderPlaylists();
  renderDiscoveryResults();
  renderPlayer();
}

function playEmbeddedTrack(track, options = {}) {
  const startSeconds = Math.max(0, Number(options.startSeconds) || 0);
  const source = embedSourceFor(track, startSeconds);
  if (!source) {
    throw new Error("Nessun player incorporato disponibile.");
  }

  dom.embeddedPlayerTitle.textContent = track.title || "Video YouTube";
  dom.embeddedPlayerMeta.textContent = track.subtitle || track.creatorName || "Riproduzione interna";
  dom.embeddedPlayerFrame.src = source;
  dom.embeddedPlayer.hidden = false;

  activePlayback = {
    trackId: track.id,
    mode: "embed",
    startedAt: Date.now() - startSeconds * 1000,
    duration: parseDurationSeconds(track.duration),
  };
  scheduleEmbeddedProgress(activePlayback.duration, startSeconds);
  window.setTimeout(applyEmbeddedVolume, 700);
  renderTrackGrid();
  renderPlaylists();
  renderDiscoveryResults();
  renderPlayer();
}

async function playTrackById(trackId) {
  playbackAdvanceScheduled = false;
  const track =
    tracks.find((entry) => entry.id === trackId) ||
    sessionTracks.find((entry) => entry.id === trackId) ||
    discoveryResults.find((entry) => entry.id === trackId);
  if (!track) {
    return;
  }

  if (isExternalSessionTrack(track) && !externalRiskAccepted) {
    showExternalRiskWarning(track.id);
    return;
  }

  stopPlayback({ render: false });

  if (embedSourceFor(track)) {
    playEmbeddedTrack(track);
    return;
  }

  if (playbackSourceFor(track)) {
    await playAudioTrack(track);
    return;
  }

  playSynthTrack(track);
}

async function togglePreview(trackId) {
  if (isPlaying(trackId)) {
    pausePlayback();
    return;
  }

  if (activePlayback?.trackId === trackId && !isPlaybackAudible()) {
    await toggleGlobalPlayback();
    return;
  }

  await playTrackById(trackId);
}

async function playAdjacentTrack(direction, options = {}) {
  const queue = queueTracks();
  if (queue.length === 0) {
    return false;
  }

  const currentTrackId = options.currentTrackId || activePlayback?.trackId || "";
  let nextTrackId = "";

  if (state.shuffleEnabled && direction > 0) {
    nextTrackId = nextShuffleTrackId(currentTrackId, options.stopAtQueueEnd === true);
  } else {
    const currentIndex = queue.findIndex((track) => track.id === currentTrackId);
    if (
      options.stopAtQueueEnd === true &&
      direction > 0 &&
      currentIndex >= queue.length - 1 &&
      state.repeatMode !== "all"
    ) {
      return false;
    }

    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + direction + queue.length) % queue.length;
    nextTrackId = queue[nextIndex]?.id || "";
  }

  if (!nextTrackId) {
    return false;
  }

  await playTrackById(nextTrackId);
  return true;
}

async function handlePlaybackEnded() {
  playbackAdvanceScheduled = false;
  const endedTrackId = activePlayback?.trackId || "";
  const endedMode = activePlayback?.mode || "";

  if (endedMode === "embed") {
    if (embeddedTimerId) {
      window.clearInterval(embeddedTimerId);
      embeddedTimerId = null;
    }
    if (embeddedEndTimerId) {
      window.clearTimeout(embeddedEndTimerId);
      embeddedEndTimerId = null;
    }
    dom.embeddedPlayerFrame.src = "";
    dom.embeddedPlayer.hidden = true;
  }

  if (endedMode === "audio") {
    audioPreview.pause();
    audioPreview.currentTime = 0;
  }

  activePlayback = null;

  if (state.repeatMode === "one" && endedTrackId) {
    await playTrackById(endedTrackId);
    return;
  }

  const didContinue = await playAdjacentTrack(1, {
    currentTrackId: endedTrackId,
    stopAtQueueEnd: true,
  });

  if (!didContinue) {
    renderTrackGrid();
    renderPlaylists();
    renderDiscoveryResults();
    renderPlayer();
  }
}

async function toggleGlobalPlayback() {
  if (activePlayback?.mode === "paused") {
    const pausedPlayback = activePlayback;
    const track = currentPlaybackTrack();
    if (!track) {
      activePlayback = null;
      renderPlayer();
      return;
    }

    if (pausedPlayback.previousMode === "audio" && playbackSourceFor(track)) {
      activePlayback = { trackId: track.id, mode: "audio" };
      audioPreview.currentTime = Number(pausedPlayback.currentTime) || audioPreview.currentTime || 0;
      try {
        await audioPreview.play();
      } catch {
        setStatus(dom.libraryStatus, "Riproduzione audio non disponibile in questo browser.", "error");
      }
      renderTrackGrid();
      renderPlaylists();
      renderDiscoveryResults();
      renderPlayer();
      return;
    }

    if (pausedPlayback.previousMode === "embed" && embedSourceFor(track)) {
      const resumeAt = Math.max(0, Number(pausedPlayback.currentTime) || 0);

      if (!dom.embeddedPlayerFrame.src) {
        playEmbeddedTrack(track, { startSeconds: resumeAt });
        return;
      }

      activePlayback = {
        trackId: track.id,
        mode: "embed",
        startedAt: Date.now() - resumeAt * 1000,
        duration: Number(pausedPlayback.duration) || parseDurationSeconds(track.duration),
      };
      dom.embeddedPlayer.hidden = false;
      scheduleEmbeddedProgress(activePlayback.duration, resumeAt);
      sendEmbeddedCommand("seekTo", [resumeAt, true]);
      window.setTimeout(() => {
        sendEmbeddedCommand("playVideo");
        applyEmbeddedVolume();
      }, 80);
      renderTrackGrid();
      renderPlaylists();
      renderDiscoveryResults();
      renderPlayer();
      return;
    }

    await playTrackById(track.id);
    return;
  }

  if (activePlayback?.mode === "audio") {
    if (audioPreview.paused) {
      try {
        await audioPreview.play();
      } catch {
        setStatus(dom.libraryStatus, "Riproduzione audio non disponibile in questo browser.", "error");
      }
    } else {
      audioPreview.pause();
    }

    renderPlayer();
    return;
  }

  if (activePlayback?.mode === "synth") {
    pausePlayback();
    return;
  }

  if (activePlayback?.mode === "embed") {
    pausePlayback();
    return;
  }

  const firstTrack = queueTracks()[0];
  if (firstTrack) {
    await playTrackById(firstTrack.id);
  }
}
