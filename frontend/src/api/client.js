const tokenStorageKey = "clearwave-auth-token";
const backendOfflineMessage =
  "Backend non raggiungibile. Su PC avvia npm start; su Raspberry controlla docker compose ps/logs.";

export function readStoredToken() {
  // Il token e' solo locale al browser: non contiene password e viene rimosso al logout.
  return window.localStorage.getItem(tokenStorageKey) || "";
}

export function storeToken(token) {
  if (token) {
    window.localStorage.setItem(tokenStorageKey, token);
  } else {
    window.localStorage.removeItem(tokenStorageKey);
  }
}

export async function apiRequest(path, options = {}) {
  // Wrapper unico per le chiamate al backend: aggiunge JSON, Bearer token e gestione errori.
  const { token, body, headers, ...requestOptions } = options;
  const nextHeaders = {
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(headers || {}),
  };

  if (token) {
    nextHeaders.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      ...requestOptions,
      headers: nextHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(backendOfflineMessage);
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Vite restituisce testo non JSON quando il proxy /api non trova il backend su localhost:3000.
    payload = {};
  }

  if (!response.ok) {
    const backendOffline =
      response.status >= 500 &&
      path.startsWith("/api") &&
      !payload.error &&
      /proxy|ECONNREFUSED|localhost:3000|target/i.test(text);
    throw new Error(
      payload.error ||
        (backendOffline
          ? backendOfflineMessage
          : "Richiesta non riuscita.")
    );
  }

  return payload;
}

function filenameFromDisposition(disposition, fallbackName) {
  const match = String(disposition || "").match(/filename="([^"]+)"/i);
  return match?.[1] || fallbackName;
}

export async function downloadRequest(path, token, fallbackName) {
  // Download admin con Bearer token: evita URL pubblici e mantiene gli export protetti.
  let response;
  try {
    response = await fetch(path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new Error(backendOfflineMessage);
  }

  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    throw new Error(payload.error || "Download non riuscito.");
  }

  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), fallbackName),
  };
}

export function login(credentials) {
  // POST /api/auth/login restituisce token di sessione e ruolo utente/admin.
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: credentials,
  });
}

export function logout(token) {
  return apiRequest("/api/auth/logout", {
    method: "POST",
    token,
  });
}

export function fetchCurrentUser(token) {
  return apiRequest("/api/auth/me", { token });
}

export function fetchTracks(params = null) {
  // Con params il backend filtra e pagina: React riceve solo le card da renderizzare.
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });
  }

  return apiRequest(`/api/tracks${query.toString() ? `?${query.toString()}` : ""}`);
}

export function fetchDiscoveryProviders() {
  return apiRequest("/api/discovery/providers");
}

export function searchDiscovery(token, { query, provider = "all", rightsMode = "commercial_ready", limit = 8 }) {
  const params = new URLSearchParams({
    q: query || "",
    provider,
    rights_mode: rightsMode,
    limit: String(limit),
  });

  return apiRequest(`/api/discovery/search?${params.toString()}`, { token });
}

export function importDiscoveryTrack(token, track) {
  return apiRequest("/api/discovery/import", {
    method: "POST",
    token,
    body: track,
  });
}

const bulkImportSizes = new Set([120, 250, 500]);

function volumeBody(volume) {
  const numeric = Number(volume);
  const normalized = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.75;
  return {
    volume: normalized,
    volumePercent: Math.round(normalized * 100),
  };
}

export function bulkImportDiscovery(token, options = {}) {
  const requestedMaxTracks = Number(options.maxTracks) || 120;
  const maxTracks = bulkImportSizes.has(requestedMaxTracks) ? requestedMaxTracks : 120;

  return apiRequest("/api/discovery/bulk-import", {
    method: "POST",
    token,
    body: {
      includeYouTubeChannels: true,
      limitPerQuery: 10,
      maxTracks,
      youtubeChannelMaxPages: 20,
      youtubeResume: true,
      youtubeRestartCompleted: true,
      youtubeScanMultiplier: 8,
      includeYouTubePlaylists: true,
      youtubePlaylistScanLimit: 30,
      youtubePlaylistItemsPerPlaylist: 80,
    },
  });
}

export function importDiscoveryLink(token, url) {
  return apiRequest("/api/discovery/import-link", {
    method: "POST",
    token,
    body: {
      url,
      maxTracks: 5000,
    },
  });
}

export function importSessionLink(token, url) {
  // Import temporaneo backend: legge video, playlist o canali YouTube senza salvarli nel catalogo.
  return apiRequest("/api/session/import-link", {
    method: "POST",
    token,
    body: {
      url,
      maxTracks: 5000,
    },
  });
}

export function fetchServerPlayerStatus(token) {
  return apiRequest("/api/server-player/status", { token });
}

