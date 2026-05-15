function ytdlPoTokenClientContext(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "mweb.gvs";
  }
  return value.includes("+") ? value.split("+")[0] : value;
}

function ytdlPoTokenPlayerClient(rawValue) {
  const context = ytdlPoTokenClientContext(rawValue);
  return context.split(".")[0] || "mweb";
}

function normalizedYtdlPoToken(rawToken, rawClientContext) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return "";
  }
  if (/^[a-z0-9_]+(?:\.[a-z0-9_]+)?\+/i.test(token)) {
    return token;
  }
  return `${ytdlPoTokenClientContext(rawClientContext)}+${token}`;
}

function buildYtdlExtractorArgs(rawExtractorArgs, rawPoToken, rawPoTokenClient, options = {}) {
  const useBgutilProvider = Boolean(options.useBgutilProvider);
  const bgutilBaseUrl = String(options.bgutilBaseUrl || "").trim();
  const token = normalizedYtdlPoToken(rawPoToken, rawPoTokenClient);
  const legacyDefault = "youtube:player_client=web_safari";
  const poTokenClient = ytdlPoTokenPlayerClient(token || rawPoTokenClient);
  const shouldUseMweb = Boolean(token || useBgutilProvider);
  let extractorArgs = String(rawExtractorArgs || "").trim();

  if (!extractorArgs) {
    extractorArgs = shouldUseMweb ? `youtube:player_client=${poTokenClient}` : legacyDefault;
  } else if (shouldUseMweb && extractorArgs === legacyDefault) {
    extractorArgs = `youtube:player_client=${poTokenClient}`;
  } else if (shouldUseMweb && /youtube:[^,\s]*player_client=web_safari/i.test(extractorArgs)) {
    extractorArgs = extractorArgs.replace(/player_client=web_safari/i, `player_client=${poTokenClient}`);
  }

  extractorArgs = appendBgutilExtractorArgs(extractorArgs, useBgutilProvider, bgutilBaseUrl);

  if (!token || /po_token=/i.test(extractorArgs)) {
    return extractorArgs;
  }

  if (/youtube:[^,\s]*/i.test(extractorArgs)) {
    return extractorArgs.replace(/youtube:[^,\s]*/i, (value) => `${value};po_token=${token}`);
  }

  return `${extractorArgs},youtube:player_client=${poTokenClient};po_token=${token}`;
}

function appendBgutilExtractorArgs(rawExtractorArgs, useBgutilProvider = false, bgutilBaseUrl = "") {
  const extractorArgs = String(rawExtractorArgs || "").trim();
  const baseUrl = String(bgutilBaseUrl || "").trim();
  if (!useBgutilProvider || !baseUrl || /youtubepot-bgutilhttp:/i.test(extractorArgs)) {
    return extractorArgs;
  }

  // yt-dlp usa una chiave extractor separata per dire al plugin bgutil dove chiedere i PO token GVS.
  const bgutilArgs = `youtubepot-bgutilhttp:base_url=${baseUrl}`;
  return extractorArgs ? `${extractorArgs},${bgutilArgs}` : bgutilArgs;
}

function redactYtdlSecrets(value) {
  return String(value || "").replace(/(po_token=)([^,\s]+)/gi, "$1***");
}

function redactYtdlArgs(args) {
  return args.map((arg) => redactYtdlSecrets(arg));
}

function mpvRawOptionPair(key, value) {
  return `${key}=${mpvSuboptionValue(value)}`;
}

function mpvSuboptionValue(value) {
  const text = String(value || "");
  if (!/[,\s\[\]'"%]/.test(text)) {
    return text;
  }

  // mpv interpreta "," come separatore delle key/value list: il prefisso %n% passa il valore intatto.
  return `%${Buffer.byteLength(text, "utf8")}%${text}`;
}

module.exports = {
  buildYtdlExtractorArgs,
  mpvRawOptionPair,
  normalizedYtdlPoToken,
  redactYtdlArgs,
  redactYtdlSecrets,
  ytdlPoTokenClientContext,
};
