import { useEffect, useMemo, useRef, useState } from "react";
import {
  bulkImportDiscovery,
  changePassword,
  createTrack,
  createUser,
  deleteUser,
  exportCatalogBackup,
  exportLicenseReport,
  exportLicenseReportHtml,
  fetchAdminDiagnostics,
  fetchDiscoveryProviders,
  fetchCurrentUser,
  fetchServerPlayerStatus,
  fetchTracks,
  fetchUsers,
  importDiscoveryLink,
  importDiscoveryTrack,
  importCatalogBackup,
  importSessionLink,
  login,
  logout,
  pauseServerTrack,
  playServerTrack,
  readStoredToken,
  resetUserPassword,
  resetYouTubeImportState,
  searchDiscovery,
  seekServerTrack,
  setServerTrackContext,
  setServerTrackVolume,
  stopServerTrack,
  storeToken,
} from "./api/client.js";
import { AdminPanel } from "./components/AdminPanel.jsx";
import { AuthGate } from "./components/AuthGate.jsx";
import { Catalog } from "./components/Catalog.jsx";
import { DiscoveryPanel } from "./components/DiscoveryPanel.jsx";
import { Hero } from "./components/Hero.jsx";
import { PlayerDock } from "./components/PlayerDock.jsx";
import { PlaylistPanel } from "./components/PlaylistPanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { StudioPanel } from "./components/StudioPanel.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { useCatalogPage } from "./hooks/useCatalogPage.js";
import {
  durationSecondsFor,
  getGenre,
  getSource,
  isYouTubeTrack,
  normalizeSearch,
  playableSourceFor,
  trackMatchesSearch,
  youtubeEmbedSourceFor,
} from "./utils.js";

function clampVolumeLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.75;
  }

  return Math.max(0, Math.min(1, numeric));
}

function downloadBlob({ blob, filename }) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function playerConnectionMessage(error, fallback) {
  const message = error?.message || "";
  if (/backend.*non raggiungibile/i.test(message)) {
    return "Connessione UI/backend momentaneamente persa. Se il Raspberry sta gia' suonando, la musica continua.";
  }

  return message || fallback;
}

