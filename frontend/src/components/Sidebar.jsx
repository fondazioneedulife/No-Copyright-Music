export function Sidebar({ activeSection, onNavigate, user }) {
  // La sidebar e' un pannello persistente: il CSS la tiene fissa mentre il contenuto centrale scorre.
  const items = [
    ["catalog", "Catalogo"],
    ["playlists", "Generi"],
    ["discovery", "Import"],
    ["diagnostics", "Diagnostica"],
    ["settings", "Impostazioni"],
  ].filter(([id]) => {
    // Import e impostazioni sono strumenti admin: gli utenti normali vedono solo ascolto e generi.
    if (id === "discovery" || id === "diagnostics" || id === "settings") {
      return user?.role === "admin";
    }
    return true;
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span>CW</span>
        <div>
          <strong>ClearWave Library</strong>
          <small>Commercial-safe music hub</small>
        </div>
      </div>

      <nav>
        {items.map(([id, label]) => (
          <button
            key={id}
            className={activeSection === id ? "is-active" : ""}
            type="button"
            onClick={() => onNavigate(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="sidebar-card quick-card">
        <p className="eyebrow">Quick access</p>
        <button type="button" onClick={() => onNavigate("catalog")}>
          Nuove selezioni
        </button>
        <button type="button" onClick={() => onNavigate("studio")}>
          Documenti diritti
        </button>
      </section>
    </aside>
  );
}
