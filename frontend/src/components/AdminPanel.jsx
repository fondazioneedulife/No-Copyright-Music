import { useEffect, useState } from "react";

const hardBrokenReasons = new Set([
  "youtube-unavailable",
  "youtube-format",
  "stream-not-playable",
  "missing-source",
  "missing-file",
  "not-found",
  "forbidden",
]);
const auditRefreshMs = 3000;
const diagnosticsRefreshMs = 15000;
const diagnosticReasonInfo = {
  ok: {
    label: "OK",
    detail: "La traccia e' stata aperta correttamente durante il controllo.",
  },
  timeout: {
    label: "Timeout",
    detail:
      "YouTube, rete o Raspberry non hanno risposto in tempo. Non e' definitivo: se sono tanti, riprova con meno concorrenza o rete piu' libera.",
  },
  "youtube-unavailable": {
    label: "YouTube non disponibile",
    detail:
      "Il video risulta rimosso, privato, bloccato o non piu' leggibile da yt-dlp. Se resta cosi' in piu' report, e' candidato ad archiviazione.",
  },
  "youtube-age-or-login": {
    label: "Login/eta YouTube",
    detail:
      "YouTube richiede cookie validi, conferma account o controllo anti-bot. Prima prova Test cookie YouTube, poi rilancia il check.",
  },
  "youtube-error": {
    label: "Errore YouTube",
    detail:
      "yt-dlp e' uscito con errore generico. Da ora il log mostra anche il messaggio breve per capire se e' login, rete o video non valido.",
  },
  "youtube-expired-url": {
    label: "URL YouTube temporaneo",
    detail:
      "La traccia contiene solo un link googlevideo scadibile. Va reimportato il video YouTube originale o aggiunto lo youtubeVideoId.",
  },
  "youtube-stream-open-failed": {
    label: "Stream YouTube non aperto",
    detail:
      "yt-dlp ha risolto il video, ma mpv non ha aperto lo stream googlevideo firmato. Riprova e controlla cookie/account se succede spesso.",
  },
  "exit-1": {
    label: "Exit 1",
    detail:
      "Motivo generico dei report vecchi. Nei nuovi check viene trasformato in Errore YouTube quando riguarda un video YouTube.",
  },
};
const diagnosticReasonOrder = [
  "ok",
  "timeout",
  "youtube-unavailable",
  "youtube-age-or-login",
  "youtube-error",
  "youtube-expired-url",
  "youtube-stream-open-failed",
  "exit-1",
];

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

function audioCheckSummary(audioCheck) {
  if (!audioCheck?.enabled) {
    return "Disattivato";
  }
  if (audioCheck.running) {
    return "In corso";
  }

  const ok = audioCheck.lastSummary?.ok;
  const failed = audioCheck.lastSummary?.failed;
  if (Number.isFinite(ok) || Number.isFinite(failed)) {
    return `OK ${ok ?? 0} / KO ${failed ?? 0}`;
  }

  return audioCheck.lastStartedAt ? "Ultimo report non letto" : "In attesa del primo giro";
}

function audioCheckHealthOk(audioCheck) {
  if (!audioCheck?.enabled || audioCheck.running) {
    return true;
  }

  const neverStarted = !audioCheck.lastStartedAt && audioCheck.lastExitCode === null && !audioCheck.lastError;
  if (neverStarted) {
    return true;
  }

  return !audioCheck.lastError && audioCheck.lastExitCode === 0;
}

function youtubeAuditSummary(audit) {
  if (!audit) {
    return "Non avviato";
  }

  if (audit.running) {
    const total = Number(audit.total) || 0;
    const checked = Number(audit.checked) || 0;
    return total > 0 ? `${checked}/${total} (${audit.progress || 0}%)` : "In avvio";
  }

  if (audit.lastError) {
    return "Errore";
  }

  const checked = Number(audit.summary?.ok || 0) + Number(audit.summary?.failed || 0);
  if (checked > 0) {
    return `OK ${audit.summary?.ok || 0} / KO ${audit.summary?.failed || 0}`;
  }

  return audit.finishedAt ? "Report letto" : "Non avviato";
}

