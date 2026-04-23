function filterTracks() {
  const searchTerm = state.search.trim().toLowerCase();
  const sourceTracks = state.activePlaylistId === "session-user" ? sessionTracks : tracks;

  return sourceTracks.filter((track) => {
    if (!isPlayableCatalogSong(track)) {
      return false;
    }

    const haystack = [
      track.title,
      track.subtitle,
      track.genre,
      track.instrument,
      track.description,
      track.license,
      track.licenseDetail,
      track.rightsNotes,
      ...(track.tags || []),
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !searchTerm || haystack.includes(searchTerm);
    const matchesGenre = state.genre === "all" || getTrackGenre(track) === state.genre;
    const matchesSource =
      state.source === "all" ||
      (state.source === "youtube" && ["youtube_curated", "youtube_session"].includes(track.externalProvider)) ||
      (state.source === "jamendo" && track.externalProvider === "jamendo") ||
      (state.source === "session" && track.externalProvider === "youtube_session");

    return matchesSearch && matchesGenre && matchesSource;
  });
}

function selectedTracks() {
  const selectedMap = new Set(state.selectedIds);
  return allTracks().filter((track) => selectedMap.has(track.id) && isPlayableCatalogSong(track));
}

function isPrimaryMusicSource(track) {
  return (
    track.externalProvider === "jamendo" ||
    track.externalProvider === "youtube_curated" ||
    track.externalProvider === "youtube_session"
  );
}

function isPlayableCatalogSong(track) {
  const hasJamendoAudio = track.externalProvider === "jamendo" && Boolean(track.audioPath);
  const hasYouTubeEmbed =
    track.externalProvider === "youtube_curated" && Boolean(track.embedPath || track.youtubeVideoId);
  const hasSessionEmbed =
    track.externalProvider === "youtube_session" && Boolean(track.embedPath || track.youtubeVideoId);
  return isPrimaryMusicSource(track) && (hasJamendoAudio || hasYouTubeEmbed || hasSessionEmbed);
}

function isRealSong(track) {
  return isPlayableCatalogSong(track);
}

function isFavorite(trackId) {
  return state.favoriteIds.includes(trackId);
}

function toggleFavorite(trackId) {
  if (isFavorite(trackId)) {
    state.favoriteIds = state.favoriteIds.filter((id) => id !== trackId);
  } else {
    state.favoriteIds = [...state.favoriteIds, trackId];
  }

  saveState();
  renderAll();
}

function queuedTracks() {
  const byId = new Map(allTracks().filter(isPlayableCatalogSong).map((track) => [track.id, track]));
  return state.queueIds.map((trackId) => byId.get(trackId)).filter(Boolean);
}

function isQueued(trackId) {
  return state.queueIds.includes(trackId);
}

function toggleQueue(trackId) {
  if (isQueued(trackId)) {
    state.queueIds = state.queueIds.filter((id) => id !== trackId);
  } else {
    state.queueIds = [...state.queueIds, trackId];
  }

  saveState();
  renderAll();
}

function showTrackContextMenu(trackId, x, y) {
  if (!dom.trackContextMenu || !dom.contextQueueButton) {
    return;
  }

  contextMenuTrackId = trackId;
  const queued = isQueued(trackId);
  dom.contextQueueButton.textContent = queued ? "Rimuovi dalla coda" : "Aggiungi alla coda";
  dom.trackContextMenu.hidden = false;
  const menuRect = dom.trackContextMenu.getBoundingClientRect();
  const left = Math.min(window.innerWidth - menuRect.width - 12, Math.max(12, x));
  const top = Math.min(window.innerHeight - menuRect.height - 12, Math.max(12, y));
  dom.trackContextMenu.style.left = `${left}px`;
  dom.trackContextMenu.style.top = `${top}px`;
}

function hideTrackContextMenu() {
  if (!dom.trackContextMenu) {
    return;
  }

  dom.trackContextMenu.hidden = true;
  contextMenuTrackId = "";
}

function clearQueue() {
  state.queueIds = [];
  shuffleQueueIds = [];
  saveState();
  renderAll();
  setStatus(dom.queueStatus, "Coda svuotata.", "success");
}

function trackText(track) {
  return [
    track.title,
    track.subtitle,
    track.genre,
    track.mood,
    track.energy,
    track.license,
    track.licenseDetail,
    track.description,
    ...(track.useCases || []),
    ...(track.tags || []),
  ]
    .join(" ")
    .toLowerCase();
}

function trackHasUseCase(track, useCase) {
  return (track.useCases || []).includes(useCase);
}

function uniqueTracks(trackList) {
  const seen = new Set();
  return trackList.filter((track) => {
    if (seen.has(track.id)) {
      return false;
    }

    seen.add(track.id);
    return true;
  });
}

function groupTracksByGenre(trackList) {
  return trackList.reduce((groups, track) => {
    const genre = getTrackGenre(track);
    if (!groups.has(genre)) {
      groups.set(genre, []);
    }

    groups.get(genre).push(track);
    return groups;
  }, new Map());
}

function getAutomaticPlaylists() {
  const baseTracks = tracks.filter(isPlayableCatalogSong);
  const realTracks = baseTracks.filter(isRealSong);
  const realPlayableTracks = realTracks.filter((track) => playbackSourceFor(track) || embedSourceFor(track));
  const favorites = baseTracks.filter((track) => isFavorite(track.id));
  const sessionPlaylist = sessionTracks.length > 0
    ? [{
        id: "session-user",
        title: "Canzoni esterne",
        description: `${sessionTracks.length} brani temporanei con rischio copyright. Spariscono al logout.`,
        tracks: sessionTracks,
        empty: "Nessuna canzone esterna attiva.",
        risk: true,
      }]
    : [];
  const genrePlaylists = [...groupTracksByGenre(realPlayableTracks).entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0], "it"))
    .slice(0, 8)
    .map(([genre, genreTracks]) => ({
      id: `genre-${slugifyClient(genre)}`,
      title: genre,
      description: `${genreTracks.length} brani riproducibili.`,
      tracks: uniqueTracks(genreTracks),
      empty: `Nessuna traccia ${genre} disponibile.`,
    }));
  const favoritePlaylist = favorites.length > 0
    ? [{
        id: "favorites",
        title: "Preferiti",
        description: `${favorites.length} brani salvati.`,
        tracks: favorites,
        empty: "Nessun preferito ancora.",
      }]
    : [];

  return [
    {
      id: "real-songs",
      title: "Tutta la libreria",
      description: `${realPlayableTracks.length} brani commercial-safe salvati.`,
      tracks: realPlayableTracks,
      empty: "Nessun brano reale importato ancora: usa Importa lotto nella Discovery.",
    },
    ...sessionPlaylist,
    ...favoritePlaylist,
    ...genrePlaylists,
  ];
}

