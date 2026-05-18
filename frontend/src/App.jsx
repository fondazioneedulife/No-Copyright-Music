import { useEffect, useMemo, useState } from "react";
import {
  bulkImportDiscovery,
  changePassword,
  cleanupBrokenAudioTracks,
  createTrack,
  createUser,
  deleteUser,
  exportCatalogBackup,
  exportLicenseReport,
  exportLicenseReportHtml,
  fetchAdminDiagnostics,
  fetchCurrentUser,
  fetchTracks,
  fetchUsers,
  fetchYouTubeFullAuditStatus,
  importDiscoveryLink,
  importDiscoveryTrack,
  importCatalogBackup,
  importSessionLink,
  login,
  logout,
  probeYouTubeCookies,
  readStoredToken,
  recheckArchivedAudioTracks,
  recheckYouTubeLoginFailures,
  resetUserPassword,
  resetYouTubeImportState,
  searchDiscovery,
  startYouTubeFullAudit,
  storeToken,
} from "./api/client.js";
import { AdminPanel } from "./components/AdminPanel.jsx";
import { AuthGate } from "./components/AuthGate.jsx";
import { Catalog } from "./components/Catalog.jsx";
import { CookieAlertModal } from "./components/CookieAlertModal.jsx";
import { DiscoveryPanel } from "./components/DiscoveryPanel.jsx";
import { Hero } from "./components/Hero.jsx";
import { PlayerDock } from "./components/PlayerDock.jsx";
import { PlaylistPanel } from "./components/PlaylistPanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { StudioPanel } from "./components/StudioPanel.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { useCatalogPage } from "./hooks/useCatalogPage.js";
import { useDiscoveryProviders } from "./hooks/useDiscoveryProviders.js";
import { usePlayerRuntime } from "./hooks/usePlayerRuntime.js";
import { useYouTubeCookieAlert } from "./hooks/useYouTubeCookieAlert.js";
import {
  downloadBlob,
  getGenre,
  getSource,
  normalizeSearch,
  trackMatchesSearch,
} from "./utils.js";

