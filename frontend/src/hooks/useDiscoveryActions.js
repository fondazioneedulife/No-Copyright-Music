import { useState } from "react";
import {
  bulkImportDiscovery,
  importDiscoveryTrack,
  importDiscoveryLink,
  importExternalLink,
  importSessionLink,
  searchDiscovery,
} from "../api/client.js";

export function useDiscoveryActions({ user, token, refreshTracks }) {
  const [discoveryResults, setDiscoveryResults] = useState([]);
  const [discoveryStatus, setDiscoveryStatus] = useState("");
  const [discoveryStatusType, setDiscoveryStatusType] = useState("success");
  const [sessionTracks, setSessionTracks] = useState([]);

  function rejectNonAdmin(actionLabel) {
    if (user?.role === "admin") {
      return false;
    }

    setDiscoveryStatusType("error");
    setDiscoveryStatus(actionLabel);
    return true;
  }

  async function handleDiscoverySearch({ query: discoveryQuery, provider }) {
    if (rejectNonAdmin("Solo l'amministratore puo' cercare e importare nuove sorgenti.")) {
      return;
    }

    try {
      setDiscoveryStatus("Ricerca in corso nelle sorgenti ufficiali...");
      setDiscoveryStatusType("success");
      const payload = await searchDiscovery(token, { query: discoveryQuery, provider });
      setDiscoveryResults(payload.items || []);
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        setDiscoveryStatusType("error");
        setDiscoveryStatus(
          `Ricerca completata con avvisi. ${payload.errors
            .map((entry) => `${entry.provider}: ${entry.message}`)
            .join(" | ")}`
        );
      } else {
        setDiscoveryStatusType("success");
        setDiscoveryStatus(`${(payload.items || []).length} risultati trovati nelle sorgenti ufficiali.`);
      }
    } catch (error) {
      setDiscoveryResults([]);
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Errore nella ricerca esterna.");
    }
  }

  async function handleDiscoveryImport(track) {
    if (rejectNonAdmin("Solo l'amministratore puo' importare brani.")) {
      return;
    }

    try {
      setDiscoveryStatus("Import nel catalogo locale in corso...");
      await importDiscoveryTrack(token, track);
      await refreshTracks();
      setDiscoveryStatusType("success");
      setDiscoveryStatus("Traccia importata nel catalogo locale.");
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Errore durante l'import.");
    }
  }

  async function handleBulkImport(maxTracks = 120) {
    if (rejectNonAdmin("Solo l'amministratore puo' importare lotti.")) {
      return;
    }

    const requestedMaxTracks = Number(maxTracks) || 120;

    try {
      setDiscoveryStatus(`Importo un lotto progressivo da ${requestedMaxTracks} tracce...`);
      const payload = await bulkImportDiscovery(token, { maxTracks: requestedMaxTracks });
      await refreshTracks();
      const importErrors = Array.isArray(payload.errors) ? payload.errors : [];
      const youtubeProgress = Array.isArray(payload.youtubeProgress) ? payload.youtubeProgress : [];
      const skippedSummary = Array.isArray(payload.skippedSummary) ? payload.skippedSummary : [];
      const youtubeText = youtubeProgress.length
        ? ` YouTube: ${youtubeProgress
            .map((entry) => {
              const resetText = entry.resetCursor ? ", reset token" : "";
              const skippedText = entry.skipped ? `, ${entry.skipped}` : "";
              const playlistText = entry.playlistsRead
                ? `, playlist ${entry.playlistItems || 0}/${entry.playlistItemsScanned || 0}`
                : "";
              const uploadText =
                entry.skipped === "uploads-completed"
                  ? "upload gia' completi"
                  : `${entry.items || 0}/${entry.scanned || 0}`;
              return `${entry.channel}: ${uploadText}${playlistText}${resetText}${skippedText}`;
            })
            .join("; ")}.`
        : "";
      const skippedText = skippedSummary.length
        ? ` Saltate: ${skippedSummary.map((entry) => `${entry.label} ${entry.count}`).join(", ")}.`
        : "";
      const errorText = importErrors.length
        ? ` Avvisi: ${importErrors.map((entry) => entry.message).join(" | ")}`
        : "";
      // Il riepilogo esplicito evita "0 nuove tracce" senza sapere se erano duplicati, quota o canali finiti.
      setDiscoveryStatusType(importErrors.length > 0 && !payload.importedCount ? "error" : "success");
      setDiscoveryStatus(
        `Lotto completato: ${payload.importedCount || 0} nuove tracce su ${
          payload.scanned || 0
        } risultati letti.${youtubeText}${skippedText}${errorText}`
      );
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Errore durante l'import del lotto.");
    }
  }

  async function handleImportLink(url) {
    if (rejectNonAdmin("Solo l'amministratore puo' importare link.")) {
      return;
    }

    try {
      setDiscoveryStatus("Import da link in corso...");
      const payload = await importDiscoveryLink(token, url);
      await refreshTracks();
      setDiscoveryStatusType("success");
      setDiscoveryStatus(
        `Import completato: ${payload.importedCount || 0} nuove tracce, ${payload.skippedCount || 0} saltate.`
      );
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Import da link non riuscito.");
    }
  }

  async function handleImportExternalLink(url) {
    if (rejectNonAdmin("Solo l'amministratore puo' importare tracce esterne.")) {
      return;
    }

    try {
      setDiscoveryStatus("Importazione traccia esterna (SoundCloud/YT)...");
      const payload = await importExternalLink(token, url);
      await refreshTracks();
      setDiscoveryStatusType("success");
      setDiscoveryStatus(`Import completato: ${payload.track?.title || "Traccia importata con successo"}.`);
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Import traccia esterna non riuscito.");
    }
  }

  async function handleAddSessionLink(url) {
    if (rejectNonAdmin("Solo l'amministratore puo' usare la playlist temporanea.")) {
      return false;
    }

    if (!url) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus("Incolla un link YouTube prima di creare la sessione temporanea.");
      return false;
    }

    try {
      setDiscoveryStatusType("success");
      setDiscoveryStatus("Carico il link nella playlist temporanea...");
      const payload = await importSessionLink(token, url);
      const imported = Array.isArray(payload.imported) ? payload.imported : [];
      if (imported.length === 0) {
        throw new Error("Nessuna traccia temporanea trovata nel link.");
      }

      let addedCount = 0;
      let duplicateCount = 0;
      // La playlist temporanea vive solo nello stato React: non entra nel catalogo SQLite.
      setSessionTracks((current) => {
        const knownIds = new Set(current.map((track) => track.youtubeVideoId || track.id));
        const incoming = imported
          .filter((track) => !knownIds.has(track.youtubeVideoId || track.id))
          .map((track) => ({
            ...track,
            isTemporary: true,
            sessionOwner: user.username,
          }));
        addedCount = incoming.length;
        duplicateCount = Math.max(0, imported.length - incoming.length);
        return [...incoming, ...current];
      });

      const notice = payload.notice ? ` ${payload.notice}` : "";
      setDiscoveryStatusType("success");
      if (addedCount === 0) {
        setDiscoveryStatus(
          `Sessione temporanea invariata: nessuna nuova traccia aggiunta.${
            duplicateCount > 0 ? ` ${duplicateCount} erano gia' presenti.` : ""
          }${notice}`
        );
      } else {
        setDiscoveryStatus(
          `Sessione temporanea aggiornata: ${addedCount} nuove tracce in prova.${
            duplicateCount > 0 ? ` ${duplicateCount} erano gia' presenti.` : ""
          } Esci o svuota playlist per rimuoverle.${notice}`
        );
      }
      return true;
    } catch (error) {
      setDiscoveryStatusType("error");
      setDiscoveryStatus(error.message || "Import sessione temporanea non riuscito.");
      return false;
    }
  }

  function resetDiscoveryState() {
    setDiscoveryResults([]);
    setDiscoveryStatus("");
    setDiscoveryStatusType("success");
    setSessionTracks([]);
  }

  return {
    discoveryResults,
    discoveryStatus,
    discoveryStatusType,
    handleAddSessionLink,
    handleBulkImport,
    handleDiscoveryImport,
    handleDiscoverySearch,
    handleImportLink,
    handleImportExternalLink,
    resetDiscoveryState,
    sessionTracks,
    setDiscoveryStatus,
    setDiscoveryStatusType,
    setSessionTracks,
  };
}