function diagnosticReasonRows(diagnostics, youtubeAudit) {
  const counts = {};
  [diagnostics?.audioCheck?.lastSummary?.byReason, youtubeAudit?.summary?.byReason].forEach((source) => {
    if (!source || typeof source !== "object") {
      return;
    }

    Object.entries(source).forEach(([reason, count]) => {
      counts[reason] = (counts[reason] || 0) + (Number(count) || 0);
    });
  });

  const ordered = diagnosticReasonOrder.map((reason) => ({
    reason,
    count: counts[reason] || 0,
    label: diagnosticReasonInfo[reason]?.label || reason,
    detail: diagnosticReasonInfo[reason]?.detail || "Motivo tecnico letto dal report.",
  }));

  const extras = Object.keys(counts)
    .filter((reason) => !diagnosticReasonOrder.includes(reason))
    .sort()
    .map((reason) => ({
      reason,
      count: counts[reason] || 0,
      label: reason,
      detail: "Motivo tecnico letto dal report. Apri il JSON in data/reports per il dettaglio completo.",
    }));

  return [...ordered, ...extras];
}

function refreshClockLabel() {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function diagnosticDateLabel(value) {
  if (!value) {
    return "";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return String(value);
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function diagnosticHealthChecks(diagnostics) {
  if (!diagnostics) {
    return [];
  }

  const preflight = Array.isArray(diagnostics.audioPreflight) ? diagnostics.audioPreflight : [];
  const audioOk = preflight.length === 0 || preflight.some((entry) => entry.ok);
  const cookieAnalysis = diagnostics.config?.ytdlCookieAnalysis || null;
  const youtubeCookiesAvailable = Boolean(diagnostics.config?.ytdlCookiesAvailable);
  const youtubeCookiesConfigured = Boolean(diagnostics.config?.ytdlCookiesConfigured);
  const youtubeCookieSessionCount = Number(cookieAnalysis?.sessionCookieCount) || 0;
  const youtubeCookieSessionReady = Boolean(cookieAnalysis?.hasSessionCookies);
  return [
    {
      label: "Backend",
      ok: Boolean(diagnostics.runtime?.revision),
      detail: diagnostics.runtime?.revision || "Runtime non letto",
    },
    {
      label: "mpv",
      ok: Boolean(diagnostics.tools?.mpv?.ok),
      detail: commandSummary(diagnostics.tools?.mpv),
    },
    {
      label: "yt-dlp",
      ok: Boolean(diagnostics.tools?.ytdlp?.ok),
      detail: commandSummary(diagnostics.tools?.ytdlp),
    },
    {
      label: "Deno/JS",
      ok: Boolean(diagnostics.tools?.ytdlJsRuntime?.ok),
      detail: commandSummary(diagnostics.tools?.ytdlJsRuntime),
    },
    {
      label: "Audio",
      ok: audioOk,
      detail: audioOk ? "Almeno un output apribile" : "Nessun output apribile",
    },
    {
      label: "YouTube API",
      ok: Boolean(diagnostics.config?.hasYouTubeApiKey),
      detail: diagnostics.config?.hasYouTubeApiKey ? "Configurata" : "Non configurata",
    },
    {
      label: "Cookie YouTube",
      ok: youtubeCookiesAvailable && youtubeCookieSessionReady,
      detail: youtubeCookiesAvailable
        ? youtubeCookieSessionReady
          ? `${youtubeCookieSessionCount} cookie sessione`
          : "File presente ma sessione incompleta"
        : youtubeCookiesConfigured
          ? "File configurato ma non leggibile"
          : "Carica cookies.txt",
    },
    {
      label: "Jamendo",
      ok: Boolean(diagnostics.config?.hasJamendoClientId),
      detail: diagnostics.config?.hasJamendoClientId ? "Configurata" : "Non configurata",
    },
    {
      label: "Player",
      ok: !diagnostics.player?.error,
      detail: diagnostics.player?.error || "Nessun errore attivo",
    },
    {
      label: "Check catalogo",
      ok: audioCheckHealthOk(diagnostics.audioCheck),
      detail: audioCheckSummary(diagnostics.audioCheck),
    },
    {
      label: "Audit YouTube",
      ok: !diagnostics.youtubeAudit?.lastError,
      detail: youtubeAuditSummary(diagnostics.youtubeAudit),
    },
  ];
}

function cookieDiagnosticRows(diagnostics) {
  const config = diagnostics?.config || {};
  const analysis = config.ytdlCookieAnalysis || {};
  const warning = config.ytdlCookieWarning || {};
  const sessionNames = Array.isArray(analysis.sessionCookieNames) ? analysis.sessionCookieNames : [];
  const rows = [
    {
      label: "Messaggio",
      value:
        warning.message ||
        (config.ytdlCookiesAvailable
          ? "File cookie presente. Usa Test cookie YouTube per verificare se l'account e' accettato dal Raspberry."
          : "Cookie YouTube non presenti."),
    },
    {
      label: "File letto",
      value: config.ytdlCookiesPath || "data/youtube-cookies.txt",
    },
    {
      label: "Origine",
      value: config.ytdlCookiesSource || "default",
    },
    {
      label: "Righe cookie",
      value: `${analysis.validRows ?? 0} totali, ${analysis.youtubeRows ?? 0} YouTube/Google`,
    },
    {
      label: "Sessione login",
      value: analysis.hasSessionCookies
        ? `${analysis.sessionCookieCount ?? 0} cookie sessione trovati`
        : `${analysis.sessionCookieCount ?? 0} cookie sessione trovati: esporta un cookies.txt nuovo da YouTube gia' loggato`,
    },
    {
      label: "Nomi sessione trovati",
      value: sessionNames.length > 0 ? sessionNames.join(", ") : "Nessun cookie sessione riconosciuto",
    },
    {
      label: "Prossima scadenza critica",
      value: analysis.earliestExpiresAt
        ? `${diagnosticDateLabel(analysis.earliestExpiresAt)}${
            Number.isFinite(analysis.expiresInDays) ? ` (${analysis.expiresInDays} giorni)` : ""
          }`
        : "Scadenza non rilevata nel file",
    },
  ];

  return rows;
}

export function AdminPanel({
  users,
  currentUser,
  onCreateUser,
  onDeleteUser,
  onResetUserPassword,
  onResetYouTubeImportState,
  onLoadDiagnostics,
  onLoadYouTubeAuditStatus,
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
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
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

  const preflightResults = Array.isArray(diagnostics?.audioPreflight) ? diagnostics.audioPreflight : [];
  const healthChecks = diagnosticHealthChecks(diagnostics);
  const playerEvents = Array.isArray(diagnostics?.player?.events) ? diagnostics.player.events : [];
  const diagnosticTools = diagnostics
    ? [
        ["mpv", diagnostics.tools?.mpv],
        ["yt-dlp", diagnostics.tools?.ytdlp],
        ["deno/js", diagnostics.tools?.ytdlJsRuntime],
        ["aplay -l", diagnostics.alsa?.listDevices],
      ]
    : [];
  const replacementList = diagnostics?.replacementList || null;
  const replacementItems = Array.isArray(replacementList?.items) ? replacementList.items : [];
  const hardBrokenItems = replacementItems.filter((item) =>
    hardBrokenReasons.has(String(item.reason || "").toLowerCase())
  );
  const youtubeAudit = diagnostics?.youtubeAudit || null;
  const youtubeAuditLog = Array.isArray(youtubeAudit?.logTail) ? youtubeAudit.logTail.slice(-20) : [];
  const audioCheckLog = Array.isArray(diagnostics?.audioCheck?.logTail) ? diagnostics.audioCheck.logTail.slice(-20) : [];
  const warningHealthChecks = healthChecks.filter((entry) => !entry.ok);
  const cookieRows = cookieDiagnosticRows(diagnostics);
  const checkReasonRows = diagnosticReasonRows(diagnostics, youtubeAudit);
  const cookieReady = Boolean(
    diagnostics?.config?.ytdlCookiesAvailable && diagnostics?.config?.ytdlCookieAnalysis?.hasSessionCookies
  );
  const autoRefreshActive = Boolean(youtubeAudit?.running || diagnostics?.audioCheck?.running);

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

        <article className="admin-tool-card diagnostic-card">
          <div className="diagnostic-head">
            <div>
              <p className="eyebrow">Raspberry</p>
              <h3>Diagnostica audio/server</h3>
              <p>Controlla mpv, yt-dlp, ALSA, configurazione player e ultimo errore noto.</p>
            </div>
            <div className="admin-tool-actions">
              <button type="button" onClick={handleLoadDiagnostics} disabled={loadingDiagnostics}>
                {loadingDiagnostics ? "Controllo..." : "Aggiorna diagnostica"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleProbeYouTubeCookies}
                disabled={probingYouTubeCookies}
              >
                {probingYouTubeCookies ? "Test..." : "Test cookie YouTube"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleRecheckYouTubeLoginFailures}
                disabled={recheckingYouTubeLogin}
              >
                {recheckingYouTubeLogin ? "Ricontrollo..." : "Ricontrolla login YouTube"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleRecheckArchivedAudioTracks}
                disabled={recheckingArchivedTracks}
              >
                {recheckingArchivedTracks ? "Riverifico..." : "Riverifica archiviate"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleStartYouTubeFullAudit}
                disabled={startingYouTubeFullAudit || youtubeAudit?.running}
              >
                {youtubeAudit?.running
                  ? `YouTube ${youtubeAudit.progress || 0}%`
                  : startingYouTubeFullAudit
                    ? "Avvio..."
                    : "Verifica tutto YouTube"}
              </button>
              <label className={`file-button ${uploadingYouTubeCookies ? "is-disabled" : ""}`}>
                {uploadingYouTubeCookies ? "Carico..." : "Carica cookies.txt"}
                <input
                  type="file"
                  accept=".txt,text/plain"
                  disabled={uploadingYouTubeCookies}
                  onChange={handleUploadYouTubeCookiesFile}
                />
              </label>
            </div>
          </div>

          {diagnosticsStatus ? (
            <p className={`status-banner is-${diagnosticsStatusType}`}>{diagnosticsStatus}</p>
          ) : null}

          {autoRefreshActive ? (
            <p className="status-banner is-info">
              Auto-refresh attivo: aggiorno lo stato dei controlli ogni pochi secondi
              {autoRefreshAt ? `, ultimo aggiornamento ${autoRefreshAt}.` : "."}
            </p>
          ) : null}

          {healthChecks.length > 0 ? (
            <div className="diagnostic-health">
              {healthChecks.map((entry) => (
                <div key={entry.label} className={entry.ok ? "is-ok" : "is-warn"} title={entry.detail}>
                  <strong>{entry.label}</strong>
                  <span>{entry.ok ? "OK" : "ATTENZIONE"}</span>
                  <small>{entry.detail}</small>
                </div>
              ))}
            </div>
          ) : null}

          {warningHealthChecks.length > 0 ? (
            <div className="diagnostic-events is-readable">
              <p className="eyebrow">Avvisi diagnostica</p>
              {warningHealthChecks.map((entry) => (
                <div key={`warning-${entry.label}`}>
                  <strong>{entry.label}</strong>
                  <span>{entry.detail}</span>
                  <small>
                    {entry.label === "Cookie YouTube"
                      ? "Il file esiste, ma non basta: deve contenere cookie di sessione login esportati da YouTube gia' autenticato."
                      : "Apri il dettaglio sotto per leggere il messaggio completo e capire il prossimo passo."}
                  </small>
                </div>
              ))}
            </div>
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
                <small>
                  mpv {diagnostics.player?.outputVolume ?? diagnostics.player?.volume ?? 0}% | gain x
                  {diagnostics.config?.serverVolumeGain ?? diagnostics.player?.volumeGain ?? 1}
                </small>
              </div>
              <div>
                <span>Check catalogo</span>
                <strong>{audioCheckSummary(diagnostics.audioCheck)}</strong>
                <small>
                  {diagnostics.audioCheck?.config?.mode || "probe"} ogni{" "}
                  {diagnostics.audioCheck?.config?.intervalHours ?? 0}h
                </small>
              </div>
              <div>
                <span>Cookie YouTube</span>
                <strong>
                  {cookieReady
                    ? "Attivi"
                    : diagnostics.config?.ytdlCookiesAvailable
                      ? "Sessione incompleta"
                      : diagnostics.config?.ytdlCookiesConfigured
                      ? "File mancante"
                      : "Non configurati"}
                </strong>
                <small>
                  {cookieReady
                    ? `${diagnostics.config?.ytdlCookiesSource || "file"} | ${
                        diagnostics.config?.ytdlCookieAnalysis?.sessionCookieCount || 0
                      } cookie sessione`
                    : diagnostics.config?.ytdlCookiesAvailable
                      ? diagnostics.config?.ytdlCookieWarning?.message || "File presente ma senza sessione login completa"
                    : diagnostics.config?.ytdlCookiesConfigured
                      ? `Non leggibile: ${diagnostics.config?.ytdlCookiesPath || "percorso mancante"}`
                  : `Auto: ${diagnostics.config?.ytdlCookiesPath || "data/youtube-cookies.txt"}`}
                </small>
              </div>
              <div>
                <span>Stream YouTube</span>
                <strong>{diagnostics.config?.ytdlExtractorArgs || "default"}</strong>
                <small>{diagnostics.config?.ytdlFormat || "audio-only"}</small>
              </div>
              <div>
                <span>Audit YouTube</span>
                <strong>{youtubeAuditSummary(youtubeAudit)}</strong>
                <small>
                  {youtubeAudit?.running
                    ? `Controllo completo in corso dal ${youtubeAudit.startedAt || "n/d"}`
                    : youtubeAudit?.finishedAt
                      ? `Ultimo giro: ${youtubeAudit.finishedAt}`
                      : "Avvialo dopo avere caricato i cookie"}
                </small>
              </div>
            </div>
          ) : null}

          {diagnostics ? (
            <div className="diagnostic-events is-readable">
              <p className="eyebrow">Dettaglio cookie YouTube</p>
              {cookieRows.map((row) => (
                <div key={row.label}>
                  <strong>{row.label}</strong>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          {youtubeAudit ? (
            <div className="diagnostic-events is-readable">
              <p className="eyebrow">Verifica completa YouTube</p>
              <div>
                <strong>{youtubeAuditSummary(youtubeAudit)}</strong>
                <span>
                  {youtubeAudit.config?.mode || "metadata"} | concorrenza {youtubeAudit.config?.concurrency || 5}
                  {youtubeAudit.loginFailures ? ` | login KO ${youtubeAudit.loginFailures}` : ""}
                  {youtubeAudit.summary?.replaceCount
                    ? ` | ${youtubeAudit.summary.replaceCount} da sostituire`
                    : ""}
                </span>
                <small>
                  {youtubeAudit.earlyAbort
                    ? "Fermato automaticamente: cookie YouTube non validi o account bloccato da anti-bot."
                    : youtubeAudit.lastError || youtubeAudit.reportJson || "In attesa del report finale"}
                </small>
                {youtubeAudit.running ? (
                  <div className="diagnostic-progress" aria-label="Avanzamento verifica YouTube">
                    <span style={{ width: `${Math.max(0, Math.min(100, youtubeAudit.progress || 0))}%` }} />
                  </div>
                ) : null}
              </div>
              {youtubeAuditLog.map((line, index) => (
                <div key={`${line}-${index}`}>
                  <strong>{line.startsWith("[check]") ? "check" : "log"}</strong>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          ) : null}

          {diagnostics ? (
            <div className="diagnostic-events is-readable">
              <p className="eyebrow">Legenda risultati check</p>
              <div>
                <strong>Concorrenza audit</strong>
                <span>Default 5 controlli paralleli per velocizzare YouTube.</span>
                <small>
                  Se il report finale ha molti timeout, abbassa temporaneamente
                  CLEARWAVE_YOUTUBE_FULL_AUDIT_CONCURRENCY a 3 o 2 e rilancia.
                </small>
              </div>
              {checkReasonRows.map((row) => (
                <div key={row.reason}>
                  <strong>
                    {row.label}
                    {row.count ? ` (${row.count})` : ""}
                  </strong>
                  <span>{row.reason}</span>
                  <small>{row.detail}</small>
                </div>
              ))}
            </div>
          ) : null}

          {audioCheckLog.length > 0 ? (
            <div className="diagnostic-events is-readable">
              <p className="eyebrow">Log check catalogo</p>
              <div>
                <strong>{audioCheckSummary(diagnostics.audioCheck)}</strong>
                <span>
                  OK {diagnostics.audioCheck?.lastSummary?.ok ?? "n/d"} | KO{" "}
                  {diagnostics.audioCheck?.lastSummary?.failed ?? "n/d"}
                </span>
                <small>
                  {diagnostics.audioCheck?.lastError ||
                    diagnostics.audioCheck?.lastReportJson ||
                    "Ultime righe del controllo automatico catalogo."}
                </small>
              </div>
              {audioCheckLog.map((line, index) => (
                <div key={`${line}-${index}`}>
                  <strong>{line.startsWith("[check]") ? "check" : "log"}</strong>
                  <span>{line}</span>
                </div>
              ))}
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

          {replacementList ? (
            <div className="diagnostic-events is-readable">
              <p className="eyebrow">Tracce da sostituire</p>
              <div>
                <strong>{replacementList.summary?.replaceCount ?? replacementItems.length} candidate</strong>
                <span>
                  Controllate {replacementList.summary?.checked ?? 0}
                  {replacementList.summary?.waitingForCookies
                    ? `, ${replacementList.summary.waitingForCookies} ancora in attesa cookie`
                    : ""}
                </span>
                <small>{replacementList.updatedAt || "Nessun ricontrollo eseguito"}</small>
              </div>
              {hardBrokenItems.length > 0 ? (
                <div>
                  <strong>{hardBrokenItems.length} non disponibili</strong>
                  <span>Video rimossi, privati o non piu' riproducibili: puoi nasconderli senza cancellarli.</span>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={cleaningBrokenTracks}
                    onClick={() => setPendingCleanupBroken(true)}
                  >
                    {cleaningBrokenTracks ? "Archivio..." : "Archivia non disponibili"}
                  </button>
                </div>
              ) : null}
              {replacementItems.slice(0, 12).map((item) => (
                <div key={`${item.id}-${item.checkedAt}`}>
                  <strong>{item.title}</strong>
                  <span>{item.reason}</span>
                  <small>{item.message}</small>
                </div>
              ))}
            </div>
          ) : null}

          {diagnostics?.alsa?.cards ? (
            <pre className="diagnostic-output">{diagnostics.alsa.cards}</pre>
          ) : null}

          {playerEvents.length > 0 ? (
            <div className="diagnostic-events is-readable">
              <p className="eyebrow">Ultimi eventi player</p>
              {playerEvents.map((event) => (
                <div key={event.id}>
                  <strong>{event.type}</strong>
                  <span>{event.message}</span>
                  <small>{event.at}</small>
                </div>
              ))}
            </div>
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
