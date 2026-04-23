export function Hero({ tracksCount, queueCount, noAttributionCount, useCaseCount, onNavigate, isAdmin }) {
  return (
    <section className="hero-panel" id="top">
      <div className="hero-copy">
        <p className="eyebrow">ClearWave Music</p>
        <h1>Applicazione musicale OpenSource con musica commerciale.</h1>
        <p>Catalogo pulito: cerca, scegli un genere e premi play.</p>
        <div className="hero-actions">
          <button type="button" className="primary-button" onClick={() => onNavigate("catalog")}>
            Apri catalogo
          </button>
          {isAdmin ? (
            <button type="button" onClick={() => onNavigate("discovery")}>
              Importa lotto
            </button>
          ) : null}
        </div>
        <div className="hero-metrics">
          <article>
            <strong>{tracksCount}</strong>
            <span>Brani reali</span>
          </article>
          <article>
            <strong>{noAttributionCount}</strong>
            <span>No attribution</span>
          </article>
          <article>
            <strong>{useCaseCount}</strong>
            <span>Use case coperti</span>
          </article>
        </div>
      </div>
      <aside className="hero-spotlight" aria-label="Riepilogo libreria">
        <p className="eyebrow">Library</p>
        <h2>Jamendo + YouTube whitelist.</h2>
        <span>{queueCount} in coda</span>
      </aside>
    </section>
  );
}
