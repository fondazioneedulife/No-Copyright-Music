async function searchDiscovery() {
  if (!requireAdminAction(dom.discoveryStatus, "Solo l'amministratore puo' cercare e importare nuove sorgenti.")) {
    return;
  }

  const q = dom.discoverySearchInput.value.trim();
  const rightsMode = dom.discoveryRightsMode.value;
  const provider = dom.discoveryProviderSelect.value;

  setStatus(dom.discoveryStatus, "Ricerca in corso nelle sorgenti ufficiali...");
  dom.discoverySearchButton.disabled = true;

  try {
    const url = new URL("/api/discovery/search", window.location.origin);
    url.searchParams.set("q", q);
    url.searchParams.set("provider", provider);
    url.searchParams.set("rights_mode", rightsMode);
    url.searchParams.set("limit", "8");

    const response = await fetch(url, {
      headers: authHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Ricerca esterna non disponibile.");
    }

    discoveryResults = Array.isArray(payload.items) ? payload.items : [];
    renderDiscoveryResults();

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const message = payload.errors
        .map((entry) => `${entry.provider}: ${entry.message}`)
        .join(" | ");
      setStatus(
        dom.discoveryStatus,
        `Ricerca completata con avvisi. ${message}`,
        "error"
      );
    } else {
      setStatus(
        dom.discoveryStatus,
        `${discoveryResults.length} risultati trovati nelle sorgenti ufficiali.`,
        "success"
      );
    }
  } catch (error) {
    discoveryResults = [];
    renderDiscoveryResults();
    setStatus(dom.discoveryStatus, error.message || "Errore nella ricerca esterna.", "error");
  } finally {
    dom.discoverySearchButton.disabled = false;
  }
}

async function importDiscoveryTrackById(trackId) {
  if (!requireAdminAction(dom.discoveryStatus)) {
    return;
  }

  const track = discoveryResults.find((entry) => entry.id === trackId);
  if (!track) {
    return;
  }

  setStatus(dom.discoveryStatus, "Import nel catalogo locale in corso...");

  try {
    const response = await fetch("/api/discovery/import", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(track),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Import non riuscito.");
    }

    setStatus(dom.discoveryStatus, "Traccia importata nel catalogo locale.", "success");
    await fetchLibrary({ quiet: true });
  } catch (error) {
    setStatus(dom.discoveryStatus, error.message || "Errore durante l'import.", "error");
  }
}

async function importFromLink() {
  if (!requireAdminAction(dom.discoveryStatus)) {
    return;
  }

  const link = dom.importLinkInput.value.trim();
  if (!link) {
    setStatus(
      dom.discoveryStatus,
      "Incolla prima un link Jamendo oppure un video/playlist/canale YouTube whitelist.",
      "error"
    );
    return;
  }

  setStatus(
    dom.discoveryStatus,
    `Import da link in corso: leggo fino a ${safeLinkImportMaxTracks} tracce, puo' richiedere qualche secondo...`
  );
  dom.importLinkButton.disabled = true;

  try {
    const response = await fetch("/api/discovery/import-link", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        url: link,
        maxTracks: safeLinkImportMaxTracks,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Import da link non riuscito.");
    }

    await fetchLibrary({ quiet: true });
    const importedCount = Number(payload.importedCount || 0);
    const skippedCount = Number(payload.skippedCount || 0);
    const scannedCount = Number(payload.scanned || 0);
    const skipDetails = skippedSummaryText(payload);
    const skippedText = skippedCount > 0
      ? ` ${skippedCount} saltate${skipDetails ? ` (${skipDetails})` : ""}.`
      : "";
    const progressText = importProgressText(payload);
    const statusText =
      importedCount === 0 && skippedCount > 0
        ? `Nessuna nuova traccia: il link e' gia' presente oppure non supera i filtri commercial-safe.${skippedText}${progressText}`
        : `Import link completato: ${importedCount} nuove tracce su ${scannedCount} lette.${skippedText}${progressText}`;
    setStatus(dom.discoveryStatus, statusText, "success");

    if (importedCount > 0) {
      dom.importLinkInput.value = "";
    }
  } catch (error) {
    setStatus(
      dom.discoveryStatus,
      friendlyImportError(error, "Errore durante l'import da link."),
      "error"
    );
  } finally {
    dom.importLinkButton.disabled = false;
  }
}

