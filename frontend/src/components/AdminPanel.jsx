import { useState } from "react";

function firstDiagnosticLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function commandSummary(result) {
  if (!result) {
    return "Non controllato";
  }

  if (result.ok) {
    return firstDiagnosticLine(result.stdout) || "OK";
  }

  return firstDiagnosticLine(result.stderr) || result.error || "Errore";
}

export function AdminPanel({
  users,
  currentUser,
  onCreateUser,
  onDeleteUser,
  onResetUserPassword,
  onResetYouTubeImportState,
  onLoadDiagnostics,
  status,
  statusType = "success",
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);
  const [deletingUsername, setDeletingUsername] = useState("");
  const [resettingUsername, setResettingUsername] = useState("");
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null);
  const [pendingYouTubeReset, setPendingYouTubeReset] = useState(false);
  const [resettingYouTubeState, setResettingYouTubeState] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState("");
  const [diagnosticsStatusType, setDiagnosticsStatusType] = useState("success");
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  async function handleCreate(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      return;
    }

    setBusy(true);
    try {
      const created = await onCreateUser({ name: cleanName, username: cleanName, role });
      if (created) {
        setName("");
        setRole("user");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(user) {
    if (user.username === currentUser?.username) {
      return;
    }

    setDeletingUsername(user.username);
    try {
      await onDeleteUser(user.username);
    } finally {
      setDeletingUsername("");
      setPendingDeleteUser(null);
    }
  }

  async function handleResetPassword(user) {
    if (user.username === currentUser?.username) {
      return;
    }

    setResettingUsername(user.username);
    try {
      await onResetUserPassword(user.username);
    } finally {
      setResettingUsername("");
    }
  }

  async function handleResetYouTubeState() {
    setResettingYouTubeState(true);
    try {
      await onResetYouTubeImportState();
      setPendingYouTubeReset(false);
    } catch {
      // Lo stato visibile viene gia' aggiornato da App.jsx con il messaggio backend.
    } finally {
      setResettingYouTubeState(false);
    }
  }

  async function handleLoadDiagnostics() {
    setLoadingDiagnostics(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Controllo diagnostica Raspberry in corso...");
    try {
      const payload = await onLoadDiagnostics();
      setDiagnostics(payload);
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus("Diagnostica aggiornata.");
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Diagnostica non riuscita.");
    } finally {
      setLoadingDiagnostics(false);
    }
  }

  const preflightResults = Array.isArray(diagnostics?.audioPreflight) ? diagnostics.audioPreflight : [];
  const diagnosticTools = diagnostics
    ? [
        ["mpv", diagnostics.tools?.mpv],
        ["yt-dlp", diagnostics.tools?.ytdlp],
        ["aplay -l", diagnostics.alsa?.listDevices],
      ]
    : [];

  return (
    <section className="panel admin-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Gestione utenti</h2>
          <p>La creazione utenti usa il database SQLite gia' presente nel backend.</p>
        </div>
      </div>

      <form className="admin-form" onSubmit={handleCreate}>
        <label>
          Nome utente
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="es. postazione-bar"
          />
        </label>
        <label>
          Ruolo
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="user">Utente normale</option>
            <option value="admin">Amministratore</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creo..." : "Crea utente"}
        </button>
      </form>

      {status ? <p className={`status-banner is-${statusType}`}>{status}</p> : null}

      <div className="user-list">
        {users.length === 0 ? <p className="empty-state">Nessun utente presente.</p> : null}
        {users.map((user) => (
          <article key={user.username}>
            <div>
              <strong>{user.name}</strong>
              <span>@{user.username}</span>
            </div>
            <div className="user-actions">
              <span className="role-pill">{user.role}</span>
              {user.mustChangePassword ? <span className="role-pill is-warning">temp</span> : null}
              <button
                type="button"
                className="secondary-button"
                disabled={user.username === currentUser?.username || resettingUsername === user.username}
                onClick={() => handleResetPassword(user)}
              >
                {resettingUsername === user.username ? "Reset..." : "Reset"}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={user.username === currentUser?.username || deletingUsername === user.username}
                onClick={() => setPendingDeleteUser(user)}
              >
                {deletingUsername === user.username ? "Elimino..." : "Elimina"}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="admin-maintenance-grid">
        <article className="admin-tool-card">
          <div>
            <p className="eyebrow">YouTube</p>
            <h3>Reset stato import</h3>
            <p>
              Azzera i cursori di scansione dei canali whitelist. Il backend crea prima un backup
              in `data`, poi il prossimo lotto riparte pulito.
            </p>
          </div>
          <button type="button" className="danger-button" onClick={() => setPendingYouTubeReset(true)}>
            Reset scan YouTube
          </button>
        </article>

        <article className="admin-tool-card diagnostic-card">
          <div className="diagnostic-head">
            <div>
              <p className="eyebrow">Raspberry</p>
              <h3>Diagnostica audio/server</h3>
              <p>Controlla mpv, yt-dlp, ALSA, configurazione player e ultimo errore noto.</p>
            </div>
            <button type="button" onClick={handleLoadDiagnostics} disabled={loadingDiagnostics}>
              {loadingDiagnostics ? "Controllo..." : "Aggiorna diagnostica"}
            </button>
          </div>

          {diagnosticsStatus ? (
            <p className={`status-banner is-${diagnosticsStatusType}`}>{diagnosticsStatus}</p>
          ) : null}

          {diagnostics ? (
            <div className="diagnostic-grid">
              <div>
                <span>Runtime</span>
                <strong>{diagnostics.runtime?.revision || "n/d"}</strong>
                <small>
                  {diagnostics.runtime?.platform}/{diagnostics.runtime?.arch} | Node {diagnostics.runtime?.node}
                </small>
              </div>
              <div>
                <span>Player</span>
                <strong>{diagnostics.player?.isPlaying ? "In riproduzione" : "Fermo"}</strong>
                <small>{diagnostics.player?.error || "Nessun errore attivo"}</small>
              </div>
              <div>
                <span>Output audio</span>
                <strong>{diagnostics.config?.audioOutput || "auto"}</strong>
                <small>
                  device {diagnostics.config?.audioDevice || "auto"} | card {diagnostics.config?.alsaCard || "auto"}
                </small>
              </div>
              <div>
                <span>Volume server</span>
                <strong>{diagnostics.player?.volume ?? 0}%</strong>
                <small>preflight {diagnostics.config?.audioPreflight ? "attivo" : "disattivo"}</small>
              </div>
            </div>
          ) : null}

          {diagnosticTools.length > 0 ? (
            <div className="diagnostic-list">
              {diagnosticTools.map(([label, result]) => (
                <div key={label}>
                  <span className={result?.ok ? "is-ok" : "is-error"}>{result?.ok ? "OK" : "WARN"}</span>
                  <strong>{label}</strong>
                  <small>{commandSummary(result)}</small>
                </div>
              ))}
            </div>
          ) : null}

          {preflightResults.length > 0 ? (
            <div className="diagnostic-list">
              {preflightResults.map((entry) => (
                <div key={entry.label}>
                  <span className={entry.ok ? "is-ok" : "is-error"}>{entry.ok ? "OK" : "NO"}</span>
                  <strong>{entry.label}</strong>
                  <small>{entry.message || entry.args?.join(" ") || "Device apribile"}</small>
                </div>
              ))}
            </div>
          ) : null}

          {diagnostics?.alsa?.cards ? (
            <pre className="diagnostic-output">{diagnostics.alsa.cards}</pre>
          ) : null}
        </article>
      </div>

      {pendingDeleteUser ? (
        <div className="app-modal-backdrop" role="presentation" onClick={() => setPendingDeleteUser(null)}>
          <section
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Conferma</p>
            <h3 id="delete-user-title">Eliminare utente?</h3>
            <p>
              Stai per eliminare <strong>{pendingDeleteUser.name}</strong> (@{pendingDeleteUser.username}).
              L'utente non potra' piu' accedere con questa sessione.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingDeleteUser(null)}>
                Annulla
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deletingUsername === pendingDeleteUser.username}
                onClick={() => handleDelete(pendingDeleteUser)}
              >
                {deletingUsername === pendingDeleteUser.username ? "Elimino..." : "Elimina utente"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingYouTubeReset ? (
        <div className="app-modal-backdrop" role="presentation" onClick={() => setPendingYouTubeReset(false)}>
          <section
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-youtube-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Manutenzione</p>
            <h3 id="reset-youtube-title">Resettare scan YouTube?</h3>
            <p>
              Il catalogo non viene cancellato. Verranno azzerati solo i cursori di import,
              cosi' il prossimo lotto rilegge i canali whitelist dall'inizio.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingYouTubeReset(false)}>
                Annulla
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={resettingYouTubeState}
                onClick={handleResetYouTubeState}
              >
                {resettingYouTubeState ? "Reset..." : "Reset scan"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
