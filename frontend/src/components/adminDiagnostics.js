export const hardBrokenReasons = new Set([
  "youtube-unavailable",
  "youtube-format",
  "stream-not-playable",
  "missing-source",
  "missing-file",
  "not-found",
  "forbidden",
]);

export const auditRefreshMs = 3000;
export const diagnosticsRefreshMs = 15000;

const diagnosticReasonInfo = {
  ok: {
    label: "OK",
    detail: "La traccia e' stata aperta correttamente durante il controllo.",
  },
  timeout: {
    label: "Timeout",
    detail:
      "YouTube, rete o Raspberry non hanno risposto in tempo. Non e' definitivo: se sono tanti, riprova con meno concorrenza o rete piu' libera.",
  },
  "youtube-unavailable": {
    label: "YouTube non disponibile",
    detail:
      "Il video risulta rimosso, privato, bloccato o non piu' leggibile da yt-dlp. Se resta cosi' in piu' report, e' candidato ad archiviazione.",
  },
  "youtube-age-or-login": {
    label: "Login/eta YouTube",
    detail:
      "YouTube richiede cookie validi, conferma account o controllo anti-bot. Prima prova Test cookie YouTube, poi rilancia il check.",
  },
  "youtube-error": {
    label: "Errore YouTube",
    detail:
      "yt-dlp e' uscito con errore generico. Da ora il log mostra anche il messaggio breve per capire se e' login, rete o video non valido.",
  },
  "youtube-expired-url": {
    label: "URL YouTube temporaneo",
    detail:
      "La traccia contiene solo un link googlevideo scadibile. Va reimportato il video YouTube originale o aggiunto lo youtubeVideoId.",
  },
  "youtube-stream-open-failed": {
    label: "Stream YouTube non aperto",
    detail:
      "yt-dlp ha risolto il video, ma mpv non ha aperto lo stream googlevideo firmato. Se succede spesso, oltre ai cookie serve configurare un PO token.",
  },
  "exit-1": {
    label: "Exit 1",
    detail:
      "Motivo generico dei report vecchi o di yt-dlp. Apri l'evento/report: se parla di googlevideo, e' uno Stream YouTube non aperto.",
  },
};

const diagnosticReasonOrder = [
  "ok",
  "timeout",
  "youtube-unavailable",
  "youtube-age-or-login",
  "youtube-error",
  "youtube-expired-url",
  "youtube-stream-open-failed",
  "exit-1",
];

