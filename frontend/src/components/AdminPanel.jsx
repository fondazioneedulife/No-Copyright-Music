import { useEffect, useState } from "react";
import { AdminDiagnosticsPanel } from "./AdminDiagnosticsPanel.jsx";
import {
  auditRefreshMs,
  diagnosticsRefreshMs,
  refreshClockLabel,
} from "./adminDiagnostics";

export function AdminPanel({
  users,
  currentUser,
  onCreateUser,
  onDeleteUser,
  onResetUserPassword,
  onResetYouTubeImportState,
  onLoadDiagnostics,
  onLoadYouTubeAudioResults,
  onLoadYouTubeAuditStatus,
  onCheckSourceHealth,
  onRecheckYouTubeLoginFailures,
  onStartYouTubeFullAudit,
  onUploadYouTubeCookies,
  onProbeYouTubeCookies,
  onCleanupBrokenAudioTracks,
  onRecheckArchivedAudioTracks,
  onExportCatalogBackup,
  onExportLicenseReport,
  onExportLicenseReportHtml,
  onImportCatalogBackup,
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
  const [youtubeResults, setYoutubeResults] = useState(null);
  const [youtubeResultsFilter, setYoutubeResultsFilter] = useState("failed");
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [loadingYouTubeResults, setLoadingYouTubeResults] = useState(false);
  const [checkingSourceHealth, setCheckingSourceHealth] = useState(false);
  const [recheckingYouTubeLogin, setRecheckingYouTubeLogin] = useState(false);
  const [startingYouTubeFullAudit, setStartingYouTubeFullAudit] = useState(false);
  const [uploadingYouTubeCookies, setUploadingYouTubeCookies] = useState(false);
  const [probingYouTubeCookies, setProbingYouTubeCookies] = useState(false);
  const [cleaningBrokenTracks, setCleaningBrokenTracks] = useState(false);
  const [recheckingArchivedTracks, setRecheckingArchivedTracks] = useState(false);
  const [pendingCleanupBroken, setPendingCleanupBroken] = useState(false);
  const [exporting, setExporting] = useState("");
  const [importingBackup, setImportingBackup] = useState(false);
  const [autoRefreshAt, setAutoRefreshAt] = useState("");

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
      setAutoRefreshAt(refreshClockLabel());
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus("Diagnostica aggiornata.");
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Diagnostica non riuscita.");
    } finally {
      setLoadingDiagnostics(false);
    }
  }

  async function handleLoadYouTubeResults(nextFilter = youtubeResultsFilter) {
    if (!onLoadYouTubeAudioResults) {
      return;
    }

    setYoutubeResultsFilter(nextFilter);
    setLoadingYouTubeResults(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Carico esiti ultimo report YouTube...");
    try {
      const payload = await onLoadYouTubeAudioResults({ status: nextFilter, limit: 80 });
      setYoutubeResults(payload.results || null);
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus(
        payload.results?.ok
          ? `Esiti YouTube caricati: ${payload.results.totalFiltered || 0} tracce.`
          : "Nessun report YouTube trovato: avvia prima Verifica tutto YouTube."
      );
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Esiti YouTube non disponibili.");
    } finally {
      setLoadingYouTubeResults(false);
    }
  }

  async function handleCheckSourceHealth() {
    if (!onCheckSourceHealth) {
      return;
    }

    setCheckingSourceHealth(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Test sorgenti YouTube/Jamendo in corso...");
    try {
      const payload = await onCheckSourceHealth();
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }
      setDiagnosticsStatusType(payload.sourceHealth?.ok ? "success" : "error");
      setDiagnosticsStatus(payload.sourceHealth?.summary || "Test sorgenti completato.");
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Test sorgenti non riuscito.");
    } finally {
      setCheckingSourceHealth(false);
    }
  }

  async function handleRecheckYouTubeLoginFailures() {
    if (!onRecheckYouTubeLoginFailures) {
      return;
    }

    setRecheckingYouTubeLogin(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Ricontrollo tracce YouTube con errore login in corso...");
    try {
      const payload = await onRecheckYouTubeLoginFailures();
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus(payload.message || "Ricontrollo completato.");
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Ricontrollo non riuscito.");
    } finally {
      setRecheckingYouTubeLogin(false);
    }
  }

  async function handleStartYouTubeFullAudit() {
    if (!onStartYouTubeFullAudit) {
      return;
    }

    setStartingYouTubeFullAudit(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Verifica completa YouTube avviata in background...");
    try {
      const payload = await onStartYouTubeFullAudit();
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus(payload.message || "Verifica completa YouTube avviata.");
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Verifica completa YouTube non riuscita.");
    } finally {
      setStartingYouTubeFullAudit(false);
    }
  }

  async function handleUploadYouTubeCookiesFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUploadYouTubeCookies) {
      return;
    }

    setUploadingYouTubeCookies(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Installazione cookie YouTube in corso...");
    try {
      const payload = await onUploadYouTubeCookies(await file.text());
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus(payload.message || "Cookie YouTube installati.");
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Cookie YouTube non validi.");
    } finally {
      setUploadingYouTubeCookies(false);
    }
  }

  async function handleProbeYouTubeCookies() {
    if (!onProbeYouTubeCookies) {
      return;
    }

    setProbingYouTubeCookies(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Test cookie YouTube dal Raspberry in corso...");
    try {
      const payload = await onProbeYouTubeCookies();
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }
      setDiagnosticsStatusType(payload.ok ? "success" : "error");
      setDiagnosticsStatus(
        payload.authorization?.label
          ? `${payload.authorization.label}: ${payload.message || "Test cookie YouTube completato."}`
          : payload.message || "Test cookie YouTube completato."
      );
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Test cookie YouTube non riuscito.");
    } finally {
      setProbingYouTubeCookies(false);
    }
  }

  async function handleCleanupBrokenAudioTracks() {
    if (!onCleanupBrokenAudioTracks) {
      return;
    }

    setCleaningBrokenTracks(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Quarantena tracce YouTube non disponibili in corso...");
    try {
      const payload = await onCleanupBrokenAudioTracks();
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus(
        `${payload.message || "Quarantena catalogo completata."}${payload.backupFile ? ` Backup: ${payload.backupFile}.` : ""}`
      );
      setPendingCleanupBroken(false);
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Quarantena catalogo non riuscita.");
    } finally {
      setCleaningBrokenTracks(false);
    }
  }

  async function handleRecheckArchivedAudioTracks() {
    if (!onRecheckArchivedAudioTracks) {
      return;
    }

    setRecheckingArchivedTracks(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Riverifica tracce archiviate con i cookie attuali in corso...");
    try {
      const payload = await onRecheckArchivedAudioTracks();
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus(
        `${payload.message || "Riverifica archiviate completata."}${payload.backupFile ? ` Backup: ${payload.backupFile}.` : ""}`
      );
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Riverifica archiviate non riuscita.");
    } finally {
      setRecheckingArchivedTracks(false);
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
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Backup catalogo non leggibile.");
    } finally {
      setImportingBackup(false);
    }
  }

  // Quando un controllo lungo e' attivo, la diagnostica si aggiorna da sola senza premere il pulsante.
  useEffect(() => {
    const auditRunning = Boolean(diagnostics?.youtubeAudit?.running);
    const catalogCheckRunning = Boolean(diagnostics?.audioCheck?.running);
    if (!auditRunning && !catalogCheckRunning) {
      return undefined;
    }

    let cancelled = false;
    let auditBusy = false;
    let diagnosticsBusy = false;

    async function refreshAuditStatus() {
      if (!auditRunning || !onLoadYouTubeAuditStatus || auditBusy) {
        return;
      }

      auditBusy = true;
      try {
        const payload = await onLoadYouTubeAuditStatus();
        if (cancelled) {
          return;
        }

        setDiagnostics((current) =>
          current
            ? {
                ...current,
                youtubeAudit: payload.audit || current.youtubeAudit,
                replacementList: payload.replacementList || current.replacementList,
              }
            : current
        );
        setAutoRefreshAt(refreshClockLabel());
      } catch {
        // Il refresh quieto non deve interrompere un audit lungo solo per un giro rete fallito.
      } finally {
        auditBusy = false;
      }
    }

    async function refreshFullDiagnostics() {
      if (!onLoadDiagnostics || diagnosticsBusy) {
        return;
      }

      diagnosticsBusy = true;
      try {
        const payload = await onLoadDiagnostics();
        if (!cancelled && payload) {
          setDiagnostics(payload);
          setAutoRefreshAt(refreshClockLabel());
        }
      } catch {
        // Anche la diagnostica completa puo' saltare un giro se mpv/ALSA rispondono lentamente.
      } finally {
        diagnosticsBusy = false;
      }
    }

    void refreshAuditStatus();
    if (catalogCheckRunning) {
      void refreshFullDiagnostics();
    }

    const auditTimerId = auditRunning ? window.setInterval(refreshAuditStatus, auditRefreshMs) : 0;
    const diagnosticsTimerId = window.setInterval(refreshFullDiagnostics, diagnosticsRefreshMs);

    return () => {
      cancelled = true;
      if (auditTimerId) {
        window.clearInterval(auditTimerId);
      }
      window.clearInterval(diagnosticsTimerId);
    };
  }, [
    diagnostics?.youtubeAudit?.running,
    diagnostics?.audioCheck?.running,
    onLoadYouTubeAuditStatus,
    onLoadDiagnostics,
  ]);

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

        <AdminDiagnosticsPanel
          diagnostics={diagnostics}
          diagnosticsStatus={diagnosticsStatus}
          diagnosticsStatusType={diagnosticsStatusType}
          autoRefreshAt={autoRefreshAt}
          loadingDiagnostics={loadingDiagnostics}
          loadingYouTubeResults={loadingYouTubeResults}
          checkingSourceHealth={checkingSourceHealth}
          probingYouTubeCookies={probingYouTubeCookies}
          recheckingYouTubeLogin={recheckingYouTubeLogin}
          recheckingArchivedTracks={recheckingArchivedTracks}
          startingYouTubeFullAudit={startingYouTubeFullAudit}
          uploadingYouTubeCookies={uploadingYouTubeCookies}
          cleaningBrokenTracks={cleaningBrokenTracks}
          youtubeResults={youtubeResults}
          youtubeResultsFilter={youtubeResultsFilter}
          onLoadDiagnostics={handleLoadDiagnostics}
          onLoadYouTubeResults={handleLoadYouTubeResults}
          onCheckSourceHealth={handleCheckSourceHealth}
          onProbeYouTubeCookies={handleProbeYouTubeCookies}
          onRecheckYouTubeLoginFailures={handleRecheckYouTubeLoginFailures}
          onRecheckArchivedAudioTracks={handleRecheckArchivedAudioTracks}
          onStartYouTubeFullAudit={handleStartYouTubeFullAudit}
          onUploadYouTubeCookiesFile={handleUploadYouTubeCookiesFile}
          onRequestCleanupBroken={() => setPendingCleanupBroken(true)}
        />
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

      {pendingCleanupBroken ? (
        <div className="app-modal-backdrop" role="presentation" onClick={() => setPendingCleanupBroken(false)}>
          <section
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cleanup-broken-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Catalogo</p>
            <h3 id="cleanup-broken-title">Archiviare tracce non disponibili?</h3>
            <p>
              Verranno archiviate <strong>{hardBrokenItems.length}</strong> tracce confermate rotte dal report audio.
              Non saranno cancellate: resteranno in `library.json` con motivo errore e backup in `data`.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingCleanupBroken(false)}>
                Annulla
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={cleaningBrokenTracks}
                onClick={handleCleanupBrokenAudioTracks}
              >
                {cleaningBrokenTracks ? "Archivio..." : "Archivia tracce"}
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
