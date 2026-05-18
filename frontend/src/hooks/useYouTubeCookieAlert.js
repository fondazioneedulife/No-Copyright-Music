import { useEffect, useState } from "react";
import { fetchYouTubeCookieStatus, uploadYouTubeCookies } from "../api/client.js";

const COOKIE_ALERT_INTERVAL_MS = 10 * 60 * 1000;

export function useYouTubeCookieAlert({ token, isAdmin, setAdminStatus, setAdminStatusType }) {
  const [cookieAlert, setCookieAlert] = useState(null);
  const [cookieAlertVisible, setCookieAlertVisible] = useState(false);
  const [cookieAlertStatus, setCookieAlertStatus] = useState("");
  const [cookieAlertStatusType, setCookieAlertStatusType] = useState("success");
  const [cookieAlertUploading, setCookieAlertUploading] = useState(false);

  useEffect(() => {
    // Avviso operativo: se i cookie YouTube stanno scadendo, l'admin viene richiamato ogni 10 minuti.
    if (!token || !isAdmin) {
      setCookieAlert(null);
      setCookieAlertVisible(false);
      return undefined;
    }

    let cancelled = false;
    async function checkYouTubeCookies() {
      try {
        const payload = await fetchYouTubeCookieStatus(token);
        if (cancelled) {
          return;
        }

        const cookies = payload.cookies || null;
        setCookieAlert(cookies);
        if (cookies?.warning?.shouldAlert) {
          setCookieAlertStatus("");
          setCookieAlertVisible(true);
        } else {
          setCookieAlertVisible(false);
          setCookieAlertStatus("");
        }
      } catch {
        if (!cancelled) {
          setCookieAlert(null);
        }
      }
    }

    void checkYouTubeCookies();
    const timerId = window.setInterval(checkYouTubeCookies, COOKIE_ALERT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [token, isAdmin]);

  async function handleUploadYouTubeCookies(cookiesText) {
    try {
      const payload = await uploadYouTubeCookies(token, cookiesText);
      setAdminStatusType("success");
      setAdminStatus(payload.message || "Cookie YouTube installati.");
      const cookies = payload.cookies || null;
      setCookieAlert(cookies);
      if (cookies?.warning?.shouldAlert) {
        setCookieAlertVisible(true);
      } else {
        setCookieAlertVisible(false);
        setCookieAlertStatus("");
      }
      return payload;
    } catch (error) {
      setAdminStatusType("error");
      setAdminStatus(error.message || "Installazione cookie YouTube non riuscita.");
      throw error;
    }
  }

  async function handleCookieAlertUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      setCookieAlertUploading(true);
      setCookieAlertStatusType("success");
      setCookieAlertStatus("Caricamento cookies.txt in corso...");
      const payload = await uploadYouTubeCookies(token, await file.text());
      const statusPayload = await fetchYouTubeCookieStatus(token);
      const cookies = statusPayload.cookies || payload.cookies || null;
      setCookieAlert(cookies);
      setAdminStatusType("success");
      setAdminStatus(payload.message || "Cookie YouTube installati.");

      if (cookies?.warning?.shouldAlert) {
        setCookieAlertStatusType(cookies.warning.level === "error" ? "error" : "success");
        setCookieAlertStatus(cookies.warning.message || "Cookie caricati, ma serve ancora una verifica.");
        setCookieAlertVisible(true);
      } else {
        setCookieAlertStatusType("success");
        setCookieAlertStatus("Cookie aggiornati: avviso automatico disattivato.");
        setCookieAlertVisible(false);
      }
    } catch (error) {
      setCookieAlertStatusType("error");
      setCookieAlertStatus(error.message || "Installazione cookie YouTube non riuscita.");
    } finally {
      setCookieAlertUploading(false);
    }
  }

  return {
    cookieAlert,
    cookieAlertStatus,
    cookieAlertStatusType,
    cookieAlertUploading,
    cookieAlertVisible,
    handleCookieAlertUpload,
    handleUploadYouTubeCookies,
    setCookieAlertVisible,
  };
}