function renderSessionPanel() {
  const isActive = Boolean(sessionUser);
  dom.sessionUserInput.disabled = isActive;
  dom.sessionLoginButton.disabled = isActive;
  dom.sessionLogoutButton.disabled = !isActive;
  dom.sessionImportButton.disabled = !isActive;

  if (isActive) {
    dom.sessionUserInput.value = sessionUser;
    setStatus(
      dom.sessionStatus,
      `Sessione attiva per ${sessionUser}: ${sessionTracks.length} tracce temporanee.`,
      "success"
    );
    return;
  }

  setStatus(
    dom.sessionStatus,
    "Entra con un nome utente per caricare playlist YouTube temporanee.",
    ""
  );
}

function loginSessionUser() {
  const nextUser = dom.sessionUserInput.value.trim();
  if (!nextUser) {
    setStatus(dom.sessionStatus, "Inserisci un nome utente o una postazione.", "error");
    return;
  }

  if (sessionUser && sessionUser !== nextUser) {
    sessionTracks = [];
  }

  sessionUser = nextUser;
  sessionTracks = [];
  externalRiskAccepted = false;
  if (state.activePlaylistId === "session-user") {
    state.activePlaylistId = "real-songs";
  }
  cleanSelectedIds();
  saveState();
  renderAll();
}

function logoutSessionUser() {
  const sessionIds = new Set(sessionTracks.map((track) => track.id));
  if (sessionIds.has(activePlayback?.trackId)) {
    stopPlayback({ render: false });
  }

  sessionUser = "";
  sessionTracks = [];
  externalRiskAccepted = false;
  hideExternalRiskWarning();
  dom.sessionUserInput.disabled = false;
  dom.sessionUserInput.value = "";
  if (state.activePlaylistId === "session-user") {
    state.activePlaylistId = "real-songs";
  }

  cleanSelectedIds();
  populateFilters();
  saveState();
  renderAll();
  setStatus(dom.sessionStatus, "Logout eseguito: playlist temporanea rimossa.", "success");
}

async function importSessionPlaylistFromLink() {
  if (!requireAdminAction(dom.sessionStatus)) {
    return;
  }

  const link = dom.importLinkInput.value.trim();
  if (!sessionUser) {
    setStatus(dom.sessionStatus, "Prima entra con un nome utente per creare la sessione.", "error");
    return;
  }

  if (!link) {
    setStatus(dom.sessionStatus, "Incolla un link playlist o video YouTube.", "error");
    return;
  }

  setStatus(
    dom.sessionStatus,
    `Carico link YouTube nella sessione temporanea: leggo fino a ${sessionLinkImportMaxTracks} tracce...`
  );
  dom.sessionImportButton.disabled = true;

  try {
    const response = await fetch("/api/session/import-link", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        url: link,
        maxTracks: sessionLinkImportMaxTracks,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Import sessione non riuscito.");
    }

    const knownIds = new Set(sessionTracks.map((track) => track.youtubeVideoId || track.id));
    const incomingTracks = (Array.isArray(payload.imported) ? payload.imported : [])
      .filter((track) => !knownIds.has(track.youtubeVideoId || track.id))
      .map((track) => ({
        ...track,
        sessionOwner: sessionUser,
        subtitle: `${track.creatorName || "YouTube"} / sessione ${sessionUser}`,
      }));

    sessionTracks = [...sessionTracks, ...incomingTracks];
    externalRiskAccepted = false;
    state.activePlaylistId = "session-user";
    state.genre = "all";
    populateFilters();
    dom.genreSelect.value = "all";
    saveState();
    renderAll();

    const notice = payload.notice ? ` ${payload.notice}` : "";
    const progressText = importProgressText(payload);
    const receivedCount = Number(payload.importedCount || 0);
    const duplicateText = receivedCount > incomingTracks.length
      ? ` ${receivedCount - incomingTracks.length} erano gia' presenti nella sessione.`
      : "";
    setStatus(
      dom.sessionStatus,
      `Sessione caricata: ${incomingTracks.length} nuove tracce temporanee. Al logout spariscono.${duplicateText}${notice}${progressText}`,
      "success"
    );
  } catch (error) {
    setStatus(
      dom.sessionStatus,
      friendlyImportError(error, "Errore durante l'import sessione."),
      "error"
    );
  } finally {
    dom.sessionImportButton.disabled = !sessionUser;
  }
}