export default function App() {
  // App contiene solo lo stato globale: i dettagli visivi sono nei componenti sotto components/.
  const audioRef = useRef(null);
  const embedFrameRef = useRef(null);
  const embedClockRef = useRef({ baseTime: 0, startedAt: 0 });
  const playbackRequestRef = useRef(0);
  const serverRunIdRef = useRef(0);
  const serverVolumeTimerRef = useRef(null);
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
  const [activeTrack, setActiveTrack] = useState(null);
  const [playerMode, setPlayerMode] = useState("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [playbackTarget, setPlaybackTarget] = useState(
    () => window.localStorage.getItem("clearwave-playback-target") || "server"
  );
  const [playerNotice, setPlayerNotice] = useState("");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const [embedSource, setEmbedSource] = useState("");
  const [adminStatus, setAdminStatus] = useState("");
  const [adminStatusType, setAdminStatusType] = useState("success");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [settingsStatusType, setSettingsStatusType] = useState("success");
  const [discoveryProviders, setDiscoveryProviders] = useState([]);
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

  function setPlayerVolume(nextVolume) {
    setVolume(clampVolumeLevel(nextVolume));
  }

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
    // Target audio salvato: sul Raspberry l'app riparte gia' in modalita' server-side.
    window.localStorage.setItem("clearwave-playback-target", playbackTarget);
  }, [playbackTarget]);

  useEffect(() => {
    const safeVolume = clampVolumeLevel(volume);
    if (safeVolume !== volume) {
      setVolume(safeVolume);
      return undefined;
    }

    if (audioRef.current) {
      audioRef.current.volume = safeVolume;
    }

    sendEmbedVolume(safeVolume);

    if (!token || playbackTarget !== "server") {
      return undefined;
    }

    window.clearTimeout(serverVolumeTimerRef.current);
    serverVolumeTimerRef.current = window.setTimeout(() => {
      // Lo slider resta immediato, ma il Raspberry riceve meno comandi IPC e non si intasa.
      void setServerTrackVolume(token, safeVolume).catch((error) => {
        setPlayerNotice(playerConnectionMessage(error, "Volume Raspberry non raggiungibile."));
      });
    }, 160);

    return () => window.clearTimeout(serverVolumeTimerRef.current);
  }, [volume, playbackTarget, token]);

  useEffect(() => {
    // Se l'uscita selezionata e' il Raspberry, teniamo la UI allineata anche dopo refresh o errori mpv.
    if (playbackTarget !== "server" || !token) {
      return undefined;
    }

    let cancelled = false;
    async function syncServerPlayer() {
      try {
        const payload = await fetchServerPlayerStatus(token);
        if (cancelled) {
          return;
        }

        const player = payload.player || {};
        serverRunIdRef.current = Number(player.runId || 0);
        const nextDuration = Number(player.duration || durationSecondsFor(activeTrack));
        const nextPosition = Math.max(0, Number(player.position) || 0);
        const serverVolume = Number(player.volume);

        if (Number.isFinite(serverVolume)) {
          setVolume((currentVolume) => {
            const nextVolume = clampVolumeLevel(serverVolume / 100);
            return Math.abs(currentVolume - nextVolume) > 0.004 ? nextVolume : currentVolume;
          });
        }

        setPlayerNotice(player.error || "");

        if (!player.activeTrack) {
          // Se non c'e' nulla sul Raspberry, azzeriamo solo una sessione server gia' attiva.
          if (playerMode === "server") {
            setIsPlaying(false);
            setPlayerMode("idle");
            setActiveTrack(null);
            updateClock(0, 0);
          }
          return;
        }

        setActiveTrack((current) => (current?.id === player.activeTrack.id ? current : player.activeTrack));
        setPlayerMode("server");

        if (nextDuration > 0) {
          updateClock(nextPosition, nextDuration);
        }

        if (player.isPlaying) {
          embedClockRef.current = { baseTime: nextPosition, startedAt: performance.now() };
          setIsPlaying(true);
        } else if (player.isPaused) {
          embedClockRef.current = { baseTime: nextPosition, startedAt: 0 };
          setIsPlaying(false);
        }
      } catch (error) {
        if (!cancelled) {
          setPlayerNotice(playerConnectionMessage(error, "Player Raspberry non raggiungibile."));
        }
      }
    }

    void syncServerPlayer();
    const timerId = window.setInterval(() => {
      void syncServerPlayer();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [playbackTarget, token, activeTrack]);

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
    if (!user) {
      return;
    }

    let cancelled = false;
    async function loadProviders() {
      try {
        const payload = await fetchDiscoveryProviders();
        if (!cancelled) {
          setDiscoveryProviders(payload.providers || []);
        }
      } catch {
        if (!cancelled) {
          setDiscoveryProviders([]);
        }
      }
    }

    void loadProviders();
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
  const knownTracks = useMemo(() => [...tracks, ...catalogTracks, ...sessionTracks], [
    catalogTracks,
    sessionTracks,
    tracks,
  ]);
  const queuedTracks = useMemo(
    () => queueIds.map((trackId) => knownTracks.find((track) => track.id === trackId)).filter(Boolean),
    [knownTracks, queueIds]
  );
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

  function playbackListForTrack(track = activeTrack) {
    // Questa lista viene inviata anche al backend: cosi' il Raspberry continua se il browser si chiude.
    const catalogPlaybackList = filteredTracks.length > 0 ? filteredTracks : catalogTracks;
    const trackInSession = sessionTracks.some((sessionTrack) => sessionTrack.id === track?.id);
    return queuedTracks.length > 0 ? queuedTracks : trackInSession ? sessionTracks : catalogPlaybackList;
  }

  function serverPlaybackContextFor(track = activeTrack) {
    const list = playbackListForTrack(track);
    const trackInSession = sessionTracks.some((sessionTrack) => sessionTrack.id === track?.id);
    return {
      trackIds: trackInSession ? [] : list.map((entry) => entry.id).filter(Boolean),
      tracks: trackInSession ? list : [],
      repeatMode,
      shuffleEnabled,
    };
  }

  useEffect(() => {
    // Aggiorna la coda lato Raspberry dopo che lista e filtri React sono gia' inizializzati.
    if (playerMode !== "server" || !token || !activeTrack) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      void setServerTrackContext(token, {
        serverContext: serverPlaybackContextFor(activeTrack),
      }).catch((error) => {
        setPlayerNotice(playerConnectionMessage(error, "Contesto Raspberry non aggiornato."));
      });
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [
    playerMode,
    token,
    activeTrack?.id,
    queueIds,
    repeatMode,
    shuffleEnabled,
    filteredTracks,
    catalogTracks,
    sessionTracks,
    queuedTracks,
  ]);

  function sendEmbedCommand(func, args = []) {
    // I comandi YouTube rendono play, pausa, seek e volume immediati senza ricaricare l'iframe.
    const frameWindow = embedFrameRef.current?.contentWindow;
    if (!frameWindow) {
      return false;
    }

    frameWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
    return true;
  }

  function sendEmbedVolume(nextVolume = volume) {
    const safeVolume = Math.round(Math.max(0, Math.min(1, nextVolume)) * 100);
    sendEmbedCommand("setVolume", [safeVolume]);
    sendEmbedCommand(safeVolume === 0 ? "mute" : "unMute");
  }

  function primeEmbedPlayer() {
    // L'iframe puo' impiegare un istante a esporsi: inviamo due passate leggere e idempotenti.
    const pushStateToEmbed = () => {
      sendEmbedVolume(volume);
      if (playerMode === "embed" && activeTrack) {
        sendEmbedCommand("seekTo", [currentTime, true]);
        sendEmbedCommand(isPlaying ? "playVideo" : "pauseVideo");
      }
    };

    pushStateToEmbed();
    window.setTimeout(pushStateToEmbed, 350);
  }

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
    const audio = audioRef.current;
    if (token) {
      try {
        await stopServerTrack(token);
      } catch {
        // Se il player Raspberry non e' attivo, il logout deve comunque proseguire.
      }

      try {
        await logout(token);
      } catch {
        // Anche se il backend non risponde, la sessione locale va pulita.
      }
    }

    // Il logout deve lasciare l'interfaccia davvero ferma: niente audio browser o iframe residui.
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    stopEmbedPlayback(0);
    embedClockRef.current = { baseTime: 0, startedAt: 0 };

    storeToken("");
    setToken("");
    setUser(null);
    setTracks([]);
    resetCatalogPage();
    setQueueIds([]);
    setSessionTracks([]);
    setActiveTrack(null);
    setPlayerMode("idle");
    setIsPlaying(false);
    updateClock(0, 0);
    setActiveSection("catalog");
    setAdminStatus("");
    setSettingsStatus("");
    setDiscoveryResults([]);
    setPlayerNotice("");
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

  function syncEmbedClock() {
    // Lo stesso clock ottimistico vale per YouTube embed e per il Raspberry controllato via API.
    if ((playerMode !== "embed" && playerMode !== "server") || !embedClockRef.current.startedAt) {
      return currentTime;
    }

    const elapsed = (performance.now() - embedClockRef.current.startedAt) / 1000;
    return embedClockRef.current.baseTime + elapsed;
  }

  function stopEmbedPlayback(nextTime = 0) {
    embedClockRef.current = { baseTime: nextTime, startedAt: 0 };
    sendEmbedCommand("stopVideo");
    setEmbedSource("");
  }

  function updateClock(nextCurrentTime, nextDuration = duration) {
    const safeDuration = Math.max(0, Number(nextDuration) || 0);
    const safeTime = Math.max(0, Number(nextCurrentTime) || 0);
    setCurrentTime(safeTime);
    setDuration(safeDuration);
    setProgress(safeDuration > 0 ? Math.min(100, (safeTime / safeDuration) * 100) : 0);
  }

  function pausePlayback() {
    const requestId = ++playbackRequestRef.current;
    const audio = audioRef.current;
    if (playerMode === "audio" && audio) {
      audio.pause();
    }

    if (playerMode === "embed") {
      const pausedAt = syncEmbedClock();
      embedClockRef.current = { baseTime: pausedAt, startedAt: 0 };
      sendEmbedCommand("pauseVideo");
      updateClock(pausedAt);
    }

    if (playerMode === "server") {
      const pausedAt = syncEmbedClock();
      embedClockRef.current = { baseTime: pausedAt, startedAt: 0 };
      updateClock(pausedAt);
      if (token) {
        void pauseServerTrack(token, true).catch((error) => {
          if (playbackRequestRef.current === requestId) {
            setPlayerNotice(playerConnectionMessage(error, "Pausa Raspberry non riuscita."));
          }
        });
      }
    }

    setIsPlaying(false);
  }

  function playTrack(track, options = {}) {
    // Player misto: Raspberry via backend quando selezionato, browser locale come fallback.
    const requestId = ++playbackRequestRef.current;
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const sameTrack = activeTrack?.id === track.id;
    if (sameTrack && isPlaying && !options.forceRestart) {
      pausePlayback();
      return;
    }

    const startAt = sameTrack && !options.forceRestart ? currentTime : Number(options.startAt || 0);
    const nextDuration = durationSecondsFor(track);
    setActiveTrack(track);
    updateClock(startAt, nextDuration);

    if (playbackTarget === "server") {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      stopEmbedPlayback(0);
      setPlayerMode("server");
      setIsPlaying(true);
      setPlayerNotice("");
      embedClockRef.current = { baseTime: startAt, startedAt: performance.now() };

      if (!token) {
        setIsPlaying(false);
        setPlayerNotice("Accesso richiesto per comandare il Raspberry.");
        return;
      }

      if (sameTrack && playerMode === "server" && !isPlaying && !options.forceRestart) {
        // Resume vero: se il brano e' gia' caricato in mpv, togliamo solo la pausa invece di riaprirlo.
        void pauseServerTrack(token, false)
          .then((payload) => {
            if (playbackRequestRef.current !== requestId) {
              return;
            }

            const serverDuration = Number(payload.player?.duration || nextDuration);
            const serverPosition = Number(payload.player?.position ?? startAt);
            if (serverDuration > 0) {
              updateClock(serverPosition, serverDuration);
            }
            serverRunIdRef.current = Number(payload.player?.runId || serverRunIdRef.current);
            embedClockRef.current = { baseTime: serverPosition, startedAt: performance.now() };
            setIsPlaying(true);
            setPlayerNotice("");
          })
          .catch((error) => {
            if (playbackRequestRef.current !== requestId) {
              return;
            }

            embedClockRef.current = { baseTime: startAt, startedAt: 0 };
            setIsPlaying(false);
            setPlayerMode("idle");
            setPlayerNotice(playerConnectionMessage(error, "Resume Raspberry non riuscito."));
          });
        return;
      }

      void playServerTrack(token, { track, startAt, volume, serverContext: serverPlaybackContextFor(track) })
        .then((payload) => {
          if (playbackRequestRef.current !== requestId) {
            return;
          }

          const serverDuration = Number(payload.player?.duration || nextDuration);
          if (serverDuration > 0) {
            updateClock(startAt, serverDuration);
          }
          serverRunIdRef.current = Number(payload.player?.runId || serverRunIdRef.current);
          setPlayerNotice("");
        })
        .catch((error) => {
          if (playbackRequestRef.current !== requestId) {
            return;
          }

          embedClockRef.current = { baseTime: startAt, startedAt: 0 };
          setIsPlaying(false);
          setPlayerMode("idle");
          setPlayerNotice(playerConnectionMessage(error, "Player Raspberry non raggiungibile."));
        });
      return;
    }

    if (playerMode === "server" && token) {
      void stopServerTrack(token, { trackId: activeTrack?.id, runId: serverRunIdRef.current }).catch(() => {});
    }

    if (isYouTubeTrack(track)) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setPlayerMode("embed");
      embedClockRef.current = { baseTime: startAt, startedAt: performance.now() };
      setIsPlaying(true);

      if (sameTrack && embedSource && !options.forceRestart) {
        sendEmbedCommand("seekTo", [startAt, true]);
        sendEmbedCommand("playVideo");
        sendEmbedVolume(volume);
      } else {
        setEmbedSource(youtubeEmbedSourceFor(track, startAt));
      }
      setPlayerNotice("");
      return;
    }

    stopEmbedPlayback(0);
    setPlayerMode("audio");
    if (!sameTrack || !audio.src || options.forceRestart) {
      audio.src = playableSourceFor(track);
    }
    try {
      audio.currentTime = startAt;
    } catch {
      // Alcune sorgenti impostano la posizione solo dopo i metadata: il play resta comunque valido.
    }
    audio.volume = volume;
    void audio
      .play()
      .then(() => {
        if (playbackRequestRef.current !== requestId) {
          return;
        }

        setIsPlaying(true);
        setPlayerNotice("");
      })
      .catch(() => {
        if (playbackRequestRef.current !== requestId) {
          return;
        }

        setIsPlaying(false);
        setPlayerNotice("Play browser non riuscito.");
      });
  }

  function playAdjacent(direction, options = {}) {
    // Se stai ascoltando la playlist temporanea, prev/next restano in quella sessione.
    const list = playbackListForTrack(activeTrack);
    if (list.length === 0) {
      return false;
    }

    const currentIndex = list.findIndex((track) => track.id === activeTrack?.id);
    let nextIndex = currentIndex < 0 ? 0 : currentIndex + direction;

    if (shuffleEnabled && direction > 0 && list.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * list.length);
      } while (nextIndex === currentIndex);
    }

    if (nextIndex >= list.length) {
      if (repeatMode !== "all" && options.fromEnded) {
        setIsPlaying(false);
        return false;
      }
      nextIndex = 0;
    }

    if (nextIndex < 0) {
      nextIndex = list.length - 1;
    }

    playTrack(list[nextIndex], { forceRestart: true, startAt: 0 });
    return true;
  }

  function toggleQueue(track) {
    // Click destro sulla cover aggiunge/toglie il brano dalla coda.
    setQueueIds((current) =>
      current.includes(track.id) ? current.filter((trackId) => trackId !== track.id) : [...current, track.id]
    );
  }

  function removeFromQueue(trackId) {
    setQueueIds((current) => current.filter((id) => id !== trackId));
  }

  function removeSessionTrack(trackId) {
    setSessionTracks((current) => current.filter((track) => track.id !== trackId));
    if (activeTrack?.id === trackId) {
      pausePlayback();
      setActiveTrack(null);
      stopEmbedPlayback(0);
      if (playerMode === "server" && token) {
        void stopServerTrack(token, { trackId, runId: serverRunIdRef.current }).catch(() => {});
      }
      setPlayerMode("idle");
      updateClock(0, 0);
      setPlayerNotice("Brano temporaneo rimosso dalla sessione.");
    }
  }

  function clearSessionTracks() {
    const activeWillBeCleared = sessionTracks.some((track) => track.id === activeTrack?.id);
    setSessionTracks([]);
    if (activeWillBeCleared) {
      pausePlayback();
      setActiveTrack(null);
      stopEmbedPlayback(0);
      if (playerMode === "server" && token) {
        void stopServerTrack(token, { trackId: activeTrack?.id, runId: serverRunIdRef.current }).catch(() => {});
      }
      setPlayerMode("idle");
      updateClock(0, 0);
    }
    setDiscoveryStatusType("success");
    setDiscoveryStatus("Playlist temporanea svuotata.");
  }

  function handleTimeUpdate() {
    if (playerMode !== "audio") {
      return;
    }

    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      updateClock(0, duration);
      return;
    }

    updateClock(audio.currentTime, audio.duration);
  }

  function handleLoadedMetadata() {
    if (playerMode !== "audio") {
      return;
    }

    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }

    setDuration(audio.duration);
  }

  function previewFallbackSource(track) {
    if (!track?.id) {
      return "";
    }

    return track.previewPath || `/api/tracks/${encodeURIComponent(track.id)}/preview.wav`;
  }

  function handleAudioError() {
    if (playerMode !== "audio") {
      return;
    }

    const requestId = playbackRequestRef.current;
    const audio = audioRef.current;
    if (!audio || !activeTrack) {
      setIsPlaying(false);
      return;
    }

    const fallbackSource = previewFallbackSource(activeTrack);
    const currentSource = audio.getAttribute("src") || "";
    if (fallbackSource && currentSource !== fallbackSource) {
      audio.src = fallbackSource;
      audio.currentTime = 0;
      void audio
        .play()
        .then(() => {
          if (playbackRequestRef.current !== requestId) {
            return;
          }

          setPlayerMode("audio");
          setIsPlaying(true);
          setPlayerNotice("Stream diretto non disponibile: uso preview backend.");
        })
        .catch(() => {
          if (playbackRequestRef.current !== requestId) {
            return;
          }

          setIsPlaying(false);
          setPlayerNotice("Audio browser non disponibile per questa traccia.");
        });
      return;
    }

    setIsPlaying(false);
    setPlayerNotice("Audio browser non disponibile per questa traccia.");
  }

  function handleSeek(nextPercent) {
    if (!activeTrack || duration <= 0) {
      return;
    }

    const nextTime = (Math.max(0, Math.min(100, nextPercent)) / 100) * duration;
    if (playerMode === "audio" && audioRef.current) {
      audioRef.current.currentTime = nextTime;
      updateClock(nextTime, duration);
      return;
    }

    if (playerMode === "embed") {
      updateClock(nextTime, duration);
      embedClockRef.current = { baseTime: nextTime, startedAt: isPlaying ? performance.now() : 0 };
      const sent = sendEmbedCommand("seekTo", [nextTime, true]);
      if (isPlaying) {
        sendEmbedCommand("playVideo");
      } else {
        sendEmbedCommand("pauseVideo");
      }

      if (!sent && isPlaying) {
        setEmbedSource(youtubeEmbedSourceFor(activeTrack, nextTime));
      }
    }

    if (playerMode === "server") {
      updateClock(nextTime, duration);
      embedClockRef.current = { baseTime: nextTime, startedAt: isPlaying ? performance.now() : 0 };
      if (token) {
        void seekServerTrack(token, nextTime).catch((error) => {
          setPlayerNotice(playerConnectionMessage(error, "Seek Raspberry non riuscito."));
        });
      }
    }
  }

  function toggleRepeatMode() {
    setRepeatMode((current) => (current === "off" ? "all" : current === "all" ? "one" : "off"));
  }

  function togglePlaybackTarget() {
    // Cambio uscita: Browser resta utile in sviluppo, Raspberry e' l'uscita reale in produzione.
    const nextTarget = playbackTarget === "server" ? "browser" : "server";
    if (playbackTarget === "server" && playerMode === "server" && token) {
      void stopServerTrack(token, { trackId: activeTrack?.id, runId: serverRunIdRef.current }).catch(() => {});
      setIsPlaying(false);
      embedClockRef.current = { baseTime: currentTime, startedAt: 0 };
    }

    if (nextTarget === "server" && playerMode === "audio" && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    if (nextTarget === "server" && playerMode === "embed") {
      const pausedAt = syncEmbedClock();
      stopEmbedPlayback(pausedAt);
      updateClock(pausedAt, duration);
      setIsPlaying(false);
    }

    setPlaybackTarget(nextTarget);
    setPlayerNotice(nextTarget === "server" ? "Uscita audio: Raspberry." : "Uscita audio: browser.");
  }

  function handleEnded() {
    // A fine brano si passa automaticamente al prossimo elemento della coda o lista filtrata.
    if (repeatMode === "one" && activeTrack) {
      playTrack(activeTrack, { forceRestart: true, startAt: 0 });
      return;
    }

    const endedOnServer = playerMode === "server";
    stopEmbedPlayback(0);
    updateClock(0, duration);
    const moved = playAdjacent(1, { fromEnded: true });
    if (!moved) {
      setIsPlaying(false);
      if (endedOnServer && token) {
        void stopServerTrack(token, { trackId: activeTrack?.id, runId: serverRunIdRef.current }).catch(() => {});
      }
    }
  }

  useEffect(() => {
    if ((playerMode !== "embed" && playerMode !== "server") || !isPlaying) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      const nextTime = syncEmbedClock();
      updateClock(nextTime, duration);
      if (playerMode !== "server" && duration > 0 && nextTime >= duration - 0.35) {
        handleEnded();
      }
    }, 500);

    return () => window.clearInterval(timerId);
  }, [playerMode, isPlaying, duration, activeTrack, repeatMode, queueIds, shuffleEnabled, sessionTracks]);

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
        onPause={() => {
          if (playerMode === "audio") {
            setIsPlaying(false);
          }
        }}
      />
    </>
  );
}
