import { useState } from "react";
import { AdminDiagnosticsPanel } from "./AdminDiagnosticsPanel.jsx";
import { hardBrokenReasons } from "./adminDiagnostics";
import { useDiagnosticsActions } from "../hooks/useDiagnosticsActions.js";

// Pagina diagnostica autonoma: stato, timer e API vivono nel hook dedicato, non piu' in AdminPanel.
export function DiagnosticsPage({ token, refreshTracks }) {
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
    loadingDiagnostics,
    loadingYouTubeResults,
    probingYouTubeCookies,
    recheckingArchivedTracks,
    recheckingYouTubeLogin,
    startingYouTubeFullAudit,
    uploadingYouTubeCookies,
    youtubeResults,
    youtubeResultsFilter,
  } = useDiagnosticsActions({ token, refreshTracks });

  const [pendingCleanupBroken, setPendingCleanupBroken] = useState(false);

  const hardBrokenCount = Array.isArray(diagnostics?.replacementList?.items)
    ? diagnostics.replacementList.items.filter((item) =>
        hardBrokenReasons.has(String(item.reason || "").toLowerCase())
      ).length
    : 0;

  async function confirmCleanupBroken() {
    await handleCleanupBrokenAudioTracks();
    setPendingCleanupBroken(false);
  }

  return (
    <section className="panel" id="diagnostica">
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
        onRequestCleanupBroken={() => setPendingCleanupBroken(true)}
      />

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
    </section>
  );
}
