import { useEffect, useState } from "react";

export function AdminPanel({
  users,
  currentUser,
  onCreateUser,
  onDeleteUser,
  onResetUserPassword,
  onResetYouTubeImportState,
  onExportCatalogBackup,
  onExportLicenseReport,
  onExportLicenseReportHtml,
  onImportCatalogBackup,
  activeSection,
  status,
  statusType = "success",
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [adminView, setAdminView] = useState("users");
  const [busy, setBusy] = useState(false);
  const [deletingUsername, setDeletingUsername] = useState("");
  const [resettingUsername, setResettingUsername] = useState("");
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null);
  const [pendingYouTubeReset, setPendingYouTubeReset] = useState(false);
  const [resettingYouTubeState, setResettingYouTubeState] = useState(false);
  const [exporting, setExporting] = useState("");
  const [importingBackup, setImportingBackup] = useState(false);

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

  async function handleExport(type, action) {
    setExporting(type);
    try {
      await action();
    } finally {
      setExporting("");
    }
  }

  async function handleImportBackupFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onImportCatalogBackup) {
      return;
    }

    setImportingBackup(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await onImportCatalogBackup(parsed);
    } catch (error) {
      // Ignore error for now, should bubble up or be handled by the context
    } finally {
      setImportingBackup(false);
    }
  }

  useEffect(() => {
    if (activeSection === "settings") {
      setAdminView("users");
    }
  }, [activeSection]);

  return (
    <section className="panel admin-panel" id="admin">
      <div className="section-heading admin-page-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Centro controllo</h2>
          <p>Gestione utenti e manutenzione del catalogo.</p>
        </div>
        <div className="admin-view-tabs" role="tablist" aria-label="Sezioni amministrazione">
          {[
            ["users", "Utenti"],
            ["maintenance", "Manutenzione"],
          ].map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={adminView === view}
              className={adminView === view ? "is-active" : "secondary-button"}
              onClick={() => setAdminView(view)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {status ? (
        <p className={`status-banner is-${statusType}`}>{status}</p>
      ) : null}

      {adminView === "users" ? (
        <div className="admin-page-panel">
          <div>
            <p className="eyebrow">Utenti</p>
            <h3>Gestione account</h3>
            <p>La creazione utenti usa il database SQLite gia' presente nel backend.</p>
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
        </div>
      ) : null}

      {adminView === "maintenance" ? (
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

          <article className="admin-tool-card">
            <div>
              <p className="eyebrow">Backup</p>
              <h3>Export catalogo e licenze</h3>
              <p>
                Scarica JSON, CSV o report HTML. Il ripristino da JSON salva prima una copia
                automatica del catalogo corrente.
              </p>
            </div>
            <div className="admin-tool-actions">
              <button
                type="button"
                onClick={() => handleExport("catalog", onExportCatalogBackup)}
                disabled={exporting === "catalog"}
              >
                {exporting === "catalog" ? "Esporto..." : "Backup catalogo"}
              </button>
              <button
                type="button"
                onClick={() => handleExport("licenses", onExportLicenseReport)}
                disabled={exporting === "licenses"}
              >
                {exporting === "licenses" ? "Esporto..." : "Report licenze"}
              </button>
              <button
                type="button"
                onClick={() => handleExport("licenses-html", onExportLicenseReportHtml)}
                disabled={exporting === "licenses-html"}
              >
                {exporting === "licenses-html" ? "Esporto..." : "Report HTML"}
              </button>
              <label className={`file-button ${importingBackup ? "is-disabled" : ""}`}>
                {importingBackup ? "Importo..." : "Importa backup"}
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={importingBackup}
                  onChange={handleImportBackupFile}
                />
              </label>
            </div>
          </article>
        </div>
      ) : null}

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

