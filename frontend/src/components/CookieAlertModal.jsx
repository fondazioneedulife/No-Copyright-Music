import { formatCookieExpiryDate } from "../utils.js";

export function CookieAlertModal({
  cookieAlert,
  status,
  statusType,
  uploading,
  onDismiss,
  onOpenAdmin,
  onUpload,
}) {
  return (
    <div className="app-modal-backdrop cookie-alert-backdrop" role="presentation">
      <section
        className={`app-modal cookie-alert-modal is-${cookieAlert.warning.level || "warning"}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cookie-alert-title"
      >
        <span className="eyebrow">YouTube cookies</span>
        <h3 id="cookie-alert-title">Cookie YouTube da aggiornare</h3>
        <p>{cookieAlert.warning.message}</p>
        <div className="cookie-alert-meta">
          <span>Prossima scadenza critica</span>
          <strong>{formatCookieExpiryDate(cookieAlert.analysis?.earliestExpiresAt || cookieAlert.analysis?.expiresAt)}</strong>
        </div>
        {status ? (
          <p className={`status-banner is-${statusType === "error" ? "error" : "success"}`}>{status}</p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onDismiss}>
            Ricordamelo tra 10 min
          </button>
          <button type="button" className="secondary-button" onClick={onOpenAdmin}>
            Apri admin
          </button>
          <label className={`file-button ${uploading ? "is-disabled" : ""}`}>
            {uploading ? "Carico..." : "Carica cookies.txt"}
            <input type="file" accept=".txt,text/plain" disabled={uploading} onChange={onUpload} />
          </label>
        </div>
      </section>
    </div>
  );
}