function getActivePlaylist() {
  const playlists = getAutomaticPlaylists();
  const active = playlists.find((playlist) => playlist.id === state.activePlaylistId);
  if (active) {
    return active;
  }

  state.activePlaylistId = "real-songs";
  saveState();
  return playlists[0];
}

function queueTracks() {
  const manualQueue = queuedTracks();
  if (manualQueue.length > 0) {
    return manualQueue;
  }

  const activePlaylist = getActivePlaylist();
  if (activePlaylist) {
    return activePlaylist.tracks;
  }

  const filtered = filterTracks();
  return filtered.length > 0 ? filtered : tracks;
}

function queueTrackIds() {
  return queueTracks().map((track) => track.id);
}

function refillShuffleQueue(currentTrackId = "") {
  shuffleQueueIds = queueTrackIds()
    .filter((trackId) => trackId !== currentTrackId)
    .sort(() => Math.random() - 0.5);
}

function nextShuffleTrackId(currentTrackId = "", shouldStopAtQueueEnd = false) {
  const validIds = new Set(queueTrackIds());
  shuffleQueueIds = shuffleQueueIds.filter(
    (trackId) => validIds.has(trackId) && trackId !== currentTrackId
  );

  if (shuffleQueueIds.length === 0) {
    if (shouldStopAtQueueEnd && state.repeatMode !== "all") {
      return "";
    }

    refillShuffleQueue(currentTrackId);
  }

  return shuffleQueueIds.shift() || currentTrackId;
}

