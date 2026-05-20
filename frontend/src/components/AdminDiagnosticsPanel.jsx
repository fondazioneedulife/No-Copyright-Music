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
  checkingSourceHealth,
  probingYouTubeCookies,
  recheckingYouTubeLogin,
  recheckingArchivedTracks,
  startingYouTubeFullAudit,
  uploadingYouTubeCookies,
  cleaningBrokenTracks,
  onLoadDiagnostics,
  onCheckSourceHealth,
  onProbeYouTubeCookies,
  onRecheckYouTubeLoginFailures,
  onRecheckArchivedAudioTracks,
  onStartYouTubeFullAudit,
  onUploadYouTubeCookiesFile,
  onRequestCleanupBroken,
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
  const cookieRows = cookieDiagnosticRows(diagnostics);
  const checkReasonRows = diagnosticReasonRows(diagnostics, youtubeAudit);
  const cookieReady = Boolean(
    diagnostics?.config?.ytdlCookiesAvailable && diagnostics?.config?.ytdlCookieAnalysis?.hasSessionCookies
  );
  const autoRefreshActive = Boolean(youtubeAudit?.running || diagnostics?.audioCheck?.running);

  return (
    <article className="admin-tool-card diagnostic-card">
      <div className="diagnostic-head">
        <div>
          <p className="eyebrow">Raspberry</p>
          <h3>Diagnostica audio/server</h3>
          <p>Controlla mpv, yt-dlp, ALSA, configurazione player e ultimo errore noto.</p>
        </div>
        <div className="admin-tool-actions">
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
              ? `YouTube ${youtubeAudit.progress || 0}%`
              : startingYouTubeFullAudit
                ? "Avvio..."
                : "Verifica tutto YouTube"}
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

      {healthChecks.length > 0 ? (
        <div className="diagnostic-health">
          {healthChecks.map((entry) => (
            <div key={entry.label} className={entry.ok ? "is-ok" : "is-warn"} title={entry.detail}>
              <strong>{entry.label}</strong>
              <span>{entry.ok ? "OK" : "ATTENZIONE"}</span>
              <small>{entry.detail}</small>
            </div>
          ))}
        </div>
      ) : null}

      {warningHealthChecks.length > 0 ? (
        <div className="diagnostic-events is-readable">
          <p className="eyebrow">Avvisi diagnostica</p>
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
      ) : null}

      {diagnostics ? (
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
      ) : null}

      {diagnostics ? (
        <div className="diagnostic-events is-readable">
          <p className="eyebrow">Dettaglio cookie YouTube</p>
          {cookieRows.map((row) => (
            <div key={row.label}>
              <strong>{row.label}</strong>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {sourceHealthChecks.length > 0 ? (
        <div className="diagnostic-events is-readable">
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

      {youtubeAudit ? (
        <div className="diagnostic-events is-readable">
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

      {diagnostics ? (
        <div className="diagnostic-events is-readable">
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

      {audioCheckLog.length > 0 ? (
        <div className="diagnostic-events is-readable">
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

      {diagnosticTools.length > 0 ? (
        <div className="diagnostic-list">
          {diagnosticTools.map(([label, result]) => (
            <div key={label}>
              <span className={result?.ok ? "is-ok" : "is-error"}>{result?.ok ? "OK" : "WARN"}</span>
              <strong>{label}</strong>
              <small>{commandSummary(result)}</small>
            </div>
          ))}
        </div>
      ) : null}

      {preflightResults.length > 0 ? (
        <div className="diagnostic-list">
          {preflightResults.map((entry) => (
            <div key={entry.label}>
              <span className={entry.ok ? "is-ok" : "is-error"}>{entry.ok ? "OK" : "NO"}</span>
              <strong>{entry.label}</strong>
              <small>{entry.message || entry.args?.join(" ") || "Device apribile"}</small>
            </div>
          ))}
        </div>
      ) : null}

      {replacementList ? (
        <div className="diagnostic-events is-readable">
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

      {diagnostics?.alsa?.cards ? <pre className="diagnostic-output">{diagnostics.alsa.cards}</pre> : null}

      {playerEvents.length > 0 ? (
        <div className="diagnostic-events is-readable">
          <p className="eyebrow">Ultimi eventi player</p>
          {playerEvents.map((event) => (
            <div key={event.id}>
              <strong>{event.type}</strong>
              <span>{event.message}</span>
              <small>{event.at}</small>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
