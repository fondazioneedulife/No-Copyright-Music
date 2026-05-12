const TRACK_PAGE_SIZE_DEFAULT = 20;
const TRACK_PAGE_SIZE_MAX = 80;

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function catalogGenreForTrack(track) {
  return firstString(track.genre, track.instrument, "Altro");
}

function catalogSourceForTrack(track) {
  const provider = firstString(track.externalProvider, track.sourceType).toLowerCase();
  if (provider === "jamendo") {
    return "jamendo";
  }

  if (provider === "youtube_curated" || provider === "youtube_session" || track.youtubeVideoId) {
    return "youtube";
  }

  return "other";
}

function normalizeCatalogSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function catalogTrackMatchesSearch(track, query) {
  if (!query) {
    return true;
  }

  return [
    track.title,
    track.subtitle,
    track.creatorName,
    track.license,
    Array.isArray(track.tags) ? track.tags.join(" ") : track.tags,
    catalogGenreForTrack(track),
    catalogSourceForTrack(track),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function catalogTrackMatchesFilters(track, filters) {
  if (filters.genre !== "all" && catalogGenreForTrack(track) !== filters.genre) {
    return false;
  }

  if (filters.source !== "all" && catalogSourceForTrack(track) !== filters.source) {
    return false;
  }

  return catalogTrackMatchesSearch(track, filters.query);
}

function isArchivedCatalogTrack(track) {
  return Boolean(track?.hiddenFromCatalog) || firstString(track?.availabilityStatus).toLowerCase() === "unavailable";
}

function catalogPageResponse(allTracks, searchParams, options = {}) {
  const attachComputedFields = options.attachComputedFields || ((track) => track);
  const includeArchived = searchParams.get("includeArchived") === "1";
  const tracks = allTracks
    .filter((track) => includeArchived || !isArchivedCatalogTrack(track))
    .map(attachComputedFields);
  const wantsServerPage = ["page", "limit", "q", "search", "genre", "source"].some((key) =>
    searchParams.has(key)
  );
  const genres = [...new Set(tracks.map(catalogGenreForTrack).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const facets = {
    // Facets arrivano dal catalogo completo: React non deve scaricare tutto solo per popolare i filtri.
    genres,
    sources: ["youtube", "jamendo", "other"],
    totalTracks: tracks.length,
  };

  if (!wantsServerPage) {
    return {
      tracks,
      pagination: {
        page: 1,
        pageSize: tracks.length,
        totalItems: tracks.length,
        totalPages: 1,
      },
      facets,
    };
  }

  const filters = {
    query: normalizeCatalogSearch(firstString(searchParams.get("q"), searchParams.get("search"))),
    genre: firstString(searchParams.get("genre"), "all"),
    source: firstString(searchParams.get("source"), "all"),
  };
  const filteredTracks = tracks.filter((track) => catalogTrackMatchesFilters(track, filters));
  const pageSize = Math.max(
    1,
    Math.min(TRACK_PAGE_SIZE_MAX, Number(searchParams.get("limit")) || TRACK_PAGE_SIZE_DEFAULT)
  );
  const totalItems = filteredTracks.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const requestedPage = Math.max(1, Number(searchParams.get("page")) || 1);
  const page = Math.min(requestedPage, totalPages);
  const startIndex = (page - 1) * pageSize;

  return {
    tracks: filteredTracks.slice(startIndex, startIndex + pageSize),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
    },
    facets,
  };
}

module.exports = {
  catalogPageResponse,
};
