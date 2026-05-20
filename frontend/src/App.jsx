import { useEffect, useMemo, useState } from "react";
import {
  changePassword,
  createTrack,
  fetchCurrentUser,
  fetchTracks,
  login,
  logout,
  readStoredToken,
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
import { useAdminActions } from "./hooks/useAdminActions.js";
import { useCatalogPage } from "./hooks/useCatalogPage.js";
import { useDiscoveryActions } from "./hooks/useDiscoveryActions.js";
import { useDiscoveryProviders } from "./hooks/useDiscoveryProviders.js";
import { usePlayerRuntime } from "./hooks/usePlayerRuntime.js";
import { useYouTubeCookieAlert } from "./hooks/useYouTubeCookieAlert.js";
import { getGenre, getSource, normalizeSearch, trackMatchesSearch } from "./utils.js";

export default function App() {
  // App contiene solo lo stato globale: i dettagli visivi sono nei componenti sotto components/.
  const [token, setToken] = useState(readStoredToken);
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("");
  const [tracks, setTracks] = useState([]);
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
  const [settingsStatus, setSettingsStatus] = useState("");
  const [settingsStatusType, setSettingsStatusType] = useState("success");
  const discoveryProviders = useDiscoveryProviders(user);
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
  const {
    adminStatus,
    adminStatusType,
    handleCheckSourceHealth,
    handleCleanupBrokenAudioTracks,
    handleCreateUser,
    handleDeleteUser,
    handleExportCatalogBackup,
    handleExportLicenseReport,
    handleExportLicenseReportHtml,
    handleImportCatalogBackup,
    handleLoadAdminDiagnostics,
    handleLoadYouTubeFullAuditStatus,
    handleProbeYouTubeCookies,
    handleRecheckArchivedAudioTracks,
    handleRecheckYouTubeLoginFailures,
    handleResetUserPassword,
    handleResetYouTubeImportState,
    handleStartYouTubeFullAudit,
    resetAdminStatus,
    setAdminStatus,
    setAdminStatusType,
    users,
  } = useAdminActions({
    user,
    token,
    refreshTracks,
  });
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
  const {
    discoveryResults,
    discoveryStatus,
    discoveryStatusType,
    handleAddSessionLink,
    handleBulkImport,
    handleDiscoveryImport,
    handleDiscoverySearch,
    handleImportLink,
    resetDiscoveryState,
    sessionTracks,
    setDiscoveryStatus,
    setDiscoveryStatusType,
    setSessionTracks,
  } = useDiscoveryActions({
    user,
    token,
    refreshTracks,
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
    resetAdminStatus();
    setSettingsStatus("");
    resetDiscoveryState();
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
                      onCheckSourceHealth={handleCheckSourceHealth}
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
