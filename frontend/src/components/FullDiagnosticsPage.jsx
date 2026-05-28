import { useState } from "react";
import { hardBrokenReasons } from "./adminDiagnostics";
import { useDiagnosticsActions } from "../hooks/useDiagnosticsActions.js";
import { AdminDiagnosticsPanel } from "./AdminDiagnosticsPanel.jsx";

export function FullDiagnosticsPage({ token, refreshTracks }) {
  const [activeTab, setActiveTab] = useState("stato");
  const [pendingCleanupBroken, setPendingCleanupBroken] = useState(false);

  const {
    autoRefreshAt,
    checkingSourceHealth,
    cleaningBrokenTracks,
    diagnostics,
    diagnosticsStatus,
    diagnosticsStatusType,
    handleCheckSourceHealth,
    handleCleanupBrokenAudioTracks,
    handleLoadDiagnostics,
    handleLoadYouTubeResults,
    handleProbeYouTubeCookies,
    handleRecheckArchivedAudioTracks,
    handleRecheckYouTubeLoginFailures,
    handleStartYouTubeFullAudit,
    handleUploadYouTubeCookiesFile,
    handleRemoveYouTubeCookies,
    loadingDiagnostics,
    loadingYouTubeResults,
    probingYouTubeCookies,
    recheckingArchivedTracks,
    recheckingYouTubeLogin,
    startingYouTubeFullAudit,
    uploadingYouTubeCookies,
    removingYouTubeCookies,
    youtubeResults,
    youtubeResultsFilter,
  } = useDiagnosticsActions({ token, refreshTracks });

  const hardBrokenCount = Array.isArray(diagnostics?.replacementList?.items)
    ? diagnostics.replacementList.items.filter((item) =>
        hardBrokenReasons.has(String(item.reason || "").toLowerCase())
      ).length
    : 0;

  async function confirmCleanupBroken() {
    await handleCleanupBrokenAudioTracks();
    setPendingCleanupBroken(false);
  }

  // Costruiamo una vista unificata ma isolando log e dati per renderli pulti.
  // Per non dover riscrivere da zero tutta la logica visiva complessa di AdminDiagnosticsPanel, 
  // lo passiamo intero ma con classi css che lo rendono leggibile a tutto schermo,
  // e aggiungiamo le tabs come container superiore.

  return (
    <div className="full-page-view diagnostics-full-page">
      <header className="page-header">
        <h1 className="page-title">Diagnostica di Sistema</h1>
        <p className="page-subtitle">Monitoraggio server, player audio, cookie e audit YouTube.</p>
        
        <div className="page-tabs">
          <button 
            className={`tab-button ${activeTab === "stato" ? "active" : ""}`} 
            onClick={() => setActiveTab("stato")}
          >
            Stato e Player
          </button>
          <button 
            className={`tab-button ${activeTab === "youtube" ? "active" : ""}`} 
            onClick={() => setActiveTab("youtube")}
          >
            Cookie YouTube
          </button>
          <button 
            className={`tab-button ${activeTab === "audit" ? "active" : ""}`} 
            onClick={() => setActiveTab("audit")}
          >
            Verifica Catalogo
          </button>
        </div>
      </header>

      <div className={`tab-content active-tab-${activeTab}`}>
        <AdminDiagnosticsPanel
          diagnostics={diagnostics}
          diagnosticsStatus={diagnosticsStatus}
          diagnosticsStatusType={diagnosticsStatusType}
          autoRefreshAt={autoRefreshAt}
          loadingDiagnostics={loadingDiagnostics}
          loadingYouTubeResults={loadingYouTubeResults}
          checkingSourceHealth={checkingSourceHealth}
          probingYouTubeCookies={probingYouTubeCookies}
          recheckingYouTubeLogin={recheckingYouTubeLogin}
          recheckingArchivedTracks={recheckingArchivedTracks}
          startingYouTubeFullAudit={startingYouTubeFullAudit}
          uploadingYouTubeCookies={uploadingYouTubeCookies}
          removingYouTubeCookies={removingYouTubeCookies}
          cleaningBrokenTracks={cleaningBrokenTracks}
          youtubeResults={youtubeResults}
          youtubeResultsFilter={youtubeResultsFilter}
          onLoadDiagnostics={handleLoadDiagnostics}
          onLoadYouTubeResults={handleLoadYouTubeResults}
          onCheckSourceHealth={handleCheckSourceHealth}
          onProbeYouTubeCookies={handleProbeYouTubeCookies}
          onRecheckYouTubeLoginFailures={handleRecheckYouTubeLoginFailures}
          onRecheckArchivedAudioTracks={handleRecheckArchivedAudioTracks}
          onStartYouTubeFullAudit={handleStartYouTubeFullAudit}
          onUploadYouTubeCookiesFile={handleUploadYouTubeCookiesFile}
          onRemoveYouTubeCookies={handleRemoveYouTubeCookies}
          onRequestCleanupBroken={() => setPendingCleanupBroken(true)}
          activeTab={activeTab}
        />
      </div>

      {pendingCleanupBroken ? (
        <div className="app-modal-backdrop" role="presentation" onClick={() => setPendingCleanupBroken(false)}>
          <section
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cleanup-broken-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Catalogo</p>
            <h3 id="cleanup-broken-title">Archiviare tracce non disponibili?</h3>
            <p>
              Verranno archiviate <strong>{hardBrokenCount}</strong> tracce confermate rotte dal report audio.
              Non saranno cancellate: resteranno in `library.json` con motivo errore e backup in `data`.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingCleanupBroken(false)}>
                Annulla
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={cleaningBrokenTracks}
                onClick={confirmCleanupBroken}
              >
                {cleaningBrokenTracks ? "Archivio..." : "Archivia tracce"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
