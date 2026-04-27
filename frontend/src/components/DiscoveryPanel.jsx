import { useState } from "react";
import { getSource, readableDuration, sourceLabel } from "../utils.js";

function providerId(provider) {
  return provider.id || provider.provider || provider.providerId || provider.name || "all";
}

function providerName(provider) {
  return provider.name || provider.label || providerId(provider);
}

export function DiscoveryPanel({
  providers,
  results,
  isAdmin,
  sessionOwner = "",
  sessionTracks = [],
  status,
  statusType = "success",
  onSearch,
  onImportTrack,
  onBulkImport,
  onImportLink,
  onAddSessionLink,
  onPlaySessionTrack,
  onRemoveSessionTrack,
  onClearSessionTracks,
  onLogout,
}) {
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [provider, setProvider] = useState("all");
  const [busyAction, setBusyAction] = useState("");

  async function runAction(actionName, action) {
    setBusyAction(actionName);
    try {
      return await action();
    } finally {
      setBusyAction("");
    }
  }

  async function addToTemporaryPlaylist() {
    const added = await runAction("temporary", () => onAddSessionLink(link.trim()));
    if (added) {
      setLink("");
    }
  }

  return (
    <section className="panel discovery-panel" id="discovery">
      <div className="section-heading section-heading-row">
        <div>
          <p className="eyebrow">Import</p>
          <h2>Aggiungi brani</h2>
          <p>Aggiungi piccoli lotti da Jamendo e dai canali YouTube whitelist.</p>
        </div>
      </div>

      <div className="session-panel">
        <div className="session-panel-copy">
          <p className="eyebrow">Sessione utente</p>
          <h3>Playlist YouTube temporanea</h3>
          <p>Link di prova non salvati nel catalogo. Esci o svuota playlist per pulire la sessione.</p>
          <div className="session-meta">
            <span>{isAdmin ? "Solo amministratore" : "Sessione limitata"}</span>
            {sessionOwner ? <span>Sessione: {sessionOwner}</span> : null}
            <span>Pulizia automatica al logout</span>
          </div>
        </div>
        <div className="session-actions">
          <span>{sessionTracks.length} in prova</span>
          <button type="button" disabled={sessionTracks.length === 0} onClick={onClearSessionTracks}>
            Svuota playlist
          </button>
          <button type="button" onClick={onLogout}>
            Esci e pulisci
          </button>
        </div>
      </div>

      <div className="discovery-toolbar">
        <label>
          Importa da link
          <input
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Playlist/video/canale YouTube oppure traccia Jamendo"
          />
        </label>
        {isAdmin ? (
          <>
            <label>
              Query esterna
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ambient piano, upbeat retail, cinematic"
              />
            </label>
            <label>
              Sorgente
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="all">YouTube + Jamendo</option>
                {providers.map((entry) => {
                  const id = providerId(entry);
                  return (
                    <option key={id} value={id}>
                      {providerName(entry)}
                    </option>
                  );
                })}
              </select>
            </label>
          </>
        ) : null}
        <div className="discovery-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busyAction === "temporary" || !link.trim()}
            onClick={addToTemporaryPlaylist}
          >
            {busyAction === "temporary" ? "Aggiungo..." : "Aggiungi temporanea"}
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="primary-button"
              disabled={busyAction === "link" || !link.trim()}
              onClick={() => runAction("link", () => onImportLink(link.trim()))}
            >
              {busyAction === "link" ? "Salvo..." : "Salva nel catalogo"}
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              disabled={busyAction === "search"}
              onClick={() => runAction("search", () => onSearch({ query, provider }))}
            >
              {busyAction === "search" ? "Cerco..." : "Cerca online"}
            </button>
          ) : null}
          {isAdmin ? (
            <button type="button" disabled={busyAction === "bulk"} onClick={() => runAction("bulk", onBulkImport)}>
              {busyAction === "bulk" ? "Importo..." : "Importa lotto"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="temporary-playlist">
        <div className="temporary-playlist-head">
          <div>
            <p className="eyebrow">Playlist temporanea</p>
            <h3>{sessionTracks.length === 0 ? "Nessuna traccia in prova" : `${sessionTracks.length} tracce in prova`}</h3>
            <p>Sessione locale admin: non viene salvata nel catalogo commercial-safe.</p>
          </div>
          <span>Non salvata nel catalogo</span>
        </div>
        <div className="queue-list">
          {sessionTracks.length === 0 ? (
            <p className="empty-state">Aggiungi un link YouTube per provarlo in questa sessione.</p>
          ) : (
            sessionTracks.map((track, index) => (
              <article className="queue-row temporary-row" key={track.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{track.title}</strong>
                  <small>
                    {track.creatorName || track.subtitle || "YouTube temporaneo"} | {readableDuration(track)}
                  </small>
                  {track.sourceUrl ? (
                    <a href={track.sourceUrl} target="_blank" rel="noreferrer">
                      Fonte YouTube
                    </a>
                  ) : null}
                </div>
                <button type="button" onClick={() => onPlaySessionTrack(track)}>
                  Play
                </button>
                <button type="button" onClick={() => onRemoveSessionTrack(track.id)}>
                  Togli
                </button>
              </article>
            ))
          )}
        </div>
      </div>

      <p className="import-hint">
        Catalogo sicuro: Jamendo e canali YouTube whitelist restano salvati con controlli licenza.
        Conserva sempre prova della licenza prima dell'uso commerciale.
      </p>

      <div className="provider-pills">
        {providers.map((entry) => (
          <span key={providerId(entry)} className={entry.enabled === false ? "is-disabled" : ""}>
            {providerName(entry)}
          </span>
        ))}
      </div>

      {status ? <p className={`status-banner is-${statusType}`}>{status}</p> : null}

      <div className="discovery-results">
        {results.length === 0 ? (
          <p className="empty-state">Cerca online o importa un lotto per vedere risultati qui.</p>
        ) : (
          results.map((track) => (
            <article key={track.id || `${track.title}-${track.sourceUrl}`}>
              <div>
                <strong>{track.title}</strong>
                <span>{track.creatorName || track.subtitle || "Fonte esterna"}</span>
                <small>
                  {sourceLabel(getSource(track))} | {readableDuration(track)} | {track.license || "licenza da verificare"}
                </small>
              </div>
              <button type="button" onClick={() => onImportTrack(track)}>
                Importa
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
