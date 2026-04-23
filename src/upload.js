async function copyReport() {
  try {
    await navigator.clipboard.writeText(buildReportText());
    dom.reportStatus.textContent = "Report copiato negli appunti";
  } catch {
    dom.reportStatus.textContent = "Copia non disponibile in questo browser";
  }
}

function fileToPayload(file) {
  if (!file) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const raw = String(reader.result || "");
      const dataBase64 = raw.includes(",") ? raw.split(",")[1] : raw;

      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        dataBase64,
      });
    };

    reader.onerror = () => {
      reject(new Error(`Impossibile leggere il file ${file.name}.`));
    };

    reader.readAsDataURL(file);
  });
}

async function handleUploadSubmit(event) {
  event.preventDefault();

  if (!requireAdminAction(dom.uploadStatus, "Solo l'amministratore puo' aggiungere brani al catalogo.")) {
    return;
  }

  if (!dom.uploadTitle.value.trim()) {
    setStatus(dom.uploadStatus, "Inserisci almeno il titolo del brano.", "error");
    return;
  }

  if (!dom.uploadLicense.value.trim()) {
    setStatus(dom.uploadStatus, "Specifica la tipologia di licenza.", "error");
    return;
  }

  if (parseList(dom.uploadUseCases.value).length === 0) {
    setStatus(dom.uploadStatus, "Inserisci almeno un uso commerciale.", "error");
    return;
  }

  setStatus(dom.uploadStatus, "Caricamento in corso...");
  dom.submitUploadButton.disabled = true;

  try {
    const [audioFile, licenseFile] = await Promise.all([
      fileToPayload(dom.uploadAudioFile.files[0]),
      fileToPayload(dom.uploadLicenseFile.files[0]),
    ]);

    const payload = {
      title: dom.uploadTitle.value.trim(),
      subtitle: dom.uploadSubtitle.value.trim(),
      mood: dom.uploadMood.value,
      energy: dom.uploadEnergy.value,
      bpm: dom.uploadBpm.value,
      duration: dom.uploadDuration.value.trim(),
      license: dom.uploadLicense.value.trim(),
      licenseDetail: dom.uploadLicenseDetail.value.trim(),
      useCases: parseList(dom.uploadUseCases.value),
      formats: parseList(dom.uploadFormats.value),
      instrument: dom.uploadInstrument.value.trim(),
      stems: dom.uploadStems.value,
      tags: parseList(dom.uploadTags.value),
      sourceUrl: dom.uploadSourceUrl.value.trim(),
      description: dom.uploadDescription.value.trim(),
      rightsNotes: dom.uploadRightsNotes.value.trim(),
      attributionRequired: dom.uploadAttributionRequired.checked,
      audioFile,
      licenseFile,
    };

    const response = await fetch("/api/tracks", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Impossibile salvare il brano.");
    }

    dom.uploadForm.reset();
    dom.uploadMood.value = "Upbeat";
    dom.uploadEnergy.value = "Media";
    setStatus(dom.uploadStatus, "Brano salvato nel catalogo e archivio aggiornato.", "success");
    await fetchLibrary({ quiet: true });
  } catch (error) {
    setStatus(dom.uploadStatus, error.message || "Errore durante il caricamento.", "error");
  } finally {
    dom.submitUploadButton.disabled = false;
  }
}

