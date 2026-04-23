function currentAccount() {
  // Account UI attivo: preferisce quello selezionato, poi admin, poi fallback iniziale.
  return (
    state.accounts.find((account) => account.id === state.currentAccountId) ||
    state.accounts.find((account) => account.id === "admin") ||
    defaultState.accounts[0]
  );
}

function isAdmin() {
  return currentAccount().role === "admin";
}

function authHeaders(headers = {}) {
  const account = currentAccount();
  const nextHeaders = {
    ...headers,
    "X-ClearWave-Account": account.id,
    "X-ClearWave-Role": account.role,
  };

  if (authToken) {
    nextHeaders.Authorization = `Bearer ${authToken}`;
  }

  return nextHeaders;
}

function applyTheme() {
  document.body.dataset.theme = state.uiTheme === "light" ? "light" : "dark";
  if (dom.themeToggleButton) {
    dom.themeToggleButton.textContent = state.uiTheme === "light" ? "Dark mode" : "Light mode";
    dom.themeToggleButton.setAttribute(
      "aria-label",
      state.uiTheme === "light" ? "Attiva dark mode" : "Attiva light mode"
    );
  }
}

function syncAccountFromAuthUser(user) {
  if (!user) {
    authenticatedUser = null;
    return;
  }

  authenticatedUser = user;
  const nextAccount = {
    id: user.username || user.id,
    name: user.name || user.username,
    role: user.role === "admin" ? "admin" : "user",
  };
  state.accounts = normalizeAccounts([...state.accounts, nextAccount]);
  state.currentAccountId = nextAccount.id;
  saveState();
}

function showAuthGate(message = "") {
  if (!dom.authGate) {
    return;
  }

  dom.authGate.hidden = false;
  if (message) {
    setStatus(dom.authStatus, message, "error");
  }
  window.setTimeout(() => dom.loginUsername?.focus(), 50);
}

function hideAuthGate() {
  if (dom.authGate) {
    dom.authGate.hidden = true;
  }
  setStatus(dom.authStatus, "");
}

async function verifyAuthSession() {
  if (!authToken) {
    showAuthGate("Accedi per usare ClearWave Library.");
    return null;
  }

  try {
    const response = await fetch("/api/auth/me", {
      headers: authHeaders(),
    });
    const payload = await response.json();
    if (!response.ok || !payload.user) {
      throw new Error(payload.error || "Sessione non valida.");
    }

    syncAccountFromAuthUser(payload.user);
    if (payload.user.role === "admin") {
      await refreshAuthUsers();
    }
    hideAuthGate();
    renderAll();
    return payload.user;
  } catch {
    authToken = "";
    window.localStorage.removeItem(authTokenStorageKey);
    showAuthGate("Sessione scaduta: accedi di nuovo.");
    return null;
  }
}

async function refreshAuthUsers() {
  if (!authToken || authenticatedUser?.role !== "admin") {
    return;
  }

  try {
    const response = await fetch("/api/users", {
      headers: authHeaders(),
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.users)) {
      return;
    }

    state.accounts = normalizeAccounts(
      payload.users.map((user) => ({
        id: user.username,
        name: user.name,
        role: user.role,
      }))
    );
    if (!state.accounts.some((account) => account.id === state.currentAccountId)) {
      state.currentAccountId = authenticatedUser.username;
    }
    saveState();
  } catch {
    // La lista utenti non deve bloccare l'accesso alla libreria.
  }
}

async function loginUser() {
  const username = dom.loginUsername?.value.trim() || "";
  const password = dom.loginPassword?.value || "";
  if (!username || !password) {
    setStatus(dom.authStatus, "Inserisci username e password.", "error");
    return;
  }

  setStatus(dom.authStatus, "Accesso in corso...");
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Credenziali non valide.");
    }

    authToken = payload.token;
    window.localStorage.setItem(authTokenStorageKey, authToken);
    syncAccountFromAuthUser(payload.user);
    if (payload.user.role === "admin") {
      await refreshAuthUsers();
    }
    if (dom.loginPassword) {
      dom.loginPassword.value = "";
    }
    hideAuthGate();
    renderAll();
    await fetchLibrary({ quiet: true });
    await fetchDiscoveryProviders();
    if (payload.user?.mustChangePassword) {
      document.querySelector("#impostazioni")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus(
        dom.passwordStatus,
        "Stai usando una password temporanea: cambiala da qui.",
        "error"
      );
    }
  } catch (error) {
    setStatus(dom.authStatus, error.message || "Accesso non riuscito.", "error");
  }
}

