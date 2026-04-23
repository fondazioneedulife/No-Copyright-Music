function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugifyClient(value) {
  return String(value || "genre")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "genre";
}

function getTrackGenre(track) {
  return String(track.genre || "Electronic").trim() || "Electronic";
}

function providerLabel(track) {
  if (track.externalProvider === "jamendo") {
    return "Jamendo";
  }

  if (track.externalProvider === "youtube_curated") {
    return "YouTube whitelist";
  }

  if (track.externalProvider === "youtube_session") {
    return "Sessione YouTube";
  }

  return "Catalogo";
}

function allTracks() {
  return [...tracks, ...sessionTracks];
}

function isExternalSessionTrack(track) {
  return track?.externalProvider === "youtube_session";
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function setStatus(element, message, variant = "") {
  if (!message) {
    element.hidden = true;
    element.className = "status-banner";
    element.textContent = "";
    return;
  }

  element.hidden = false;
  element.className = `status-banner${variant ? ` is-${variant}` : ""}`;
  element.textContent = message;
}

function friendlyImportError(error, fallback) {
  const message = String(error?.message || "");
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("failed to fetch") ||
    lowerMessage.includes("networkerror") ||
    lowerMessage.includes("network request failed")
  ) {
    return (
      "Il backend locale non ha risposto durante l'import. " +
      "Ho sistemato i link radio/mix YouTube: riavvia l'app e riprova con un link playlist pubblico, canale o video."
    );
  }

  if (lowerMessage.includes("json")) {
    return "Il backend ha risposto senza dettagli leggibili: riavvia l'app e riprova il link.";
  }

  return message || fallback;
}

function textList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return parseList(value);
}

function skippedSummaryText(payload) {
  const summary = Array.isArray(payload?.skippedSummary) ? payload.skippedSummary : [];
  if (summary.length === 0) {
    return "";
  }

  return summary
    .filter((entry) => Number(entry.count) > 0)
    .map((entry) => `${entry.count} ${entry.label || entry.reason || "saltate"}`)
    .join(", ");
}

function importProgressText(payload) {
  const directPages = Number(payload?.sourcePagesRead || payload?.pagesRead || 0);
  const directScanned = Number(payload?.sourceScanned || payload?.scanned || 0);
  const directLimit = Number(payload?.sourceLimit || payload?.limit || 0);
  const directHasMore = Boolean(payload?.sourceHasMore || payload?.hasMore);
  const directReachedEnd = Boolean(payload?.sourceReachedEnd || payload?.reachedEnd);
  const directText = directPages > 0
    ? ` YouTube: ${directScanned} video letti in ${directPages} pagine${
        directLimit > 0 ? `, limite ${directLimit}` : ""
      }${directHasMore ? ", ci sono altre pagine oltre il limite" : directReachedEnd ? ", playlist/canale letto fino alla fine" : ""}.`
    : "";

  const progress = payload?.source?.resolvedChannel?.progress;
  if (!progress) {
    return directText;
  }

  const pages = Number(progress.pagesRead || 0);
  const total = Number(progress.pagesReadTotal || 0);
  const scanned = Number(progress.scanned || 0);
  const endText = progress.reachedEnd ? ", canale letto fino alla fine" : progress.hasMore ? ", altre pagine disponibili" : "";
  return `${directText} Avanzamento canale: ${scanned} video letti in ${pages} pagine ora, ${total} pagine totali${endText}.`;
}

function formatDate(value) {
  if (!value) {
    return "n/d";
  }

  try {
    return new Intl.DateTimeFormat("it-IT", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function uniqueValues(field) {
  return [
    ...new Set(
      allTracks().flatMap((track) => {
        const value = track[field];
        return Array.isArray(value) ? value : [value];
      })
    ),
  ]
    .filter(Boolean)
    .sort((left, right) => String(left).localeCompare(String(right), "it"));
}

function populateSelect(select, label, values, currentValue) {
  const previous = currentValue || "all";
  select.innerHTML = "";

  const optionAll = document.createElement("option");
  optionAll.value = "all";
  optionAll.textContent = `Tutti ${label}`;
  select.append(optionAll);

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });

  select.value = values.includes(previous) ? previous : "all";
}

function populateSourceSelect() {
  if (!dom.sourceSelect) {
    return;
  }

  const previous = state.source || "all";
  const hasSessionTracks = sessionTracks.length > 0;
  const options = [
    ["all", "YouTube + Jamendo"],
    ["youtube", "Solo YouTube"],
    ["jamendo", "Solo Jamendo"],
    ["session", "Sessione temporanea"],
  ];

  dom.sourceSelect.innerHTML = "";
  options.forEach(([value, label]) => {
    if (value === "session" && !hasSessionTracks) {
      return;
    }

    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    dom.sourceSelect.append(option);
  });

  dom.sourceSelect.value = [...dom.sourceSelect.options].some((option) => option.value === previous)
    ? previous
    : "all";
  state.source = dom.sourceSelect.value;
}

function populateFilters() {
  state.mood = "all";
  state.license = "all";
  state.useCase = "all";
  state.attributionOnly = false;
  populateSelect(dom.genreSelect, "i generi", uniqueValues("genre"), state.genre);
  populateSourceSelect();
  populateSelect(dom.moodSelect, "i mood", uniqueValues("mood"), state.mood);
  populateSelect(dom.licenseSelect, "le licenze", uniqueValues("license"), state.license);
  populateSelect(dom.useCaseSelect, "gli usi", uniqueValues("useCases"), state.useCase);

  state.genre = dom.genreSelect.value;
  state.source = dom.sourceSelect?.value || "all";
  saveState();
}

function cleanSelectedIds() {
  const validIds = new Set(allTracks().filter(isPlayableCatalogSong).map((track) => track.id));
  state.selectedIds = state.selectedIds.filter((id) => validIds.has(id));
  state.favoriteIds = state.favoriteIds.filter((id) => validIds.has(id));
  state.queueIds = state.queueIds.filter((id) => validIds.has(id));
  saveState();
}

