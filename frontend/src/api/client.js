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

export function fetchTracks() {
  // Catalogo gia' normalizzato dal backend con previewPath, coverPath e campi calcolati.
  return apiRequest("/api/tracks");
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

export function bulkImportDiscovery(token) {
  return apiRequest("/api/discovery/bulk-import", {
    method: "POST",
    token,
    body: {
      includeYouTubeChannels: true,
      limitPerQuery: 8,
      maxTracks: 80,
      youtubeChannelMaxPages: 2,
      youtubeResume: true,
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
