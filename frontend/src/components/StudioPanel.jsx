import { useState } from "react";

function fileToPayload(file) {
  if (!file || !file.name) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve({
        name: file.name,
        type: file.type,
        base64: raw.includes(",") ? raw.split(",").pop() : raw,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function StudioPanel({ tracks, isAdmin, uploadStatus, uploadStatusType = "success", onUploadTrack }) {
  const [busy, setBusy] = useState(false);

  const uploadedCount = tracks.filter((track) => String(track.audioPath || "").startsWith("/uploads/")).length;
  const licensedCount = tracks.filter((track) => track.licensePath || track.licenseFilePath || track.licenseDocument || track.license).length;
  const missingCount = Math.max(0, tracks.length - licensedCount);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const audioFile = await fileToPayload(form.get("audioFile"));
      const licenseFile = await fileToPayload(form.get("licenseFile"));
      const payload = {
        title: form.get("title"),
        subtitle: form.get("subtitle"),
        genre: form.get("genre"),
        mood: form.get("mood"),
        energy: form.get("energy"),
        duration: form.get("duration"),
        bpm: form.get("bpm"),
        license: form.get("license"),
        licenseDetail: form.get("licenseDetail"),
        useCases: form.get("useCases"),
        formats: form.get("formats"),
        instrument: form.get("instrument"),
        stems: form.get("stems"),
        sourceUrl: form.get("sourceUrl"),
        description: form.get("description"),
        rightsNotes: form.get("rightsNotes"),
        attributionRequired: form.get("attributionRequired") === "on",
        audioFile,
        licenseFile,
      };
      const ok = await onUploadTrack(payload);
      if (ok) {
        event.currentTarget.reset();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="studio-drawer" id="studio" open>
      <summary>
        <strong>Archivio licenze</strong>
        <span>Documenti e controlli avanzati</span>
      </summary>

      <section className="operations-grid">
        <article className="panel archive-panel" id="archivio">
          <div className="section-heading">
            <p className="eyebrow">Archivio</p>
            <h2>Diritti e documenti</h2>
          </div>
          <p>Tracce importate dai provider con link rapidi a fonte, licenza e note compliance.</p>
          <div className="archive-metrics">
            <article>
              <strong>{uploadedCount}</strong>
              <span>Brani caricati</span>
            </article>
            <article>
              <strong>{licensedCount}</strong>
              <span>Licenze archiviate</span>
            </article>
            <article>
              <strong>{missingCount}</strong>
              <span>Documenti mancanti</span>
            </article>
          </div>
          <div className="archive-list">
            {tracks.slice(0, 6).map((track) => (
              <article className="archive-item" key={track.id}>
                <div>
                  <strong>{track.title}</strong>
                  <span>{track.license || "Licenza da verificare"}</span>
                </div>
                <div className="asset-links">
                  {track.playbackPath || track.audioPath || track.previewPath ? (
                    <a href={track.playbackPath || track.audioPath || track.previewPath} target="_blank" rel="noreferrer">
                      Apri audio
                    </a>
                  ) : null}
                  {track.licensePath || track.licenseUrl ? (
                    <a href={track.licensePath || track.licenseUrl} target="_blank" rel="noreferrer">
                      Apri licenza
                    </a>
                  ) : null}
                  {track.sourceUrl ? (
                    <a href={track.sourceUrl} target="_blank" rel="noreferrer">
                      Fonte
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </article>

        <aside className="panel upload-panel" id="ingest">
          <div className="section-heading">
            <p className="eyebrow">Upload</p>
            <h2>Upload manuale opzionale</h2>
          </div>
          <p>Usalo per archiviare file acquistati o scaricati legalmente fuori dalle API.</p>
          {uploadStatus ? <p className={`status-banner is-${uploadStatusType}`}>{uploadStatus}</p> : null}
          <form className="upload-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <label>
                Titolo
                <input name="title" type="text" required disabled={!isAdmin} />
              </label>
              <label>
                Artista
                <input name="subtitle" type="text" disabled={!isAdmin} />
              </label>
              <label>
                Genere
                <input name="genre" type="text" placeholder="Electronic" disabled={!isAdmin} />
              </label>
              <label>
                Mood
                <input name="mood" type="text" placeholder="Upbeat" disabled={!isAdmin} />
              </label>
              <label>
                Energy
                <select name="energy" defaultValue="Media" disabled={!isAdmin}>
                  <option value="Alta">Alta</option>
                  <option value="Media">Media</option>
                  <option value="Bassa">Bassa</option>
                </select>
              </label>
              <label>
                BPM
                <input name="bpm" type="number" min="0" step="1" disabled={!isAdmin} />
              </label>
              <label>
                Durata
                <input name="duration" type="text" placeholder="02:30" disabled={!isAdmin} />
              </label>
              <label>
                Licenza
                <input name="license" type="text" required disabled={!isAdmin} />
              </label>
              <label>
                Dettaglio licenza
                <input name="licenseDetail" type="text" placeholder="Uso commerciale" disabled={!isAdmin} />
              </label>
              <label>
                Usi commerciali
                <input name="useCases" type="text" required placeholder="ADV digital, Social media" disabled={!isAdmin} />
              </label>
              <label>
                Formati disponibili
                <input name="formats" type="text" placeholder="WAV, MP3" disabled={!isAdmin} />
              </label>
              <label>
                Strumento principale
                <input name="instrument" type="text" placeholder="Synth, Piano, Drums" disabled={!isAdmin} />
              </label>
              <label>
                Stem
                <input name="stems" type="number" min="0" step="1" disabled={!isAdmin} />
              </label>
              <label>
                URL sorgente
                <input name="sourceUrl" type="url" placeholder="https://..." disabled={!isAdmin} />
              </label>
            </div>
            <label>
              Descrizione
              <textarea name="description" rows="3" disabled={!isAdmin} />
            </label>
            <label>
              Note diritti / compliance
              <textarea name="rightsNotes" rows="3" disabled={!isAdmin} />
            </label>
            <div className="form-grid">
              <label>
                File audio
                <input name="audioFile" type="file" accept="audio/*" disabled={!isAdmin} />
              </label>
              <label>
                Documento licenza
                <input name="licenseFile" type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.doc,.docx" disabled={!isAdmin} />
              </label>
            </div>
            <label className="toggle-field">
              <input name="attributionRequired" type="checkbox" disabled={!isAdmin} />
              <span>Questa traccia richiede attribuzione finale</span>
            </label>
            <button type="submit" className="primary-button" disabled={!isAdmin || busy}>
              {busy ? "Salvo..." : "Salva nel catalogo"}
            </button>
          </form>
        </aside>
      </section>

      <section className="compliance-grid" id="compliance">
        <article>
          <p className="eyebrow">CC0</p>
          <h3>Nessuna attribuzione</h3>
          <p>Le tracce CC0 o di pubblico dominio sono le piu' semplici da gestire.</p>
        </article>
        <article>
          <p className="eyebrow">Royalty-free</p>
          <h3>Commerciale, ma con licenza</h3>
          <p>Archivia sempre prova d'acquisto, condizioni e fonte originale.</p>
        </article>
        <article>
          <p className="eyebrow">Workflow</p>
          <h3>Compliance dentro al player</h3>
          <p>Ogni scheda deve portare rapidamente a fonte, licenza e note diritti.</p>
        </article>
      </section>
    </details>
  );
}