export function playServerTrack(token, { track, startAt = 0, volume = 0.75, serverContext = null }) {
  // Player Raspberry: il browser invia solo comandi, l'audio viene emesso dal backend.
  return apiRequest("/api/server-player/play", {
    method: "POST",
    token,
    body: {
      track,
      trackId: track?.id,
      startAt,
      serverContext,
      ...volumeBody(volume),
    },
  });
}

export function pauseServerTrack(token, paused = true) {
  return apiRequest("/api/server-player/pause", {
    method: "POST",
    token,
    body: { paused },
  });
}

export function seekServerTrack(token, seconds) {
  return apiRequest("/api/server-player/seek", {
    method: "POST",
    token,
    body: { seconds },
  });
}

export function setServerTrackVolume(token, volume) {
  return apiRequest("/api/server-player/volume", {
    method: "POST",
    token,
    body: volumeBody(volume),
  });
}

export function setServerTrackContext(token, body = {}) {
  return apiRequest("/api/server-player/context", {
    method: "POST",
    token,
    body,
  });
}

export function stopServerTrack(token, body = null) {
  return apiRequest("/api/server-player/stop", {
    method: "POST",
    token,
    body,
  });
}

export function fetchAdminDiagnostics(token) {
  return apiRequest("/api/admin/diagnostics", { token });
}

export function checkSourceHealth(token) {
  return apiRequest("/api/admin/source-health", {
    method: "POST",
    token,
  });
}

export function fetchYouTubeFullAuditStatus(token) {
  return apiRequest("/api/admin/audio-check/youtube-full-audit", { token });
}

export function fetchYouTubeAudioResults(token, options = {}) {
  const params = new URLSearchParams();
  params.set("status", options.status || "failed");
  params.set("limit", String(options.limit || 80));
  params.set("offset", String(options.offset || 0));
  if (options.reason) {
    params.set("reason", options.reason);
  }
  return apiRequest(`/api/admin/audio-check/youtube-results?${params.toString()}`, { token });
}

export function recheckYouTubeLoginFailures(token) {
  return apiRequest("/api/admin/audio-check/youtube-login-recheck", {
    method: "POST",
    token,
  });
}

export function startYouTubeFullAudit(token, options = {}) {
  return apiRequest("/api/admin/audio-check/youtube-full-audit", {
    method: "POST",
    token,
    body: options,
  });
}

export function cleanupBrokenAudioTracks(token, options = {}) {
  return apiRequest("/api/admin/audio-check/cleanup-broken", {
    method: "POST",
    token,
    body: options,
  });
}

export function recheckArchivedAudioTracks(token, options = {}) {
  return apiRequest("/api/admin/audio-check/recheck-archived", {
    method: "POST",
    token,
    body: options,
  });
}

export function uploadYouTubeCookies(token, cookiesText) {
  return apiRequest("/api/admin/youtube-cookies", {
    method: "POST",
    token,
    body: { cookiesText },
  });
}

export function removeYouTubeCookies(token) {
  return apiRequest("/api/admin/youtube-cookies", {
    method: "DELETE",
    token,
  });
}

export function fetchYouTubeCookieStatus(token) {
  return apiRequest("/api/admin/youtube-cookies/status", { token });
}

export function probeYouTubeCookies(token) {
  return apiRequest("/api/admin/youtube-cookies/probe", {
    method: "POST",
    token,
  });
}

export function resetYouTubeImportState(token) {
  return apiRequest("/api/admin/youtube-import-state/reset", {
    method: "POST",
    token,
  });
}

export function exportCatalogBackup(token) {
  return downloadRequest("/api/admin/export/catalog.json", token, "clearwave-catalog-backup.json");
}

export function exportLicenseReport(token) {
  return downloadRequest("/api/admin/export/licenses.csv", token, "clearwave-license-report.csv");
}

export function exportLicenseReportHtml(token) {
  return downloadRequest("/api/admin/export/licenses.html", token, "clearwave-license-report.html");
}

export function importCatalogBackup(token, backupPayload) {
  return apiRequest("/api/admin/import/catalog-backup", {
    method: "POST",
    token,
    body: backupPayload,
  });
}

export function createTrack(token, trackPayload) {
  return apiRequest("/api/tracks", {
    method: "POST",
    token,
    body: trackPayload,
  });
}

export function fetchUsers(token) {
  return apiRequest("/api/users", { token });
}

export function createUser(token, user) {
  return apiRequest("/api/users", {
    method: "POST",
    token,
    body: user,
  });
}

export function deleteUser(token, username) {
  return apiRequest(`/api/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    token,
  });
}

export function resetUserPassword(token, username) {
  return apiRequest(`/api/users/${encodeURIComponent(username)}/reset-password`, {
    method: "POST",
    token,
  });
}

export function changePassword(token, passwordPayload) {
  return apiRequest("/api/auth/change-password", {
    method: "POST",
    token,
    body: passwordPayload,
  });
}
