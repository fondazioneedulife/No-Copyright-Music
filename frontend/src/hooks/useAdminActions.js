import { useEffect, useState } from "react";
import {
  checkSourceHealth,
  cleanupBrokenAudioTracks,
  createUser,
  deleteUser,
  exportCatalogBackup,
  exportLicenseReport,
  exportLicenseReportHtml,
  fetchAdminDiagnostics,
  fetchUsers,
  fetchYouTubeAudioResults,
  fetchYouTubeFullAuditStatus,
  importCatalogBackup,
  probeYouTubeCookies,
  recheckArchivedAudioTracks,
  recheckYouTubeLoginFailures,
  resetUserPassword,
  resetYouTubeImportState,
  startYouTubeFullAudit,
} from "../api/client.js";
import { downloadBlob } from "../utils.js";

export function useAdminActions({ user, token, refreshTracks }) {
  const [users, setUsers] = useState([]);
  const [adminStatus, setAdminStatus] = useState("");
  const [adminStatusType, setAdminStatusType] = useState("success");

  async function refreshUsers() {
    if (!token) {
      return;
    }

    try {
      const payload = await fetchUsers(token);
      setUsers(payload.users || []);
    } catch {
      setUsers([]);
    }
  }

  useEffect(() => {
    if (!user || user.role !== "admin") {
      setUsers([]);
      return;
    }

    void refreshUsers();
  }, [user, token]);

  function resetAdminStatus() {
    setAdminStatus("");
    setAdminStatusType("success");
  }

  async function handleCreateUser(nextUser) {
    try {
      const payload = await createUser(token, nextUser);
      setAdminStatusType("success");
      setAdminStatus(`Utente creato: ${payload.user.username}. Password temporanea: ${payload.tempPassword}`);
      await refreshUsers();
      return true;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Creazione utente non riuscita.");
      return false;
    }
  }

  async function handleDeleteUser(username) {
    try {
      await deleteUser(token, username);
      setAdminStatusType("success");
      setAdminStatus(`Utente eliminato: ${username}.`);
      await refreshUsers();
      return true;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Eliminazione utente non riuscita.");
      return false;
    }
  }

  async function handleResetUserPassword(username) {
    try {
      const payload = await resetUserPassword(token, username);
      setAdminStatusType("success");
      setAdminStatus(`Password temporanea per ${payload.user.username}: ${payload.tempPassword}`);
      await refreshUsers();
      return true;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Reset password non riuscito.");
      return false;
    }
  }

  async function handleResetYouTubeImportState() {
    try {
      const payload = await resetYouTubeImportState(token);
      setAdminStatusType("success");
      setAdminStatus(
        `Stato import YouTube azzerato. Canali precedenti: ${payload.previousChannels || 0}${
          payload.backupFile ? `. Backup: ${payload.backupFile}` : ""
        }.`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Reset stato YouTube non riuscito.");
      throw error;
    }
  }

  async function handleLoadAdminDiagnostics() {
    const payload = await fetchAdminDiagnostics(token);
    return payload.diagnostics || null;
  }

  async function handleLoadYouTubeFullAuditStatus() {
    return fetchYouTubeFullAuditStatus(token);
  }

  async function handleLoadYouTubeAudioResults(options = {}) {
    try {
      return await fetchYouTubeAudioResults(token, options);
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Lettura esiti YouTube non riuscita.");
      throw error;
    }
  }

  async function handleCheckSourceHealth() {
    try {
      const payload = await checkSourceHealth(token);
      setAdminStatusType(payload.sourceHealth?.ok ? "success" : "error");
      setAdminStatus(payload.sourceHealth?.summary || "Test sorgenti completato.");
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Test sorgenti non riuscito.");
      throw error;
    }
  }

  async function handleRecheckYouTubeLoginFailures() {
    try {
      const payload = await recheckYouTubeLoginFailures(token);
      setAdminStatusType("success");
      setAdminStatus(
        `${payload.message || "Ricontrollo YouTube completato"}${
          payload.reportJson ? ` Report: ${payload.reportJson}.` : ""
        }`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Ricontrollo YouTube non riuscito.");
      throw error;
    }
  }

  async function handleStartYouTubeFullAudit() {
    try {
      const payload = await startYouTubeFullAudit(token, { mode: "metadata" });
      setAdminStatusType("success");
      setAdminStatus(payload.message || "Verifica completa YouTube avviata.");
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Verifica completa YouTube non riuscita.");
      throw error;
    }
  }

  async function handleProbeYouTubeCookies() {
    try {
      const payload = await probeYouTubeCookies(token);
      setAdminStatusType(payload.ok ? "success" : "error");
      setAdminStatus(payload.message || "Test cookie YouTube completato.");
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Test cookie YouTube non riuscito.");
      throw error;
    }
  }

  async function handleCleanupBrokenAudioTracks() {
    try {
      const payload = await cleanupBrokenAudioTracks(token);
      await refreshTracks();
      setAdminStatusType("success");
      setAdminStatus(
        `${payload.message || "Quarantena catalogo completata."}${
          payload.backupFile ? ` Backup: ${payload.backupFile}.` : ""
        }`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Quarantena catalogo non riuscita.");
      throw error;
    }
  }

  async function handleRecheckArchivedAudioTracks() {
    try {
      const payload = await recheckArchivedAudioTracks(token);
      await refreshTracks();
      setAdminStatusType("success");
      setAdminStatus(
        `${payload.message || "Riverifica archiviate completata."}${
          payload.backupFile ? ` Backup: ${payload.backupFile}.` : ""
        }`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Riverifica archiviate non riuscita.");
      throw error;
    }
  }

  async function handleExportCatalogBackup() {
    try {
      const file = await exportCatalogBackup(token);
      downloadBlob(file);
      setAdminStatusType("success");
      setAdminStatus(`Backup catalogo esportato: ${file.filename}.`);
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Export catalogo non riuscito.");
    }
  }

  async function handleExportLicenseReport() {
    try {
      const file = await exportLicenseReport(token);
      downloadBlob(file);
      setAdminStatusType("success");
      setAdminStatus(`Report licenze esportato: ${file.filename}.`);
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Export report licenze non riuscito.");
    }
  }

  async function handleExportLicenseReportHtml() {
    try {
      const file = await exportLicenseReportHtml(token);
      downloadBlob(file);
      setAdminStatusType("success");
      setAdminStatus(`Report licenze HTML esportato: ${file.filename}.`);
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Export report licenze HTML non riuscito.");
    }
  }

  async function handleImportCatalogBackup(backupPayload) {
    try {
      const payload = await importCatalogBackup(token, backupPayload);
      await refreshTracks();
      setAdminStatusType("success");
      setAdminStatus(
        `Catalogo ripristinato: ${payload.importedCount || 0} tracce. Backup precedente: ${
          payload.backupFile || "creato"
        }.`
      );
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Ripristino backup catalogo non riuscito.");
      throw error;
    }
  }

  return {
    adminStatus,
    adminStatusType,
    handleCleanupBrokenAudioTracks,
    handleCheckSourceHealth,
    handleCreateUser,
    handleDeleteUser,
    handleExportCatalogBackup,
    handleExportLicenseReport,
    handleExportLicenseReportHtml,
    handleImportCatalogBackup,
    handleLoadAdminDiagnostics,
    handleLoadYouTubeAudioResults,
    handleLoadYouTubeFullAuditStatus,
    handleProbeYouTubeCookies,
    handleRecheckArchivedAudioTracks,
    handleRecheckYouTubeLoginFailures,
    handleResetUserPassword,
    handleResetYouTubeImportState,
    handleStartYouTubeFullAudit,
    refreshUsers,
    resetAdminStatus,
    setAdminStatus,
    setAdminStatusType,
    users,
  };
}
