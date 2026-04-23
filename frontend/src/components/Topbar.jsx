export function Topbar({ user, search, setSearch, theme, setTheme, onLogout }) {
  return (
    <header className="topbar">
      <label className="search-box">
        <span className="sr-only">Cerca nel catalogo</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cerca per titolo, tag, strumento o licenza"
        />
      </label>

      <div className="topbar-actions">
        {/* La navigazione principale resta nella sidebar fissa; qui teniamo solo azioni globali. */}
        <span className="role-pill">
          {user?.role === "admin" ? "Admin: accesso completo" : "Utente: solo libreria"}
        </span>
        <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button type="button" onClick={onLogout}>
          Esci
        </button>
      </div>
    </header>
  );
}