function firstDiagnosticLine(value) {
  return (
    String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

export function commandSummary(result) {
  if (!result) {
    return "Non controllato";
  }

  if (result.ok) {
    return firstDiagnosticLine(result.stdout) || "OK";
  }

  return firstDiagnosticLine(result.stderr) || result.error || "Errore";
}

export function audioCheckSummary(audioCheck) {
  if (!audioCheck?.enabled) {
    return "Disattivato";
  }
  if (audioCheck.running) {
    return "In corso";
  }

  const ok = audioCheck.lastSummary?.ok;
  const failed = audioCheck.lastSummary?.failed;
  if (Number.isFinite(ok) || Number.isFinite(failed)) {
    return `OK ${ok ?? 0} / KO ${failed ?? 0}`;
  }

  return audioCheck.lastStartedAt ? "Ultimo report non letto" : "In attesa del primo giro";
}

function audioCheckHealthOk(audioCheck) {
  if (!audioCheck?.enabled || audioCheck.running) {
    return true;
  }

  const neverStarted = !audioCheck.lastStartedAt && audioCheck.lastExitCode === null && !audioCheck.lastError;
  if (neverStarted) {
    return true;
  }

  return !audioCheck.lastError && audioCheck.lastExitCode === 0;
}

export function youtubeAuditSummary(audit) {
  if (!audit) {
    return "Non avviato";
  }

  if (audit.running) {
    const total = Number(audit.total) || 0;
    const checked = Number(audit.checked) || 0;
    return total > 0 ? `${checked}/${total} (${audit.progress || 0}%)` : "In avvio";
  }

  if (audit.lastError) {
    return "Errore";
  }

  const checked = Number(audit.summary?.ok || 0) + Number(audit.summary?.failed || 0);
  if (checked > 0) {
    return `OK ${audit.summary?.ok || 0} / KO ${audit.summary?.failed || 0}`;
  }

  return audit.finishedAt ? "Report letto" : "Non avviato";
}

export function diagnosticReasonRows(diagnostics, youtubeAudit) {
  const counts = {};
  [diagnostics?.audioCheck?.lastSummary?.byReason, youtubeAudit?.summary?.byReason].forEach((source) => {
    if (!source || typeof source !== "object") {
      return;
    }

    Object.entries(source).forEach(([reason, count]) => {
      counts[reason] = (counts[reason] || 0) + (Number(count) || 0);
    });
  });

  const ordered = diagnosticReasonOrder.map((reason) => ({
    reason,
    count: counts[reason] || 0,
    label: diagnosticReasonInfo[reason]?.label || reason,
    detail: diagnosticReasonInfo[reason]?.detail || "Motivo tecnico letto dal report.",
  }));

  const extras = Object.keys(counts)
    .filter((reason) => !diagnosticReasonOrder.includes(reason))
    .sort()
    .map((reason) => ({
      reason,
      count: counts[reason] || 0,
      label: reason,
      detail: "Motivo tecnico letto dal report. Apri il JSON in data/reports per il dettaglio completo.",
    }));

  return [...ordered, ...extras];
}

export function refreshClockLabel() {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function diagnosticDateLabel(value) {
  if (!value) {
    return "";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return String(value);
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function diagnosticHealthChecks(diagnostics) {
  if (!diagnostics) {
    return [];
  }

  const preflight = Array.isArray(diagnostics.audioPreflight) ? diagnostics.audioPreflight : [];
  const audioOk = preflight.length === 0 || preflight.some((entry) => entry.ok);
  const cookieAnalysis = diagnostics.config?.ytdlCookieAnalysis || null;
  const youtubeCookiesAvailable = Boolean(diagnostics.config?.ytdlCookiesAvailable);
  const youtubeCookiesConfigured = Boolean(diagnostics.config?.ytdlCookiesConfigured);
  const youtubeCookieSessionCount = Number(cookieAnalysis?.sessionCookieCount) || 0;
  const youtubeCookieSessionReady = Boolean(cookieAnalysis?.hasSessionCookies);
  const sourceHealth = diagnostics.sourceHealth || null;
  return [
    {
      label: "Backend",
      ok: Boolean(diagnostics.runtime?.revision),
      detail: diagnostics.runtime?.revision || "Runtime non letto",
    },
    {
      label: "mpv",
      ok: Boolean(diagnostics.tools?.mpv?.ok),
      detail: commandSummary(diagnostics.tools?.mpv),
    },
    {
      label: "yt-dlp",
      ok: Boolean(diagnostics.tools?.ytdlp?.ok),
      detail: commandSummary(diagnostics.tools?.ytdlp),
    },
    {
      label: "Deno/JS",
      ok: Boolean(diagnostics.tools?.ytdlJsRuntime?.ok),
      detail: commandSummary(diagnostics.tools?.ytdlJsRuntime),
    },
    {
      label: "PO token",
      ok: Boolean(diagnostics.tools?.bgutilProvider?.ok || diagnostics.config?.ytdlPoTokenConfigured),
      detail: diagnostics.tools?.bgutilProvider?.ok
        ? "Provider bgutil attivo"
        : diagnostics.config?.ytdlPoTokenConfigured
          ? `Manuale ${diagnostics.config?.ytdlPoTokenClient || "attivo"}`
          : "Non attivo",
    },
    {
      label: "Audio",
      ok: audioOk,
      detail: audioOk ? "Almeno un output apribile" : "Nessun output apribile",
    },
    {
      label: "YouTube API",
      ok: Boolean(diagnostics.config?.hasYouTubeApiKey),
      detail: diagnostics.config?.hasYouTubeApiKey ? "Configurata" : "Non configurata",
    },
    {
      label: "Cookie YouTube",
      ok: youtubeCookiesAvailable && youtubeCookieSessionReady,
      detail: youtubeCookiesAvailable
        ? youtubeCookieSessionReady
          ? `${youtubeCookieSessionCount} cookie sessione`
          : "File presente ma sessione incompleta"
        : youtubeCookiesConfigured
          ? "File configurato ma non leggibile"
          : "Carica cookies.txt",
    },
    {
      label: "Jamendo",
      ok: Boolean(diagnostics.config?.hasJamendoClientId),
      detail: diagnostics.config?.hasJamendoClientId ? "Configurata" : "Non configurata",
    },
    {
      label: "Player",
      ok: !diagnostics.player?.error,
      detail: diagnostics.player?.error || "Nessun errore attivo",
    },
    {
      label: "Check catalogo",
      ok: audioCheckHealthOk(diagnostics.audioCheck),
      detail: audioCheckSummary(diagnostics.audioCheck),
    },
    {
      label: "Audit YouTube",
      ok: !diagnostics.youtubeAudit?.lastError,
      detail: youtubeAuditSummary(diagnostics.youtubeAudit),
    },
    {
      label: "Sorgenti",
      ok: sourceHealth?.checkedAt ? Boolean(sourceHealth.ok) : true,
      detail: sourceHealth?.summary || "Test rapido non ancora eseguito",
    },
  ];
}

export function cookieDiagnosticRows(diagnostics) {
  const config = diagnostics?.config || {};
  const analysis = config.ytdlCookieAnalysis || {};
  const warning = config.ytdlCookieWarning || {};
  const sessionNames = Array.isArray(analysis.sessionCookieNames) ? analysis.sessionCookieNames : [];
  const rows = [
    {
      label: "Messaggio",
      value:
        warning.message ||
        (config.ytdlCookiesAvailable
          ? "File cookie presente. Usa Test cookie YouTube per verificare se l'account e' accettato dal Raspberry."
          : "Cookie YouTube non presenti."),
    },
    {
      label: "File letto",
      value: config.ytdlCookiesPath || "data/youtube-cookies.txt",
    },
    {
      label: "Origine",
      value: config.ytdlCookiesSource || "default",
    },
    {
      label: "Righe cookie",
      value: `${analysis.validRows ?? 0} totali, ${analysis.youtubeRows ?? 0} YouTube/Google`,
    },
    {
      label: "Sessione login",
      value: analysis.hasSessionCookies
        ? `${analysis.sessionCookieCount ?? 0} cookie sessione trovati`
        : `${analysis.sessionCookieCount ?? 0} cookie sessione trovati: esporta un cookies.txt nuovo da YouTube gia' loggato`,
    },
    {
      label: "Nomi sessione trovati",
      value: sessionNames.length > 0 ? sessionNames.join(", ") : "Nessun cookie sessione riconosciuto",
    },
    {
      label: "Prossima scadenza critica",
      value: analysis.earliestExpiresAt
        ? `${diagnosticDateLabel(analysis.earliestExpiresAt)}${
            Number.isFinite(analysis.expiresInDays) ? ` (${analysis.expiresInDays} giorni)` : ""
          }`
        : "Scadenza non rilevata nel file",
    },
  ];

  return rows;
}
