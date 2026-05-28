import {
  audioCheckSummary,
  commandSummary,
  cookieDiagnosticRows,
  diagnosticHealthChecks,
  diagnosticReasonRows,
  hardBrokenReasons,
  youtubeAuditSummary,
} from "./adminDiagnostics";

export function AdminDiagnosticsPanel({
  diagnostics,
  diagnosticsStatus,
  diagnosticsStatusType,
  autoRefreshAt,
  loadingDiagnostics,
  loadingYouTubeResults,
  checkingSourceHealth,
  probingYouTubeCookies,
  recheckingYouTubeLogin,
  recheckingArchivedTracks,
  startingYouTubeFullAudit,
  uploadingYouTubeCookies,
  removingYouTubeCookies,
  cleaningBrokenTracks,
  youtubeResults,
  youtubeResultsFilter,
  onLoadDiagnostics,
  onLoadYouTubeResults,
  onCheckSourceHealth,
  onProbeYouTubeCookies,
  onRecheckYouTubeLoginFailures,
  onRecheckArchivedAudioTracks,
  onStartYouTubeFullAudit,
  onUploadYouTubeCookiesFile,
  onRemoveYouTubeCookies,
  onRequestCleanupBroken,
  activeTab = "stato",
}) {
  // La diagnostica Raspberry e' volutamente isolata: contiene molte viste operative e log lunghi.
  const preflightResults = Array.isArray(diagnostics?.audioPreflight) ? diagnostics.audioPreflight : [];
  const healthChecks = diagnosticHealthChecks(diagnostics);
  const playerEvents = Array.isArray(diagnostics?.player?.events) ? diagnostics.player.events : [];
  const diagnosticTools = diagnostics
    ? [
        ["mpv", diagnostics.tools?.mpv],
        ["yt-dlp", diagnostics.tools?.ytdlp],
        ["deno/js", diagnostics.tools?.ytdlJsRuntime],
        ["provider PO", diagnostics.tools?.bgutilProvider],
        ["aplay -l", diagnostics.alsa?.listDevices],
      ]
    : [];
  const replacementList = diagnostics?.replacementList || null;
  const replacementItems = Array.isArray(replacementList?.items) ? replacementList.items : [];
  const hardBrokenItems = replacementItems.filter((item) =>
    hardBrokenReasons.has(String(item.reason || "").toLowerCase())
  );
  const youtubeAudit = diagnostics?.youtubeAudit || null;
  const sourceHealth = diagnostics?.sourceHealth || null;
  const sourceHealthChecks = Array.isArray(sourceHealth?.checks) ? sourceHealth.checks : [];
  const youtubeAuditLog = Array.isArray(youtubeAudit?.logTail) ? youtubeAudit.logTail.slice(-20) : [];
  const audioCheckLog = Array.isArray(diagnostics?.audioCheck?.logTail)
    ? diagnostics.audioCheck.logTail.slice(-20)
    : [];
  const warningHealthChecks = healthChecks.filter((entry) => !entry.ok);
  const okHealthChecks = healthChecks.filter((entry) => entry.ok);
  const cookieRows = cookieDiagnosticRows(diagnostics);
  const checkReasonRows = diagnosticReasonRows(diagnostics, youtubeAudit);
  const youtubeResultItems = Array.isArray(youtubeResults?.items) ? youtubeResults.items : [];
  const cookieReady = Boolean(
    diagnostics?.config?.ytdlCookiesAvailable && diagnostics?.config?.ytdlCookieAnalysis?.hasSessionCookies
  );
  const autoRefreshActive = Boolean(youtubeAudit?.running || diagnostics?.audioCheck?.running);

  let youtubeAuditEtaText = "";
  if (youtubeAudit?.running && youtubeAudit.startedAt && youtubeAudit.checked > 0 && youtubeAudit.total > 0) {
    const elapsedMs = Date.now() - new Date(youtubeAudit.startedAt).getTime();
    if (elapsedMs > 5000) {
      const msPerTrack = elapsedMs / youtubeAudit.checked;
      const remainingTracks = Math.max(0, youtubeAudit.total - youtubeAudit.checked);
      const remainingMs = remainingTracks * msPerTrack;
      if (remainingMs > 0) {
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        youtubeAuditEtaText = `Circa ${remainingMinutes} min. rimanenti`;
        if (remainingMinutes > 60) {
          const hours = Math.floor(remainingMinutes / 60);
          const mins = remainingMinutes % 60;
          youtubeAuditEtaText = `Circa ${hours}h ${mins}m rimanenti`;
        }
      }
    }
  }

  return (
    <article className="admin-tool-card diagnostic-card diagnostic-page">
      <div className="diagnostic-head">
        <div>
          <p className="eyebrow">Raspberry</p>
          <h3>Pagina diagnostica</h3>
          <p>Prima gli errori, poi lo stato funzionante, i check manuali e i log tecnici.</p>
        </div>
      </div>

      {diagnosticsStatus ? (
        <p className={`status-banner is-${diagnosticsStatusType}`}>{diagnosticsStatus}</p>
      ) : null}

      {autoRefreshActive ? (
        <p className="status-banner is-info">
          Auto-refresh attivo: aggiorno lo stato dei controlli ogni pochi secondi
          {autoRefreshAt ? `, ultimo aggiornamento ${autoRefreshAt}.` : "."}
        </p>
      ) : null}

      <section className="diagnostic-section diagnostic-controls-section">
        <div className="diagnostic-section-title">
          <div>
            <p className="eyebrow">Check</p>
            <h4>Controlli manuali</h4>
          </div>
          <small>Usali quando vuoi verificare Raspberry, sorgenti, cookie o catalogo YouTube.</small>
        </div>
        <div className="admin-tool-actions diagnostic-actions">
          <button type="button" onClick={onLoadDiagnostics} disabled={loadingDiagnostics}>
            {loadingDiagnostics ? "Controllo..." : "Aggiorna diagnostica"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onCheckSourceHealth}
            disabled={checkingSourceHealth}
          >
            {checkingSourceHealth ? "Test..." : "Test sorgenti"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onProbeYouTubeCookies}
            disabled={probingYouTubeCookies}
          >
            {probingYouTubeCookies ? "Test..." : "Test cookie YouTube"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onRecheckYouTubeLoginFailures}
            disabled={recheckingYouTubeLogin}
          >
            {recheckingYouTubeLogin ? "Ricontrollo..." : "Ricontrolla login YouTube"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onRecheckArchivedAudioTracks}
            disabled={recheckingArchivedTracks}
          >
            {recheckingArchivedTracks ? "Riverifico..." : "Riverifica archiviate"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onStartYouTubeFullAudit}
            disabled={startingYouTubeFullAudit || youtubeAudit?.running}
          >
            {youtubeAudit?.running
              ? `Verifica ${youtubeAudit.progress || 0}%`
              : startingYouTubeFullAudit
                ? "Avvio..."
                : "Verifica intero catalogo"}
          </button>
          <label className={`file-button ${uploadingYouTubeCookies ? "is-disabled" : ""}`}>
            {uploadingYouTubeCookies ? "Carico..." : "Carica cookies.txt"}
            <input
              type="file"
              accept=".txt,text/plain"
              disabled={uploadingYouTubeCookies}
              onChange={onUploadYouTubeCookiesFile}
            />
          </label>
          <button
            type="button"
            className="danger-button"
            onClick={onRemoveYouTubeCookies}
            disabled={removingYouTubeCookies}
          >
            {removingYouTubeCookies ? "Rimuovo..." : "Rimuovi vecchi cookie"}
          </button>
        </div>
      </section>

      {activeTab === "stato" && warningHealthChecks.length > 0 ? (
        <section className="diagnostic-section diagnostic-problem-section">
          <div className="diagnostic-section-title">
            <div>
              <p className="eyebrow">Errori</p>
              <h4>Avvisi e cose da sistemare</h4>
            </div>
            <small>{warningHealthChecks.length} controllo/i richiedono attenzione.</small>
          </div>
          <div className="diagnostic-events is-readable diagnostic-problems">
          {warningHealthChecks.map((entry) => (
            <div key={`warning-${entry.label}`}>
              <strong>{entry.label}</strong>
              <span>{entry.detail}</span>
              <small>
                {entry.label === "Cookie YouTube"
                  ? "Il file esiste, ma non basta: deve contenere cookie di sessione login esportati da YouTube gia' autenticato."
                  : "Apri il dettaglio sotto per leggere il messaggio completo e capire il prossimo passo."}
              </small>
            </div>
          ))}
          </div>
        </section>
      ) : diagnostics ? (
        <section className="diagnostic-section diagnostic-problem-section">
          <div className="diagnostic-section-title">
            <div>
              <p className="eyebrow">Errori</p>
              <h4>Nessun avviso attivo</h4>
            </div>
            <small>La diagnostica non sta segnalando problemi principali.</small>
          </div>
        </section>
      ) : null}

      {activeTab === "stato" && okHealthChecks.length > 0 ? (
        <section className="diagnostic-section">
          <div className="diagnostic-section-title">
            <div>
              <p className="eyebrow">Funzionanti</p>
              <h4>Componenti OK</h4>
            </div>
            <small>{okHealthChecks.length} controlli principali risultano verdi.</small>
          </div>
          <div className="diagnostic-health">
            {okHealthChecks.map((entry) => (
              <div key={entry.label} className="is-ok" title={entry.detail}>
                <strong>{entry.label}</strong>
                <span>OK</span>
                <small>{entry.detail}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "stato" && diagnostics ? (
        <section className="diagnostic-section">
          <div className="diagnostic-section-title">
            <div>
              <p className="eyebrow">Stato</p>
              <h4>Runtime e player</h4>
            </div>
            <small>Dati rapidi su server, volume, stream YouTube e audit.</small>
          </div>
          <div className="diagnostic-grid">
          <div>
            <span>Runtime</span>
            <strong>{diagnostics.runtime?.revision || "n/d"}</strong>
            <small>
              {diagnostics.runtime?.platform}/{diagnostics.runtime?.arch} | Node {diagnostics.runtime?.node}
            </small>
          </div>
          <div>
            <span>Player</span>
            <strong>{diagnostics.player?.isPlaying ? "In riproduzione" : "Fermo"}</strong>
            <small>{diagnostics.player?.error || "Nessun errore attivo"}</small>
          </div>
          <div>
            <span>Output audio</span>
            <strong>{diagnostics.config?.audioOutput || "auto"}</strong>
            <small>
              device {diagnostics.config?.audioDevice || "auto"} | card {diagnostics.config?.alsaCard || "auto"}
            </small>
          </div>
          <div>
            <span>Volume server</span>
            <strong>{diagnostics.player?.volume ?? 0}%</strong>
            <small>
              mpv {diagnostics.player?.outputVolume ?? diagnostics.player?.volume ?? 0}% | gain x
              {diagnostics.config?.serverVolumeGain ?? diagnostics.player?.volumeGain ?? 1}
            </small>
          </div>
          <div>
            <span>Check catalogo</span>
            <strong>{audioCheckSummary(diagnostics.audioCheck)}</strong>
            <small>
              {diagnostics.audioCheck?.config?.mode || "probe"} ogni{" "}
              {diagnostics.audioCheck?.config?.intervalHours ?? 0}h
            </small>
          </div>
          <div>
            <span>Cookie YouTube</span>
            <strong>
              {cookieReady
                ? "Attivi"
                : diagnostics.config?.ytdlCookiesAvailable
                  ? "Sessione incompleta"
                  : diagnostics.config?.ytdlCookiesConfigured
                    ? "File mancante"
                    : "Non configurati"}
            </strong>
            <small>
              {cookieReady
                ? `${diagnostics.config?.ytdlCookiesSource || "file"} | ${
                    diagnostics.config?.ytdlCookieAnalysis?.sessionCookieCount || 0
                  } cookie sessione`
                : diagnostics.config?.ytdlCookiesAvailable
                  ? diagnostics.config?.ytdlCookieWarning?.message || "File presente ma senza sessione login completa"
                  : diagnostics.config?.ytdlCookiesConfigured
                    ? `Non leggibile: ${diagnostics.config?.ytdlCookiesPath || "percorso mancante"}`
                    : `Auto: ${diagnostics.config?.ytdlCookiesPath || "data/youtube-cookies.txt"}`}
            </small>
          </div>
          <div>
            <span>Stream YouTube</span>
            <strong>{diagnostics.config?.ytdlExtractorArgs || "default"}</strong>
            <small>
              {diagnostics.config?.ytdlFormat || "audio-only"}
              {diagnostics.tools?.bgutilProvider?.ok
                ? " | PO provider bgutil"
                : diagnostics.config?.ytdlPoTokenConfigured
                  ? ` | PO token ${diagnostics.config?.ytdlPoTokenClient || "attivo"}`
                  : " | PO token non configurato"}
            </small>
          </div>
          <div>
            <span>Audit YouTube</span>
            <strong>{youtubeAuditSummary(youtubeAudit)}</strong>
            <small>
              {youtubeAudit?.running
                ? `Controllo completo in corso dal ${youtubeAudit.startedAt || "n/d"}`
                : youtubeAudit?.finishedAt
                  ? `Ultimo giro: ${youtubeAudit.finishedAt}`
                  : "Avvialo dopo avere caricato i cookie"}
            </small>
          </div>
          <div>
            <span>Test sorgenti</span>
            <strong>
              {sourceHealth?.running
                ? "In corso"
                : sourceHealth?.checkedAt
                  ? sourceHealth.ok
                    ? "OK"
                    : "Da controllare"
                  : "Non eseguito"}
            </strong>
            <small>{sourceHealth?.summary || "Premi Test sorgenti per provare YouTube, Jamendo e file locali."}</small>
          </div>
          </div>
        </section>
      ) : null}

      {activeTab === "youtube" && diagnostics ? (
        <div className="diagnostic-events diagnostic-section is-readable">
          <p className="eyebrow">Dettaglio cookie YouTube</p>
          {cookieRows.map((row) => (
            <div key={row.label}>
              <strong>{row.label}</strong>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "audit" && sourceHealthChecks.length > 0 ? (
        <div className="diagnostic-events diagnostic-section is-readable">
          <p className="eyebrow">Test sorgenti</p>
          <div>
            <strong>{sourceHealth?.ok ? "Sorgenti OK" : "Sorgenti da verificare"}</strong>
            <span>{sourceHealth?.summary || "Ultimo test sorgenti."}</span>
            <small>{sourceHealth?.checkedAt || "In attesa del primo test"}</small>
          </div>
          {sourceHealthChecks.map((check) => (
            <div key={check.key}>
              <strong>{check.label}</strong>
              <span>
                {check.status || (check.ok ? "OK" : "KO")}
                {check.reason ? ` | ${check.reason}` : ""}
                {check.statusCode ? ` | HTTP ${check.statusCode}` : ""}
              </span>
              <small>{check.detail}</small>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "audit" && youtubeAudit ? (
        <div className="diagnostic-events diagnostic-section is-readable">
          <p className="eyebrow">Verifica completa YouTube</p>
          <div>
            <strong>{youtubeAuditSummary(youtubeAudit)}</strong>
            <span>
              {youtubeAudit.config?.mode || "metadata"} | concorrenza {youtubeAudit.config?.concurrency || 5}
              {youtubeAudit.loginFailures ? ` | login KO ${youtubeAudit.loginFailures}` : ""}
              {youtubeAudit.summary?.replaceCount ? ` | ${youtubeAudit.summary.replaceCount} da sostituire` : ""}
            </span>
            <small>
              {youtubeAudit.earlyAbort
                ? "Fermato automaticamente: cookie YouTube non validi o account bloccato da anti-bot."
                : youtubeAudit.lastError || youtubeAudit.reportJson || "In attesa del report finale"}
              {youtubeAuditEtaText ? ` | ${youtubeAuditEtaText}` : ""}
            </small>
            {youtubeAudit.running ? (
              <div className="diagnostic-progress" aria-label="Avanzamento verifica YouTube">
                <span style={{ width: `${Math.max(0, Math.min(100, youtubeAudit.progress || 0))}%` }} />
              </div>
            ) : null}
          </div>
          {youtubeAuditLog.map((line, index) => (
            <div key={`${line}-${index}`}>
              <strong>{line.startsWith("[check]") ? "check" : "log"}</strong>
              <span>{line}</span>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "audit" ? (
      <div className="diagnostic-events diagnostic-section is-readable">
        <p className="eyebrow">Esiti brani YouTube</p>
        <div>
          <strong>
            {youtubeResults?.ok
              ? `${youtubeResults.totalFiltered || 0} ${
                  youtubeResultsFilter === "ok"
                    ? "funzionanti"
                    : youtubeResultsFilter === "failed"
                      ? "non funzionanti"
                      : "controllati"
                }`
              : "Ultimo report non caricato"}
          </strong>
          <span>
            {youtubeResults?.ok
              ? `Report ${youtubeResults.reportJson || "n/d"} | YouTube totali ${youtubeResults.totalYoutube || 0}`
              : "Premi un filtro dopo avere eseguito Verifica tutto YouTube."}
          </span>
          <small>
            {youtubeResults?.createdAt || "Mostra le canzoni YouTube dell'ultimo report, senza rifare il check."}
          </small>
          <div className="admin-tool-actions">
            {[
              ["failed", "KO"],
              ["ok", "OK"],
              ["all", "Tutte"],
            ].map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                className={youtubeResultsFilter === filter ? "" : "secondary-button"}
                disabled={loadingYouTubeResults}
                onClick={() => onLoadYouTubeResults(filter)}
              >
                {loadingYouTubeResults && youtubeResultsFilter === filter ? "Carico..." : label}
              </button>
            ))}
          </div>
        </div>
        {youtubeResultItems.map((item) => (
          <div key={`${item.id}-${item.status}-${item.reason}`}>
            <strong>{item.title}</strong>
            <span>
              {item.status === "ok" ? "OK" : "KO"} | {item.reason}
            </span>
            <small>{item.message || item.source || "Nessun dettaglio salvato nel report."}</small>
          </div>
        ))}
        {youtubeResults?.ok && youtubeResultItems.length === 0 ? (
          <div>
            <strong>Nessun brano in questo filtro</strong>
            <span>Cambia filtro oppure rilancia Verifica tutto YouTube.</span>
          </div>
        ) : null}
        {youtubeResults?.hasMore ? (
          <div>
            <strong>Lista parziale</strong>
            <span>Mostro le prime {youtubeResults.limit || 80} tracce del filtro selezionato.</span>
            <small>Il report completo resta in data/reports sul Raspberry.</small>
          </div>
        ) : null}
      </div>
      ) : null}

      {activeTab === "audit" && diagnostics ? (
        <div className="diagnostic-events diagnostic-section is-readable">
          <p className="eyebrow">Legenda risultati check</p>
          <div>
            <strong>Concorrenza audit</strong>
            <span>Default 5 controlli paralleli per velocizzare YouTube.</span>
            <small>
              Se il report finale ha molti timeout, abbassa temporaneamente CLEARWAVE_YOUTUBE_FULL_AUDIT_CONCURRENCY
              a 3 o 2 e rilancia.
            </small>
          </div>
          {checkReasonRows.map((row) => (
            <div key={row.reason}>
              <strong>
                {row.label}
                {row.count ? ` (${row.count})` : ""}
              </strong>
              <span>{row.reason}</span>
              <small>{row.detail}</small>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "log" && audioCheckLog.length > 0 ? (
        <div className="diagnostic-events diagnostic-section is-readable">
          <p className="eyebrow">Log check catalogo</p>
          <div>
            <strong>{audioCheckSummary(diagnostics.audioCheck)}</strong>
            <span>
              OK {diagnostics.audioCheck?.lastSummary?.ok ?? "n/d"} | KO{" "}
              {diagnostics.audioCheck?.lastSummary?.failed ?? "n/d"}
            </span>
            <small>
              {diagnostics.audioCheck?.lastError ||
                diagnostics.audioCheck?.lastReportJson ||
                "Ultime righe del controllo automatico catalogo."}
            </small>
          </div>
          {audioCheckLog.map((line, index) => (
            <div key={`${line}-${index}`}>
              <strong>{line.startsWith("[check]") ? "check" : "log"}</strong>
              <span>{line}</span>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "log" && diagnosticTools.length > 0 ? (
        <div className="diagnostic-list diagnostic-section">
          {diagnosticTools.map(([label, result]) => (
            <div key={label}>
              <span className={result?.ok ? "is-ok" : "is-error"}>{result?.ok ? "OK" : "WARN"}</span>
              <strong>{label}</strong>
              <small>{commandSummary(result)}</small>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "log" && preflightResults.length > 0 ? (
        <div className="diagnostic-list diagnostic-section">
          {preflightResults.map((entry) => (
            <div key={entry.label}>
              <span className={entry.ok ? "is-ok" : "is-error"}>{entry.ok ? "OK" : "NO"}</span>
              <strong>{entry.label}</strong>
              <small>{entry.message || entry.args?.join(" ") || "Device apribile"}</small>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "audit" && replacementList ? (
        <div className="diagnostic-events diagnostic-section is-readable">
          <p className="eyebrow">Tracce da sostituire</p>
          <div>
            <strong>{replacementList.summary?.replaceCount ?? replacementItems.length} candidate</strong>
            <span>
              Controllate {replacementList.summary?.checked ?? 0}
              {replacementList.summary?.waitingForCookies
                ? `, ${replacementList.summary.waitingForCookies} ancora in attesa cookie`
                : ""}
            </span>
            <small>{replacementList.updatedAt || "Nessun ricontrollo eseguito"}</small>
          </div>
          {hardBrokenItems.length > 0 ? (
            <div>
              <strong>{hardBrokenItems.length} non disponibili</strong>
              <span>Video rimossi, privati o non piu' riproducibili: puoi nasconderli senza cancellarli.</span>
              <button
                type="button"
                className="danger-button"
                disabled={cleaningBrokenTracks}
                onClick={onRequestCleanupBroken}
              >
                {cleaningBrokenTracks ? "Archivio..." : "Archivia non disponibili"}
              </button>
            </div>
          ) : null}
          {replacementItems.slice(0, 12).map((item) => (
            <div key={`${item.id}-${item.checkedAt}`}>
              <strong>{item.title}</strong>
              <span>{item.reason}</span>
              <small>{item.message}</small>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "log" && (
        <>
          {activeTab === "log" && diagnostics?.alsa?.cards ? <section className="diagnostic-section"><p className="eyebrow">Output alsa</p><pre className="diagnostic-output">{diagnostics.alsa.cards}</pre></section> : null}

          {diagnosticTools.map(
            ([name, output]) =>
              output ? (
                <section key={name} className="diagnostic-section">
                  <p className="eyebrow">Output {name}</p>
                  <pre className="diagnostic-output">{output}</pre>
                </section>
              ) : null
          )}
        </>
      )}
    </article>
  );
}