export default function App() {
  // App contiene solo lo stato globale: i dettagli visivi sono nei componenti sotto components/.
  const [token, setToken] = useState(readStoredToken);
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("");
  const [tracks, setTracks] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeSection, setActiveSection] = useState("catalog");
  const [theme, setTheme] = useState(() => window.localStorage.getItem("clearwave-react-theme") || "dark");
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("all");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(1);
  const [queueIds, setQueueIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("clearwave-react-queue") || "[]");
    } catch {
      return [];
    }
  });
  const [adminStatus, setAdminStatus] = useState("");
  const [adminStatusType, setAdminStatusType] = useState("success");
  const {
    cookieAlert,
    cookieAlertStatus,
    cookieAlertStatusType,
    cookieAlertUploading,
    cookieAlertVisible,
    handleCookieAlertUpload,
    handleUploadYouTubeCookies,
    setCookieAlertVisible,
  } = useYouTubeCookieAlert({
    token,
    isAdmin: user?.role === "admin",
    setAdminStatus,
    setAdminStatusType,
  });
  const [settingsStatus, setSettingsStatus] = useState("");
  const [settingsStatusType, setSettingsStatusType] = useState("success");
  const discoveryProviders = useDiscoveryProviders(user);
  const [discoveryResults, setDiscoveryResults] = useState([]);
  const [discoveryStatus, setDiscoveryStatus] = useState("");
  const [discoveryStatusType, setDiscoveryStatusType] = useState("success");
  const [sessionTracks, setSessionTracks] = useState([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadStatusType, setUploadStatusType] = useState("success");
  const {
    catalogTracks,
    catalogPagination,
    catalogFacets,
    catalogLoading,
    refreshCatalogPage,
    resetCatalogPage,
  } = useCatalogPage({
    user,
    page,
    setPage,
    search,
    genre,
    source,
    setAuthStatus,
  });

  useEffect(() => {
    // Tema salvato nel browser per mantenere dark/light mode anche dopo il refresh.
    document.body.dataset.theme = theme;
    window.localStorage.setItem("clearwave-react-theme", theme);
  }, [theme]);

  useEffect(() => {
    // La coda resta nel browser: semplice e coerente con l'idea di sessione locale.
    window.localStorage.setItem("clearwave-react-queue", JSON.stringify(queueIds));
  }, [queueIds]);

  useEffect(() => {
    // Bootstrap sessione: se il token e' ancora valido, saltiamo la schermata login.
    let cancelled = false;

    async function boot() {
      if (!token) {
        return;
      }

      try {
        const payload = await fetchCurrentUser(token);
        if (cancelled) {
          return;
        }

        if (!payload.user) {
          throw new Error("Sessione scaduta.");
        }

        setUser(payload.user);
        setAuthStatus("");
        nudgePasswordChange(payload.user);
      } catch (error) {
        if (!cancelled) {
          storeToken("");
          setToken("");
          setUser(null);
          setAuthStatus(error.message || "Sessione scaduta.");
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    // Dopo il login carichiamo il catalogo dal backend locale.
    if (!user) {
      return;
    }

    let cancelled = false;
    async function loadData() {
      try {
        const payload = await fetchTracks();
        if (!cancelled) {
          setTracks(payload.tracks || []);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthStatus(error.message || "Catalogo non disponibile.");
        }
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    // La lista utenti viene caricata solo dagli admin.
    if (!user || user.role !== "admin") {
      return;
    }

    void refreshUsers();
  }, [user, token]);

  useEffect(() => {
    if (user?.role !== "admin" && (activeSection === "admin" || activeSection === "discovery")) {
      setActiveSection("catalog");
    }
  }, [user, activeSection]);

  const query = useMemo(() => normalizeSearch(search), [search]);
  const genres = useMemo(
    () =>
      (catalogFacets.genres?.length
        ? catalogFacets.genres
        : [...new Set(tracks.map(getGenre).filter(Boolean))]
      ).sort((a, b) => a.localeCompare(b)),
    [catalogFacets.genres, tracks]
  );
  const filteredTracks = useMemo(
    () =>
      tracks.filter((track) => {
        if (genre !== "all" && getGenre(track) !== genre) {
          return false;
        }

        if (source !== "all" && getSource(track) !== source) {
          return false;
        }

        return trackMatchesSearch(track, query);
      }),
    [genre, query, source, tracks]
  );
  const {
    activeTrack,
    audioRef,
    currentTime,
    duration,
    embedFrameRef,
    embedSource,
    handleAudioError,
    handleAudioPause,
    handleEnded,
    handleLoadedMetadata,
    handleSeek,
    handleTimeUpdate,
    isPlaying,
    playAdjacent,
    playTrack,
    playbackTarget,
    playerNotice,
    primeEmbedPlayer,
    progress,
    queuedTracks,
    removeFromQueue,
    removeSessionTrack,
    clearSessionTracks,
    repeatMode,
    setPlayerVolume,
    setShuffleEnabled,
    shuffleEnabled,
    stopPlaybackForLogout,
    togglePlaybackTarget,
    toggleQueue,
    toggleRepeatMode,
    volume,
  } = usePlayerRuntime({
    token,
    tracks,
    catalogTracks,
    filteredTracks,
    sessionTracks,
    setSessionTracks,
    queueIds,
    setQueueIds,
    setDiscoveryStatus,
    setDiscoveryStatusType,
  });
  const noAttributionCount = useMemo(
    () => tracks.filter((track) => track.attributionRequired === false).length,
    [tracks]
  );
  const useCaseCount = useMemo(
    () =>
      new Set(
        tracks.flatMap((track) => {
          if (Array.isArray(track.useCases)) {
            return track.useCases;
          }
          return String(track.useCases || "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
        })
      ).size,
    [tracks]
  );

  function nudgePasswordChange(nextUser) {
    if (!nextUser?.mustChangePassword) {
      return;
    }

    setActiveSection("settings");
    setSettingsStatusType("error");
    setSettingsStatus("Stai usando una password temporanea: cambiala da qui.");
  }

  async function handleLogin(credentials) {
    try {
      const payload = await login(credentials);
      storeToken(payload.token);
      setToken(payload.token);
      setUser(payload.user);
      nudgePasswordChange(payload.user);
      setAuthStatus("");
    } catch (error) {
      setAuthStatus(error.message || "Accesso non riuscito.");
    }
  }

  async function handleLogout() {
    await stopPlaybackForLogout();

    if (token) {
      try {
        await logout(token);
      } catch {
        // Anche se il backend non risponde, la sessione locale va pulita.
      }
    }

    storeToken("");
    setToken("");
    setUser(null);
    setTracks([]);
    resetCatalogPage();
    setActiveSection("catalog");
    setAdminStatus("");
    setSettingsStatus("");
    setDiscoveryResults([]);
  }

  async function refreshUsers() {
    if (!token) {
      return;
    }

    try {
      const payload = await fetchUsers(token);
      setUsers(payload.users || []);
    } catch {
      setUsers([]);
    }
  }

  async function refreshTracks() {
    // Dopo import/upload aggiorniamo sia la cache completa sia la pagina catalogo corrente.
    const fullPayload = await fetchTracks();
    setTracks(fullPayload.tracks || []);
    await refreshCatalogPage();
  }

  function navigateToSection(sectionId) {
    const targetMap = {
      catalog: "catalogo",
      playlists: "playlists",
      discovery: "discovery",
      settings: "impostazioni",
      studio: "studio",
    };
    setActiveSection(sectionId);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetMap[sectionId] || sectionId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function handleDiscoverySearch({ query: discoveryQuery, provider }) {
    if (user?.role !== "admin") {
      setDiscoveryStatusType("error");
      setDiscoveryStatus("Solo l'amministratore puo' cercare e importare nuove sorgenti.");
      return;
    }

    try {
      setDiscoveryStatus("Ricerca in corso nelle sorgenti ufficiali...");
      setDiscoveryStatusType("success");
      const payload = await searchDiscovery(token, { query: discoveryQuery, provider });
      setDiscoveryResults(payload.items || []);
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        setDiscoveryStatusType("error");
        setDiscoveryStatus(
          `Ricerca completata con avvisi. ${payload.errors
            .map((entry) => `${entry.provider}: ${entry.message}`)
            .join(" | ")}`
        );
      } else {
        setDiscoveryStatusType("success");
        setDiscoveryStatus(`${(payload.items || []).length} risultati trovati nelle sorgenti ufficiali.`);
      }
    } catch (error) {
      setDiscoveryResults([]);
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Errore nella ricerca esterna.");
    }
  }

  async function handleDiscoveryImport(track) {
    if (user?.role !== "admin") {
      setDiscoveryStatusType("error");
      setDiscoveryStatus("Solo l'amministratore puo' importare brani.");
      return;
    }

    try {
      setDiscoveryStatus("Import nel catalogo locale in corso...");
      await importDiscoveryTrack(token, track);
      await refreshTracks();
      setDiscoveryStatusType("success");
      setDiscoveryStatus("Traccia importata nel catalogo locale.");
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Errore durante l'import.");
    }
  }

  async function handleBulkImport(maxTracks = 120) {
    if (user?.role !== "admin") {
      setDiscoveryStatusType("error");
      setDiscoveryStatus("Solo l'amministratore puo' importare lotti.");
      return;
    }

    const requestedMaxTracks = Number(maxTracks) || 120;

    try {
      setDiscoveryStatus(`Importo un lotto progressivo da ${requestedMaxTracks} tracce...`);
      const payload = await bulkImportDiscovery(token, { maxTracks: requestedMaxTracks });
      await refreshTracks();
      const importErrors = Array.isArray(payload.errors) ? payload.errors : [];
      const youtubeProgress = Array.isArray(payload.youtubeProgress) ? payload.youtubeProgress : [];
      const skippedSummary = Array.isArray(payload.skippedSummary) ? payload.skippedSummary : [];
      const youtubeText = youtubeProgress.length
        ? ` YouTube: ${youtubeProgress
            .map((entry) => {
              const resetText = entry.resetCursor ? ", reset token" : "";
              const skippedText = entry.skipped ? `, ${entry.skipped}` : "";
              const playlistText = entry.playlistsRead
                ? `, playlist ${entry.playlistItems || 0}/${entry.playlistItemsScanned || 0}`
                : "";
              const uploadText = entry.skipped === "uploads-completed"
                ? "upload gia' completi"
                : `${entry.items || 0}/${entry.scanned || 0}`;
              return `${entry.channel}: ${uploadText}${playlistText}${resetText}${skippedText}`;
            })
            .join("; ")}.`
        : "";
      const skippedText = skippedSummary.length
        ? ` Saltate: ${skippedSummary.map((entry) => `${entry.label} ${entry.count}`).join(", ")}.`
        : "";
      const errorText = importErrors.length
        ? ` Avvisi: ${importErrors.map((entry) => entry.message).join(" | ")}`
        : "";
      // Il riepilogo esplicito evita il caso "0 nuove tracce" senza capire se erano duplicati, quota o canali finiti.
      setDiscoveryStatusType(importErrors.length > 0 && !payload.importedCount ? "error" : "success");
      setDiscoveryStatus(
        `Lotto completato: ${payload.importedCount || 0} nuove tracce su ${payload.scanned || 0} risultati letti.${youtubeText}${skippedText}${errorText}`
      );
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Errore durante l'import del lotto.");
    }
  }

  async function handleImportLink(url) {
    if (user?.role !== "admin") {
      setDiscoveryStatusType("error");
      setDiscoveryStatus("Solo l'amministratore puo' importare link.");
      return;
    }

    try {
      setDiscoveryStatus("Import da link in corso...");
      const payload = await importDiscoveryLink(token, url);
      await refreshTracks();
      setDiscoveryStatusType("success");
      setDiscoveryStatus(
        `Import completato: ${payload.importedCount || 0} nuove tracce, ${payload.skippedCount || 0} saltate.`
      );
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Import da link non riuscito.");
    }
  }

  async function handleAddSessionLink(url) {
    if (user?.role !== "admin") {
      setDiscoveryStatusType("error");
      setDiscoveryStatus("Solo l'amministratore puo' usare la playlist temporanea.");
      return false;
    }

    if (!url) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus("Incolla un link YouTube prima di creare la sessione temporanea.");
      return false;
    }

    try {
      setDiscoveryStatusType("success");
      setDiscoveryStatus("Carico il link nella playlist temporanea...");
      const payload = await importSessionLink(token, url);
      const imported = Array.isArray(payload.imported) ? payload.imported : [];
      if (imported.length === 0) {
        throw new Error("Nessuna traccia temporanea trovata nel link.");
      }

      let addedCount = 0;
      let duplicateCount = 0;
      // La playlist temporanea vive solo nello stato React: non entra nel catalogo SQLite.
      setSessionTracks((current) => {
        const knownIds = new Set(current.map((track) => track.youtubeVideoId || track.id));
        const incoming = imported
          .filter((track) => !knownIds.has(track.youtubeVideoId || track.id))
          .map((track) => ({
            ...track,
            isTemporary: true,
            sessionOwner: user.username,
          }));
        addedCount = incoming.length;
        duplicateCount = Math.max(0, imported.length - incoming.length);
        return [...incoming, ...current];
      });

      const notice = payload.notice ? ` ${payload.notice}` : "";
      setDiscoveryStatusType("success");
      if (addedCount === 0) {
        setDiscoveryStatus(
          `Sessione temporanea invariata: nessuna nuova traccia aggiunta.${duplicateCount > 0 ? ` ${duplicateCount} erano gia' presenti.` : ""}${notice}`
        );
      } else {
        setDiscoveryStatus(
          `Sessione temporanea aggiornata: ${addedCount} nuove tracce in prova.${duplicateCount > 0 ? ` ${duplicateCount} erano gia' presenti.` : ""} Esci o svuota playlist per rimuoverle.${notice}`
        );
      }
      return true;
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Import sessione temporanea non riuscito.");
      return false;
    }
  }

  async function handleUploadTrack(payload) {
    if (user?.role !== "admin") {
      setUploadStatusType("error");
      setUploadStatus("Solo l'amministratore puo' caricare brani.");
      return false;
    }

    try {
      await createTrack(token, payload);
      await refreshTracks();
      setUploadStatusType("success");
      setUploadStatus("Traccia salvata nel catalogo.");
      return true;
    } catch (error) {
      setUploadStatusType("error");
      setUploadStatus(error.message || "Upload non riuscito.");
      return false;
    }
  }

  async function handleCreateUser(nextUser) {
    try {
      const payload = await createUser(token, nextUser);
      setAdminStatusType("success");
      setAdminStatus(`Utente creato: ${payload.user.username}. Password temporanea: ${payload.tempPassword}`);
      await refreshUsers();
      return true;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Creazione utente non riuscita.");
      return false;
    }
  }

  async function handleDeleteUser(username) {
    try {
      await deleteUser(token, username);
      setAdminStatusType("success");
      setAdminStatus(`Utente eliminato: ${username}.`);
      await refreshUsers();
      return true;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Eliminazione utente non riuscita.");
      return false;
    }
  }

  async function handleResetUserPassword(username) {
    try {
      const payload = await resetUserPassword(token, username);
      setAdminStatusType("success");
      setAdminStatus(`Password temporanea per ${payload.user.username}: ${payload.tempPassword}`);
      await refreshUsers();
      return true;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Reset password non riuscito.");
      return false;
    }
  }

  async function handleResetYouTubeImportState() {
    try {
      const payload = await resetYouTubeImportState(token);
      setAdminStatusType("success");
      setAdminStatus(
        `Stato import YouTube azzerato. Canali precedenti: ${payload.previousChannels || 0}${
          payload.backupFile ? `. Backup: ${payload.backupFile}` : ""
        }.`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Reset stato YouTube non riuscito.");
      throw error;
    }
  }

  async function handleLoadAdminDiagnostics() {
    const payload = await fetchAdminDiagnostics(token);
    return payload.diagnostics || null;
  }

  async function handleLoadYouTubeFullAuditStatus() {
    return fetchYouTubeFullAuditStatus(token);
  }

  async function handleRecheckYouTubeLoginFailures() {
    try {
      const payload = await recheckYouTubeLoginFailures(token);
      setAdminStatusType("success");
      setAdminStatus(
        `${payload.message || "Ricontrollo YouTube completato"}${
          payload.reportJson ? ` Report: ${payload.reportJson}.` : ""
        }`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Ricontrollo YouTube non riuscito.");
      throw error;
    }
  }

  async function handleStartYouTubeFullAudit() {
    try {
      const payload = await startYouTubeFullAudit(token, { mode: "metadata" });
      setAdminStatusType("success");
      setAdminStatus(payload.message || "Verifica completa YouTube avviata.");
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Verifica completa YouTube non riuscita.");
      throw error;
    }
  }

  async function handleProbeYouTubeCookies() {
    try {
      const payload = await probeYouTubeCookies(token);
      setAdminStatusType(payload.ok ? "success" : "error");
      setAdminStatus(payload.message || "Test cookie YouTube completato.");
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Test cookie YouTube non riuscito.");
      throw error;
    }
  }

  async function handleCleanupBrokenAudioTracks() {
    try {
      const payload = await cleanupBrokenAudioTracks(token);
      await refreshTracks();
      setAdminStatusType("success");
      setAdminStatus(
        `${payload.message || "Quarantena catalogo completata."}${
          payload.backupFile ? ` Backup: ${payload.backupFile}.` : ""
        }`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Quarantena catalogo non riuscita.");
      throw error;
    }
  }

  async function handleRecheckArchivedAudioTracks() {
    try {
      const payload = await recheckArchivedAudioTracks(token);
      await refreshTracks();
      setAdminStatusType("success");
      setAdminStatus(
        `${payload.message || "Riverifica archiviate completata."}${
          payload.backupFile ? ` Backup: ${payload.backupFile}.` : ""
        }`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Riverifica archiviate non riuscita.");
      throw error;
    }
  }

  async function handleExportCatalogBackup() {
    try {
      const file = await exportCatalogBackup(token);
      downloadBlob(file);
      setAdminStatusType("success");
      setAdminStatus(`Backup catalogo esportato: ${file.filename}.`);
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Export catalogo non riuscito.");
    }
  }

  async function handleExportLicenseReport() {
    try {
      const file = await exportLicenseReport(token);
      downloadBlob(file);
      setAdminStatusType("success");
      setAdminStatus(`Report licenze esportato: ${file.filename}.`);
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Export report licenze non riuscito.");
    }
  }

  async function handleExportLicenseReportHtml() {
    try {
      const file = await exportLicenseReportHtml(token);
      downloadBlob(file);
      setAdminStatusType("success");
      setAdminStatus(`Report licenze HTML esportato: ${file.filename}.`);
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Export report licenze HTML non riuscito.");
    }
  }

  async function handleImportCatalogBackup(backupPayload) {
    try {
      const payload = await importCatalogBackup(token, backupPayload);
      await refreshTracks();
      setAdminStatusType("success");
      setAdminStatus(
        `Catalogo ripristinato: ${payload.importedCount || 0} tracce. Backup precedente: ${
          payload.backupFile || "creato"
        }.`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Ripristino backup catalogo non riuscito.");
      throw error;
    }
  }

  async function handleChangePassword(passwordPayload) {
    try {
      const payload = await changePassword(token, passwordPayload);
      setUser(payload.user);
      setSettingsStatusType("success");
      setSettingsStatus("Password aggiornata correttamente.");
      return true;
    } catch (error) {
      setSettingsStatusType("error");
      setSettingsStatus(error.message || "Cambio password non riuscito.");
      return false;
    }
  }

  if (!user) {
    return <AuthGate onLogin={handleLogin} status={authStatus} />;
  }

  return (
    <>
      <div className="react-app">
        <Sidebar activeSection={activeSection} onNavigate={navigateToSection} user={user} />
        <main className="main-shell">
          <Topbar
            user={user}
            search={search}
            setSearch={(nextSearch) => {
              setSearch(nextSearch);
              setPage(1);
            }}
            theme={theme}
            setTheme={setTheme}
            onLogout={handleLogout}
          />
          <div className="content-shell">
            <Hero
              tracksCount={catalogFacets.totalTracks || tracks.length}
              queueCount={queuedTracks.length}
              noAttributionCount={noAttributionCount}
              useCaseCount={useCaseCount}
              onNavigate={navigateToSection}
              isAdmin={user.role === "admin"}
            />

            <div className="main-grid">
              <div className="feed-column">
                <Catalog
                  tracks={catalogTracks}
                  genres={genres}
                  genre={genre}
                  setGenre={setGenre}
                  source={source}
                  setSource={setSource}
                  page={catalogPagination.page || page}
                  setPage={setPage}
                  pagination={catalogPagination}
                  isLoading={catalogLoading}
                  queueIds={queueIds}
                  activeTrack={activeTrack}
                  isPlaying={isPlaying}
                  onPlay={playTrack}
                  onToggleQueue={toggleQueue}
                  onNavigate={navigateToSection}
                  isAdmin={user.role === "admin"}
                />

                {user.role === "admin" ? (
                <DiscoveryPanel
                  providers={discoveryProviders}
                  results={discoveryResults}
                  isAdmin={user.role === "admin"}
                  sessionOwner={user.username}
                  sessionTracks={sessionTracks}
                  status={discoveryStatus}
                  statusType={discoveryStatusType}
                    onSearch={handleDiscoverySearch}
                    onImportTrack={handleDiscoveryImport}
                    onBulkImport={handleBulkImport}
                    onImportLink={handleImportLink}
                    onAddSessionLink={handleAddSessionLink}
                    onPlaySessionTrack={playTrack}
                    onRemoveSessionTrack={removeSessionTrack}
                    onClearSessionTracks={clearSessionTracks}
                    onLogout={handleLogout}
                  />
                ) : null}

                <PlaylistPanel
                  tracks={tracks}
                  queuedTracks={queuedTracks}
                  activeGenre={genre}
                  onPlay={playTrack}
                  onSelectGenre={(nextGenre) => {
                    setGenre(nextGenre);
                    setPage(1);
                    navigateToSection("catalog");
                  }}
                  onRemoveFromQueue={removeFromQueue}
                  onClearQueue={() => setQueueIds([])}
                />

                <section className="settings-stack" id="impostazioni">
                  {user.role === "admin" ? (
                    <AdminPanel
                      users={users}
                      currentUser={user}
                      onCreateUser={handleCreateUser}
                      onDeleteUser={handleDeleteUser}
                      onResetUserPassword={handleResetUserPassword}
                      onResetYouTubeImportState={handleResetYouTubeImportState}
                      onLoadDiagnostics={handleLoadAdminDiagnostics}
                      onLoadYouTubeAuditStatus={handleLoadYouTubeFullAuditStatus}
                      onRecheckYouTubeLoginFailures={handleRecheckYouTubeLoginFailures}
                      onStartYouTubeFullAudit={handleStartYouTubeFullAudit}
                      onUploadYouTubeCookies={handleUploadYouTubeCookies}
                      onProbeYouTubeCookies={handleProbeYouTubeCookies}
                      onCleanupBrokenAudioTracks={handleCleanupBrokenAudioTracks}
                      onRecheckArchivedAudioTracks={handleRecheckArchivedAudioTracks}
                      onExportCatalogBackup={handleExportCatalogBackup}
                      onExportLicenseReport={handleExportLicenseReport}
                      onExportLicenseReportHtml={handleExportLicenseReportHtml}
                      onImportCatalogBackup={handleImportCatalogBackup}
                      status={adminStatus}
                      statusType={adminStatusType}
                    />
                  ) : null}

                  <SettingsPanel
                    user={user}
                    onChangePassword={handleChangePassword}
                    status={settingsStatus}
                    statusType={settingsStatusType}
                  />
                </section>

                <StudioPanel
                  tracks={tracks}
                  isAdmin={user.role === "admin"}
                  uploadStatus={uploadStatus}
                  uploadStatusType={uploadStatusType}
                  onUploadTrack={handleUploadTrack}
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      {cookieAlertVisible && cookieAlert?.warning?.shouldAlert ? (
        <CookieAlertModal
          cookieAlert={cookieAlert}
          status={cookieAlertStatus}
          statusType={cookieAlertStatusType}
          uploading={cookieAlertUploading}
          onDismiss={() => setCookieAlertVisible(false)}
          onOpenAdmin={() => {
            setCookieAlertVisible(false);
            navigateToSection("settings");
          }}
          onUpload={handleCookieAlertUpload}
        />
      ) : null}

      <PlayerDock
        activeTrack={activeTrack}
        isPlaying={isPlaying}
        progress={progress}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        setVolume={setPlayerVolume}
        playbackTarget={playbackTarget}
        playerNotice={playerNotice}
        shuffleEnabled={shuffleEnabled}
        repeatMode={repeatMode}
        onToggle={() => (activeTrack ? playTrack(activeTrack) : playAdjacent(1))}
        onNext={() => playAdjacent(1)}
        onPrev={() => playAdjacent(-1)}
        onSeek={handleSeek}
        onTogglePlaybackTarget={togglePlaybackTarget}
        onToggleShuffle={() => setShuffleEnabled((current) => !current)}
        onToggleRepeat={toggleRepeatMode}
      />

      {embedSource ? (
        <iframe
          ref={embedFrameRef}
          className="embedded-audio-frame"
          src={embedSource}
          title={activeTrack ? `Player ${activeTrack.title}` : "Player YouTube"}
          allow="autoplay; encrypted-media"
          onLoad={primeEmbedPlayer}
        />
      ) : null}

      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleAudioError}
        onEnded={handleEnded}
        onPause={handleAudioPause}
      />
    </>
  );
}
