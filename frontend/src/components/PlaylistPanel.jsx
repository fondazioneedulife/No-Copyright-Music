import { getGenre } from "../utils.js";

export function PlaylistPanel({ tracks, queuedTracks, activeGenre, onSelectGenre, onRemoveFromQueue, onClearQueue }) {
  const genreGroups = tracks.reduce((groups, track) => {
    const genre = getGenre(track);
    groups.set(genre, [...(groups.get(genre) || []), track]);
    return groups;
  }, new Map());
  const playlists = [...genreGroups.entries()]
    .map(([genre, entries]) => ({ genre, tracks: entries }))
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .slice(0, 8);
  return (
    <section className="panel playlist-panel" id="playlists">
      <div className="section-heading section-heading-row">
        <div>
          <p className="eyebrow">Playlist automatiche</p>
          <h2>Mix pronti per uso commerciale</h2>
          <p>Generi e raccolte vengono creati automaticamente dal catalogo locale.</p>
        </div>
      </div>

      <div className="playlist-grid">
        <button type="button" className={activeGenre === "all" ? "is-active" : ""} onClick={() => onSelectGenre("all")}>
          <strong>Tutta la libreria</strong>
          <span>{tracks.length} brani</span>
        </button>
        {playlists.map((playlist) => (
          <button
            key={playlist.genre}
            type="button"
            className={activeGenre === playlist.genre ? "is-active" : ""}
            onClick={() => onSelectGenre(playlist.genre)}
          >
            <strong>{playlist.genre}</strong>
            <span>{playlist.tracks.length} brani</span>
          </button>
        ))}
      </div>

      <div className="queue-panel">
        <div className="section-heading section-heading-row">
          <div>
            <p className="eyebrow">Coda</p>
            <h3>Coda di ascolto</h3>
          </div>
          <button type="button" disabled={queuedTracks.length === 0} onClick={onClearQueue}>
            Svuota coda
          </button>
        </div>
        <div className="queue-list">
          {queuedTracks.length === 0 ? (
            <p className="empty-state">Usa il tasto destro su una copertina per aggiungere brani.</p>
          ) : (
            queuedTracks.map((track, index) => (
              <article className="queue-row" key={track.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{track.title}</strong>
                  <small>{track.creatorName || track.subtitle || "Catalogo ClearWave"}</small>
                </div>
                <button type="button" onClick={() => onPlay(track)}>
                  Play
                </button>
                <button type="button" onClick={() => onRemoveFromQueue(track.id)}>
                  Togli
                </button>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
