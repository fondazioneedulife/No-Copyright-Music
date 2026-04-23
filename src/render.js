function toggleSelection(trackId) {
  if (state.selectedIds.includes(trackId)) {
    state.selectedIds = state.selectedIds.filter((id) => id !== trackId);
  } else {
    state.selectedIds = [...state.selectedIds, trackId];
  }

  saveState();
  renderAll();
}

function playlistToFilter(playlistId) {
  if (!playlistId || playlistId === "real-songs" || playlistId === "session-user") {
    return "all";
  }

  const playlist = getAutomaticPlaylists().find((entry) => entry.id === playlistId);
  return playlist && playlist.id.startsWith("genre-") ? playlist.title : "all";
}

function renderTrackGrid() {
  const playableTracks = (state.activePlaylistId === "session-user" ? sessionTracks : tracks).filter(
    isPlayableCatalogSong
  );
  const filtered = filterTracks().sort((left, right) => {
    const realScore = Number(isRealSong(right)) - Number(isRealSong(left));
    if (realScore !== 0) {
      return realScore;
    }

    return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
  });
  const realCount = playableTracks.length;
  const filterText = state.genre === "all" ? "" : ` Filtro genere: ${state.genre}.`;
  const sourceText =
    state.source === "youtube"
      ? " Sorgente: YouTube."
      : state.source === "jamendo"
        ? " Sorgente: Jamendo."
        : state.source === "session"
          ? " Sorgente: sessione temporanea."
          : "";
  const totalPages = Math.max(1, Math.ceil(filtered.length / catalogPageSize));
  state.catalogPage = Math.min(Math.max(1, Number(state.catalogPage) || 1), totalPages);
  const startIndex = (state.catalogPage - 1) * catalogPageSize;
  const pagedTracks = filtered.slice(startIndex, startIndex + catalogPageSize);
  dom.resultsSummary.textContent = `${filtered.length} tracce filtrate su ${realCount} totali. Pagina ${state.catalogPage} di ${totalPages}.${filterText}${sourceText}`;

  if (playableTracks.length === 0) {
    dom.trackGrid.innerHTML = `
      <article class="selection-empty">
        Nessuna traccia Jamendo/YouTube riproducibile disponibile. Usa Importa lotto nella Discovery.
      </article>
    `;
    renderCatalogPagination(0);
    return;
  }

  if (filtered.length === 0) {
    dom.trackGrid.innerHTML = `
      <article class="selection-empty">
        Nessuna traccia corrisponde ai filtri correnti. Prova ad ampliare la licenza oppure a
        disattivare il filtro sull'attribuzione.
      </article>
    `;
    renderCatalogPagination(0);
    return;
  }

  renderCatalogPagination(totalPages);
  dom.trackGrid.innerHTML = pagedTracks
    .map((track, index) => {
      const selected = state.selectedIds.includes(track.id);
      const favorite = isFavorite(track.id);
      const queued = isQueued(track.id);
      const playing = isPlaying(track.id);
      const admin = isAdmin();
      const uploaded = track.sourceType === "uploaded";
      const imported = track.sourceType === "provider-import";
      const realSong = isRealSong(track);
      const hasLicenseEvidence = Boolean(track.licensePath || track.licenseUrl);
      const hasPlayback = Boolean(track.playbackPath || track.audioPath || track.previewPath);
      const genre = getTrackGenre(track);
      const coverPath = track.coverPath || "";
      const coverImage = coverPath
        ? `<img class="track-cover-art" src="${escapeHtml(coverPath)}" alt="${escapeHtml(track.coverAlt || `${genre} artwork`)}" width="1024" height="1024" loading="lazy" onerror="this.remove()" />`
        : "";
      const docBadge = hasLicenseEvidence
        ? '<span class="tag is-success">Licenza collegata</span>'
        : '<span class="tag is-warning">Doc mancante</span>';
      const coverBadge =
        track.externalProvider === "youtube_curated"
          ? "YOUTUBE"
          : track.externalProvider === "jamendo"
            ? "JAMENDO"
            : uploaded
              ? "UPLOADED"
              : imported
                ? "REAL"
                : "TRACK";

      return `
        <article class="track-card" style="--card-accent: ${escapeHtml(track.accent || "#146c78")}; animation-delay: ${index * 40}ms;">
          <div class="track-card-header">
            <div class="track-cover">
              ${coverImage}
              <div class="track-cover-top">
                <span class="track-cover-badge">${coverBadge}</span>
                <span class="track-cover-badge">${escapeHtml(genre)}</span>
              </div>
              <button class="track-play" data-action="preview" data-id="${escapeHtml(track.id)}" data-playing="${playing ? "true" : "false"}" type="button" aria-label="${playing ? "Pausa" : "Ascolta"} ${escapeHtml(track.title)}">
                ${
                  playing
                    ? '<span class="track-pause-icon" aria-hidden="true"></span>'
                    : '<span class="track-play-icon" aria-hidden="true"></span>'
                }
              </button>
            </div>
            <div class="track-card-copy">
              <div>
                <h3>${escapeHtml(track.title)}</h3>
                <p class="track-subtitle">${escapeHtml(track.subtitle || "Traccia senza sottotitolo")}</p>
                <p class="track-source-line">${escapeHtml(providerLabel(track))} | ${escapeHtml(track.duration || "n/d")}</p>
              </div>
              <p class="track-description">${escapeHtml(track.description || "Nessuna descrizione disponibile.")}</p>
              <p class="track-genre-audit">${escapeHtml(track.genreAudit || "Genere stimato dai metadata disponibili")}</p>
            </div>
          </div>

          <div class="track-meta">
            <span class="pill">${escapeHtml(track.bpm || 0)} BPM</span>
            <span class="pill">${escapeHtml(track.duration || "n/d")}</span>
            <span class="pill">${escapeHtml(genre)}</span>
            <span class="pill">${track.audioPath ? "File live" : "Preview locale"}</span>
          </div>

          <div class="track-badges">
            <span class="tag">${escapeHtml(track.license || "Licenza n/d")}</span>
            <span class="tag">${track.attributionRequired ? "Attribuzione richiesta" : "No attribution"}</span>
            <span class="tag">${realSong ? "Brano riproducibile" : "Non incluso"}</span>
            ${docBadge}
          </div>

          <div class="track-meta">
            <span class="pill">${escapeHtml(track.licenseDetail || "Dettaglio licenza non specificato")}</span>
            <span class="pill">${escapeHtml((track.formats || []).join(", ") || "Formato n/d")}</span>
          </div>

          <div class="asset-links">
            ${
              hasPlayback
                ? `<a class="asset-link" href="${escapeHtml(track.playbackPath || track.audioPath || track.previewPath)}" target="_blank" rel="noreferrer">Apri audio</a>`
                : '<span class="asset-link is-muted">Audio non disponibile</span>'
            }
            ${
              track.licensePath
                ? `<a class="asset-link" href="${escapeHtml(track.licensePath)}" target="_blank" rel="noreferrer">Apri licenza</a>`
                : track.licenseUrl
                  ? `<a class="asset-link" href="${escapeHtml(track.licenseUrl)}" target="_blank" rel="noreferrer">Pagina licenza</a>`
                  : '<span class="asset-link is-muted">Licenza non allegata</span>'
            }
            ${
              track.sourceUrl
                ? `<a class="asset-link" href="${escapeHtml(track.sourceUrl)}" target="_blank" rel="noreferrer">Fonte</a>`
                : ""
            }
            ${
              track.downloadPath
                ? `<a class="asset-link" href="${escapeHtml(track.downloadPath)}">Download controllato</a>`
                : ""
            }
          </div>

          <div class="card-actions">
            <button class="button button-ghost ${playing ? "is-active" : ""}" data-action="preview" data-id="${escapeHtml(track.id)}" type="button">
              ${playing ? "Pausa" : track.audioPath ? "Ascolta file" : "Ascolta preview"}
            </button>
            <button class="button button-secondary ${queued ? "is-active" : ""}" data-action="queue" data-id="${escapeHtml(track.id)}" type="button">
              ${queued ? "In coda" : "Aggiungi coda"}
            </button>
            <button class="button button-favorite ${favorite ? "is-active" : ""}" data-action="favorite" data-id="${escapeHtml(track.id)}" type="button">
              ${favorite ? "Preferita" : "Preferiti"}
            </button>
            <button class="button ${selected ? "button-secondary" : "button-primary"}" data-action="select" data-id="${escapeHtml(track.id)}" type="button">
              ${selected ? "In shortlist" : "Shortlist"}
            </button>
            ${
              admin
                ? `<button class="button button-danger" data-action="delete-track" data-id="${escapeHtml(track.id)}" type="button">Rimuovi</button>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCatalogPagination(totalPages) {
  if (!dom.catalogPagination) {
    return;
  }

  if (totalPages <= 1) {
    dom.catalogPagination.innerHTML = "";
    return;
  }

  const currentPage = Math.min(Math.max(1, Number(state.catalogPage) || 1), totalPages);
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const safePages = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items = [];
  let previousPage = 0;
  safePages.forEach((page) => {
    if (previousPage && page - previousPage > 1) {
      items.push('<span class="pagination-gap">...</span>');
    }

    items.push(`
      <button class="pagination-button ${page === currentPage ? "is-active" : ""}" data-page="${page}" type="button">
        ${page}
      </button>
    `);
    previousPage = page;
  });

  dom.catalogPagination.innerHTML = `
    <button class="pagination-button" data-page="${Math.max(1, currentPage - 1)}" type="button" ${currentPage === 1 ? "disabled" : ""}>
      Prev
    </button>
    ${items.join("")}
    <button class="pagination-button" data-page="${Math.min(totalPages, currentPage + 1)}" type="button" ${currentPage === totalPages ? "disabled" : ""}>
      Next
    </button>
  `;
}

function renderPlaylists() {
  const playlists = getAutomaticPlaylists();
  const activePlaylist = getActivePlaylist();
  const playableTracks = allTracks().filter(isPlayableCatalogSong);

  if (playableTracks.length === 0) {
    dom.playlistGrid.innerHTML = "";
    dom.playlistFocusTitle.textContent = "Playlist non disponibili";
    dom.playlistFocusMeta.textContent = "Importa brani Jamendo o YouTube per generare le playlist.";
    dom.playlistTrackRow.innerHTML =
      '<p class="selection-empty">Nessuna traccia riproducibile disponibile.</p>';
    setStatus(dom.playlistStatus, "Importa brani riproducibili da Jamendo o YouTube.", "error");
    return;
  }

  setStatus(dom.playlistStatus, "");
  dom.playlistGrid.innerHTML = playlists
    .map(
      (playlist) => `
        <button class="playlist-card ${playlist.id === activePlaylist.id ? "is-active" : ""} ${playlist.risk ? "is-risk" : ""}" data-action="playlist" data-id="${escapeHtml(playlist.id)}" type="button">
          <h3>${escapeHtml(playlist.title)}</h3>
          <p>${escapeHtml(playlist.description)}</p>
          <span class="playlist-count">${playlist.tracks.length} tracce</span>
        </button>
      `
    )
    .join("");

  dom.playlistFocusTitle.textContent = activePlaylist.title;
  dom.playlistFocusMeta.textContent = `${activePlaylist.tracks.length} tracce disponibili. Usa questa playlist come coda per Prev, Play e Next.`;

  if (activePlaylist.tracks.length === 0) {
    dom.playlistTrackRow.innerHTML = `
      <p class="selection-empty">${escapeHtml(activePlaylist.empty || "Nessuna traccia in questa playlist.")}</p>
    `;
    return;
  }

  dom.playlistTrackRow.innerHTML = activePlaylist.tracks
    .slice(0, 12)
    .map((track) => {
      const selected = state.selectedIds.includes(track.id);
      const favorite = isFavorite(track.id);
      const queued = isQueued(track.id);
      const playing = isPlaying(track.id);

      return `
        <article class="playlist-mini-track">
          <div>
            <strong>${escapeHtml(track.title)}</strong>
            <span>${escapeHtml(getTrackGenre(track))} | ${escapeHtml(track.duration || "n/d")} | ${escapeHtml(track.license || "Licenza n/d")}</span>
          </div>
          <div class="mini-track-actions">
            <button class="button button-ghost ${playing ? "is-active" : ""}" data-action="preview" data-id="${escapeHtml(track.id)}" type="button">
              ${playing ? "Pausa" : "Play"}
            </button>
            <button class="button button-secondary ${queued ? "is-active" : ""}" data-action="queue" data-id="${escapeHtml(track.id)}" type="button">
              ${queued ? "In coda" : "Coda"}
            </button>
            <button class="button button-favorite ${favorite ? "is-active" : ""}" data-action="favorite" data-id="${escapeHtml(track.id)}" type="button">
              ${favorite ? "Salvata" : "Preferiti"}
            </button>
            <button class="button ${selected ? "button-secondary" : "button-primary"}" data-action="select" data-id="${escapeHtml(track.id)}" type="button">
              ${selected ? "Shortlist" : "Aggiungi"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderQueue() {
  if (!dom.queueList) {
    return;
  }

  const queued = queuedTracks();
  dom.clearQueueButton.disabled = queued.length === 0;

  if (queued.length === 0) {
    setStatus(dom.queueStatus, "La coda e' vuota: aggiungi brani dal catalogo.", "");
    dom.queueList.innerHTML =
      '<p class="selection-empty">Nessuna traccia in coda. Se non aggiungi nulla, Prev/Next seguono la playlist selezionata.</p>';
    return;
  }

  setStatus(
    dom.queueStatus,
    `${queued.length} tracce in coda. Prev, Play e Next useranno questa lista.`,
    "success"
  );
  dom.queueList.innerHTML = queued
    .map((track, index) => {
      const playing = isPlaying(track.id);
      return `
        <article class="queue-item ${playing ? "is-playing" : ""}">
          <span class="queue-index">${index + 1}</span>
          <div>
            <strong>${escapeHtml(track.title)}</strong>
            <span>${escapeHtml(getTrackGenre(track))} | ${escapeHtml(providerLabel(track))} | ${escapeHtml(track.duration || "n/d")}</span>
          </div>
          <div class="mini-track-actions">
            <button class="button button-ghost ${playing ? "is-active" : ""}" data-action="preview" data-id="${escapeHtml(track.id)}" type="button">
              ${playing ? "Pausa" : "Play"}
            </button>
            <button class="button button-secondary" data-action="queue" data-id="${escapeHtml(track.id)}" type="button">
              Togli
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSelection() {
  const selected = selectedTracks();
  dom.selectedCount.textContent = String(selected.length);
  dom.playerSelectionCount.textContent = String(selected.length);

  const averageBpm =
    selected.length === 0
      ? 0
      : Math.round(selected.reduce((sum, track) => sum + Number(track.bpm || 0), 0) / selected.length);
  dom.selectedAvgBpm.textContent = String(averageBpm);

  if (selected.length === 0) {
    dom.selectionList.innerHTML =
      '<p class="selection-empty">Aggiungi una o piu\' tracce dal catalogo per costruire il pacchetto commerciale.</p>';
    return;
  }

  dom.selectionList.innerHTML = selected
    .map(
      (track) => `
        <article class="selection-item">
          <div>
            <strong>${escapeHtml(track.title)}</strong>
            <span>${escapeHtml(track.license)} | ${escapeHtml((track.useCases || []).join(", "))}</span>
          </div>
          <button class="icon-button" data-action="remove" data-id="${escapeHtml(track.id)}" type="button" aria-label="Rimuovi ${escapeHtml(track.title)}">
            &times;
          </button>
        </article>
      `
    )
    .join("");
}

function renderMetrics() {
  const playableTracks = allTracks().filter(isPlayableCatalogSong);
  dom.metricTracks.textContent = String(playableTracks.length);
  dom.metricZero.textContent = String(playableTracks.filter((track) => !track.attributionRequired).length);
  dom.metricUses.textContent = String(
    new Set(playableTracks.flatMap((track) => track.useCases || []).filter(Boolean)).size
  );
  dom.playerLibraryCount.textContent = String(playableTracks.length);
}

function buildReportText() {
  const selected = selectedTracks();
  const lines = [
    `Progetto: ${state.projectName || "Senza nome"}`,
    `Destinazione: ${state.projectUsage}`,
    `Tracce selezionate: ${selected.length}`,
    "",
  ];

  if (selected.length === 0) {
    lines.push("Nessuna traccia selezionata.");
  } else {
    selected.forEach((track, index) => {
      lines.push(`${index + 1}. ${track.title} (${track.bpm || 0} BPM, ${track.duration || "n/d"})`);
      lines.push(`   Licenza: ${track.licenseDetail || track.license}`);
      lines.push(`   Usi coperti: ${(track.useCases || []).join(", ")}`);
      lines.push(
        `   Compliance: ${
          track.attributionRequired
            ? "Inserire credito nel deliverable finale."
            : "Nessuna attribuzione richiesta."
        }`
      );
      lines.push(
        `   Archivio: ${
          track.licensePath || track.licenseUrl
            ? "Documento o pagina licenza presente"
            : "Documento licenza mancante"
        }`
      );
      lines.push(
        `   Asset audio: ${
          track.audioPath
            ? track.audioOriginalName || track.audioPath
            : track.previewPath || track.playbackPath || "Preview locale"
        }`
      );
      if (track.sourceUrl) {
        lines.push(`   Fonte: ${track.sourceUrl}`);
      }
      if (track.rightsNotes) {
        lines.push(`   Note: ${track.rightsNotes}`);
      }
      lines.push("");
    });
  }

  lines.push("Nota:");
  lines.push(
    "Conservare sempre la licenza originale o la prova di provenienza del brano prima della pubblicazione commerciale."
  );

  return lines.join("\n");
}

function renderReport() {
  dom.reportStatus.textContent = "Pronto da esportare";
  dom.reportOutput.textContent = buildReportText();
}

function renderArchive() {
  const uploadedTracks = tracks
    .filter(isPlayableCatalogSong)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  const licensedCount = uploadedTracks.filter(
    (track) => Boolean(track.licensePath || track.licenseUrl)
  ).length;
  const missingCount = uploadedTracks.length - licensedCount;

  dom.archiveUploadedCount.textContent = String(uploadedTracks.length);
  dom.archiveLicensedCount.textContent = String(licensedCount);
  dom.archiveMissingCount.textContent = String(missingCount);

  if (uploadedTracks.length === 0) {
    dom.archiveList.innerHTML = `
      <p class="selection-empty">
        Nessuna traccia Jamendo/YouTube archiviata ancora. Usa Importa lotto nella Discovery per
        importare brani riproducibili automaticamente.
      </p>
    `;
    return;
  }

  dom.archiveList.innerHTML = uploadedTracks
    .slice(0, 6)
    .map(
      (track) => `
        <article class="archive-item">
          <div class="archive-item-header">
            <div>
              <h3>${escapeHtml(track.title)}</h3>
              <p class="track-subtitle">${escapeHtml(track.subtitle || "Senza sottotitolo")}</p>
            </div>
            <span class="tag ${track.licensePath || track.licenseUrl ? "is-success" : "is-warning"}">
              ${track.licensePath || track.licenseUrl ? "Licenza presente" : "Licenza mancante"}
            </span>
          </div>

          <div class="archive-meta">
            <span class="pill">${escapeHtml(track.license)}</span>
            <span class="pill">${escapeHtml((track.formats || []).join(", ") || "Formato n/d")}</span>
            <span class="pill">Caricato il ${escapeHtml(formatDate(track.createdAt))}</span>
          </div>

          <p class="archive-note">${escapeHtml(track.rightsNotes || track.licenseDetail || "Nessuna nota compliance disponibile.")}</p>

          <div class="asset-links">
            ${
              track.playbackPath || track.audioPath || track.previewPath
                ? `<a class="asset-link" href="${escapeHtml(track.playbackPath || track.audioPath || track.previewPath)}" target="_blank" rel="noreferrer">Apri audio</a>`
                : '<span class="asset-link is-muted">Audio non allegato</span>'
            }
            ${
              track.licensePath
                ? `<a class="asset-link" href="${escapeHtml(track.licensePath)}" target="_blank" rel="noreferrer">Apri documento licenza</a>`
                : track.licenseUrl
                  ? `<a class="asset-link" href="${escapeHtml(track.licenseUrl)}" target="_blank" rel="noreferrer">Apri pagina licenza</a>`
                  : '<span class="asset-link is-muted">Documento mancante</span>'
            }
            ${
              track.sourceUrl
                ? `<a class="asset-link" href="${escapeHtml(track.sourceUrl)}" target="_blank" rel="noreferrer">Marketplace</a>`
                : ""
            }
            ${
              track.downloadPath
                ? `<a class="asset-link" href="${escapeHtml(track.downloadPath)}">Download controllato</a>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");
}

function renderDiscoveryResults() {
  dom.playerDiscoveryCount.textContent = String(discoveryResults.length);

  if (discoveryResults.length === 0) {
    dom.discoveryResults.innerHTML = `
      <p class="selection-empty">
        Cerca nelle API ufficiali per vedere risultati pubblici dominio o commerciali con
        licenza.
      </p>
    `;
    return;
  }

  dom.discoveryResults.innerHTML = discoveryResults
    .map((track) => {
      const playbackSource = playbackSourceFor(track);
      const embedSource = embedSourceFor(track);
      const canImport = track.canImport !== false;
      const canPreview = track.canPreview !== false && Boolean(playbackSource || embedSource);

      return `
        <article class="discovery-card">
          <div class="discovery-card-copy">
            <h3>${escapeHtml(track.title)}</h3>
            <p>${escapeHtml(track.subtitle || "Sorgente esterna")}</p>

            <div class="track-meta">
              <span class="pill">${escapeHtml(track.externalProvider || "provider")}</span>
              <span class="pill">${escapeHtml(track.license || "licenza n/d")}</span>
              <span class="pill">${escapeHtml(track.commercialStatus || "verifica richiesta")}</span>
            </div>

            <p>${escapeHtml(track.rightsNotes || track.licenseDetail || "Verifica i termini prima dell'uso.")}</p>

            <div class="asset-links">
              ${
                playbackSource
                  ? `<a class="asset-link" href="${escapeHtml(playbackSource)}" target="_blank" rel="noreferrer">Apri audio / preview</a>`
                  : '<span class="asset-link is-muted">Preview synth locale</span>'
              }
              ${
                track.licenseUrl
                  ? `<a class="asset-link" href="${escapeHtml(track.licenseUrl)}" target="_blank" rel="noreferrer">Apri pagina licenza</a>`
                  : ""
              }
              ${
                track.sourceUrl
                  ? `<a class="asset-link" href="${escapeHtml(track.sourceUrl)}" target="_blank" rel="noreferrer">Pagina sorgente</a>`
                  : ""
              }
            </div>
          </div>

          <div class="discovery-card-actions">
            <button class="button button-secondary" data-action="import-discovery" data-id="${escapeHtml(track.id)}" type="button" ${canImport ? "" : "disabled"}>
              ${canImport ? "Importa nel catalogo" : "Solo metadata"}
            </button>
            <button class="button button-ghost" data-action="preview-discovery" data-id="${escapeHtml(track.id)}" type="button" ${canPreview ? "" : "disabled"}>
              ${canPreview ? (isPlaying(track.id) ? "Pausa" : embedSource ? "Riproduci qui" : "Ascolta") : "No audio"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

