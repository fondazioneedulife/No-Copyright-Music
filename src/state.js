function normalizeAccounts(accounts) {
  const fallbackAccounts = defaultState.accounts;
  const incoming = Array.isArray(accounts) ? accounts : [];
  const normalized = incoming
    .map((account) => ({
      id: accountIdFromText(account?.id || account?.name || ""),
      name: String(account?.name || account?.id || "").trim(),
      role: account?.role === "admin" ? "admin" : "user",
    }))
    .filter((account) => account.id && account.name);
  const byId = new Map([...fallbackAccounts, ...normalized].map((account) => [account.id, account]));

  return [...byId.values()].sort((left, right) => {
    if (left.id === "admin") {
      return -1;
    }
    if (right.id === "admin") {
      return 1;
    }

    return left.name.localeCompare(right.name, "it");
  });
}

function accountIdFromText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function loadState() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (!saved) {
      return {
        ...defaultState,
        accounts: normalizeAccounts(defaultState.accounts),
      };
    }

    const loadedState = {
      ...defaultState,
      ...saved,
      selectedIds: Array.isArray(saved.selectedIds) ? saved.selectedIds : [],
      favoriteIds: Array.isArray(saved.favoriteIds) ? saved.favoriteIds : [],
      queueIds: Array.isArray(saved.queueIds) ? saved.queueIds : [],
      source: ["all", "youtube", "jamendo", "session"].includes(saved.source)
        ? saved.source
        : defaultState.source,
      catalogPage:
        Number.isInteger(saved.catalogPage) && saved.catalogPage > 0
          ? saved.catalogPage
          : defaultState.catalogPage,
      accounts: normalizeAccounts(saved.accounts),
      uiTheme: saved.uiTheme === "light" ? "light" : "dark",
      adminAccessCode:
        typeof saved.adminAccessCode === "string" && saved.adminAccessCode.trim()
          ? saved.adminAccessCode
          : defaultState.adminAccessCode,
      playerVolume:
        typeof saved.playerVolume === "number" && saved.playerVolume >= 0 && saved.playerVolume <= 1
          ? saved.playerVolume
          : defaultState.playerVolume,
      shuffleEnabled: Boolean(saved.shuffleEnabled),
      repeatMode: ["off", "all", "one"].includes(saved.repeatMode)
        ? saved.repeatMode
        : defaultState.repeatMode,
    };

    if (!loadedState.accounts.some((account) => account.id === loadedState.currentAccountId)) {
      loadedState.currentAccountId = "admin";
    }

    if (!saved.activePlaylistId || saved.activePlaylistId === "all-library") {
      loadedState.activePlaylistId = "real-songs";
    }

    loadedState.mood = "all";
    loadedState.license = "all";
    loadedState.useCase = "all";
    loadedState.attributionOnly = false;
    return loadedState;
  } catch {
    return {
      ...defaultState,
      accounts: normalizeAccounts(defaultState.accounts),
    };
  }
}

function saveState() {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}
