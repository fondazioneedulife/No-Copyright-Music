const tokenStorageKey = "clearwave-auth-token";

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
    throw new Error("Backend locale non raggiungibile. Avvia il server con npm start.");
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
          ? "Backend locale non raggiungibile. Avvia il server con npm start."
          : "Richiesta non riuscita.")
    );
  }

  return payload;
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

export function playServerTrack(token, { track, startAt = 0, volume = 0.75 }) {
  // Player Raspberry: il browser invia solo comandi, l'audio viene emesso dal backend.
  return apiRequest("/api/server-player/play", {
    method: "POST",
    token,
    body: {
      track,
      trackId: track?.id,
      startAt,
      volume,
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
    body: { volume },
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

export function resetYouTubeImportState(token) {
  return apiRequest("/api/admin/youtube-import-state/reset", {
    method: "POST",
    token,
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
