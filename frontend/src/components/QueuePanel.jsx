export function QueuePanel({ queuedTracks, onPlay, onRemove, onClear }) {
  return (
    <section className="panel queue-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Coda</p>
          <h2>Coda di ascolto</h2>
          <p>{queuedTracks.length ? `${queuedTracks.length} brani pronti.` : "La coda e' vuota."}</p>
        </div>
        <button type="button" disabled={queuedTracks.length === 0} onClick={onClear}>
          Svuota
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
              <button type="button" onClick={() => onRemove(track.id)}>
                Togli
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
