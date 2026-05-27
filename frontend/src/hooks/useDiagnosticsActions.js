import { useEffect, useState } from "react";
import {
  checkSourceHealth,
  cleanupBrokenAudioTracks,
  fetchAdminDiagnostics,
  fetchYouTubeAudioResults,
  fetchYouTubeFullAuditStatus,
  probeYouTubeCookies,
  recheckArchivedAudioTracks,
  recheckYouTubeLoginFailures,
  startYouTubeFullAudit,
  uploadYouTubeCookies,
} from "../api/client.js";
import {
  auditRefreshMs,
  diagnosticsRefreshMs,
  refreshClockLabel,
} from "../components/adminDiagnostics";

// Hook autosufficiente: la pagina diagnostica ha il suo stato, i suoi timer e le sue chiamate API.
// Non dipende da AdminPanel ne' da useAdminActions.
export function useDiagnosticsActions({ token, refreshTracks }) {
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
  const [autoRefreshAt, setAutoRefreshAt] = useState("");

  // Carica la diagnostica automaticamente al primo mount: l'utente vede subito lo stato senza premere nulla.
  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      setLoadingDiagnostics(true);
      setDiagnosticsStatusType("success");
      setDiagnosticsStatus("Caricamento diagnostica Raspberry...");
      try {
        const payload = await fetchAdminDiagnostics(token);
        if (cancelled) {
          return;
        }

        setDiagnostics(payload.diagnostics || null);
        setAutoRefreshAt(refreshClockLabel());
        setDiagnosticsStatusType("success");
        setDiagnosticsStatus("Diagnostica aggiornata.");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setDiagnosticsStatusType("error");
        setDiagnosticsStatus(error.message || "Diagnostica non disponibile.");
      } finally {
        if (!cancelled) {
          setLoadingDiagnostics(false);
        }
      }
    }

    if (token) {
      void initialLoad();
    }

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleLoadDiagnostics() {
    setLoadingDiagnostics(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Controllo diagnostica Raspberry in corso...");
    try {
      const payload = await fetchAdminDiagnostics(token);
      setDiagnostics(payload.diagnostics || null);
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
    setYoutubeResultsFilter(nextFilter);
    setLoadingYouTubeResults(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Carico esiti ultimo report YouTube...");
    try {
      const payload = await fetchYouTubeAudioResults(token, { status: nextFilter, limit: 80 });
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
    setCheckingSourceHealth(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Test sorgenti YouTube/Jamendo in corso...");
    try {
      const payload = await checkSourceHealth(token);
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

  async function handleProbeYouTubeCookies() {
    setProbingYouTubeCookies(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Test cookie YouTube dal Raspberry in corso...");
    try {
      const payload = await probeYouTubeCookies(token);
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

  async function handleRecheckYouTubeLoginFailures() {
    setRecheckingYouTubeLogin(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Ricontrollo tracce YouTube con errore login in corso...");
    try {
      const payload = await recheckYouTubeLoginFailures(token);
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

  async function handleRecheckArchivedAudioTracks() {
    setRecheckingArchivedTracks(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Riverifica tracce archiviate con i cookie attuali in corso...");
    try {
      const payload = await recheckArchivedAudioTracks(token);
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }

      if (refreshTracks) {
        await refreshTracks();
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

  async function handleStartYouTubeFullAudit() {
    setStartingYouTubeFullAudit(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Verifica completa YouTube avviata in background...");
    try {
      const payload = await startYouTubeFullAudit(token, { mode: "metadata" });
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
    if (!file) {
      return;
    }

    setUploadingYouTubeCookies(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Installazione cookie YouTube in corso...");
    try {
      const payload = await uploadYouTubeCookies(token, await file.text());
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

  async function handleCleanupBrokenAudioTracks() {
    setCleaningBrokenTracks(true);
    setDiagnosticsStatusType("success");
    setDiagnosticsStatus("Quarantena tracce YouTube non disponibili in corso...");
    try {
      const payload = await cleanupBrokenAudioTracks(token);
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      }

      if (refreshTracks) {
        await refreshTracks();
      }

      setDiagnosticsStatusType("success");
      setDiagnosticsStatus(
        `${payload.message || "Quarantena catalogo completata."}${payload.backupFile ? ` Backup: ${payload.backupFile}.` : ""}`
      );
    } catch (error) {
      setDiagnosticsStatusType("error");
      setDiagnosticsStatus(error.message || "Quarantena catalogo non riuscita.");
    } finally {
      setCleaningBrokenTracks(false);
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
      if (!auditRunning || auditBusy) {
        return;
      }

      auditBusy = true;
      try {
        const payload = await fetchYouTubeFullAuditStatus(token);
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
      if (diagnosticsBusy) {
        return;
      }

      diagnosticsBusy = true;
      try {
        const payload = await fetchAdminDiagnostics(token);
        if (!cancelled && payload) {
          setDiagnostics(payload.diagnostics || null);
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
  }, [diagnostics?.youtubeAudit?.running, diagnostics?.audioCheck?.running, token]);

  return {
    autoRefreshAt,
    checkingSourceHealth,
    cleaningBrokenTracks,
    diagnostics,
    diagnosticsStatus,
    diagnosticsStatusType,
    handleCheckSourceHealth,
    handleCleanupBrokenAudioTracks,
    handleLoadDiagnostics,
    handleLoadYouTubeResults,
    handleProbeYouTubeCookies,
    handleRecheckArchivedAudioTracks,
    handleRecheckYouTubeLoginFailures,
    handleStartYouTubeFullAudit,
    handleUploadYouTubeCookiesFile,
    loadingDiagnostics,
    loadingYouTubeResults,
    probingYouTubeCookies,
    recheckingArchivedTracks,
    recheckingYouTubeLogin,
    startingYouTubeFullAudit,
    uploadingYouTubeCookies,
    youtubeResults,
    youtubeResultsFilter,
  };
}