async function logoutUser() {
  if (authToken) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: authHeaders(),
      });
    } catch {
      // Il logout locale deve riuscire anche se il server non risponde.
    }
  }

  authToken = "";
  authenticatedUser = null;
  window.localStorage.removeItem(authTokenStorageKey);
  showAuthGate("Logout eseguito.");
  renderAccountPanel();
}

async function changeOwnPassword() {
  const currentPassword = dom.currentPasswordInput?.value || "";
  const newPassword = dom.newPasswordInput?.value || "";
  if (!currentPassword || !newPassword) {
    setStatus(dom.passwordStatus, "Inserisci password attuale e nuova password.", "error");
    return;
  }

  try {
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Cambio password non riuscito.");
    }

    syncAccountFromAuthUser(payload.user);
    dom.currentPasswordInput.value = "";
    dom.newPasswordInput.value = "";
    renderAll();
    setStatus(dom.passwordStatus, "Password aggiornata correttamente.", "success");
  } catch (error) {
    setStatus(dom.passwordStatus, error.message || "Cambio password non riuscito.", "error");
  }
}

function renderAdminSettings() {
  if (!dom.accountsList) {
    return;
  }

  const admin = isAdmin();
  if (dom.settingsPanel) {
    dom.settingsPanel.hidden = !admin;
  }

  if (!admin) {
    dom.accountsList.innerHTML = `
      <p class="selection-empty">
        Le impostazioni utenti sono disponibili solo con un account amministratore.
      </p>
    `;
    setStatus(dom.settingsStatus, "Passa a un account admin per gestire gli utenti.", "error");
    return;
  }

  setStatus(dom.settingsStatus, "");
  dom.accountsList.innerHTML = state.accounts
    .map((account) => {
      const active = account.id === state.currentAccountId;
      const primaryAdmin = account.id === "admin";
      return `
        <article class="account-row ${active ? "is-active" : ""}">
          <div class="account-row-main">
            <span class="account-avatar">${escapeHtml(account.name.slice(0, 2).toUpperCase())}</span>
            <div>
              <strong>${escapeHtml(account.name)}</strong>
              <span>${account.role === "admin" ? "Amministratore" : "Utente normale"}${active ? " | attivo" : ""}</span>
            </div>
          </div>
          <div class="account-row-actions">
            <button class="button button-secondary" data-action="switch-account" data-id="${escapeHtml(account.id)}" type="button" ${active ? "disabled" : ""}>
              Usa
            </button>
            <button class="button button-danger" data-action="remove-account" data-id="${escapeHtml(account.id)}" type="button" ${primaryAdmin ? "disabled" : ""}>
              Rimuovi
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAccountPanel() {
  if (!dom.accountSelect) {
    applyTheme();
    return;
  }

  const account = currentAccount();
  const admin = isAdmin();
  document.body.classList.toggle("is-admin", admin);
  document.body.classList.toggle("is-user", !admin);
  applyTheme();

  dom.accountSelect.innerHTML = state.accounts
    .map(
      (entry) => `
        <option value="${escapeHtml(entry.id)}">
          ${escapeHtml(entry.name)} - ${entry.role === "admin" ? "Admin" : "Utente"}
        </option>
      `
    )
    .join("");
  dom.accountSelect.value = account.id;

  if (dom.currentRoleBadge) {
    dom.currentRoleBadge.textContent = admin ? "Admin: accesso completo" : "Utente: solo libreria";
  }

  if (dom.createAccountButton) {
    dom.createAccountButton.disabled = !admin;
  }
  if (dom.removeAccountButton) {
    dom.removeAccountButton.disabled = !admin || account.id === "admin";
  }
  if (dom.accountNameInput) {
    dom.accountNameInput.disabled = !admin;
  }
  if (dom.accountRoleSelect) {
    dom.accountRoleSelect.disabled = !admin;
  }

  if (!admin) {
    setStatus(
      dom.accountStatus,
      "Utente normale: puoi ascoltare, mettere in shortlist, preferiti e coda solo i brani gia' presenti.",
      "success"
    );
  } else {
    setStatus(
      dom.accountStatus,
      "Amministratore: puoi importare, aggiungere, rimuovere brani e creare altri utenti.",
      "success"
    );
  }

  renderAdminSettings();
}

function requireAdminAction(statusElement, message = "Solo l'amministratore puo' usare questa funzione.") {
  if (isAdmin()) {
    return true;
  }

  setStatus(statusElement || dom.accountStatus, message, "error");
  return false;
}

function switchAccount(accountId) {
  const targetAccount = state.accounts.find((account) => account.id === accountId);
  if (!targetAccount) {
    renderAccountPanel();
    return;
  }

  if (authenticatedUser && authenticatedUser.role !== "admin" && targetAccount.id !== authenticatedUser.username) {
    renderAccountPanel();
    setStatus(dom.accountStatus, "Per cambiare account devi fare logout e accedere con altre credenziali.", "error");
    return;
  }

  if (authenticatedUser && targetAccount.role === "admin" && authenticatedUser.role !== "admin") {
    renderAccountPanel();
    setStatus(dom.accountStatus, "Accesso admin richiesto.", "error");
    return;
  }

  if (!isAdmin() && targetAccount.role === "admin") {
    const code = window.prompt("Codice amministratore locale");
    if (code !== state.adminAccessCode) {
      renderAccountPanel();
      setStatus(dom.accountStatus, "Codice amministratore non valido.", "error");
      return;
    }
  }

  state.currentAccountId = accountId;
  if (!isAdmin() && state.activePlaylistId === "session-user") {
    state.activePlaylistId = "real-songs";
  }

  saveState();
  renderAll();
}

async function createAccount() {
  const statusElement = dom.settingsStatus || dom.accountStatus;
  if (!requireAdminAction(statusElement)) {
    return;
  }

  const name = dom.accountNameInput?.value.trim() || "";
  if (!name) {
    setStatus(statusElement, "Scrivi un nome utente o postazione da creare.", "error");
    return;
  }

  const id = slugifyClient(name);
  if (state.accounts.some((account) => account.id === id)) {
    setStatus(statusElement, "Questo utente esiste gia'.", "error");
    return;
  }

  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name,
        username: id,
        role: dom.accountRoleSelect?.value === "admin" ? "admin" : "user",
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Creazione utente non riuscita.");
    }

    state.accounts = normalizeAccounts([
      ...state.accounts,
      {
        id: payload.user.username,
        name: payload.user.name,
        role: payload.user.role,
      },
    ]);
    if (dom.accountNameInput) {
      dom.accountNameInput.value = "";
    }
    await refreshAuthUsers();
    saveState();
    renderAll();
    setStatus(
      statusElement,
      `Utente ${payload.user.username} creato. Password temporanea: ${payload.tempPassword}`,
      "success"
    );
  } catch (error) {
    setStatus(statusElement, error.message || "Creazione utente non riuscita.", "error");
  }
}

function removeAccountById(accountId) {
  const statusElement = dom.settingsStatus || dom.accountStatus;
  if (!requireAdminAction(statusElement)) {
    return;
  }

  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    setStatus(statusElement, "Utente non trovato.", "error");
    return;
  }

  if (account.id === "admin") {
    setStatus(statusElement, "L'account amministratore principale non si puo' eliminare.", "error");
    return;
  }

  state.accounts = normalizeAccounts(state.accounts.filter((entry) => entry.id !== account.id));
  if (state.currentAccountId === account.id) {
    state.currentAccountId = "admin";
  }
  saveState();
  renderAll();
  setStatus(statusElement, `Utente ${account.name} rimosso.`, "success");
}

function removeCurrentAccount() {
  removeAccountById(currentAccount().id);
}

function toggleTheme() {
  state.uiTheme = state.uiTheme === "light" ? "dark" : "light";
  saveState();
  applyTheme();
}