async function bulkImportLibrary() {
  if (!requireAdminAction(dom.bulkImportStatus)) {
    return;
  }

  setStatus(
    dom.bulkImportStatus,
    "Importo un piccolo lotto progressivo da Jamendo e dai canali YouTube whitelist..."
  );
  dom.bulkImportButton.disabled = true;

  try {
    const response = await fetch("/api/discovery/bulk-import", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        includeYouTubeChannels: true,
        limitPerQuery: 8,
        maxTracks: 80,
        youtubeChannelMaxPages: 2,
        youtubeResume: true,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Import lotto non riuscito.");
    }

    await fetchLibrary({ quiet: true });
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const warningText =
      errors.length > 0
        ? ` Avvisi: ${errors.map((entry) => `${entry.provider}: ${entry.message}`).join(" | ")}`
        : "";
    const youtubeProgress = Array.isArray(payload.youtubeProgress) ? payload.youtubeProgress : [];
    const progressText =
      youtubeProgress.length > 0
        ? ` YouTube pagine: ${youtubeProgress
            .map((entry) => `${entry.channel} ${entry.pagesRead || 0}`)
            .join(", ")}.`
        : "";
    const skipDetails = skippedSummaryText(payload);
    const skippedText = Number(payload.skippedCount || 0) > 0
      ? ` Saltate: ${skipDetails || payload.skippedCount}.`
      : "";
    setStatus(
      dom.bulkImportStatus,
      `Lotto completato: ${payload.importedCount || 0} nuove tracce importate su ${payload.scanned || 0} risultati letti.${progressText}${skippedText}${warningText}`,
      errors.length > 0 ? "error" : "success"
    );
  } catch (error) {
    setStatus(
      dom.bulkImportStatus,
      error.message || "Errore durante l'import del lotto.",
      "error"
    );
  } finally {
    dom.bulkImportButton.disabled = false;
  }
}

async function deleteTrackById(trackId) {
  if (!requireAdminAction(dom.libraryStatus, "Solo l'amministratore puo' rimuovere brani.")) {
    return;
  }

  const track = allTracks().find((entry) => entry.id === trackId);
  if (!track) {
    return;
  }

  const confirmed = window.confirm(`Rimuovere "${track.title}" dal catalogo locale?`);
  if (!confirmed) {
    return;
  }

  setStatus(dom.libraryStatus, "Rimozione brano in corso...");

  try {
    const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Rimozione non riuscita.");
    }

    if (activePlayback?.trackId === trackId) {
      stopPlayback({ render: false });
    }
    state.selectedIds = state.selectedIds.filter((id) => id !== trackId);
    state.favoriteIds = state.favoriteIds.filter((id) => id !== trackId);
    state.queueIds = state.queueIds.filter((id) => id !== trackId);
    saveState();
    await fetchLibrary({ quiet: true });
    setStatus(dom.libraryStatus, "Brano rimosso dal catalogo.", "success");
  } catch (error) {
    setStatus(dom.libraryStatus, error.message || "Errore durante la rimozione.", "error");
  }
}

