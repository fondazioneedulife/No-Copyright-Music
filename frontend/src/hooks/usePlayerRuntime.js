import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchServerPlayerStatus,
  pauseServerTrack,
  playServerTrack,
  seekServerTrack,
  setServerTrackContext,
  setServerTrackVolume,
  stopServerTrack,
} from "../api/client.js";
import {
  clampVolumeLevel,
  compactPlayerNotice,
  durationSecondsFor,
  isYouTubeTrack,
  playableSourceFor,
  playerConnectionMessage,
  youtubeEmbedSourceFor,
} from "../utils.js";

export function usePlayerRuntime({
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
}) {
  const audioRef = useRef(null);
  const embedFrameRef = useRef(null);
  const embedClockRef = useRef({ baseTime: 0, startedAt: 0 });
  const playbackRequestRef = useRef(0);
  const serverRunIdRef = useRef(0);
  const serverVolumeTimerRef = useRef(null);
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

  const knownTracks = useMemo(() => [...tracks, ...catalogTracks, ...sessionTracks], [
    catalogTracks,
    sessionTracks,
    tracks,
  ]);
  const queuedTracks = useMemo(
    () => queueIds.map((trackId) => knownTracks.find((track) => track.id === trackId)).filter(Boolean),
    [knownTracks, queueIds]
  );

  function setPlayerVolume(nextVolume) {
    setVolume(clampVolumeLevel(nextVolume));
  }

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

  function handleAudioPause() {
    if (playerMode === "audio") {
      setIsPlaying(false);
    }
  }

  async function stopPlaybackForLogout() {
    const audio = audioRef.current;
    if (token) {
      try {
        await stopServerTrack(token);
      } catch {
        // Se il player Raspberry non e' attivo, il logout deve comunque proseguire.
      }
    }

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    stopEmbedPlayback(0);
    embedClockRef.current = { baseTime: 0, startedAt: 0 };
    setQueueIds([]);
    setSessionTracks([]);
    setActiveTrack(null);
    setPlayerMode("idle");
    setIsPlaying(false);
    updateClock(0, 0);
    setPlayerNotice("");
  }

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

        setPlayerNotice(compactPlayerNotice(player.error));

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

  return {
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
  };
}
