import { formatClockTime } from "../utils.js";

export function PlayerDock({
  activeTrack,
  isPlaying,
  progress,
  currentTime,
  duration,
  volume,
  setVolume,
  playbackTarget,
  playerNotice,
  shuffleEnabled,
  repeatMode,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onTogglePlaybackTarget,
  onToggleShuffle,
  onToggleRepeat,
}) {
  // Player fisso in basso: riceve stato e azioni da App, ma non decide quale brano suonare.
  // onInput rende seek e volume immediati mentre trascini lo slider, senza aspettare il rilascio.
  const title = activeTrack?.title || "Nessuna traccia in ascolto";
  const subtitle = activeTrack?.subtitle || "Apri una traccia dal catalogo React.";
  const targetLabel = playbackTarget === "server" ? "Pi" : "PC";
  const stateLabel = isPlaying ? "In riproduzione" : activeTrack ? "In pausa" : "Idle";
  const handleVolumeInput = (event) => setVolume(Number(event.currentTarget.value) / 100);

  return (
    <footer className="player-dock">
      <div className="now-playing">
        <div className="mini-cover">
          {activeTrack?.coverPath ? <img src={activeTrack.coverPath} alt="" /> : <span>CW</span>}
        </div>
        <div className="now-playing-copy">
          <MarqueeLine as="strong" text={title} active={title.length > 42} />
          <MarqueeLine text={subtitle} active={subtitle.length > 36} />
        </div>
      </div>

      <div className="player-center">
        <span className="player-state" title={playerNotice || `Uscita audio: ${targetLabel}`}>
          {stateLabel} / {targetLabel}
        </span>
        {playerNotice ? <span className="player-notice">{playerNotice}</span> : null}
        <div className="transport">
          <button
            type="button"
            className={shuffleEnabled ? "is-active" : ""}
            aria-pressed={shuffleEnabled}
            onClick={onToggleShuffle}
            title="Shuffle"
          >
            <PlayerIcon name="shuffle" />
          </button>
          <button type="button" onClick={onPrev} title="Precedente">
            <PlayerIcon name="prev" />
          </button>
          <button type="button" className="player-toggle" onClick={onToggle} title="Play/Pausa">
            {isPlaying ? <span className="pause-icon" /> : <span className="play-icon" />}
          </button>
          <button type="button" onClick={onNext} title="Successiva">
            <PlayerIcon name="next" />
          </button>
          <button
            type="button"
            className={repeatMode !== "off" ? "is-active" : ""}
            aria-pressed={repeatMode !== "off"}
            onClick={onToggleRepeat}
            title={repeatMode === "one" ? "Repeat uno" : repeatMode === "all" ? "Repeat tutto" : "Repeat off"}
          >
            <PlayerIcon name={repeatMode === "one" ? "repeatOne" : "repeat"} />
          </button>
        </div>
        <div className="time-row">
          <span>{formatClockTime(currentTime)}</span>
          <input
            aria-label="Avanzamento brano"
            className="progress-range"
            type="range"
            min="0"
            max="100"
            value={Math.round(progress)}
            onInput={(event) => onSeek(Number(event.currentTarget.value))}
          />
          <span>{duration > 0 ? formatClockTime(duration) : "0:00"}</span>
        </div>
      </div>

      <div className="volume-cluster">
        <button
          type="button"
          className={playbackTarget === "server" ? "playback-target is-active" : "playback-target"}
          aria-pressed={playbackTarget === "server"}
          onClick={onTogglePlaybackTarget}
          title={playbackTarget === "server" ? "Audio sul Raspberry" : "Audio nel browser"}
        >
          <PlayerIcon name="server" />
          <span>{targetLabel}</span>
        </button>
        <label className="volume">
          Vol
          <input
            aria-label="Volume player"
            type="range"
            min="0"
            max="100"
            value={Math.round(volume * 100)}
            onInput={handleVolumeInput}
            onChange={handleVolumeInput}
          />
          <span>{Math.round(volume * 100)}%</span>
        </label>
      </div>
    </footer>
  );
}

function MarqueeLine({ as: Tag = "span", text, active = false }) {
  // Duplichiamo il testo solo quando e' lungo: dopo 5 secondi parte il movimento CSS.
  return (
    <Tag className={active ? "marquee-line is-marquee" : "marquee-line"} title={text}>
      <span className="marquee-track">
        <span>{text}</span>
        {active ? <span aria-hidden="true">{text}</span> : null}
      </span>
    </Tag>
  );
}

function PlayerIcon({ name }) {
  // Icone inline: evitano caratteri speciali rotti e mantengono i pulsanti compatti.
  const icons = {
    shuffle: (
      <>
        <path d="M4 7h3.5l9 10H20" />
        <path d="M16 5l4 4-4 4" />
        <path d="M4 17h3.5l2.5-2.8" />
        <path d="M14 8.8 16.5 6H20" />
      </>
    ),
    prev: (
      <>
        <path d="M6 5v14" />
        <path d="m19 6-9 6 9 6V6Z" />
      </>
    ),
    next: (
      <>
        <path d="M18 5v14" />
        <path d="m5 6 9 6-9 6V6Z" />
      </>
    ),
    repeat: (
      <>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11V9a3 3 0 0 1 3-3h15" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v2a3 3 0 0 1-3 3H3" />
      </>
    ),
    repeatOne: (
      <>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11V9a3 3 0 0 1 3-3h15" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v2a3 3 0 0 1-3 3H3" />
        <path d="M12 9v6" />
      </>
    ),
    server: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 8h8" />
        <path d="M8 13h8" />
        <path d="M9 17h.01" />
        <path d="M13 17h2" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" className="player-icon" viewBox="0 0 24 24">
      {icons[name]}
    </svg>
  );
}
