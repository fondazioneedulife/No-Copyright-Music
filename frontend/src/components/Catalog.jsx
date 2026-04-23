import { cx, getGenre, getSource, pageSize, readableDuration, sourceLabel } from "../utils.js";

export function Catalog({
  tracks,
  genres,
  genre,
  setGenre,
  source,
  setSource,
  page,
  setPage,
  queueIds,
  activeTrack,
  isPlaying,
  onPlay,
  onToggleQueue,
  onNavigate,
  isAdmin,
}) {
  // La paginazione resta nel componente catalogo: 20 card per pagina, filtri sempre globali.
  const totalPages = Math.max(1, Math.ceil(tracks.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visibleTracks = tracks.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <section className="panel catalog-panel" id="catalogo">
      <div className="section-heading section-heading-row">
        <div>
          <p className="eyebrow">Catalogo</p>
          <h2>Brani disponibili</h2>
          <p>
            {tracks.length} tracce filtrate. Pagina {safePage} di {totalPages}.
          </p>
        </div>
        {isAdmin ? (
          <div className="section-actions">
            <button type="button" onClick={() => onNavigate("discovery")}>
              Aggiungi brani
            </button>
          </div>
        ) : null}
      </div>

      <div className="filter-rack">
        <label>
          Genere
          <select
            value={genre}
            onChange={(event) => {
              setGenre(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Tutti i generi</option>
            {genres.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sorgente
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">YouTube + Jamendo</option>
            <option value="youtube">Solo YouTube</option>
            <option value="jamendo">Solo Jamendo</option>
            <option value="other">Altro</option>
          </select>
        </label>
        <label>
          Mood
          <select disabled>
            <option>Tutti i mood</option>
          </select>
        </label>
        <label className="toggle-field">
          <input type="checkbox" disabled />
          <span>Senza attribuzione</span>
        </label>
      </div>

      <p className="results-summary">
        {tracks.length} risultati nel catalogo corrente. Click destro aggiunge alla coda.
      </p>

      <div className="track-grid">
        {visibleTracks.map((track) => {
          const queued = queueIds.includes(track.id);
          const playing = activeTrack?.id === track.id && isPlaying;
          const trackGenre = getGenre(track);
          return (
            <article
              className={cx("track-card", playing && "is-playing", queued && "is-queued")}
              key={track.id}
              onContextMenu={(event) => {
                // Tasto destro: scorciatoia rapida per la coda senza aggiungere bottoni visivi.
                event.preventDefault();
                onToggleQueue(track);
              }}
              title="Click destro: aggiungi o togli dalla coda"
            >
              <div className="track-cover">
                {track.coverPath ? (
                  <img src={track.coverPath} alt={track.coverAlt || `${track.title} cover`} />
                ) : (
                  <span className="cover-fallback">{track.title?.slice(0, 2).toUpperCase()}</span>
                )}
                <span className="genre-badge">{trackGenre}</span>
                <button type="button" className="track-play" onClick={() => onPlay(track)}>
                  {playing ? <span className="pause-icon" /> : <span className="play-icon" />}
                </button>
              </div>
              <div className="track-copy">
                <strong>{track.title}</strong>
                <span>{track.creatorName || track.subtitle || "Artista non indicato"}</span>
                <small>
                  {sourceLabel(getSource(track))} | {readableDuration(track)}
                </small>
                <div className="track-badges">
                  <span>{track.license || "Licenza da verificare"}</span>
                  <span>{track.attributionRequired ? "Attribuzione" : "No attribution"}</span>
                </div>
                <div className="asset-links">
                  {track.playbackPath || track.audioPath || track.previewPath ? (
                    <a href={track.playbackPath || track.audioPath || track.previewPath} target="_blank" rel="noreferrer">
                      Audio
                    </a>
                  ) : null}
                  {track.licensePath || track.licenseUrl ? (
                    <a href={track.licensePath || track.licenseUrl} target="_blank" rel="noreferrer">
                      Licenza
                    </a>
                  ) : null}
                  {track.sourceUrl ? (
                    <a href={track.sourceUrl} target="_blank" rel="noreferrer">
                      Fonte
                    </a>
                  ) : null}
                </div>
                <div className="track-actions">
                  <small>{queued ? "In coda" : "Click destro per coda"}</small>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <Pagination page={safePage} totalPages={totalPages} setPage={setPage} />
    </section>
  );
}

function Pagination({ page, totalPages, setPage }) {
  // Mostra solo poche pagine vicine per non creare una barra infinita con cataloghi grandi.
  if (totalPages <= 1) {
    return null;
  }

  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const visiblePages = [...pages].filter((entry) => entry >= 1 && entry <= totalPages).sort((a, b) => a - b);

  return (
    <div className="pagination">
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Prev
      </button>
      {visiblePages.map((entry) => (
        <button
          key={entry}
          type="button"
          className={entry === page ? "is-active" : ""}
          onClick={() => setPage(entry)}
        >
          {entry}
        </button>
      ))}
      <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
