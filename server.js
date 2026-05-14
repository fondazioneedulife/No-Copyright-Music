const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { createAutomaticAudioCheckService } = require("./lib/audio-check-service");
const { createAudioReplacementService } = require("./lib/audio-replacement-service");
const { createAuthService } = require("./lib/auth-service");
const { catalogPageResponse } = require("./lib/catalog-page");

// Percorsi principali dell'app: tutto resta locale e puo' essere spostato con variabili ambiente.
const ROOT_DIR = __dirname;
const DATA_DIR = process.env.CLEARWAVE_DATA_DIR || path.join(ROOT_DIR, "data");
const UPLOADS_DIR = process.env.CLEARWAVE_UPLOADS_DIR || path.join(ROOT_DIR, "uploads");
const ASSETS_DIR = path.join(ROOT_DIR, "assets");
const SRC_DIR = path.join(ROOT_DIR, "src");
const STYLES_DIR = path.join(ROOT_DIR, "styles");
const PARTIALS_DIR = path.join(ROOT_DIR, "partials");
const INDEX_TEMPLATE_FILE = path.join(ROOT_DIR, "index.html");
const REACT_DIST_DIR = path.join(ROOT_DIR, "frontend", "dist");
const COVERS_DIR = path.join(ASSETS_DIR, "covers");
const AUDIO_DIR = path.join(UPLOADS_DIR, "audio");
const LICENSES_DIR = path.join(UPLOADS_DIR, "licenses");
const LIBRARY_FILE = path.join(DATA_DIR, "library.json");
const AUTH_DB_FILE = path.join(DATA_DIR, "clearwave-auth.sqlite");
const YOUTUBE_IMPORT_STATE_FILE = path.join(DATA_DIR, "youtube-import-state.json");
const AUDIO_REPLACEMENT_FILE = path.join(DATA_DIR, "audio-replacement-list.json");
const AUDIO_CHECK_REPORTS_DIR = process.env.CLEARWAVE_AUDIO_CHECK_REPORT_DIR || path.join(DATA_DIR, "reports");
const DEFAULT_YTDL_COOKIES_FILE = path.join(DATA_DIR, "youtube-cookies.txt");
const publicFiles = new Set(["/index.html", "/styles.css", "/app.js"]);
const SERVER_RUNTIME_REVISION = "raspberry-audio-queue-2026-04-29";

// Chiavi API esterne. Devono arrivare dall'ambiente o da start-local.ps1, mai dal frontend.
const jamendoClientId = process.env.JAMENDO_CLIENT_ID || process.env.JAMIENDO_CLIENT_ID;
const audioDbApiKey = process.env.THEAUDIODB_API_KEY || process.env.AUDIODB_API_KEY;
const audiusApiKey = process.env.AUDIUS_API_KEY;
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
const jamendoCoverCache = new Map();
const serverPlayerCommand = process.env.CLEARWAVE_PLAYER_COMMAND || "mpv";
const serverPlayerAudioOutput = String(process.env.CLEARWAVE_AUDIO_OUTPUT || "alsa").trim();
const serverPlayerAudioDevice = String(process.env.CLEARWAVE_AUDIO_DEVICE || "").trim();
const serverPlayerAlsaCard = String(process.env.ALSA_CARD || "").trim();
const serverPlayerYtdlPath = String(process.env.CLEARWAVE_YTDL_PATH || "/usr/bin/yt-dlp").trim();
const serverPlayerYtdlFormat = String(
  process.env.CLEARWAVE_YTDL_FORMAT || "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best"
).trim();
const serverPlayerYtdlJsRuntime = String(process.env.CLEARWAVE_YTDL_JS_RUNTIME || "").trim();
const serverPlayerYtdlCookiesFileFromEnv = String(process.env.CLEARWAVE_YTDL_COOKIES_FILE || "").trim();
const serverPlayerYtdlCookiesFile = serverPlayerYtdlCookiesFileFromEnv || DEFAULT_YTDL_COOKIES_FILE;
const serverPlayerYtdlCookieProbeUrl = String(
  process.env.CLEARWAVE_YTDL_COOKIE_PROBE_URL || "https://www.youtube.com/watch?v=jNQXAC9IVRw"
).trim();
const serverPlayerYtdlCookieExpiryWarningDays = Math.max(
  1,
  Math.min(60, Number(process.env.CLEARWAVE_YTDL_COOKIE_EXPIRY_WARNING_DAYS || 14) || 14)
);
const serverPlayerMpvMsgLevel = String(process.env.CLEARWAVE_MPV_MSG_LEVEL || "all=warn,ytdl_hook=info").trim();
const serverPlayerAudioPreflight = process.env.CLEARWAVE_AUDIO_PREFLIGHT !== "0";
const serverPlayerAudioPreflightTimeoutMs = Math.max(
  700,
  Number(process.env.CLEARWAVE_AUDIO_PREFLIGHT_TIMEOUT_MS || 2500) || 2500
);
const serverPlayerVolumeGain = Math.max(
  0.5,
  Math.min(2, Number(process.env.CLEARWAVE_SERVER_VOLUME_GAIN || 1.15) || 1.15)
);
const serverPlayerVolumeMax = Math.max(
  100,
  Math.min(180, Number(process.env.CLEARWAVE_SERVER_VOLUME_MAX || 130) || 130)
);
const ytdlSessionCookieNames = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LOGIN_INFO",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PSIDTS",
  "__Secure-3PSIDTS",
]);
const serverPlayer = {
  // Stato del player lato Raspberry: React diventa telecomando, l'audio esce dal server.
  process: null,
  runId: 0,
  socketPath: "",
  activeTrack: null,
  startedAt: 0,
  pausedAt: 0,
  duration: 0,
  isPaused: false,
  isStopping: false,
  lastError: "",
  lastExitCode: null,
  lastFailedTrack: null,
  volume: Number(process.env.CLEARWAVE_SERVER_VOLUME || 75),
  playSequence: 0,
  playQueue: Promise.resolve(),
  events: [],
  playbackContext: {
    tracks: [],
    index: -1,
    repeatMode: "off",
    shuffleEnabled: false,
    skippedTrackIds: [],
    updatedAt: "",
  },
};
const automaticAudioCheck = createAutomaticAudioCheckService({
  rootDir: ROOT_DIR,
  dataDir: DATA_DIR,
  uploadsDir: UPLOADS_DIR,
});
const audioReplacementService = createAudioReplacementService({
  rootDir: ROOT_DIR,
  dataDir: DATA_DIR,
  reportsDir: AUDIO_CHECK_REPORTS_DIR,
  replacementFile: AUDIO_REPLACEMENT_FILE,
  readLibrary,
  writeLibrary,
  getYtdlCookiesFile: ytdlCookiesFileIfAvailable,
  getLastPlayerFailure: () => ({
    track: serverPlayer.lastFailedTrack,
    error: serverPlayer.lastError,
  }),
});
const {
  authUserFromRequest,
  changeAuthPassword,
  createAuthUser,
  deleteAuthUser,
  ensureAuthDatabase,
  getBearerToken,
  listAuthUsers,
  loginAuthUser,
  logoutAuthToken,
  requireAdminRequest,
  requireAuthRequest,
  resetAuthUserPassword,
} = createAuthService({
  authDbFile: AUTH_DB_FILE,
  initialAdminPassword: process.env.CLEARWAVE_ADMIN_PASSWORD || "admin123",
});

// Canali YouTube considerati "sicuri" per import permanente. Ogni traccia va comunque verificata.
const youtubeCuratedChannels = [
  {
    id: "UC_aEa8K-EOJ3D6gOs7HcyNg",
    name: "NoCopyrightSounds",
    aliases: ["nocopyrightsounds"],
    policyUrl: "https://ncs.io/usage-policy",
    note: "NCS richiede credito e ha condizioni diverse per creator indipendenti, brand e campagne.",
  },
  {
    id: "UCkRrhwhJ2Ia_ZlkTQ4XFWJA",
    name: "Infraction - No Copyright Music",
    aliases: ["infractionnocopyrightmusic", "infraction-no-copyright-music"],
    policyUrl: "https://www.youtube.com/@Infraction-NoCopyrightMusic",
    note: "Verifica sempre descrizione video, link download e termini della singola traccia.",
  },
  {
    id: "UCUFDNffZtBGisDliMx12fYw",
    name: "BreakingCopyright - Royalty Free Music",
    aliases: ["breakingcopyright", "breakingcopyrightroyaltyfreemusic"],
    policyUrl: "https://breakingcopyright.com/disclaimer",
    note: "BreakingCopyright segnala che le condizioni possono cambiare e va conservata la prova licenza.",
  },
];

const baseSeedDate = "2026-04-15T08:00:00.000Z";
const seedTrackBlueprints = [
  {
    id: "solar-drift",
    title: "Solar Drift",
    subtitle: "Nu-disco / summer retail",
    mood: "Upbeat",
    bpm: 118,
    duration: "02:14",
    energy: "Alta",
    license: "CC0",
    licenseDetail: "CC0 / nessuna attribuzione richiesta",
    attributionRequired: false,
    useCases: ["ADV digital", "Social media", "Retail store"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 6,
    instrument: "Bass synth",
    accent: "#de7a3d",
    description:
      "Groove rapido e luminoso, ideale per promo retail, saldi e reel con ritmo energico.",
    tags: ["promo", "summer", "funk", "retail"],
    preview: [392, 440, 523.25, 587.33, 523.25, 440],
    wave: "sawtooth",
  },
  {
    id: "civic-light",
    title: "Civic Light",
    subtitle: "Corporate piano / branded video",
    mood: "Calm",
    bpm: 92,
    duration: "02:48",
    energy: "Media",
    license: "Public Domain",
    licenseDetail: "Pubblico dominio verificato",
    attributionRequired: false,
    useCases: ["Video branded", "Podcast", "ADV digital"],
    formats: ["WAV", "MP3"],
    stems: 4,
    instrument: "Piano felt",
    accent: "#147885",
    description:
      "Texture morbida e istituzionale, adatta a presentazioni prodotto e storytelling aziendale.",
    tags: ["corporate", "piano", "clean", "brand"],
    preview: [261.63, 329.63, 392, 523.25, 392, 329.63],
    wave: "triangle",
  },
  {
    id: "velvet-route",
    title: "Velvet Route",
    subtitle: "Lo-fi / voiceover safe",
    mood: "Warm",
    bpm: 84,
    duration: "03:02",
    energy: "Bassa",
    license: "Royalty-Free Pro",
    licenseDetail: "Royalty-free commerciale, conserva la prova licenza",
    attributionRequired: false,
    useCases: ["Podcast", "Video branded", "Social media"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 8,
    instrument: "Electric piano",
    accent: "#956646",
    description:
      "Tappeto rilassato e parlato-friendly, pensato per podcast premium e walkthrough di prodotto.",
    tags: ["lofi", "podcast", "warm", "voiceover"],
    preview: [220, 246.94, 293.66, 349.23, 293.66, 246.94],
    wave: "sine",
  },
  {
    id: "optic-rise",
    title: "Optic Rise",
    subtitle: "Electro pop / motion design",
    mood: "Upbeat",
    bpm: 126,
    duration: "02:05",
    energy: "Alta",
    license: "CC0",
    licenseDetail: "CC0 / uso commerciale illimitato",
    attributionRequired: false,
    useCases: ["ADV digital", "Social media", "Video branded"],
    formats: ["WAV", "MP3"],
    stems: 5,
    instrument: "Pluck synth",
    accent: "#4a8b76",
    description:
      "Transizioni brillanti e hook sintetico breve, perfetto per motion graphic e launch teaser.",
    tags: ["teaser", "tech", "bright", "launch"],
    preview: [523.25, 659.25, 783.99, 880, 783.99, 659.25],
    wave: "square",
  },
  {
    id: "ember-story",
    title: "Ember Story",
    subtitle: "Acoustic folk / storytelling",
    mood: "Warm",
    bpm: 96,
    duration: "02:56",
    energy: "Media",
    license: "Attribution Commercial",
    licenseDetail: "Commerciale con attribuzione obbligatoria",
    attributionRequired: true,
    useCases: ["Video branded", "Social media"],
    formats: ["WAV", "MP3"],
    stems: 3,
    instrument: "Acoustic guitar",
    accent: "#c2793f",
    description:
      "Chitarra e percussioni leggere per racconti autentici, turismo e food storytelling.",
    tags: ["folk", "story", "travel", "food"],
    preview: [329.63, 392, 440, 523.25, 440, 392],
    wave: "triangle",
  },
  {
    id: "metro-signal",
    title: "Metro Signal",
    subtitle: "Minimal techno / in-store loop",
    mood: "Focused",
    bpm: 122,
    duration: "04:08",
    energy: "Media",
    license: "Royalty-Free Pro",
    licenseDetail: "Royalty-free commerciale, con proof-of-license",
    attributionRequired: false,
    useCases: ["Retail store", "ADV digital"],
    formats: ["WAV", "MP3", "Loop Pack"],
    stems: 10,
    instrument: "Analog sequence",
    accent: "#2d6d73",
    description:
      "Sequenza minimal e ipnotica per negozi, showroom o UX sonoro di eventi fisici.",
    tags: ["minimal", "store", "loop", "tech"],
    preview: [174.61, 220, 246.94, 220, 174.61, 246.94],
    wave: "sawtooth",
  },
  {
    id: "garden-frame",
    title: "Garden Frame",
    subtitle: "Ambient piano / wellness",
    mood: "Calm",
    bpm: 74,
    duration: "03:18",
    energy: "Bassa",
    license: "CC0",
    licenseDetail: "CC0 / nessun credito richiesto",
    attributionRequired: false,
    useCases: ["Podcast", "Retail store", "Video branded"],
    formats: ["WAV", "MP3"],
    stems: 4,
    instrument: "Soft piano",
    accent: "#8b9a5c",
    description:
      "Ambiente sospeso e tranquillo per wellness, hospitality, interni e long-form voiceover.",
    tags: ["ambient", "wellness", "soft", "spa"],
    preview: [220, 261.63, 329.63, 392, 329.63, 261.63],
    wave: "sine",
  },
  {
    id: "signal-bloom",
    title: "Signal Bloom",
    subtitle: "Indie pop / lifestyle",
    mood: "Bright",
    bpm: 110,
    duration: "02:24",
    energy: "Alta",
    license: "Public Domain",
    licenseDetail: "Pubblico dominio, commerciale e social-safe",
    attributionRequired: false,
    useCases: ["Social media", "ADV digital", "Video branded"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 7,
    instrument: "Hand claps",
    accent: "#d19a42",
    description:
      "Pop fresco e leggero per creator, capsule collection, lifestyle brand e campagne stagionali.",
    tags: ["indie", "social", "lifestyle", "bright"],
    preview: [293.66, 369.99, 440, 587.33, 440, 369.99],
    wave: "square",
  },
  {
    id: "night-canopy",
    title: "Night Canopy",
    subtitle: "Downtempo / luxury retail",
    mood: "Focused",
    bpm: 102,
    duration: "03:36",
    energy: "Media",
    license: "Royalty-Free Pro",
    licenseDetail: "Royalty-free commerciale con ricevuta da archiviare",
    attributionRequired: false,
    useCases: ["Retail store", "Video branded"],
    formats: ["WAV", "MP3"],
    stems: 5,
    instrument: "Muted keys",
    accent: "#515f7b",
    description:
      "Atmosfera sofisticata e urbana, pensata per retail premium, gioielleria o fashion film.",
    tags: ["luxury", "fashion", "urban", "slow"],
    preview: [196, 246.94, 293.66, 349.23, 293.66, 246.94],
    wave: "triangle",
  },
  {
    id: "sunline-kick",
    title: "Sunline Kick",
    subtitle: "Afro house / summer activation",
    mood: "Bright",
    bpm: 120,
    duration: "02:31",
    energy: "Alta",
    license: "CC0",
    licenseDetail: "CC0 / adatta a campagne summer e eventi",
    attributionRequired: false,
    useCases: ["ADV digital", "Retail store", "Social media"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 9,
    instrument: "Percussive synth",
    accent: "#d77c34",
    description:
      "Percussione calda e groove immediato per popup store, eventi estivi e video dinamici.",
    tags: ["summer", "house", "event", "groove"],
    preview: [293.66, 293.66, 349.23, 392, 440, 392],
    wave: "sawtooth",
  },
  {
    id: "quiet-brochure",
    title: "Quiet Brochure",
    subtitle: "Minimal marimba / product UI",
    mood: "Calm",
    bpm: 88,
    duration: "01:58",
    energy: "Bassa",
    license: "Attribution Commercial",
    licenseDetail: "Commerciale con credito richiesto nel deliverable",
    attributionRequired: true,
    useCases: ["ADV digital", "Video branded", "Podcast"],
    formats: ["WAV", "MP3"],
    stems: 2,
    instrument: "Marimba",
    accent: "#7c8450",
    description:
      "Minimalismo pulito e discreto per demo software, landing video e product explainers.",
    tags: ["minimal", "ui", "product", "soft"],
    preview: [392, 523.25, 587.33, 659.25, 587.33, 523.25],
    wave: "square",
  },
  {
    id: "ribbon-engine",
    title: "Ribbon Engine",
    subtitle: "Future bass / promo launch",
    mood: "Upbeat",
    bpm: 128,
    duration: "02:12",
    energy: "Alta",
    license: "Royalty-Free Pro",
    licenseDetail: "Royalty-free commerciale per ADV e social ads",
    attributionRequired: false,
    useCases: ["ADV digital", "Social media"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 12,
    instrument: "Synth lead",
    accent: "#476bb7",
    description:
      "Spinta moderna e taglio promo per launch di app, sneaker drop e campagne paid social.",
    tags: ["launch", "future", "ad", "promo"],
    preview: [349.23, 440, 523.25, 698.46, 523.25, 440],
    wave: "sawtooth",
  },
  {
    id: "harbor-move",
    title: "Harbor Move",
    subtitle: "Deep house / travel retail",
    mood: "Focused",
    bpm: 116,
    duration: "02:44",
    energy: "Media",
    license: "CC0",
    licenseDetail: "CC0 / uso commerciale e instore",
    attributionRequired: false,
    useCases: ["Retail store", "ADV digital", "Social media"],
    formats: ["WAV", "MP3"],
    stems: 6,
    instrument: "House piano",
    accent: "#337a8e",
    description:
      "House caldo e scorrevole per travel brand, beachwear, activation e store playlist.",
    tags: ["house", "travel", "summer", "retail"],
    preview: [261.63, 329.63, 392, 440, 392, 329.63],
    wave: "sawtooth",
  },
  {
    id: "gloss-drive",
    title: "Gloss Drive",
    subtitle: "Electro funk / beauty campaign",
    mood: "Bright",
    bpm: 124,
    duration: "02:08",
    energy: "Alta",
    license: "Royalty-Free Pro",
    licenseDetail: "Commerciale con prova di licenza",
    attributionRequired: false,
    useCases: ["ADV digital", "Social media", "Video branded"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 8,
    instrument: "Funk guitar",
    accent: "#b96d3d",
    description:
      "Brano brillante per beauty, skincare, cosmetics launch e campagne visual ad alto ritmo.",
    tags: ["beauty", "fashion", "groove", "launch"],
    preview: [392, 440, 493.88, 587.33, 493.88, 440],
    wave: "square",
  },
  {
    id: "calm-atrium",
    title: "Calm Atrium",
    subtitle: "Neo classical / hospitality",
    mood: "Calm",
    bpm: 70,
    duration: "03:26",
    energy: "Bassa",
    license: "Public Domain",
    licenseDetail: "Pubblico dominio verificato",
    attributionRequired: false,
    useCases: ["Podcast", "Retail store", "Video branded"],
    formats: ["WAV", "MP3"],
    stems: 3,
    instrument: "Grand piano",
    accent: "#879a74",
    description:
      "Piano arioso e raffinato per hospitality, wellness, real estate e luxury environments.",
    tags: ["piano", "hospitality", "luxury", "calm"],
    preview: [220, 277.18, 329.63, 392, 329.63, 277.18],
    wave: "triangle",
  },
  {
    id: "signal-garden",
    title: "Signal Garden",
    subtitle: "Indie electronic / app promo",
    mood: "Upbeat",
    bpm: 122,
    duration: "02:18",
    energy: "Alta",
    license: "CC0",
    licenseDetail: "CC0 / adatta a promo e paid media",
    attributionRequired: false,
    useCases: ["ADV digital", "Social media", "Video branded"],
    formats: ["WAV", "MP3"],
    stems: 5,
    instrument: "Synth bells",
    accent: "#4f78be",
    description:
      "Elettronica pulita e luminosa per app launch, SaaS teaser, onboarding video e digital ads.",
    tags: ["app", "tech", "promo", "bright"],
    preview: [523.25, 587.33, 659.25, 783.99, 659.25, 587.33],
    wave: "square",
  },
  {
    id: "canvas-step",
    title: "Canvas Step",
    subtitle: "Lo-fi beat / creator tools",
    mood: "Warm",
    bpm: 90,
    duration: "02:52",
    energy: "Bassa",
    license: "Royalty-Free Pro",
    licenseDetail: "Royalty-free commerciale con ricevuta",
    attributionRequired: false,
    useCases: ["Podcast", "Video branded", "ADV digital"],
    formats: ["WAV", "MP3"],
    stems: 6,
    instrument: "Tape keys",
    accent: "#7f5f56",
    description:
      "Beat morbido e discreto per tutorial, creator economy, software demos e explainer premium.",
    tags: ["lofi", "tutorial", "soft", "creator"],
    preview: [220, 246.94, 261.63, 329.63, 261.63, 246.94],
    wave: "sine",
  },
  {
    id: "granite-loop",
    title: "Granite Loop",
    subtitle: "Percussive minimal / showroom",
    mood: "Focused",
    bpm: 108,
    duration: "03:10",
    energy: "Media",
    license: "CC0",
    licenseDetail: "CC0 / instore e ambienti commerciali",
    attributionRequired: false,
    useCases: ["Retail store", "Video branded"],
    formats: ["WAV", "MP3", "Loop Pack"],
    stems: 4,
    instrument: "Percussive plucks",
    accent: "#4f6a64",
    description:
      "Loop essenziale e moderno per showroom, interni, eventi corporate e ambient branding.",
    tags: ["minimal", "showroom", "loop", "design"],
    preview: [196, 246.94, 196, 293.66, 246.94, 196],
    wave: "triangle",
  },
  {
    id: "festival-copy",
    title: "Festival Copy",
    subtitle: "Pop clap / social activation",
    mood: "Bright",
    bpm: 114,
    duration: "02:22",
    energy: "Alta",
    license: "Public Domain",
    licenseDetail: "Pubblico dominio / social-safe",
    attributionRequired: false,
    useCases: ["Social media", "ADV digital"],
    formats: ["WAV", "MP3"],
    stems: 5,
    instrument: "Claps",
    accent: "#cf9140",
    description:
      "Pop leggero con clap energici per stories, content veloci, retail activation e promo brand.",
    tags: ["social", "claps", "festival", "promo"],
    preview: [329.63, 392, 493.88, 523.25, 493.88, 392],
    wave: "square",
  },
  {
    id: "meadow-frame",
    title: "Meadow Frame",
    subtitle: "Acoustic ambient / organic brand",
    mood: "Warm",
    bpm: 82,
    duration: "03:06",
    energy: "Bassa",
    license: "Attribution Commercial",
    licenseDetail: "Commerciale con attribuzione",
    attributionRequired: true,
    useCases: ["Video branded", "Podcast"],
    formats: ["WAV", "MP3"],
    stems: 3,
    instrument: "Acoustic strings",
    accent: "#8f8552",
    description:
      "Texture organica e naturale per food, sustainable brand, tourism e storytelling umano.",
    tags: ["organic", "travel", "nature", "brand"],
    preview: [246.94, 293.66, 329.63, 392, 329.63, 293.66],
    wave: "triangle",
  },
  {
    id: "ultra-window",
    title: "Ultra Window",
    subtitle: "Future pop / sports promo",
    mood: "Upbeat",
    bpm: 130,
    duration: "02:04",
    energy: "Alta",
    license: "Royalty-Free Pro",
    licenseDetail: "Commerciale con licenza attiva",
    attributionRequired: false,
    useCases: ["ADV digital", "Social media", "Video branded"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 9,
    instrument: "Lead synth",
    accent: "#5870d0",
    description:
      "Taglio sportivo e moderno per launch, fitness apps, performance content e performance ads.",
    tags: ["sport", "promo", "future", "ads"],
    preview: [440, 523.25, 659.25, 783.99, 659.25, 523.25],
    wave: "sawtooth",
  },
  {
    id: "linen-echo",
    title: "Linen Echo",
    subtitle: "Soft electronica / interior design",
    mood: "Calm",
    bpm: 78,
    duration: "03:12",
    energy: "Bassa",
    license: "CC0",
    licenseDetail: "CC0 / uso commerciale semplice",
    attributionRequired: false,
    useCases: ["Retail store", "Video branded", "Podcast"],
    formats: ["WAV", "MP3"],
    stems: 4,
    instrument: "Soft synth",
    accent: "#597b88",
    description:
      "Elettronica soft e minimale per interior design, home brands, cataloghi video e slow content.",
    tags: ["interior", "ambient", "soft", "design"],
    preview: [196, 220, 261.63, 329.63, 261.63, 220],
    wave: "sine",
  },
  {
    id: "pixel-sprint",
    title: "Pixel Sprint",
    subtitle: "Chiptune pop / gaming campaign",
    mood: "Bright",
    bpm: 132,
    duration: "01:58",
    energy: "Alta",
    license: "Royalty-Free Pro",
    licenseDetail: "Commerciale per gaming e digital content",
    attributionRequired: false,
    useCases: ["Social media", "ADV digital", "Video branded"],
    formats: ["WAV", "MP3"],
    stems: 7,
    instrument: "8-bit lead",
    accent: "#6481f0",
    description:
      "Vibe gaming leggera e veloce per promos, streamer packages, app events e launch vertical.",
    tags: ["gaming", "retro", "promo", "digital"],
    preview: [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25],
    wave: "square",
  },
  {
    id: "plaza-lights",
    title: "Plaza Lights",
    subtitle: "Disco house / mall atmosphere",
    mood: "Upbeat",
    bpm: 120,
    duration: "02:40",
    energy: "Alta",
    license: "CC0",
    licenseDetail: "CC0 / retail e promo always-on",
    attributionRequired: false,
    useCases: ["Retail store", "ADV digital", "Social media"],
    formats: ["WAV", "MP3", "Stems"],
    stems: 8,
    instrument: "Disco strings",
    accent: "#cc733f",
    description:
      "House disco elegante per store traffic, mall promo, beauty corners e activation instore.",
    tags: ["disco", "mall", "retail", "promo"],
    preview: [293.66, 349.23, 392, 493.88, 392, 349.23],
    wave: "sawtooth",
  },
];

const seedVariantNames = [
  "Afterglow",
  "Studio Cut",
  "Midday Edit",
  "Night Edit",
  "Clean Loop",
  "Social Lift",
  "Retail Mix",
  "Soft Bed",
  "Launch Cut",
  "Warm Alt",
  "Pulse Edit",
  "Short Form",
  "Brand Bed",
  "Focus Mix",
  "Creator Cut",
  "Gallery Edit",
  "Motion Loop",
  "Event Mix",
  "Airline Cut",
  "Wellness Edit",
  "Showroom Mix",
  "Podcast Bed",
  "Campaign Edit",
  "Store Loop",
  "Prime Cut",
  "Lite Mix",
  "Morning Edit",
  "Echo Cut",
  "Road Mix",
  "Spark Edit",
  "Calm Loop",
  "Hero Cut",
];

const seedVariantBpmOffsets = [-8, -4, 3, 6, 10, -2];
const seedVariantTransposes = [-5, -3, 2, 4, 7, 9];

function transposePreviewNotes(notes, semitones) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return notes;
  }

  const factor = 2 ** (semitones / 12);
  return notes.map((frequency) => Number((Number(frequency || 220) * factor).toFixed(2)));
}

function buildSeedVariant(track, index, layer = 1) {
  const variantName = seedVariantNames[index % seedVariantNames.length];
  const suffix = layer > 1 ? `${variantName} ${layer}` : variantName;
  const bpmOffset = seedVariantBpmOffsets[index % seedVariantBpmOffsets.length] + (layer - 1) * 2;
  const transpose = seedVariantTransposes[index % seedVariantTransposes.length] + layer - 1;
  const tags = [
    ...(Array.isArray(track.tags) ? track.tags : []),
    "alt-cut",
    slugify(variantName),
  ];

  return {
    ...track,
    id: `${track.id}-${slugify(suffix)}`,
    title: `${track.title} ${suffix}`,
    subtitle: `${track.subtitle} / ${variantName.toLowerCase()}`,
    bpm: Math.max(58, Number(track.bpm || 100) + bpmOffset),
    duration: layer > 1 ? "01:36" : track.duration,
    stems: Math.max(0, Number(track.stems || 0) - (layer > 1 ? 1 : 0)),
    description: `${track.description} Variante ${variantName.toLowerCase()} per playlist, social cut e rotazioni commerciali.`,
    tags: [...new Set(tags)].slice(0, 8),
    preview: transposePreviewNotes(track.preview, transpose),
  };
}

const expandedSeedTrackBlueprints = [
  ...seedTrackBlueprints,
  ...seedTrackBlueprints.map((track, index) => buildSeedVariant(track, index)),
  ...seedTrackBlueprints
    .slice(0, 8)
    .map((track, index) => buildSeedVariant(track, index + seedTrackBlueprints.length, 2)),
];

const seedTracks = expandedSeedTrackBlueprints.map((track, index) => ({
  ...track,
  sourceType: "seed",
  audioPath: null,
  audioOriginalName: null,
  licensePath: null,
  licenseFileName: null,
  sourceUrl: "",
  rightsNotes: "",
  createdAt: new Date(new Date(baseSeedDate).getTime() + index * 3_600_000).toISOString(),
  updatedAt: new Date(new Date(baseSeedDate).getTime() + index * 3_600_000).toISOString(),
}));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
};

const accents = ["#146c78", "#c26a35", "#4a8b76", "#476bb7", "#8b9a5c", "#956646"];
const genreArtwork = {
  "Ambient": {
    slug: "ambient",
    prompt: "Premium AI-generated ambient album cover, misty depth layers, soft bioluminescent particles, elegant minimal composition, cinematic calm, no text, square 1024x1024.",
  },
  "Cinematic": {
    slug: "cinematic",
    prompt: "Premium AI-generated cinematic soundtrack cover, vast horizon glow, filmic shadows, orchestral scale, dramatic but clean commercial artwork, no text, square 1024x1024.",
  },
  "Corporate": {
    slug: "corporate",
    prompt: "Premium AI-generated corporate music cover, glass architecture, confident green-blue light, polished brand campaign aesthetic, abstract and professional, no text, square 1024x1024.",
  },
  "Drum & Bass": {
    slug: "drum-bass",
    prompt: "Premium AI-generated drum and bass album cover, neon speed trails, bass waveform geometry, fast nocturnal club energy, sharp modern depth, no text, square 1024x1024.",
  },
  "Electronic": {
    slug: "electronic",
    prompt: "Premium AI-generated electronic music cover, luminous synth grid, chrome liquid waves, deep emerald and cyan palette, futuristic streaming artwork, no text, square 1024x1024.",
  },
  "Hip Hop": {
    slug: "hip-hop",
    prompt: "Premium AI-generated instrumental hip hop cover, warm streetlight grain, vinyl texture, bold bass shapes, urban but clean commercial artwork, no text, square 1024x1024.",
  },
  "House": {
    slug: "house",
    prompt: "Premium AI-generated house music cover, glossy dancefloor reflections, sunset club energy, rhythmic circular forms, elegant nightlife palette, no text, square 1024x1024.",
  },
  "Lofi": {
    slug: "lofi",
    prompt: "Premium AI-generated lofi cover, cozy analog textures, soft tape grain, warm desk lamp mood, dreamy study atmosphere, no text, square 1024x1024.",
  },
  "Piano": {
    slug: "piano",
    prompt: "Premium AI-generated piano music cover, black lacquer keys, soft studio reflections, elegant negative space, calm luxury mood, no text, square 1024x1024.",
  },
  "Pop": {
    slug: "pop",
    prompt: "Premium AI-generated pop music cover, colorful soft shapes, bright commercial energy, clean modern streaming artwork, optimistic light, no text, square 1024x1024.",
  },
  "Rock": {
    slug: "rock",
    prompt: "Premium AI-generated rock music cover, textured amplifier cloth, warm stage light, bold guitar energy, gritty but polished album artwork, no text, square 1024x1024.",
  },
  "Trap": {
    slug: "trap",
    prompt: "Premium AI-generated trap instrumental cover, dark neon smoke, heavy bass geometry, crystalline edges, sharp commercial playlist mood, no text, square 1024x1024.",
  },
};
const defaultGenre = "Electronic";
const previewPresets = {
  Bright: { preview: [293.66, 369.99, 440, 587.33, 440, 369.99], wave: "square" },
  Calm: { preview: [220, 261.63, 329.63, 392, 329.63, 261.63], wave: "sine" },
  Focused: { preview: [174.61, 220, 246.94, 220, 174.61, 246.94], wave: "triangle" },
  Upbeat: { preview: [392, 440, 523.25, 587.33, 523.25, 440], wave: "sawtooth" },
  Warm: { preview: [220, 246.94, 293.66, 349.23, 293.66, 246.94], wave: "triangle" },
};
const DISCOVERY_TIMEOUT_MS = 9000;
const BULK_IMPORT_MAX_TRACKS = 5000;
const LINK_IMPORT_MAX_TRACKS = 5000;
const SESSION_IMPORT_MAX_TRACKS = 5000;
const YOUTUBE_PLAYLIST_MAX_PAGES = 120;
const YOUTUBE_CURATED_LINK_MAX_SCAN = 6000;
const YOUTUBE_UPLOADS_PAGE_SIZE = 50;
const YOUTUBE_BULK_SCAN_MULTIPLIER = 8;
const YOUTUBE_CURATED_PLAYLIST_PAGE_SIZE = 25;
const YOUTUBE_CURATED_PLAYLIST_SCAN_LIMIT = 30;
const YOUTUBE_CURATED_PLAYLIST_ITEMS_LIMIT = 80;
const primaryMusicProviders = new Set(["jamendo", "youtube_curated"]);
const bulkImportPlans = [
  {
    providerId: "jamendo",
    rightsMode: "commercial_ready",
    queries: [
      "background",
      "royalty free",
      "corporate",
      "ambient",
      "upbeat",
      "electronic",
      "cinematic",
      "house",
      "dance",
      "edm",
      "future bass",
      "dubstep",
      "drum and bass",
      "trap",
      "hip hop",
      "lofi",
      "rock",
      "pop",
      "funk",
      "jazz",
      "acoustic",
      "piano",
      "summer",
      "fashion",
      "advertising",
      "technology",
      "motivational",
      "inspirational",
      "travel",
      "vlog",
      "gaming",
      "sport",
      "documentary",
      "trailer",
    ],
  },
];

function buildDiscoveryProviders() {
  // La UI usa questa lista per mostrare quali integrazioni sono configurate.
  return [
    {
      id: "jamendo",
      name: "Jamendo",
      requiresApiKey: true,
      configured: Boolean(jamendoClientId),
      rightsModes: ["commercial_ready"],
      commercialModel: "Jamendo Pro / licenza commerciale",
      defaultMode: "commercial_ready",
      officialUrl: "https://developer.jamendo.com/v3.0/tracks",
      note:
        "Richiede client ID e verifica della licenza commerciale finale in Jamendo Pro.",
    },
    {
      id: "youtube_curated",
      name: "Canali musicali",
      requiresApiKey: true,
      configured: Boolean(youtubeApiKey),
      rightsModes: ["commercial_ready"],
      commercialModel: "NCS / Infraction / BreakingCopyright",
      defaultMode: "commercial_ready",
      officialUrl: "https://developers.google.com/youtube/v3/docs/playlistItems/list",
      note:
        "Import progressivo dai video caricati dei canali whitelist e riproduzione dentro ClearWave.",
    },
  ];
}

function publicDiscoveryProviders(rightsMode) {
  return buildDiscoveryProviders().filter((provider) => provider.rightsModes.includes(rightsMode));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isArchivedLibraryTrack(track) {
  return Boolean(track?.hiddenFromCatalog) || firstString(track?.availabilityStatus).toLowerCase() === "unavailable";
}

async function ensureStorage() {
  // Prepara cartelle e file runtime. Se le demo sono disattivate, il catalogo parte pulito.
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await fs.mkdir(LICENSES_DIR, { recursive: true });
  ensureAuthDatabase();

  try {
    await fs.access(LIBRARY_FILE);
  } catch {
    const initialTracks = process.env.CLEARWAVE_ENABLE_DEMOS === "1" ? seedTracks : [];
    await fs.writeFile(LIBRARY_FILE, JSON.stringify({ tracks: initialTracks }, null, 2), "utf8");
    return;
  }

  const raw = await fs.readFile(LIBRARY_FILE, "utf8");
  const parsed = JSON.parse(raw || "{}");
  const existingTracks = Array.isArray(parsed.tracks) ? parsed.tracks : [];
  if (process.env.CLEARWAVE_ENABLE_DEMOS === "1") {
    const byId = new Map(existingTracks.map((track) => [track.id, track]));
    seedTracks.forEach((seedTrack) => {
      if (!byId.has(seedTrack.id)) {
        existingTracks.push(seedTrack);
      }
    });
    await fs.writeFile(LIBRARY_FILE, JSON.stringify({ tracks: existingTracks }, null, 2), "utf8");
    return;
  }

  const cleanedTracks = existingTracks.filter((track) => track?.sourceType !== "seed");
  if (cleanedTracks.length !== existingTracks.length) {
    await fs.writeFile(LIBRARY_FILE, JSON.stringify({ tracks: cleanedTracks }, null, 2), "utf8");
  }
}

async function readLibrary() {
  // Catalogo musicale: JSON semplice per rendere import/export e debug piu' immediati.
  await ensureStorage();
  const raw = await fs.readFile(LIBRARY_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.tracks) ? parsed.tracks : [];
}

async function writeLibrary(tracks) {
  await ensureStorage();
  await fs.writeFile(LIBRARY_FILE, JSON.stringify({ tracks }, null, 2), "utf8");
}

async function readYouTubeImportState() {
  // Tiene memoria delle pagine YouTube gia' lette, cosi' "Importa lotto" continua da dove era arrivato.
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(YOUTUBE_IMPORT_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      channels: parsed && typeof parsed.channels === "object" ? parsed.channels : {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return { channels: {} };
  }
}

async function writeYouTubeImportState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    YOUTUBE_IMPORT_STATE_FILE,
    JSON.stringify({ channels: state.channels || {} }, null, 2),
    "utf8"
  );
}

async function resetYouTubeImportState() {
  // Reset controllato: prima crea un backup, poi azzera solo i cursori YouTube.
  await fs.mkdir(DATA_DIR, { recursive: true });
  const previousState = await readYouTubeImportState();
  const previousChannels = Object.keys(previousState.channels || {});
  let backupFile = "";

  if (fsSync.existsSync(YOUTUBE_IMPORT_STATE_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupFile = path.join(DATA_DIR, `youtube-import-state.backup-${stamp}.json`);
    await fs.copyFile(YOUTUBE_IMPORT_STATE_FILE, backupFile);
  }

  await writeYouTubeImportState({ channels: {} });
  return {
    ok: true,
    resetAt: new Date().toISOString(),
    previousChannels: previousChannels.length,
    backupFile: backupFile ? path.basename(backupFile) : "",
  };
}

async function ensureAssetStorage() {
  await fs.mkdir(COVERS_DIR, { recursive: true });
}

async function findTrackById(trackId) {
  const tracks = await readLibrary();
  return tracks.find((track) => track.id === trackId) || null;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

async function resolveJamendoCoverUrl(trackId) {
  // Le copertine Jamendo restano originali: il backend fa solo redirect/proxy controllato.
  const id = firstString(trackId).match(/\d+/)?.[0] || "";
  if (!id) {
    throw httpError(400, "ID Jamendo non valido.");
  }

  if (jamendoCoverCache.has(id)) {
    return jamendoCoverCache.get(id);
  }

  if (!jamendoClientId) {
    throw httpError(400, "JAMENDO_CLIENT_ID non configurato.");
  }

  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  url.searchParams.set("client_id", jamendoClientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("id", id);
  url.searchParams.set("imagesize", "600");
  url.searchParams.set("include", "licenses+musicinfo");
  url.searchParams.set("prolicensing", "true");
  url.searchParams.set("ccnc", "false");

  const payload = await fetchJson(url);
  const item = Array.isArray(payload.results) ? payload.results[0] : null;
  const imageUrl = firstImageUrl(
    item?.album_image,
    item?.image,
    item?.album?.image,
    item?.artist_image,
    item?.cover
  );

  if (!imageUrl) {
    throw httpError(404, "Copertina originale Jamendo non trovata.");
  }

  jamendoCoverCache.set(id, imageUrl);
  return imageUrl;
}

async function serveJamendoCover(res, trackId) {
  const imageUrl = await resolveJamendoCoverUrl(trackId);
  res.writeHead(302, {
    "Cache-Control": "public, max-age=86400",
    Location: imageUrl,
  });
  res.end();
}

function slugify(value) {
  return String(value || "track")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "track";
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function detectExtension(fileName, mimeType) {
  const explicit = path.extname(fileName || "").toLowerCase();
  if (explicit) {
    return explicit;
  }

  if (mimeType === "audio/mpeg") {
    return ".mp3";
  }

  if (mimeType === "audio/wav") {
    return ".wav";
  }

  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType === "text/plain") {
    return ".txt";
  }

  return ".bin";
}

function formatLabelList(list) {
  return parseList(list);
}

function buildPreviewBlueprint(mood) {
  return previewPresets[mood] || previewPresets.Upbeat;
}

function pickAccent(seedText) {
  const total = Array.from(String(seedText || "clearwave")).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0
  );
  return accents[total % accents.length];
}

function inferGenreFromText(text) {
  const genreEvidence = inferGenreEvidence(text);
  return genreEvidence.genre || defaultGenre;
}

function genreRules() {
  return [
    { genre: "Drum & Bass", pattern: /(drum\s*(and|&|n)?\s*bass|\bdnb\b|jungle|breakbeat)/ },
    { genre: "Trap", pattern: /(trap|808|phonk)/ },
    { genre: "Hip Hop", pattern: /(\bhip\s*hop\b|\brap\b|\bbeats?\b|boom bap)/ },
    { genre: "R&B", pattern: /(\br\s*&?\s*b\b|\brnb\b)/ },
    { genre: "Jazz", pattern: /(\bjazz\b|saxophone)/ },
    { genre: "Funk", pattern: /(\bfunk\b|\bfunnk\b)/ },
    { genre: "Folk", pattern: /(\bfolk\b|banjo)/ },
    { genre: "Country", pattern: /(\bcountry\b|western)/ },
    { genre: "Disco", pattern: /\bdisco\b/ },
    { genre: "Pop", pattern: /(dance\s*pop|hyperpop|futurepop|alternative\s*pop|\bj\s*-?\s*pop\b|\bpop\b)/ },
    { genre: "Dance", pattern: /\bdance\b/ },
    { genre: "House", pattern: /(house|deep house|tech house|future house|garage|club)/ },
    { genre: "Downtempo", pattern: /downtempo/ },
    { genre: "Cinematic", pattern: /(cinematic|epic|trailer|orchestral|film|score|dramatic)/ },
    { genre: "Ambient", pattern: /(ambient|meditation|relax|calm|wellness|atmospheric)/ },
    { genre: "Lofi", pattern: /(lofi|lo-fi|chillhop|study)/ },
    { genre: "Piano", pattern: /(piano|keys|neoclassical|classical)/ },
    { genre: "Rock", pattern: /(rock|guitar|punk|metal|indie rock)/ },
    { genre: "Corporate", pattern: /(corporate|business|presentation|commercial|advertising|inspiring)/ },
    { genre: "Electronic", pattern: /(edm|electronic|electro|techno|trance|dubstep|midtempo|bass music|synthwave|future bass|melodic bass)/ },
  ];
}

const explicitGenreAliases = new Map(
  [
    ["dnb", "Drum & Bass"],
    ["drum and bass", "Drum & Bass"],
    ["drum n bass", "Drum & Bass"],
    ["drum & bass", "Drum & Bass"],
    ["hip-hop", "Hip Hop"],
    ["hip hop", "Hip Hop"],
    ["j pop", "J-Pop"],
    ["j-pop", "J-Pop"],
    ["rnb", "R&B"],
    ["r&b", "R&B"],
    ["edm", "Electronic"],
    ["electro", "Electronic"],
  ].map(([alias, genre]) => [normalizeGenreAlias(alias), genre])
);

const explicitGenreLabels = [
  "Alternative",
  "Alternative Pop",
  "Alternative Rock",
  "Baile Bass",
  "Bass House",
  "Chill House",
  "Cloud Rap",
  "Color Bass",
  "Complextro",
  "Dance Pop",
  "Dance",
  "Disco",
  "Discoplug",
  "Drumstep",
  "Dubstep",
  "Downtempo",
  "Electronic",
  "Electronic Pop",
  "Country",
  "Folk",
  "Funk",
  "Future Bass",
  "Future Bounce",
  "Future House",
  "Future Trap",
  "Garage",
  "Glitch Hop",
  "Happy Hardcore",
  "Hardcore",
  "Hardstyle",
  "House",
  "Hyperpop",
  "Jersey Club",
  "Jazz",
  "Melodic Dubstep",
  "Melodic House",
  "Midtempo Bass",
  "Phonk",
  "Phouse",
  "Progressive House",
  "R&B",
  "Rally House",
  "Speed Garage",
  "Speed House",
  "Synthwave",
  "Tech House",
  "Techno",
  "Trance",
  "Trap",
  "Tropical House",
  "UK Dubstep",
  "Witch Funk",
  "Witch House",
  "Jedag Jedug",
];

const explicitGenreLookup = new Map(
  explicitGenreLabels.map((genre) => [normalizeGenreAlias(genre), genre])
);

function normalizeGenreAlias(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\w&+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inferExplicitGenreFromText(text) {
  const candidates = String(text || "")
    .split(/[|[\]\n\r]/)
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    // I titoli YouTube/NCS usano spesso "Titolo | Genere | NCS": quel token e' piu' affidabile
    // delle parole larghe dentro descrizioni commerciali o note di licenza.
    if (candidate.length > 36 || /\b(copyright|music|subscribe|download|whitelist|playlist)\b/i.test(candidate)) {
      continue;
    }

    const alias = normalizeGenreAlias(candidate);
    const genre = explicitGenreAliases.get(alias) || explicitGenreLookup.get(alias);
    if (genre) {
      return genre;
    }
  }

  return "";
}

function inferGenreEvidence(text) {
  const explicitGenre = inferExplicitGenreFromText(text);
  if (explicitGenre) {
    return { genre: explicitGenre, evidence: "tag esplicito nel titolo", source: "explicit" };
  }

  const normalized = String(text || "").toLowerCase();
  const match = genreRules().find((rule) => rule.pattern.test(normalized));
  return match
    ? { genre: match.genre, evidence: "metadata testuali", source: "rule" }
    : { genre: "", evidence: "", source: "" };
}

function auditGenre(currentGenre, text, provider) {
  const genreEvidence = inferGenreEvidence(text);
  const inferredGenre = genreEvidence.genre;
  const existingGenre = firstString(currentGenre);
  const hasSpecificExistingGenre = existingGenre && existingGenre !== defaultGenre;
  const providerLabel = provider === "jamendo"
    ? "Jamendo metadata"
    : provider === "youtube_curated" || provider === "youtube_session"
      ? "YouTube title/description"
      : "metadata";

  if (genreEvidence.source === "explicit") {
    return {
      genre: inferredGenre,
      audit: `Genere verificato da ${providerLabel} (${genreEvidence.evidence}): ${inferredGenre}`,
      confidence: "alta",
    };
  }

  if (hasSpecificExistingGenre) {
    const secondaryEvidence = inferredGenre && inferredGenre !== existingGenre
      ? `; metadata testuali suggeriscono anche ${inferredGenre}`
      : "";

    return {
      genre: existingGenre,
      audit: `Genere mantenuto da ${providerLabel}: ${existingGenre}${secondaryEvidence}`,
      confidence: inferredGenre && inferredGenre !== existingGenre ? "media" : "alta",
    };
  }

  const selectedGenre = inferredGenre || firstString(existingGenre, defaultGenre);

  return {
    genre: selectedGenre,
    audit: inferredGenre
      ? `Genere verificato da ${providerLabel} (${genreEvidence.evidence}): ${selectedGenre}`
      : `Genere da verificare: uso ${selectedGenre} per metadata insufficienti`,
    confidence: inferredGenre ? "alta" : "media",
  };
}

function artworkForGenre(genre) {
  const artwork = genreArtwork[genre] || genreArtwork[defaultGenre];
  const pngPath = path.join(COVERS_DIR, `${artwork.slug}.png`);
  const extension = fsSync.existsSync(pngPath) ? "png" : "svg";
  return {
    coverAlt: `${genre || defaultGenre} cover artwork 1024x1024`,
    coverPath: `/assets/covers/${artwork.slug}.${extension}`,
    coverPrompt: artwork.prompt,
    coverSize: "1024x1024",
  };
}

function isLegacyGenreCoverPath(coverPath) {
  return /^\/assets\/covers\/[^/?#]+\.(svg|png)$/i.test(firstString(coverPath));
}

function isGeneratedCoverPath(coverPath) {
  return /^\/api\/covers\/generated\.svg\b/i.test(firstString(coverPath));
}

function isReplaceableCoverPath(coverPath) {
  return isLegacyGenreCoverPath(coverPath) || isGeneratedCoverPath(coverPath);
}

function isReplaceableCoverAlt(coverAlt) {
  return /(cover artwork|album cover)\s*1024x1024/i.test(firstString(coverAlt));
}

function isHttpImageUrl(value) {
  const urlText = firstString(value);
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function firstImageUrl(...values) {
  return values.find(isHttpImageUrl)?.trim() || "";
}

function youtubeThumbnailUrl(item, videoId) {
  const thumbnails = item?.snippet?.thumbnails || {};
  return firstImageUrl(
    thumbnails.maxres?.url,
    thumbnails.standard?.url,
    thumbnails.high?.url,
    thumbnails.medium?.url,
    thumbnails.default?.url,
    videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : ""
  );
}

function providerOriginalCoverPath(track) {
  const explicit = firstImageUrl(
    track.originalCoverPath,
    track.coverImageUrl,
    track.thumbnailUrl,
    track.artworkUrl,
    track.albumImage,
    track.imageUrl,
    track.image,
    track.thumbnail
  );

  if (explicit) {
    return explicit;
  }

  const videoId = firstString(track.youtubeVideoId);
  if (videoId) {
    return youtubeThumbnailUrl(null, videoId);
  }

  const jamendoTrackId = firstString(track.externalProvider) === "jamendo"
    ? jamendoTrackIdFromTrack(track)
    : "";
  if (jamendoTrackId) {
    return `/api/covers/jamendo/${encodeURIComponent(jamendoTrackId)}.jpg`;
  }

  return "";
}

function jamendoTrackIdFromTrack(track) {
  const explicit = firstString(track.jamendoTrackId);
  if (explicit) {
    return explicit.match(/\d+/)?.[0] || "";
  }

  const text = [
    track.sourceUrl,
    track.description,
    track.audioPath,
    track.providerIdentity,
  ].map((value) => String(value || "")).join(" ");
  return firstString(
    text.match(/(?:track\/|\/t\/|trackid=)(\d+)/i)?.[1],
    text.match(/jamendo[^0-9]+(\d{4,})/i)?.[1]
  );
}

function originalCoverAltForTrack(track) {
  const provider = firstString(track.externalProvider, track.sourceType, "provider");
  return `${firstString(track.title, "Traccia")} - copertina originale ${provider}`;
}

function normalizeTrack(track) {
  const previewBlueprint = buildPreviewBlueprint(track.mood);
  const normalized = {
    accent: pickAccent(track.title),
    attributionRequired: false,
    audioOriginalName: null,
    audioPath: null,
    createdAt: new Date().toISOString(),
    description: "",
    duration: "",
    energy: "Media",
    formats: [],
    genre: "",
    instrument: "",
    license: "CC0",
    licenseDetail: "",
    licenseUrl: "",
    licenseFileName: null,
    licensePath: null,
    mood: "Upbeat",
    preview: previewBlueprint.preview,
    rightsNotes: "",
    externalProvider: "",
    commercialStatus: "",
    creatorName: "",
    creatorUrl: "",
    sourceType: "uploaded",
    sourceUrl: "",
    stems: 0,
    subtitle: "",
    tags: [],
    updatedAt: new Date().toISOString(),
    useCases: [],
    wave: previewBlueprint.wave,
    ...track,
  };
  const genreSourceText = [
    normalized.title,
    normalized.subtitle,
    normalized.instrument,
    normalized.description,
    normalized.mood,
    ...(normalized.tags || []),
    ...(normalized.useCases || []),
  ].join(" ");
  const genreCheck = auditGenre(normalized.genre, genreSourceText, normalized.externalProvider);
  const genre = genreCheck.genre;
  const artwork = artworkForGenre(genre);
  const existingCoverPath = firstString(normalized.coverPath);
  const originalCoverPath = providerOriginalCoverPath(normalized);
  const shouldKeepExistingCover = existingCoverPath && !isReplaceableCoverPath(existingCoverPath);
  const existingCoverAlt = firstString(normalized.coverAlt);
  const shouldKeepExistingCoverAlt =
    existingCoverAlt && !(originalCoverPath && isReplaceableCoverAlt(existingCoverAlt));
  const selectedCoverPath = shouldKeepExistingCover
    ? existingCoverPath
    : firstString(originalCoverPath);
  const coverSource = shouldKeepExistingCover
    ? "custom"
    : originalCoverPath
      ? "provider-original"
      : "none";

  return {
    ...normalized,
    genre,
    genreAudit: firstString(normalized.genreAudit, genreCheck.audit),
    genreConfidence: firstString(normalized.genreConfidence, genreCheck.confidence),
    coverAlt: firstString(
      shouldKeepExistingCoverAlt ? existingCoverAlt : "",
      originalCoverPath ? originalCoverAltForTrack(normalized) : "",
      artwork.coverAlt
    ),
    coverPath: selectedCoverPath,
    coverPrompt: firstString(normalized.coverPrompt, artwork.coverPrompt),
    coverRightsNote: firstString(
      normalized.coverRightsNote,
      originalCoverPath
        ? "Copertina originale del provider: usala come artwork/thumbnail dentro l'app e verifica i diritti prima di riutilizzarla in materiali commerciali esterni."
        : ""
    ),
    coverSource,
    coverSize: firstString(normalized.coverSize, artwork.coverSize),
    originalCoverPath: firstString(normalized.originalCoverPath, originalCoverPath),
  };
}

function encodeTrackId(trackId) {
  return encodeURIComponent(trackId);
}

function attachComputedFields(track) {
  const normalized = normalizeTrack(track);
  const previewPath = `/api/tracks/${encodeTrackId(normalized.id)}/preview.wav`;
  const downloadPath = `/api/tracks/${encodeTrackId(normalized.id)}/download`;
  const isRealTrack = Boolean(
    normalized.audioPath ||
      normalized.embedPath ||
      normalized.youtubeVideoId ||
      normalized.sourceType === "uploaded" ||
      normalized.sourceType === "provider-import"
  );
  return {
    ...normalized,
    downloadPath,
    isRealTrack,
    previewPath,
    playbackPath: normalized.audioPath || previewPath,
  };
}

function waveSample(type, phase) {
  if (type === "square") {
    return Math.sign(Math.sin(phase)) || 1;
  }

  if (type === "sawtooth") {
    return 2 * ((phase / (Math.PI * 2)) % 1) - 1;
  }

  if (type === "triangle") {
    return (2 / Math.PI) * Math.asin(Math.sin(phase));
  }

  return Math.sin(phase);
}

function buildPreviewWavBuffer(track) {
  const previewNotes = Array.isArray(track.preview) && track.preview.length > 0
    ? track.preview
    : buildPreviewBlueprint(track.mood).preview;
  const waveType = track.wave || buildPreviewBlueprint(track.mood).wave;
  const sampleRate = 22050;
  const targetDurationSeconds = Math.min(
    120,
    Math.max(36, parseDurationSeconds(track.duration) || 48)
  );
  const noteDurationSeconds = 0.36;
  const attackSeconds = 0.014;
  const releaseSeconds = 0.06;
  const noteSamples = Math.floor(noteDurationSeconds * sampleRate);
  const totalSamples = Math.floor(targetDurationSeconds * sampleRate);
  const totalNoteSlots = Math.ceil(totalSamples / noteSamples);
  const pcm = Buffer.alloc(totalSamples * 2);
  const motifTransposes = [0, 2, -3, 5, 0, -5, 7, 2];

  for (let noteIndex = 0; noteIndex < totalNoteSlots; noteIndex += 1) {
    const motifIndex = noteIndex % previewNotes.length;
    const sectionIndex = Math.floor(noteIndex / previewNotes.length);
    const transpose = motifTransposes[sectionIndex % motifTransposes.length];
    const frequency = (Number(previewNotes[motifIndex]) || 220) * 2 ** (transpose / 12);
    for (let i = 0; i < noteSamples; i += 1) {
      const absoluteIndex = noteIndex * noteSamples + i;
      if (absoluteIndex >= totalSamples) {
        break;
      }

      const time = i / sampleRate;
      const phase = 2 * Math.PI * frequency * time;
      const attack = Math.min(1, time / attackSeconds);
      const releaseStart = noteDurationSeconds - releaseSeconds;
      const release =
        time > releaseStart ? Math.max(0, (noteDurationSeconds - time) / releaseSeconds) : 1;
      const envelope = attack * release;
      const barPulse = noteIndex % 8 === 0 && time < 0.08 ? Math.sin(2 * Math.PI * 84 * time) * 0.1 : 0;
      const harmonic = Math.sin(phase * 0.5) * 0.08;
      const sampleValue = (waveSample(waveType, phase) * 0.28 + harmonic + barPulse) * envelope;
      const int16 = Math.max(-1, Math.min(1, sampleValue)) * 32767;
      pcm.writeInt16LE(int16, absoluteIndex * 2);
    }
  }

  const dataLength = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcm]);
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function toTitleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeTagArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }

      if (entry && typeof entry === "object") {
        return firstString(entry.name, entry.title, entry.slug);
      }

      return "";
    })
    .filter(Boolean);
}

function formatSeconds(totalSeconds) {
  const numeric = Number(totalSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }

  const minutes = Math.floor(numeric / 60);
  const seconds = Math.floor(numeric % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function parseDurationSeconds(value) {
  const parts = String(value || "")
    .split(":")
    .map((part) => Number(part));

  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseIso8601Duration(value) {
  const match = String(value || "").match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );

  if (!match) {
    return 0;
  }

  const [, days, hours, minutes, seconds] = match;
  return (
    (Number(days) || 0) * 86400 +
    (Number(hours) || 0) * 3600 +
    (Number(minutes) || 0) * 60 +
    (Number(seconds) || 0)
  );
}

function inferMoodFromText(text) {
  const normalized = String(text || "").toLowerCase();
  if (/(ambient|calm|soft|wellness|piano)/.test(normalized)) {
    return "Calm";
  }

  if (/(warm|lofi|folk|acoustic|story)/.test(normalized)) {
    return "Warm";
  }

  if (/(focus|minimal|tech|corporate|podcast)/.test(normalized)) {
    return "Focused";
  }

  if (/(bright|summer|lifestyle|happy)/.test(normalized)) {
    return "Bright";
  }

  return "Upbeat";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ClearWave Library/1.0",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    ...options,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.clone().json();
      detail = firstString(
        payload.error?.errors?.[0]?.reason,
        payload.error?.status,
        payload.error?.message
      );
    } catch {
      detail = "";
    }

    throw httpError(
      response.status,
      `Richiesta esterna fallita (${response.status}${detail ? `: ${detail}` : ""}).`
    );
  }

  return response.json();
}

function sanitizeDiscoveryLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 8;
  }

  return Math.max(1, Math.min(12, Math.floor(numeric)));
}

function sanitizeBulkImportLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 12;
  }

  return Math.max(2, Math.min(25, Math.floor(numeric)));
}

function sanitizeLinkImportMaxTracks(value, fallback = 300, max = LINK_IMPORT_MAX_TRACKS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(numeric)));
}

function normalizeDiscoveryItem(item) {
  return normalizeTrack({
    ...item,
    sourceType: "provider-import",
    useCases: Array.isArray(item.useCases) && item.useCases.length > 0
      ? item.useCases
      : ["ADV digital", "Social media", "Video branded"],
    tags: Array.isArray(item.tags) ? item.tags : [],
    formats: Array.isArray(item.formats) ? item.formats : [],
    rightsNotes: firstString(item.rightsNotes, item.licenseDetail),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const limit = 25 * 1024 * 1024;
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, "Payload troppo grande. Riduci dimensione dei file."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "JSON non valido."));
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

async function saveIncomingFile(file, targetDirectory, fallbackBaseName) {
  if (!file || !file.dataBase64) {
    return null;
  }

  const extension = detectExtension(file.name, file.type);
  const storedName = `${fallbackBaseName}-${Date.now()}${extension}`;
  const destination = path.join(targetDirectory, storedName);
  const buffer = Buffer.from(file.dataBase64, "base64");

  await fs.writeFile(destination, buffer);

  return {
    storedName,
    originalName: file.name || storedName,
  };
}

function mapOpenverseTrack(item) {
  const licenseSlug = String(item.license || "").toLowerCase();
  const isPublicDomain = licenseSlug === "cc0" || licenseSlug === "pdm";
  if (!isPublicDomain) {
    return null;
  }

  const title = firstString(item.title, item.identifier, "Untitled Openverse track");
  const creator = firstString(item.creator, item.creator_name, "Unknown creator");
  const mood = inferMoodFromText(
    [title, creator, ...(item.genres || []), ...(item.tags || [])].join(" ")
  );

  return normalizeDiscoveryItem({
    id: `openverse-${item.id || item.identifier || slugify(title)}`,
    title,
    subtitle: `${creator} / Openverse`,
    mood,
    duration: formatSeconds((Number(item.duration) || 0) / 1000),
    energy: "Media",
    license: licenseSlug === "cc0" ? "CC0" : "Public Domain Mark",
    licenseDetail:
      licenseSlug === "cc0"
        ? "CC0 / pubblico dominio operativo"
        : "Public Domain Mark / verificare la pagina sorgente",
    licenseUrl: firstString(item.license_url, item.meta_data?.license_url),
    attributionRequired: false,
    useCases: ["ADV digital", "Social media", "Video branded", "Podcast"],
    formats: [firstString(item.filetype, "AUDIO").toUpperCase()],
    stems: 0,
    instrument: "",
    accent: pickAccent(title),
    description: firstString(item.meta_data?.description, item.category, item.source),
    tags: [...normalizeTagArray(item.tags), ...normalizeTagArray(item.genres)].slice(0, 6),
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    audioPath: firstString(item.url, item.thumbnail),
    audioOriginalName: null,
    sourceUrl: firstString(item.foreign_landing_url, item.url),
    rightsNotes:
      "Risultato Openverse in modalita' pubblico dominio. Verifica finale sulla pagina sorgente prima dell'uso commerciale.",
    externalProvider: "openverse",
    commercialStatus: "public-domain-only",
    creatorName: creator,
    creatorUrl: firstString(item.creator_url),
  });
}

async function searchOpenverse(query, limit) {
  const url = new URL("https://api.openverse.org/v1/audio/");
  url.searchParams.set("q", query || "background music");
  url.searchParams.set("page_size", String(limit));

  const payload = await fetchJson(url);
  const items = Array.isArray(payload.results) ? payload.results : [];

  return items.map(mapOpenverseTrack).filter(Boolean).slice(0, limit);
}

function mapFreeToUseTrack(item) {
  const title = firstString(item.title, item.name, "Free To Use track");
  const artistText = Array.isArray(item.artists)
    ? item.artists.map((artist) => firstString(artist.name, artist.artist_name, artist)).filter(Boolean).join(", ")
    : firstString(item.artist_name, item.artist, item.user_name, "Free To Use artist");
  const mood = inferMoodFromText([title, artistText, ...(normalizeTagArray(item.tags))].join(" "));

  return normalizeDiscoveryItem({
    id: `freetouse-${item.id || slugify(`${artistText}-${title}`)}`,
    title,
    subtitle: `${artistText} / Free To Use`,
    mood,
    duration: formatSeconds(item.duration || item.length_seconds),
    energy: "Media",
    license: "Free To Use License",
    licenseDetail: "Commerciale solo con piano commerciale o licenza single-track",
    licenseUrl: "https://freetouse.com/license",
    attributionRequired: true,
    useCases: ["ADV digital", "Social media", "Video branded"],
    formats: normalizeTagArray(item.formats).map((entry) => entry.toUpperCase()),
    stems: Number(item.stems) || 0,
    instrument: "",
    accent: pickAccent(title),
    description: firstString(item.description, item.summary),
    tags: [...normalizeTagArray(item.tags), ...normalizeTagArray(item.categories)].slice(0, 6),
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    audioPath: firstString(item.preview_url, item.preview, item.stream_url, item.audio_url),
    audioOriginalName: null,
    sourceUrl: firstString(item.url, item.link, item.permalink),
    rightsNotes:
      "Provider Free To Use: l'uso commerciale richiede licenza o piano commerciale. Conserva il certificato prima della pubblicazione.",
    externalProvider: "freetouse",
    commercialStatus: "paid-license-required",
    creatorName: artistText,
    creatorUrl: "",
  });
}

async function searchFreeToUse(query, limit) {
  const url = new URL("https://api.freetouse.com/music/tracks/search");
  url.searchParams.set("query", query || "background");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", "downloads");
  url.searchParams.set("sort", "desc");

  const payload = await fetchJson(url);
  const items = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.results)
      ? payload.results
      : [];

  return items.map(mapFreeToUseTrack).filter(Boolean).slice(0, limit);
}

function mapJamendoTrack(item) {
  const title = firstString(item.name, item.title, "Jamendo track");
  const artistText = firstString(item.artist_name, item.artist, "Jamendo artist");
  const mood = inferMoodFromText([title, artistText, item.musicinfo?.tags?.genres?.join(" ")].join(" "));
  const audioUrl = firstString(item.audio, item.audiodownload);
  const audioExtension = audioUrl ? path.extname(audioUrl).slice(1).toUpperCase() : "MP3";
  const jamendoTrackId = firstString(item.id);
  const originalCoverPath = firstImageUrl(
    item.album_image,
    item.image,
    item.album?.image,
    item.artist_image,
    item.cover
  );

  return normalizeDiscoveryItem({
    id: `jamendo-${jamendoTrackId || slugify(`${artistText}-${title}`)}`,
    title,
    subtitle: `${artistText} / Jamendo Pro`,
    mood,
    duration: formatSeconds(item.duration),
    energy: "Media",
    license: "Jamendo Pro",
    licenseDetail: "Filtro commerciale Jamendo Pro applicato; verifica la licenza finale",
    licenseUrl: firstString(item.license_ccurl),
    attributionRequired: false,
    useCases: ["ADV digital", "Social media", "Retail store", "Video branded"],
    formats: [audioExtension || "MP3"],
    stems: 0,
    instrument: "",
    accent: pickAccent(title),
    description: firstString(item.shorturl, item.album_name),
    tags: normalizeTagArray(item.musicinfo?.tags?.genres).slice(0, 6),
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    audioPath: audioUrl,
    audioOriginalName: null,
    sourceUrl: firstString(item.shareurl, item.shorturl),
    rightsNotes:
      "Ricerca Jamendo con filtro prolicensing=true e ccnc=false. Conferma i termini finali nella dashboard Jamendo Pro.",
    externalProvider: "jamendo",
    commercialStatus: "commercial-license-available",
    creatorName: artistText,
    creatorUrl: firstString(item.artist_id ? `https://www.jamendo.com/artist/${item.artist_id}` : ""),
    jamendoTrackId,
    coverAlt: originalCoverPath ? `${title} - copertina originale Jamendo` : "",
    originalCoverPath,
  });
}

function providerAuthHeaders(headers = {}) {
  return {
    "User-Agent": "ClearWave Library/1.0",
    Accept: "application/json",
    ...headers,
  };
}

async function searchJamendo(query, limit) {
  const clientId = jamendoClientId;
  if (!clientId) {
    throw httpError(400, "JAMENDO_CLIENT_ID non configurato.");
  }

  // Jamendo e' la sorgente piu' solida per audio diretto importabile nel catalogo permanente.
  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("search", query || "background");
  url.searchParams.set("audioformat", "mp32");
  url.searchParams.set("include", "licenses+musicinfo");
  url.searchParams.set("prolicensing", "true");
  url.searchParams.set("ccnc", "false");

  const payload = await fetchJson(url);
  const items = Array.isArray(payload.results) ? payload.results : [];

  return items.map(mapJamendoTrack).filter(Boolean).slice(0, limit);
}

function audiusHeaders() {
  if (!audiusApiKey) {
    return providerAuthHeaders();
  }

  return providerAuthHeaders({
    Authorization: `Bearer ${audiusApiKey}`,
  });
}

function mapAudiusTrack(item) {
  const title = firstString(item.title, "Audius track");
  const artistText = firstString(item.user?.name, item.user?.handle, "Audius creator");
  const mood = inferMoodFromText(
    [title, artistText, item.genre, item.mood, ...(normalizeTagArray(item.tags))].join(" ")
  );
  const audiusId = firstString(item.id);
  const originalCoverPath = firstImageUrl(
    item.artwork?.["1000x1000"],
    item.artwork?.["480x480"],
    item.artwork?.["150x150"],
    item.artwork_url
  );

  if (!audiusId) {
    return null;
  }

  return normalizeDiscoveryItem({
    id: `audius-${audiusId}`,
    title,
    subtitle: `${artistText} / Audius`,
    mood,
    duration: formatSeconds(item.duration),
    energy: item.mood === "Chill" ? "Bassa" : "Media",
    license: "Audius creator license",
    licenseDetail: "Licenza impostata dal creator o da verificare sulla pagina Audius",
    licenseUrl: firstString(item.permalink),
    attributionRequired: true,
    useCases: ["ADV digital", "Social media", "Video branded", "Podcast"],
    formats: ["STREAM"],
    stems: 0,
    instrument: firstString(item.genre),
    accent: pickAccent(title),
    description: firstString(item.description, item.genre, item.mood),
    tags: [...normalizeTagArray(item.tags), item.genre, item.mood].filter(Boolean).slice(0, 6),
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    audioPath: `/api/providers/audius/${encodeTrackId(audiusId)}/stream`,
    audioOriginalName: null,
    sourceUrl: firstString(item.permalink),
    rightsNotes:
      "Audius e' user-generated: importa solo se il creator concede uso commerciale esplicito e conserva prova/licenza.",
    externalProvider: "audius",
    commercialStatus: "license-verification-required",
    creatorName: artistText,
    creatorUrl: firstString(item.user?.permalink),
    coverAlt: originalCoverPath ? `${title} - copertina originale Audius` : "",
    originalCoverPath,
    canImport: true,
    canPreview: true,
  });
}

async function searchAudius(query, limit) {
  if (!audiusApiKey) {
    throw httpError(400, "AUDIUS_API_KEY non configurato.");
  }

  // Audius e' user-generated: prima dell'uso commerciale serve prova licenza del creator.
  const url = new URL("https://api.audius.co/v1/tracks/search");
  url.searchParams.set("query", query || "royalty free");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("only_downloadable", "true");

  const payload = await fetchJson(url, { headers: audiusHeaders() });
  const items = Array.isArray(payload.data) ? payload.data : [];

  return items.map(mapAudiusTrack).filter(Boolean).slice(0, limit);
}

function mapTheAudioDbArtist(item) {
  const title = firstString(item.strArtist, item.strArtistAlternate, "TheAudioDB result");
  const mood = inferMoodFromText([title, item.strGenre, item.strMood, item.strStyle].join(" "));
  const originalCoverPath = firstImageUrl(item.strArtistThumb, item.strArtistFanart, item.strArtistLogo);

  return normalizeDiscoveryItem({
    id: `theaudiodb-${item.idArtist || slugify(title)}`,
    title,
    subtitle: `${firstString(item.strGenre, "Artist")} / TheAudioDB metadata`,
    mood,
    duration: "",
    energy: "Media",
    license: "Metadata only",
    licenseDetail: "TheAudioDB non fornisce file audio royalty-free o licenze commerciali per brani",
    licenseUrl: "",
    attributionRequired: false,
    useCases: [],
    formats: ["METADATA"],
    stems: 0,
    instrument: firstString(item.strGenre, item.strStyle),
    accent: pickAccent(title),
    description: firstString(item.strBiographyEN, item.strStyle, item.strMood).slice(0, 280),
    tags: [item.strGenre, item.strStyle, item.strMood].filter(Boolean).slice(0, 6),
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    audioPath: "",
    audioOriginalName: null,
    sourceUrl: firstString(item.strWebsite, item.strFacebook, item.strLastFMChart),
    rightsNotes:
      "Risultato solo metadata. Non importare come traccia commercial-safe: serve una sorgente audio con licenza separata.",
    externalProvider: "theaudiodb",
    commercialStatus: "metadata-only",
    creatorName: title,
    creatorUrl: firstString(item.strWebsite),
    coverAlt: originalCoverPath ? `${title} - immagine originale TheAudioDB` : "",
    originalCoverPath,
    canImport: false,
    canPreview: false,
  });
}

async function searchTheAudioDb(query, limit) {
  if (!audioDbApiKey) {
    throw httpError(400, "THEAUDIODB_API_KEY non configurato.");
  }

  // TheAudioDB serve come fonte metadata/immagini, non come sorgente audio royalty-free.
  const url = new URL(`https://www.theaudiodb.com/api/v1/json/${audioDbApiKey}/search.php`);
  url.searchParams.set("s", query || "royalty free");

  const payload = await fetchJson(url);
  const items = Array.isArray(payload.artists) ? payload.artists : [];

  return items.map(mapTheAudioDbArtist).filter(Boolean).slice(0, limit);
}

function youtubeVideoIdFromItem(item) {
  return firstString(
    item.id?.videoId,
    item.contentDetails?.videoId,
    item.snippet?.resourceId?.videoId,
    typeof item.id === "string" ? item.id : ""
  );
}

function mapYouTubeVideo(item) {
  const videoId = youtubeVideoIdFromItem(item);
  const title = decodeHtmlEntities(firstString(item.snippet?.title, "YouTube result"));
  const channelTitle = firstString(item.snippet?.channelTitle, "YouTube channel");
  const description = decodeHtmlEntities(firstString(item.snippet?.description));
  const mood = inferMoodFromText([title, channelTitle, description].join(" "));
  const durationSeconds = parseIso8601Duration(item.contentDetails?.duration);

  if (!videoId) {
    return null;
  }

  const originalCoverPath = youtubeThumbnailUrl(item, videoId);

  return normalizeDiscoveryItem({
    id: `youtube-${videoId}`,
    title,
    subtitle: `${channelTitle} / YouTube CC BY candidate`,
    mood,
    duration: formatSeconds(durationSeconds),
    energy: "Media",
    license: "Creative Commons Attribution",
    licenseDetail: "Risultato filtrato con videoLicense=creativeCommon; attribuzione e verifica finale richieste",
    licenseUrl: "https://support.google.com/youtube/answer/2797468",
    attributionRequired: true,
    useCases: ["Video branded", "Social media"],
    formats: ["STREAM"],
    stems: 0,
    instrument: "",
    accent: pickAccent(title),
    description: description.slice(0, 280),
    tags: ["youtube", "reference"],
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    youtubeVideoId: videoId,
    embedPath: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`,
    audioPath: "",
    audioOriginalName: null,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    rightsNotes:
      "YouTube Data API puo' filtrare video Creative Commons, ma non garantisce che il brano sia la YouTube Audio Library ne' permette download audio. Apri la pagina, verifica licenza/Content ID e salva prova prima dell'uso.",
    externalProvider: "youtube",
    commercialStatus: "cc-by-verification-required",
    creatorName: channelTitle,
    creatorUrl: "",
    coverAlt: originalCoverPath ? `${title} - thumbnail originale YouTube` : "",
    originalCoverPath,
    canImport: false,
    canPreview: false,
  });
}

function isLikelyShortVideo(item) {
  const title = decodeHtmlEntities(firstString(item.snippet?.title)).toLowerCase();
  const description = decodeHtmlEntities(firstString(item.snippet?.description)).toLowerCase();
  const text = `${title} ${description}`;
  return (
    text.includes("#shorts") ||
    title.includes("shorts") ||
    (/#[a-z0-9_]+/.test(title) && title.split(/\s+/).length < 7)
  );
}

function isYouTubeAgeRestrictedItem(item) {
  return firstString(item.contentDetails?.contentRating?.ytRating) === "ytAgeRestricted";
}

function mapYouTubeCuratedVideo(item, channel) {
  const videoId = youtubeVideoIdFromItem(item);
  const title = decodeHtmlEntities(firstString(item.snippet?.title, "YouTube curated track"));
  const channelTitle = firstString(item.snippet?.channelTitle, channel.name);
  const description = decodeHtmlEntities(firstString(item.snippet?.description, channel.note));
  const mood = inferMoodFromText([title, channelTitle, description].join(" "));
  const durationSeconds = parseIso8601Duration(item.contentDetails?.duration);

  if (!videoId || isYouTubeAgeRestrictedItem(item) || isLikelyShortVideo(item) || durationSeconds < 120) {
    return null;
  }

  const originalCoverPath = youtubeThumbnailUrl(item, videoId);

  return normalizeDiscoveryItem({
    id: `youtube-curated-${videoId}`,
    title,
    subtitle: `${channelTitle} / canale YouTube whitelist`,
    mood,
    duration: formatSeconds(durationSeconds),
    energy: "Media",
    license: "YouTube channel policy",
    licenseDetail: `Policy canale ${channel.name}: verifica descrizione, termini e attribuzione della singola traccia`,
    licenseUrl: channel.policyUrl,
    attributionRequired: true,
    useCases: ["Video branded", "Social media"],
    formats: ["STREAM"],
    stems: 0,
    instrument: "",
    accent: pickAccent(title),
    description: description.slice(0, 280),
    tags: ["youtube", "curated-channel", slugify(channel.name)],
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    youtubeVideoId: videoId,
    embedPath: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`,
    audioPath: "",
    audioOriginalName: null,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    rightsNotes:
      `${channel.name}: ${channel.note} La Data API non consente download audio; usa il link sorgente e archivia prova di licenza prima dell'uso commerciale.`,
    externalProvider: "youtube_curated",
    commercialStatus: "channel-policy-verification-required",
    creatorName: channelTitle,
    creatorUrl: `https://www.youtube.com/channel/${channel.id}`,
    coverAlt: originalCoverPath ? `${title} - thumbnail originale YouTube` : "",
    originalCoverPath,
    canImport: true,
    canPreview: true,
  });
}

function mapYouTubeSessionVideo(item) {
  const videoId = youtubeVideoIdFromItem(item);
  const title = decodeHtmlEntities(firstString(item.snippet?.title, "YouTube session track"));
  const channelTitle = firstString(item.snippet?.channelTitle, "YouTube channel");
  const description = decodeHtmlEntities(firstString(item.snippet?.description));
  const mood = inferMoodFromText([title, channelTitle, description].join(" "));
  const durationSeconds = parseIso8601Duration(item.contentDetails?.duration);

  if (!videoId || !item.youtubeDetailsFound || isYouTubeAgeRestrictedItem(item) || durationSeconds <= 0) {
    return null;
  }

  const originalCoverPath = youtubeThumbnailUrl(item, videoId);

  return normalizeTrack({
    id: `youtube-session-${videoId}`,
    title,
    subtitle: `${channelTitle} / playlist utente temporanea`,
    mood,
    duration: formatSeconds(durationSeconds),
    energy: "Media",
    license: "YouTube public embed",
    licenseDetail: "Playlist temporanea utente: diritti commerciali non verificati",
    licenseUrl: "https://www.youtube.com/t/terms",
    attributionRequired: true,
    useCases: ["Sessione utente"],
    formats: ["STREAM"],
    stems: 0,
    instrument: "",
    accent: pickAccent(title),
    description: description.slice(0, 280),
    tags: ["youtube", "session-playlist", "unverified"],
    preview: buildPreviewBlueprint(mood).preview,
    wave: buildPreviewBlueprint(mood).wave,
    youtubeVideoId: videoId,
    embedPath: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`,
    audioPath: "",
    audioOriginalName: null,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    rightsNotes:
      "Traccia caricata in sessione utente e non salvata nel catalogo commercial-safe. Verifica licenza e autorizzazioni prima di usarla in pubblicazioni commerciali.",
    externalProvider: "youtube_session",
    commercialStatus: "session-unverified",
    creatorName: channelTitle,
    creatorUrl: firstString(item.snippet?.channelId ? `https://www.youtube.com/channel/${item.snippet.channelId}` : ""),
    sourceType: "session-import",
    coverAlt: originalCoverPath ? `${title} - thumbnail originale YouTube` : "",
    originalCoverPath,
    canImport: false,
    canPreview: true,
  });
}

async function searchYouTube(query, limit) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("key", youtubeApiKey);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoCategoryId", "10");
  url.searchParams.set("videoLicense", "creativeCommon");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("videoDuration", "medium");
  url.searchParams.set("maxResults", String(Math.min(12, limit * 2)));
  url.searchParams.set("q", query || "royalty free music");

  const payload = await fetchJson(url);
  const items = await enrichYouTubeItems(Array.isArray(payload.items) ? payload.items : []);

  return items.map(mapYouTubeVideo).filter(Boolean).slice(0, limit);
}

async function enrichYouTubeItems(items) {
  const videoIds = items.map(youtubeVideoIdFromItem).filter(Boolean);
  if (videoIds.length === 0) {
    return items;
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("key", youtubeApiKey);
  url.searchParams.set("part", "snippet,contentDetails,status");
  url.searchParams.set("id", videoIds.join(","));

  const payload = await fetchJson(url);
  const detailsById = new Map(
    (Array.isArray(payload.items) ? payload.items : []).map((item) => [item.id, item])
  );

  return items
    .map((item) => {
      const videoId = youtubeVideoIdFromItem(item);
      const details = detailsById.get(videoId);
      return {
        ...item,
        youtubeDetailsFound: Boolean(details),
        snippet: details?.snippet || item.snippet || {},
        contentDetails: details?.contentDetails || {},
        status: details?.status || {},
      };
    })
    .filter((item) => item.status?.embeddable !== false);
}

async function fetchYouTubeChannelSearch(channel, query, limit, useChannelId = true) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("key", youtubeApiKey);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoCategoryId", "10");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("videoDuration", "medium");
  url.searchParams.set("maxResults", String(Math.min(12, limit * 2)));
  url.searchParams.set("order", query ? "relevance" : "date");
  url.searchParams.set("q", query || "music");

  if (useChannelId && channel.id) {
    url.searchParams.set("channelId", channel.id);
  } else {
    url.searchParams.set("q", `${query || "music"} ${channel.name}`);
  }

  const payload = await fetchJson(url);
  return enrichYouTubeItems(Array.isArray(payload.items) ? payload.items : []);
}

async function searchYouTubeCurated(query, limit) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  const perChannelLimit = Math.max(1, Math.ceil(limit / youtubeCuratedChannels.length));
  const settled = await Promise.allSettled(
    youtubeCuratedChannels.map(async (channel) => {
      let items = [];
      try {
        items = await fetchYouTubeChannelSearch(channel, query, perChannelLimit, true);
      } catch {
        items = [];
      }

      return items.map((item) => mapYouTubeCuratedVideo(item, channel)).filter(Boolean);
    })
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .slice(0, limit);
}

async function fetchYouTubeUploadsPlaylistId(channel) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("key", youtubeApiKey);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("id", channel.id);

  const payload = await fetchJson(url);
  const playlistId = firstString(
    payload.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  );

  if (!playlistId) {
    throw httpError(404, `Playlist uploads non trovata per ${channel.name}.`);
  }

  return playlistId;
}

async function resolveYouTubeChannelUploadsPlaylist(channelSource = {}) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  const channelId = firstString(channelSource.channelId);
  const handle = firstString(channelSource.handle).replace(/^@/, "");
  const username = firstString(channelSource.username);

  if (!channelId && !handle && !username) {
    throw httpError(
      400,
      "Link canale YouTube non riconosciuto. Usa un link /@handle, /channel/UC... o /user/nome."
    );
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("key", youtubeApiKey);
  url.searchParams.set("part", "contentDetails,snippet");

  if (channelId) {
    url.searchParams.set("id", channelId);
  } else if (handle) {
    url.searchParams.set("forHandle", `@${handle}`);
  } else {
    url.searchParams.set("forUsername", username);
  }

  let payload;
  try {
    payload = await fetchJson(url);
  } catch (error) {
    throw normalizeYouTubeLinkError(error, "Canale YouTube non recuperabile dalla API.");
  }

  const channel = Array.isArray(payload.items) ? payload.items[0] : null;
  const playlistId = firstString(channel?.contentDetails?.relatedPlaylists?.uploads);

  if (!channel || !playlistId) {
    throw httpError(
      404,
      "Canale YouTube non trovato o senza playlist uploads accessibile dalla API."
    );
  }

  return {
    channelId: channel.id,
    channelTitle: firstString(channel.snippet?.title, handle, username, channelId, "Canale YouTube"),
    playlistId,
  };
}

async function fetchYouTubeUploadsPage(playlistId, pageToken = "") {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("key", youtubeApiKey);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", String(YOUTUBE_UPLOADS_PAGE_SIZE));

  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  return fetchJson(url);
}

async function fetchYouTubeChannelPlaylistsPage(channelId, pageToken = "") {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
  url.searchParams.set("key", youtubeApiKey);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("maxResults", String(YOUTUBE_CURATED_PLAYLIST_PAGE_SIZE));

  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  return fetchJson(url);
}

async function fetchYouTubeCuratedPlaylistItems(channel, playlistId, maxItems) {
  const collected = [];
  let pageToken = "";
  let pagesRead = 0;
  let scanned = 0;
  const maxPages = Math.max(1, Math.ceil(maxItems / YOUTUBE_UPLOADS_PAGE_SIZE));

  while (collected.length < maxItems && pagesRead < maxPages) {
    const payload = await fetchYouTubeUploadsPage(playlistId, pageToken);
    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    scanned += pageItems.length;
    const normalizedItems = pageItems.map((item) => ({
      id: { videoId: youtubeVideoIdFromItem(item) },
      snippet: {
        ...item.snippet,
        channelTitle: firstString(
          item.snippet?.videoOwnerChannelTitle,
          item.snippet?.channelTitle,
          channel.name
        ),
      },
      contentDetails: item.contentDetails || {},
    }));
    const enriched = await enrichYouTubeItems(normalizedItems);

    for (const item of enriched) {
      const ownerChannel = youtubeChannelForItem(item);
      if (!ownerChannel) {
        continue;
      }

      const mapped = mapYouTubeCuratedVideo(item, ownerChannel);
      if (mapped) {
        collected.push(mapped);
      }
    }

    pageToken = firstString(payload.nextPageToken);
    pagesRead += 1;

    if (!pageToken) {
      break;
    }
  }

  return {
    items: collected.slice(0, maxItems),
    pagesRead,
    scanned,
  };
}

async function fetchYouTubeCuratedChannelPlaylists(channel, options = {}) {
  const maxPlaylists = Math.max(
    1,
    Math.min(80, Number(options.maxPlaylists) || YOUTUBE_CURATED_PLAYLIST_SCAN_LIMIT)
  );
  const maxItemsPerPlaylist = Math.max(
    1,
    Math.min(150, Number(options.maxItemsPerPlaylist) || YOUTUBE_CURATED_PLAYLIST_ITEMS_LIMIT)
  );
  const maxTotalItems = Math.max(
    1,
    Math.min(
      YOUTUBE_CURATED_LINK_MAX_SCAN,
      Number(options.maxTotalItems) || YOUTUBE_CURATED_LINK_MAX_SCAN
    )
  );
  const collected = [];
  const seenVideoIds = new Set();
  let pageToken = "";
  let playlistPagesRead = 0;
  let playlistsRead = 0;
  let playlistItemsScanned = 0;

  while (playlistsRead < maxPlaylists && collected.length < maxTotalItems) {
    const payload = await fetchYouTubeChannelPlaylistsPage(channel.id, pageToken);
    const playlists = Array.isArray(payload.items) ? payload.items : [];
    playlistPagesRead += 1;

    for (const playlist of playlists) {
      if (playlistsRead >= maxPlaylists || collected.length >= maxTotalItems) {
        break;
      }

      const playlistId = firstString(playlist.id);
      if (!playlistId) {
        continue;
      }

      playlistsRead += 1;
      try {
        // Le playlist pubbliche dei canali raccolgono spesso brani che non stanno nei primi upload.
        // Restano safe solo i video il cui owner e' ancora uno dei canali whitelist.
        const result = await fetchYouTubeCuratedPlaylistItems(
          channel,
          playlistId,
          maxItemsPerPlaylist
        );
        playlistItemsScanned += result.scanned;
        for (const item of result.items) {
          const identity = firstString(item.youtubeVideoId, item.id, item.sourceUrl);
          if (!identity || seenVideoIds.has(identity)) {
            continue;
          }

          seenVideoIds.add(identity);
          collected.push(item);
          if (collected.length >= maxTotalItems) {
            break;
          }
        }
      } catch {
        // Una playlist privata/cancellata non deve fermare l'import di tutto il canale.
      }
    }

    pageToken = firstString(payload.nextPageToken);
    if (!pageToken || playlists.length === 0) {
      break;
    }
  }

  return {
    items: collected,
    playlistItemsScanned,
    playlistPagesRead,
    playlistsRead,
  };
}

async function fetchYouTubeCuratedUploads(channel, maxItems, maxPages, options = {}) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  const playlistId = await fetchYouTubeUploadsPlaylistId(channel);
  const collected = [];
  let pageToken = firstString(options.pageToken);
  let pageCount = 0;
  let scanned = 0;
  let reachedEnd = false;

  while (collected.length < maxItems && pageCount < maxPages) {
    const payload = await fetchYouTubeUploadsPage(playlistId, pageToken);
    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    scanned += pageItems.length;
    const normalizedItems = pageItems.map((item) => ({
      id: { videoId: youtubeVideoIdFromItem(item) },
      snippet: {
        ...item.snippet,
        channelTitle: firstString(item.snippet?.channelTitle, channel.name),
      },
      contentDetails: item.contentDetails || {},
    }));
    const enriched = await enrichYouTubeItems(normalizedItems);

    collected.push(
      ...enriched.map((item) => mapYouTubeCuratedVideo(item, channel)).filter(Boolean)
    );

    const nextPageToken = firstString(payload.nextPageToken);
    pageCount += 1;

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        channel,
        nextPageToken,
        pageCount,
        reachedEnd: !nextPageToken,
      });
    }

    pageToken = nextPageToken;

    if (!pageToken) {
      reachedEnd = true;
      break;
    }
  }

  return {
    items: collected.slice(0, maxItems),
    scanned,
    nextPageToken: pageToken,
    pagesRead: pageCount,
    maxPages,
    limit: maxItems,
    hasMore: Boolean(pageToken),
    reachedEnd,
  };
}

async function fetchYouTubeCuratedChannelBackfill(maxTracks, maxPages, options = {}) {
  const perChannelLimit = Math.max(
    YOUTUBE_UPLOADS_PAGE_SIZE,
    Math.ceil(maxTracks / youtubeCuratedChannels.length)
  );
  const scanMultiplier = Math.max(
    1,
    Math.min(16, Number(options.scanMultiplier) || YOUTUBE_BULK_SCAN_MULTIPLIER)
  );
  const perChannelScanLimit = Math.min(
    YOUTUBE_CURATED_LINK_MAX_SCAN,
    Math.max(perChannelLimit, perChannelLimit * scanMultiplier)
  );
  const perChannelCandidateLimit = Math.min(YOUTUBE_CURATED_LINK_MAX_SCAN, perChannelScanLimit * 3);
  const candidatePoolLimit = Math.min(
    YOUTUBE_CURATED_LINK_MAX_SCAN,
    Math.max(maxTracks, maxTracks * scanMultiplier * 4)
  );
  const includePlaylists = options.includePlaylists !== false;
  const playlistScanLimit = Math.max(
    1,
    Math.min(80, Number(options.playlistScanLimit) || YOUTUBE_CURATED_PLAYLIST_SCAN_LIMIT)
  );
  const playlistItemsPerPlaylist = Math.max(
    1,
    Math.min(150, Number(options.playlistItemsPerPlaylist) || YOUTUBE_CURATED_PLAYLIST_ITEMS_LIMIT)
  );
  const resume = options.resume !== false;
  const restartCompleted = options.restartCompleted === true;
  const state = await readYouTubeImportState();
  const items = [];
  const errors = [];
  const progress = [];

  for (const channel of youtubeCuratedChannels) {
    const previousState = state.channels[channel.id] || {};
    const uploadsCompleted = resume && previousState.reachedEnd && !restartCompleted;
    if (uploadsCompleted && !includePlaylists) {
      progress.push({
        channel: channel.name,
        pagesRead: 0,
        reachedEnd: true,
        skipped: "completed",
      });
      continue;
    }

    try {
      const channelItems = [];
      const channelItemIds = new Set();
      let resetCursor = false;
      let resumeToken = resume ? firstString(previousState.nextPageToken) : "";
      let result = uploadsCompleted
        ? {
            items: [],
            scanned: 0,
            nextPageToken: "",
            pagesRead: 0,
            maxPages,
            limit: perChannelScanLimit,
            hasMore: false,
            reachedEnd: true,
          }
        : null;
      const persistProgress = async ({ nextPageToken, reachedEnd }) => {
        state.channels[channel.id] = {
          name: channel.name,
          nextPageToken: reachedEnd ? "" : nextPageToken,
          reachedEnd,
          pagesReadTotal: Number(previousState.pagesReadTotal || 0),
          updatedAt: new Date().toISOString(),
        };
        await writeYouTubeImportState(state);
      };

      if (!result) {
        try {
          result = await fetchYouTubeCuratedUploads(channel, perChannelScanLimit, maxPages, {
            pageToken: resumeToken,
            onProgress: persistProgress,
          });
        } catch (error) {
          if (!resumeToken || !isYouTubeResumeTokenError(error)) {
            throw error;
          }

          // I pageToken YouTube possono scadere: in quel caso ripartiamo dall'inizio del canale
          // invece di bloccare tutto l'import automatico.
          resetCursor = true;
          resumeToken = "";
          result = await fetchYouTubeCuratedUploads(channel, perChannelScanLimit, maxPages, {
            pageToken: "",
            onProgress: persistProgress,
          });
        }

        if (result.items.length === 0 && resumeToken) {
          resetCursor = true;
          result = await fetchYouTubeCuratedUploads(channel, perChannelScanLimit, maxPages, {
            pageToken: "",
            onProgress: persistProgress,
          });
        }
      }

      for (const item of result.items) {
        const identity = firstString(item.youtubeVideoId, item.id, item.sourceUrl);
        if (!identity || channelItemIds.has(identity)) {
          continue;
        }

        channelItemIds.add(identity);
        channelItems.push(item);
      }

      let playlistResult = {
        items: [],
        playlistItemsScanned: 0,
        playlistPagesRead: 0,
        playlistsRead: 0,
      };
      if (includePlaylists && channelItems.length < perChannelCandidateLimit) {
        // La scansione playlist e' piu' profonda degli upload, ma resta limitata al pool
        // necessario per evitare richieste API enormi quando un canale ha migliaia di brani.
        playlistResult = await fetchYouTubeCuratedChannelPlaylists(channel, {
          maxPlaylists: playlistScanLimit,
          maxItemsPerPlaylist: playlistItemsPerPlaylist,
          maxTotalItems: perChannelCandidateLimit - channelItems.length,
        });

        for (const item of playlistResult.items) {
          const identity = firstString(item.youtubeVideoId, item.id, item.sourceUrl);
          if (!identity || channelItemIds.has(identity)) {
            continue;
          }

          channelItemIds.add(identity);
          channelItems.push(item);
          if (channelItems.length >= perChannelCandidateLimit) {
            break;
          }
        }
      }

      const nextPagesReadTotal = Number(previousState.pagesReadTotal || 0) + result.pagesRead;
      state.channels[channel.id] = {
        name: channel.name,
        nextPageToken: result.reachedEnd ? "" : result.nextPageToken,
        reachedEnd: result.reachedEnd,
        pagesReadTotal: nextPagesReadTotal,
        updatedAt: new Date().toISOString(),
      };
      await writeYouTubeImportState(state);
      progress.push({
        channel: channel.name,
        items: channelItems.length,
        uploadsItems: result.items.length,
        playlistItems: playlistResult.items.length,
        scanned: result.scanned,
        playlistItemsScanned: playlistResult.playlistItemsScanned,
        playlistPagesRead: playlistResult.playlistPagesRead,
        playlistsRead: playlistResult.playlistsRead,
        pagesRead: result.pagesRead,
        pagesReadTotal: nextPagesReadTotal,
        reachedEnd: result.reachedEnd,
        hasMore: result.hasMore,
        resetCursor,
        skipped: uploadsCompleted ? "uploads-completed" : "",
      });
      items.push(...channelItems);
    } catch (error) {
      errors.push({
        provider: "youtube_curated",
        message: `${channel.name}: ${error.message || "Import canale non riuscito."}`,
      });
    }
  }

  return {
    items: items.slice(0, candidatePoolLimit),
    errors,
    progress,
  };
}

function youtubeChannelForItem(item) {
  const channelId = firstString(
    item.snippet?.channelId,
    item.snippet?.videoOwnerChannelId,
    item.contentDetails?.videoOwnerChannelId
  );
  return youtubeCuratedChannels.find((channel) => channel.id === channelId) || null;
}

function normalizeChannelAlias(value) {
  return slugify(String(value || "").replace(/^@/, "")).replace(/-/g, "");
}

function curatedChannelFromSource(channelSource = {}) {
  const channelId = firstString(channelSource.channelId);
  if (channelId) {
    return youtubeCuratedChannels.find((channel) => channel.id === channelId) || null;
  }

  const identifiers = [
    channelSource.handle,
    channelSource.username,
    channelSource.channelTitle,
    channelSource.name,
  ]
    .map(normalizeChannelAlias)
    .filter(Boolean);

  if (identifiers.length === 0) {
    return null;
  }

  return (
    youtubeCuratedChannels.find((channel) => {
      const aliases = [channel.name, ...(channel.aliases || [])]
        .map(normalizeChannelAlias)
        .filter(Boolean);

      return identifiers.some((identifier) =>
        aliases.some(
          (alias) =>
            identifier === alias ||
            (identifier.length > 8 && alias.includes(identifier)) ||
            (alias.length > 8 && identifier.includes(alias))
        )
      );
    }) || null
  );
}

function isYouTubeRadioPlaylist(playlistId, parsedUrl) {
  const id = firstString(playlistId).toUpperCase();
  return (
    parsedUrl.searchParams.get("start_radio") === "1" ||
    id.startsWith("RD")
  );
}

function youtubePlaylistImportTarget(playlistId, videoId, parsedUrl) {
  const isRadio = isYouTubeRadioPlaylist(playlistId, parsedUrl);
  if (isRadio && videoId) {
    return {
      provider: "youtube",
      type: "video",
      videoId,
      playlistId,
      isRadio: true,
    };
  }

  return {
    provider: "youtube",
    type: "playlist",
    playlistId,
    videoId,
    isRadio,
  };
}

function parseExternalImportUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    throw httpError(400, "Incolla un link YouTube, playlist YouTube o Jamendo.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw httpError(400, "Link non valido.");
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const videoId = firstString(pathParts[0]);
    const playlistId = firstString(parsed.searchParams.get("list"));
    if (playlistId) {
      return youtubePlaylistImportTarget(playlistId, videoId, parsed);
    }

    return {
      provider: "youtube",
      type: "video",
      videoId,
    };
  }

  if (host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
    const playlistId = firstString(parsed.searchParams.get("list"));
    const videoId = firstString(
      parsed.searchParams.get("v"),
      pathParts[0] === "shorts" ? pathParts[1] : "",
      pathParts[0] === "embed" ? pathParts[1] : ""
    );
    const channelId = pathParts[0] === "channel" ? firstString(pathParts[1]) : "";
    const handle = pathParts[0]?.startsWith("@") ? firstString(pathParts[0].slice(1)) : "";
    const username = pathParts[0] === "user" ? firstString(pathParts[1]) : "";

    if (playlistId) {
      return youtubePlaylistImportTarget(playlistId, videoId, parsed);
    }

    if (videoId) {
      return { provider: "youtube", type: "video", videoId };
    }

    if (channelId || handle || username) {
      return { provider: "youtube", type: "channel", channelId, handle, username };
    }

    throw httpError(400, "Link YouTube senza video, playlist o canale valido.");
  }

  if (host.endsWith("jamendo.com") || host === "jamen.do") {
    const trackIndex = pathParts.findIndex((part) => part === "track" || part === "t");
    const trackId = firstString(
      trackIndex >= 0 ? pathParts[trackIndex + 1] : "",
      parsed.searchParams.get("trackid"),
      parsed.searchParams.get("id")
    ).match(/\d+/)?.[0];

    return { provider: "jamendo", type: "track", trackId };
  }

  throw httpError(400, "Provider link non supportato. Usa YouTube o Jamendo.");
}

function normalizeYouTubeLinkError(error, fallbackMessage) {
  const message = String(error?.message || "");
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("quotaexceeded")) {
    return httpError(
      error.status || 403,
      "Quota YouTube Data API esaurita: riprova piu' tardi oppure usa Jamendo/import lotto."
    );
  }

  if (lowerMessage.includes("playlistnotfound")) {
    return httpError(404, "Playlist YouTube non trovata, privata o non accessibile.");
  }

  if (lowerMessage.includes("videonotfound")) {
    return httpError(404, "Video YouTube non trovato, privato o non accessibile.");
  }

  if (error?.status) {
    return error;
  }

  return httpError(502, fallbackMessage);
}

function isYouTubeResumeTokenError(error) {
  return /invalidpagetoken|page token|pagetoken/i.test(String(error?.message || ""));
}

async function fetchYouTubeVideoLink(videoId) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  if (!videoId) {
    throw httpError(400, "Link YouTube senza video ID valido.");
  }

  let enriched = [];
  try {
    enriched = await enrichYouTubeItems([{ id: { videoId } }]);
  } catch (error) {
    throw normalizeYouTubeLinkError(error, "Video YouTube non recuperabile dalla API.");
  }

  const item = enriched[0];
  if (!item || !item.youtubeDetailsFound) {
    throw httpError(404, "Video YouTube non trovato, privato o non accessibile.");
  }

  const channel = item ? youtubeChannelForItem(item) : null;
  if (!channel) {
    const channelTitle = firstString(item.snippet?.channelTitle, "canale non whitelist");
    throw httpError(
      400,
      `Questo video arriva da "${channelTitle}" e non dai canali whitelist NoCopyrightSounds, Infraction o BreakingCopyright.`
    );
  }

  const mapped = mapYouTubeCuratedVideo(item, channel);
  if (!mapped) {
    throw httpError(400, "Video non importabile: troppo corto, non embeddabile o non valido.");
  }

  return [mapped];
}

async function fetchYouTubePlaylistLink(playlistId, maxTracks) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  if (!playlistId) {
    throw httpError(400, "Link playlist YouTube senza playlist ID valido.");
  }

  const collected = [];
  let scanned = 0;
  let pageToken = "";
  let pagesRead = 0;
  const maxPages = Math.max(
    1,
    Math.min(YOUTUBE_PLAYLIST_MAX_PAGES, Math.ceil(maxTracks / YOUTUBE_UPLOADS_PAGE_SIZE) + 2)
  );

  while (collected.length < maxTracks && pagesRead < maxPages) {
    let payload;
    try {
      payload = await fetchYouTubeUploadsPage(playlistId, pageToken);
    } catch (error) {
      throw normalizeYouTubeLinkError(error, "Playlist YouTube non recuperabile dalla API.");
    }

    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    scanned += pageItems.length;
    const normalizedItems = pageItems.map((item) => ({
      id: { videoId: youtubeVideoIdFromItem(item) },
      snippet: item.snippet || {},
      contentDetails: item.contentDetails || {},
    }));
    const enriched = await enrichYouTubeItems(normalizedItems);

    enriched.forEach((item) => {
      const channel = youtubeChannelForItem(item);
      if (!channel) {
        return;
      }

      const mapped = mapYouTubeCuratedVideo(item, channel);
      if (mapped) {
        collected.push(mapped);
      }
    });

    pageToken = firstString(payload.nextPageToken);
    pagesRead += 1;

    if (!pageToken) {
      break;
    }
  }

  if (scanned === 0) {
    throw httpError(404, "Playlist YouTube vuota, privata o non accessibile.");
  }

  if (collected.length === 0) {
    throw httpError(
      400,
      "Playlist letta, ma nessun video appartiene ai canali whitelist o risulta importabile nel sito."
    );
  }

  return {
    items: collected.slice(0, maxTracks),
    scanned,
    pagesRead,
    maxPages,
    reachedEnd: !pageToken,
    hasMore: Boolean(pageToken),
    nextPageToken: pageToken,
    limit: maxTracks,
  };
}

async function fetchYouTubeSessionVideoLink(videoId) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  if (!videoId) {
    throw httpError(400, "Link YouTube senza video ID valido.");
  }

  let enriched = [];
  try {
    enriched = await enrichYouTubeItems([{ id: { videoId } }]);
  } catch (error) {
    throw normalizeYouTubeLinkError(error, "Video YouTube non recuperabile dalla API.");
  }

  const mapped = enriched.map(mapYouTubeSessionVideo).filter(Boolean);
  if (mapped.length === 0) {
    throw httpError(404, "Video YouTube non trovato, privato o non embeddabile.");
  }

  return mapped.slice(0, 1);
}

function ytDlpCommand() {
  return firstString(serverPlayerYtdlPath, "yt-dlp");
}

function ytdlCookiesConfigured() {
  // Se l'env non e' impostato, il Raspberry usa automaticamente data/youtube-cookies.txt quando esiste.
  return Boolean(serverPlayerYtdlCookiesFileFromEnv || fsSync.existsSync(DEFAULT_YTDL_COOKIES_FILE));
}

function ytdlJsRuntimeExecutable() {
  const value = firstString(serverPlayerYtdlJsRuntime);
  if (!value) {
    return "";
  }

  const separator = value.indexOf(":");
  if (separator > 0 && value.slice(separator + 1).startsWith("/")) {
    return value.slice(separator + 1);
  }

  return value.split(":")[0];
}

function ytdlCookiesFileIfAvailable() {
  return fsSync.existsSync(serverPlayerYtdlCookiesFile) ? serverPlayerYtdlCookiesFile : "";
}

function parseYtdlCookieRows(rawText) {
  const rows = [];
  String(rawText || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .forEach((line) => {
      const cleanLine = line.trim();
      if (!cleanLine) {
        return;
      }

      const cookieLine = cleanLine.startsWith("#HttpOnly_") ? cleanLine.slice("#HttpOnly_".length) : cleanLine;
      if (cookieLine.startsWith("#")) {
        return;
      }

      const columns = cookieLine.split("\t");
      if (columns.length < 7) {
        return;
      }

      rows.push({
        domain: columns[0].trim(),
        includeSubdomains: columns[1].trim(),
        path: columns[2].trim(),
        secure: columns[3].trim(),
        expires: Number(columns[4]) || 0,
        name: columns[5].trim(),
      });
    });

  return rows;
}

function analyzeYtdlCookieText(rawText) {
  // Analisi volutamente senza valori: i cookie sono credenziali private e non devono finire nei log o in UI.
  const rows = parseYtdlCookieRows(rawText);
  const youtubeRows = rows.filter((row) =>
    /(^|\.)youtube\.com$|(^|\.)google\.com$|(^|\.)youtube-nocookie\.com$/i.test(row.domain)
  );
  const names = new Set(youtubeRows.map((row) => row.name).filter(Boolean));
  const sessionCookieNames = Array.from(ytdlSessionCookieNames).filter((name) => names.has(name));
  const expiringSessionCookies = youtubeRows
    .filter((row) => ytdlSessionCookieNames.has(row.name) && row.expires > 0)
    .map((row) => row.expires);
  const latestExpiresAt =
    expiringSessionCookies.length > 0
      ? new Date(Math.max(...expiringSessionCookies) * 1000).toISOString()
      : "";
  const earliestExpiresAt =
    expiringSessionCookies.length > 0
      ? new Date(Math.min(...expiringSessionCookies) * 1000).toISOString()
      : "";
  const expiresInDays = earliestExpiresAt
    ? Math.floor((Date.parse(earliestExpiresAt) - Date.now()) / 86400000)
    : null;
  const expired = Number.isFinite(expiresInDays) ? expiresInDays < 0 : false;
  const expiresSoon = Number.isFinite(expiresInDays)
    ? expiresInDays <= serverPlayerYtdlCookieExpiryWarningDays
    : false;

  return {
    validRows: rows.length,
    youtubeRows: youtubeRows.length,
    sessionCookieCount: sessionCookieNames.length,
    sessionCookieNames,
    hasSessionCookies: sessionCookieNames.length >= 4,
    expiresAt: latestExpiresAt,
    earliestExpiresAt,
    latestExpiresAt,
    expiresInDays,
    expired,
    expiresSoon,
    warningDays: serverPlayerYtdlCookieExpiryWarningDays,
  };
}

function readYtdlCookieAnalysis(filePath) {
  try {
    return analyzeYtdlCookieText(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function ytdlCookieStatus() {
  const availableFile = ytdlCookiesFileIfAvailable();
  const analysis = availableFile ? readYtdlCookieAnalysis(availableFile) : null;
  const warning = availableFile
    ? ytdlCookieWarning(analysis)
    : {
        shouldAlert: true,
        level: "warning",
        message: "Cookie YouTube non presenti: carica cookies.txt per ridurre i KO delle tracce YouTube.",
      };
  return {
    configured: ytdlCookiesConfigured(),
    available: Boolean(availableFile),
    path: serverPlayerYtdlCookiesFile,
    source: serverPlayerYtdlCookiesFileFromEnv ? "env" : "default",
    analysis,
    warning,
  };
}

function ytdlCookieWarning(analysis) {
  if (!analysis) {
    return {
      shouldAlert: false,
      level: "none",
      message: "",
    };
  }

  if (!analysis.hasSessionCookies) {
    return {
      shouldAlert: true,
      level: "error",
      message: "Cookie YouTube presenti ma senza sessione login completa: carica un cookies.txt nuovo.",
    };
  }

  if (analysis.expired) {
    return {
      shouldAlert: true,
      level: "error",
      message: "Cookie YouTube scaduti: carica un cookies.txt nuovo per evitare KO sulle tracce YouTube.",
    };
  }

  if (analysis.expiresSoon) {
    return {
      shouldAlert: true,
      level: "warning",
      message: `Cookie YouTube in scadenza tra ${Math.max(0, analysis.expiresInDays)} giorni: prepara un cookies.txt nuovo.`,
    };
  }

  if (!Number.isFinite(analysis.expiresInDays)) {
    return {
      shouldAlert: false,
      level: "ok",
      message: "Cookie YouTube validi; scadenza critica non rilevata nel file.",
    };
  }

  return {
    shouldAlert: false,
    level: "ok",
    message: `Cookie YouTube validi: prossima scadenza critica tra ${analysis.expiresInDays} giorni.`,
  };
}

function ytdlCookiesUploadTargetFile() {
  const dataRoot = path.resolve(DATA_DIR);
  const targetFile = path.resolve(serverPlayerYtdlCookiesFile || DEFAULT_YTDL_COOKIES_FILE);
  if (targetFile !== dataRoot && !targetFile.startsWith(`${dataRoot}${path.sep}`)) {
    throw httpError(
      400,
      "Il percorso cookie configurato non e' dentro la cartella data. Copia il file manualmente o usa /app/data/youtube-cookies.txt."
    );
  }
  return targetFile;
}

function normalizeUploadedYtdlCookies(rawText) {
  const text = String(rawText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const byteLength = Buffer.byteLength(text, "utf8");

  if (!text) {
    throw httpError(400, "File cookie vuoto.");
  }

  if (byteLength > 8 * 1024 * 1024) {
    throw httpError(413, "File cookie troppo grande.");
  }

  const analysis = analyzeYtdlCookieText(text);

  if (analysis.youtubeRows <= 0) {
    throw httpError(
      400,
      "Il file deve essere un cookies.txt Netscape e contenere cookie YouTube/Google esportati da una sessione autorizzata."
    );
  }

  if (!analysis.hasSessionCookies) {
    throw httpError(
      400,
      "Il file contiene cookie YouTube/Google, ma non abbastanza cookie di sessione login. Esporta cookies.txt dopo aver aperto YouTube con l'account gia' loggato."
    );
  }

  return `${text}\n`;
}

async function installYtdlCookies(payload = {}) {
  // Salva il cookies.txt nel volume data: il contenuto non viene mai loggato o restituito alla UI.
  const normalized = normalizeUploadedYtdlCookies(payload.cookiesText);
  const targetFile = ytdlCookiesUploadTargetFile();
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  const tempFile = `${targetFile}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempFile, normalized, { mode: 0o600 });
  try {
    await fs.chmod(tempFile, 0o600);
  } catch {
    // chmod non e' disponibile su tutti i filesystem Windows, Docker lo gestisce su Linux.
  }
  await fs.rename(tempFile, targetFile);

  return {
    ok: true,
    message: "Cookie YouTube installati. Il prossimo play usa la sessione autorizzata.",
    cookies: ytdlCookieStatus(),
  };
}

function appendYtDlpCommonArgs(args) {
  if (serverPlayerYtdlJsRuntime) {
    args.push("--js-runtimes", serverPlayerYtdlJsRuntime);
  }

  const cookiesFile = ytdlCookiesFileIfAvailable();
  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  }
  return args;
}

function classifyYtdlCookieProbe(result) {
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}\n${result?.error || ""}`;
  if (result?.ok) {
    return {
      ok: true,
      reason: "ok",
      message: firstString(result.stdout, "yt-dlp ha letto YouTube usando i cookie caricati."),
    };
  }

  if (/sign in to confirm|not a bot|inappropriate for some users|use --cookies|cookies-from-browser/i.test(text)) {
    return {
      ok: false,
      reason: "youtube-age-or-login",
      message:
        "YouTube rifiuta ancora la sessione dal Raspberry: rigenera cookies.txt da YouTube gia' loggato oppure attendi e riprova con lo stesso account.",
    };
  }

  if (/No supported JavaScript runtime|js runtime|deno|js-runtimes/i.test(text)) {
    return {
      ok: false,
      reason: "youtube-js-runtime",
      message: "yt-dlp non vede Deno/JavaScript runtime: ricostruisci Docker e controlla CLEARWAVE_YTDL_JS_RUNTIME.",
    };
  }

  if (/private video|video unavailable|removed|not available/i.test(text)) {
    return {
      ok: false,
      reason: "youtube-unavailable",
      message: "Il video test non e' disponibile da YouTube. Cambia CLEARWAVE_YTDL_COOKIE_PROBE_URL.",
    };
  }

  if (/network|tls|ssl|connection|econnreset|enotfound|temporary failure/i.test(text)) {
    return {
      ok: false,
      reason: "network",
      message: "Il container non riesce a raggiungere YouTube in modo stabile.",
    };
  }

  return {
    ok: false,
    reason: "unknown",
    message: firstString(result?.stderr, result?.stdout, result?.error, "Test cookie YouTube non riuscito."),
  };
}

async function probeYtdlCookies(payload = {}) {
  const cookies = ytdlCookieStatus();
  if (!cookies.available) {
    throw httpError(400, "Cookie YouTube non presenti nel container: carica cookies.txt prima del test.");
  }

  if (!cookies.analysis?.hasSessionCookies) {
    throw httpError(
      400,
      "Cookie presenti ma senza sessione login completa: esporta di nuovo cookies.txt da YouTube gia' loggato."
    );
  }

  const testUrl = firstString(payload.url, serverPlayerYtdlCookieProbeUrl);
  const args = [
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--socket-timeout",
    "20",
    "--print",
    "%(title)s | %(availability)s",
  ];
  if (serverPlayerYtdlFormat) {
    args.push("-f", serverPlayerYtdlFormat);
  }
  appendYtDlpCommonArgs(args);
  args.push(testUrl);

  const result = await diagnosticCommandResult(ytDlpCommand(), args, 35000);
  const classified = classifyYtdlCookieProbe(result);

  return {
    ok: classified.ok,
    reason: classified.reason,
    message: classified.message.slice(0, 600),
    cookies: ytdlCookieStatus(),
    probe: {
      url: testUrl,
      durationMs: result.durationMs,
      exitCode: result.code ?? null,
      title: classified.ok ? String(result.stdout || "").split(/\r?\n/).find(Boolean) || "" : "",
    },
  };
}

function ytDlpPlaylistUrl(playlistId) {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

function runYtDlpJson(args, timeoutMs = 65000) {
  return new Promise((resolve, reject) => {
    const command = ytDlpCommand();
    const processRef = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timerId = setTimeout(() => {
      settled = true;
      processRef.kill("SIGTERM");
      reject(httpError(504, "yt-dlp ha impiegato troppo tempo a leggere la playlist YouTube."));
    }, timeoutMs);

    processRef.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    processRef.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    processRef.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timerId);
      reject(httpError(502, `yt-dlp non avviabile: ${error.message || "comando non trovato"}.`));
    });
    processRef.once("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timerId);

      if (code !== 0) {
        reject(httpError(502, `yt-dlp non ha letto la playlist: ${stderr.trim() || `codice ${code}`}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch {
        reject(httpError(502, "yt-dlp ha restituito una risposta playlist non valida."));
      }
    });
  });
}

function ytDlpThumbnailForEntry(entry = {}) {
  const thumbnails = Array.isArray(entry.thumbnails)
    ? entry.thumbnails.map((thumbnail) => thumbnail?.url)
    : [];
  return firstImageUrl(entry.thumbnail, ...thumbnails);
}

function mapYtDlpSessionEntry(entry = {}) {
  const videoId = firstString(entry.id, entry.url).match(/[A-Za-z0-9_-]{8,}/)?.[0] || "";
  if (!videoId) {
    return null;
  }

  const title = decodeHtmlEntities(firstString(entry.title, `Video YouTube ${videoId}`));
  const channelTitle = decodeHtmlEntities(firstString(entry.uploader, entry.channel, "Playlist YouTube"));
  const durationSeconds = Number(entry.duration) || 0;
  const originalCoverPath = ytDlpThumbnailForEntry(entry) || youtubeThumbnailUrl(null, videoId);

  return normalizeTrack({
    id: `youtube-session-${videoId}`,
    title,
    subtitle: `${channelTitle} / playlist utente temporanea`,
    mood: inferMoodFromText([title, channelTitle].join(" ")),
    duration: formatSeconds(durationSeconds),
    energy: "Media",
    license: "YouTube public embed",
    licenseDetail: "Playlist temporanea utente: diritti commerciali non verificati",
    licenseUrl: "https://www.youtube.com/t/terms",
    attributionRequired: true,
    useCases: ["Sessione utente"],
    formats: ["STREAM"],
    stems: 0,
    instrument: "",
    accent: pickAccent(title),
    description: firstString(entry.description).slice(0, 280),
    tags: ["youtube", "session-playlist", "unverified", "yt-dlp"],
    preview: buildPreviewBlueprint(inferMoodFromText([title, channelTitle].join(" "))).preview,
    wave: buildPreviewBlueprint(inferMoodFromText([title, channelTitle].join(" "))).wave,
    youtubeVideoId: videoId,
    embedPath: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`,
    audioPath: "",
    audioOriginalName: null,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    rightsNotes:
      "Traccia letta con yt-dlp nella sessione temporanea. Non viene salvata nel catalogo sicuro: verifica licenza e autorizzazioni prima dell'uso commerciale.",
    externalProvider: "youtube_session",
    commercialStatus: "session-unverified",
    creatorName: channelTitle,
    creatorUrl: "",
    sourceType: "session-import",
    coverAlt: originalCoverPath ? `${title} - thumbnail originale YouTube` : "",
    originalCoverPath,
    canImport: false,
    canPreview: true,
  });
}

async function fetchYouTubeSessionPlaylistWithYtDlp(playlistId, maxTracks) {
  if (!playlistId) {
    throw httpError(400, "Link playlist YouTube senza playlist ID valido.");
  }

  const safeLimit = Math.max(1, Math.min(SESSION_IMPORT_MAX_TRACKS, Number(maxTracks) || 300));
  const payload = await runYtDlpJson(appendYtDlpCommonArgs([
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    "--playlist-end",
    String(safeLimit),
    ytDlpPlaylistUrl(playlistId),
  ]));
  const entries = Array.isArray(payload.entries) ? payload.entries.filter(Boolean) : [];
  const mapped = entries.map(mapYtDlpSessionEntry).filter(Boolean).slice(0, safeLimit);

  if (mapped.length === 0) {
    throw httpError(404, "yt-dlp non ha trovato video leggibili nella playlist YouTube.");
  }

  return {
    items: mapped,
    scanned: entries.length,
    pagesRead: 0,
    maxPages: 0,
    reachedEnd: mapped.length < safeLimit || entries.length < safeLimit,
    hasMore: entries.length >= safeLimit,
    limit: safeLimit,
    source: "yt-dlp",
  };
}

async function fetchYouTubeSessionPlaylistLink(playlistId, maxTracks) {
  if (!youtubeApiKey) {
    throw httpError(400, "YOUTUBE_API_KEY non configurato.");
  }

  if (!playlistId) {
    throw httpError(400, "Link playlist YouTube senza playlist ID valido.");
  }

  const collected = [];
  let scanned = 0;
  let pageToken = "";
  let pagesRead = 0;
  const maxPages = Math.max(
    1,
    Math.min(YOUTUBE_PLAYLIST_MAX_PAGES, Math.ceil(maxTracks / YOUTUBE_UPLOADS_PAGE_SIZE) + 2)
  );

  while (collected.length < maxTracks && pagesRead < maxPages) {
    let payload;
    try {
      payload = await fetchYouTubeUploadsPage(playlistId, pageToken);
    } catch (error) {
      throw normalizeYouTubeLinkError(error, "Playlist YouTube non recuperabile dalla API.");
    }

    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    scanned += pageItems.length;
    const normalizedItems = pageItems.map((item) => ({
      id: { videoId: youtubeVideoIdFromItem(item) },
      snippet: item.snippet || {},
      contentDetails: item.contentDetails || {},
    }));
    const enriched = await enrichYouTubeItems(normalizedItems);

    collected.push(...enriched.map(mapYouTubeSessionVideo).filter(Boolean));

    pageToken = firstString(payload.nextPageToken);
    pagesRead += 1;

    if (!pageToken) {
      break;
    }
  }

  if (scanned === 0) {
    throw httpError(404, "Playlist YouTube vuota, privata o non accessibile.");
  }

  if (collected.length === 0) {
    throw httpError(
      400,
      "Playlist letta, ma nessun video pubblico ed embeddabile risulta riproducibile nel sito."
    );
  }

  return {
    items: collected.slice(0, maxTracks),
    scanned,
    pagesRead,
    maxPages,
    reachedEnd: !pageToken,
    hasMore: Boolean(pageToken),
    nextPageToken: pageToken,
    limit: maxTracks,
  };
}

async function fetchYouTubeSessionChannelLink(channelSource, maxTracks) {
  const channel = await resolveYouTubeChannelUploadsPlaylist(channelSource);
  const result = await fetchYouTubeSessionPlaylistLink(channel.playlistId, maxTracks);

  return {
    channel,
    stats: result,
    tracks: result.items.map((track) => ({
      ...track,
      subtitle: `${track.creatorName || channel.channelTitle} / sessione canale YouTube`,
      rightsNotes:
        `${track.rightsNotes || ""} Importato temporaneamente dal canale "${channel.channelTitle}".`.trim(),
    })),
  };
}

async function fetchYouTubeCuratedChannelLink(channelSource, maxTracks) {
  const aliasChannel = curatedChannelFromSource(channelSource);
  let resolvedChannel;

  try {
    resolvedChannel = await resolveYouTubeChannelUploadsPlaylist(channelSource);
  } catch (error) {
    if (!aliasChannel) {
      throw error;
    }

    resolvedChannel = {
      channelId: aliasChannel.id,
      channelTitle: aliasChannel.name,
      playlistId: await fetchYouTubeUploadsPlaylistId(aliasChannel),
    };
  }

  const curatedChannel = youtubeCuratedChannels.find(
    (channel) => channel.id === resolvedChannel.channelId
  );

  if (!curatedChannel) {
    throw httpError(
      400,
      `Il canale "${resolvedChannel.channelTitle}" non e' nella whitelist commerciale. Usalo nella sessione temporanea, non nel catalogo sicuro.`
    );
  }

  const state = await readYouTubeImportState();
  const previousState = state.channels[curatedChannel.id] || {};
  const resumeToken = previousState.reachedEnd ? "" : firstString(previousState.nextPageToken);
  const scanTarget = Math.max(maxTracks, Math.min(YOUTUBE_CURATED_LINK_MAX_SCAN, maxTracks * 3));
  const maxPages = Math.max(
    1,
    Math.min(
      Math.ceil(YOUTUBE_CURATED_LINK_MAX_SCAN / YOUTUBE_UPLOADS_PAGE_SIZE),
      Math.ceil(scanTarget / YOUTUBE_UPLOADS_PAGE_SIZE) + 2
    )
  );

  const result = await fetchYouTubeCuratedUploads(curatedChannel, scanTarget, maxPages, {
    pageToken: resumeToken,
    onProgress: async ({ nextPageToken, reachedEnd }) => {
      state.channels[curatedChannel.id] = {
        name: curatedChannel.name,
        nextPageToken: reachedEnd ? "" : nextPageToken,
        reachedEnd,
        pagesReadTotal: Number(previousState.pagesReadTotal || 0),
        updatedAt: new Date().toISOString(),
      };
      await writeYouTubeImportState(state);
    },
  });
  const pagesReadTotal = Number(previousState.pagesReadTotal || 0) + result.pagesRead;
  state.channels[curatedChannel.id] = {
    name: curatedChannel.name,
    nextPageToken: result.reachedEnd ? "" : result.nextPageToken,
    reachedEnd: result.reachedEnd,
    pagesReadTotal,
    updatedAt: new Date().toISOString(),
  };
  await writeYouTubeImportState(state);

  if (result.items.length === 0) {
    throw httpError(
      404,
      `Nessun video importabile trovato nel canale whitelist ${curatedChannel.name}.`
    );
  }

  return {
    channel: {
      ...resolvedChannel,
      name: curatedChannel.name,
      policyUrl: curatedChannel.policyUrl,
      progress: {
        scanned: result.scanned,
        pagesRead: result.pagesRead,
        maxPages: result.maxPages,
        pagesReadTotal,
        reachedEnd: result.reachedEnd,
        hasMore: result.hasMore,
        limit: result.limit,
      },
    },
    items: result.items,
  };
}

async function fetchJamendoTrackLink(trackId) {
  if (!jamendoClientId) {
    throw httpError(400, "JAMENDO_CLIENT_ID non configurato.");
  }

  if (!trackId) {
    throw httpError(400, "Link Jamendo senza track ID valido.");
  }

  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  url.searchParams.set("client_id", jamendoClientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("id", trackId);
  url.searchParams.set("audioformat", "mp32");
  url.searchParams.set("include", "licenses+musicinfo");
  url.searchParams.set("prolicensing", "true");
  url.searchParams.set("ccnc", "false");

  const payload = await fetchJson(url);
  const items = Array.isArray(payload.results) ? payload.results : [];
  const mapped = items.map(mapJamendoTrack).filter(Boolean);
  if (mapped.length === 0) {
    throw httpError(404, "Traccia Jamendo non trovata o non importabile.");
  }

  return mapped.slice(0, 1);
}

async function importPlayableDiscoveryItems(items, options = {}) {
  // Salva solo elementi realmente riproducibili nel sito e scarta duplicati o clip troppo corte.
  const maxTracks = sanitizeLinkImportMaxTracks(options.maxTracks, 300, LINK_IMPORT_MAX_TRACKS);
  const existingTracks = await readLibrary();
  const knownIdentities = new Set(existingTracks.map(discoveryIdentity));
  const knownTitleKeys = new Set(
    existingTracks.map((track) =>
      `${firstString(track.externalProvider, track.sourceType)}:${slugify(track.title)}:${slugify(track.creatorName)}`
    )
  );
  const importedTracks = [];
  const skipped = [];
  let scanned = 0;

  for (const item of items) {
    scanned += 1;
    if (importedTracks.length >= maxTracks) {
      break;
    }

    const playable = Boolean(
      (item.externalProvider === "jamendo" && item.audioPath) ||
        (item.externalProvider === "youtube_curated" && (item.embedPath || item.youtubeVideoId))
    );
    if (!primaryMusicProviders.has(item.externalProvider) || !playable) {
      skipped.push({ title: item.title, reason: "not-playable-in-site" });
      continue;
    }

    const durationSeconds = parseDurationSeconds(item.duration);
    if (durationSeconds > 0 && durationSeconds < 120) {
      skipped.push({ title: item.title, reason: "too-short" });
      continue;
    }

    const identity = discoveryIdentity(item);
    const titleKey = `${firstString(item.externalProvider, item.sourceType)}:${slugify(item.title)}:${slugify(item.creatorName)}`;
    if (knownIdentities.has(identity) || knownTitleKeys.has(titleKey)) {
      skipped.push({ title: item.title, reason: "duplicate" });
      continue;
    }

    const importedTrack = await importDiscoveryTrack(item, {
      idSuffix: `${Date.now()}-${importedTracks.length}`,
    });
    knownIdentities.add(discoveryIdentity(importedTrack));
    knownTitleKeys.add(
      `${firstString(importedTrack.externalProvider, importedTrack.sourceType)}:${slugify(importedTrack.title)}:${slugify(importedTrack.creatorName)}`
    );
    importedTracks.push(importedTrack);
  }

  if (importedTracks.length > 0) {
    await writeLibrary([...importedTracks, ...existingTracks]);
  }

  return {
    imported: importedTracks.map(attachComputedFields),
    importedCount: importedTracks.length,
    scanned,
    skippedCount: skipped.length,
    skipped,
    skippedSummary: summarizeSkippedReasons(skipped),
  };
}

async function importDiscoveryLink(payload = {}) {
  // Import permanente: accetta solo Jamendo e YouTube whitelist verificabili per il catalogo sicuro.
  const parsed = parseExternalImportUrl(payload.url);
  const maxTracks = sanitizeLinkImportMaxTracks(payload.maxTracks, 300, LINK_IMPORT_MAX_TRACKS);
  let items = [];
  let resolvedChannel = null;
  let sourceStats = null;

  if (parsed.provider === "youtube" && parsed.type === "video") {
    items = await fetchYouTubeVideoLink(parsed.videoId);
  } else if (parsed.provider === "youtube" && parsed.type === "playlist") {
    const result = await fetchYouTubePlaylistLink(parsed.playlistId, maxTracks);
    items = result.items;
    sourceStats = result;
  } else if (parsed.provider === "youtube" && parsed.type === "channel") {
    const result = await fetchYouTubeCuratedChannelLink(parsed, maxTracks);
    items = result.items;
    resolvedChannel = result.channel;
    sourceStats = result.channel?.progress || null;
  } else if (parsed.provider === "jamendo" && parsed.type === "track") {
    items = await fetchJamendoTrackLink(parsed.trackId);
  }

  if (items.length === 0) {
    throw httpError(404, "Nessuna traccia importabile trovata nel link.");
  }

  const result = await importPlayableDiscoveryItems(items, { maxTracks });
  return {
    ...result,
    source: resolvedChannel ? { ...parsed, resolvedChannel } : parsed,
    sourceScanned: Number(sourceStats?.scanned || 0),
    sourcePagesRead: Number(sourceStats?.pagesRead || 0),
    sourceReachedEnd: Boolean(sourceStats?.reachedEnd),
    sourceHasMore: Boolean(sourceStats?.hasMore),
    sourceLimit: Number(sourceStats?.limit || maxTracks),
    sourceMaxPages: Number(sourceStats?.maxPages || 0),
  };
}

async function importSessionLink(payload = {}) {
  // Import temporaneo: per link YouTube non verificati, rimane in sessione e non sporca il catalogo sicuro.
  const parsed = parseExternalImportUrl(payload.url);
  const maxTracks = sanitizeLinkImportMaxTracks(payload.maxTracks, 300, SESSION_IMPORT_MAX_TRACKS);
  let items = [];
  let notice = "";
  let resolvedChannel = null;
  let sourceStats = null;

  if (parsed.provider === "youtube" && parsed.type === "video") {
    items = await fetchYouTubeSessionVideoLink(parsed.videoId);
    if (parsed.isRadio) {
      notice =
        "Link radio/mix YouTube rilevato: queste playlist non sono vere playlist API, quindi ho importato il video del link nella sessione temporanea.";
    }
  } else if (parsed.provider === "youtube" && parsed.type === "playlist") {
    try {
      const result = await fetchYouTubeSessionPlaylistLink(parsed.playlistId, maxTracks);
      items = result.items;
      sourceStats = result;
      if (items.length <= 1 && !parsed.isRadio) {
        try {
          // Alcune playlist pubbliche via Data API restituiscono solo il video del link: yt-dlp prova a leggere l'elenco reale.
          const fallbackResult = await fetchYouTubeSessionPlaylistWithYtDlp(parsed.playlistId, maxTracks);
          if (fallbackResult.items.length > items.length) {
            items = fallbackResult.items;
            sourceStats = fallbackResult;
            notice =
              "La YouTube Data API ha letto pochi brani: ho espanso la playlist con yt-dlp nella sessione temporanea.";
          }
        } catch {
          notice =
            "La playlist sembra contenere un solo brano accessibile dalla API. Se e' una playlist pubblica piu' lunga, prova il link diretto /playlist?list=...";
        }
      }
    } catch (error) {
      try {
        // Fallback Raspberry/Docker: quando la Data API non vede la playlist, yt-dlp legge l'elenco reale.
        const result = await fetchYouTubeSessionPlaylistWithYtDlp(parsed.playlistId, maxTracks);
        items = result.items;
        sourceStats = result;
        notice =
          "Playlist importata con yt-dlp nella sessione temporanea: i brani non vengono salvati nel catalogo sicuro.";
      } catch {
        if (!parsed.videoId) {
          throw error;
        }

        try {
          items = await fetchYouTubeSessionVideoLink(parsed.videoId);
          notice =
            "La playlist non e' accessibile dalla YouTube Data API o da yt-dlp: ho importato solo il video presente nel link.";
        } catch {
          throw httpError(
            error.status || 404,
            "Playlist non accessibile dalla YouTube Data API/yt-dlp e video del link non disponibile o non embeddabile. Prova con il link diretto della playlist pubblica o con il link del canale /@handle."
          );
        }
      }
    }
  } else if (parsed.provider === "youtube" && parsed.type === "channel") {
    const result = await fetchYouTubeSessionChannelLink(parsed, maxTracks);
    items = result.tracks;
    resolvedChannel = result.channel;
    sourceStats = result.stats;
  } else {
    throw httpError(
      400,
      "La sessione temporanea accetta solo link YouTube pubblici: video, playlist, /@handle o /channel/UC..."
    );
  }

  return {
    imported: items.map(attachComputedFields),
    importedCount: items.length,
    scanned: Number(sourceStats?.scanned || items.length),
    pagesRead: Number(sourceStats?.pagesRead || 0),
    reachedEnd: Boolean(sourceStats?.reachedEnd),
    hasMore: Boolean(sourceStats?.hasMore),
    limit: Number(sourceStats?.limit || maxTracks),
    maxPages: Number(sourceStats?.maxPages || 0),
    source: resolvedChannel ? { ...parsed, resolvedChannel } : parsed,
    notice,
    temporary: true,
  };
}

async function searchDiscoveryProviders({ providerId, query, limit, rightsMode }) {
  // Unifica i provider esterni dietro un'unica API usata dalla UI di import.
  const limitValue = sanitizeDiscoveryLimit(limit);
  const allowedProviders = publicDiscoveryProviders(rightsMode);
  const providerMap = new Map(allowedProviders.map((provider) => [provider.id, provider]));
  const selectedProviders =
    providerId && providerId !== "all"
      ? [providerMap.get(providerId)].filter(Boolean)
      : allowedProviders;

  if (selectedProviders.length === 0) {
    throw httpError(400, "Nessun provider disponibile per la modalita' selezionata.");
  }

  const providerSearchMap = {
    openverse: () => searchOpenverse(query, limitValue),
    freetouse: () => searchFreeToUse(query, limitValue),
    jamendo: () => searchJamendo(query, limitValue),
    audius: () => searchAudius(query, limitValue),
    theaudiodb: () => searchTheAudioDb(query, limitValue),
    youtube_curated: () => searchYouTubeCurated(query, limitValue),
    youtube: () => searchYouTube(query, limitValue),
  };

  const settled = await Promise.allSettled(
    selectedProviders.map(async (provider) => {
      const items = await providerSearchMap[provider.id]();
      return { provider, items };
    })
  );

  const items = [];
  const errors = [];

  settled.forEach((result, index) => {
    const provider = selectedProviders[index];
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      return;
    }

    errors.push({
      provider: provider.id,
      message: result.reason?.message || "Errore provider esterno.",
    });
  });

  return {
    providers: selectedProviders,
    items: items.slice(0, limitValue * selectedProviders.length),
    errors,
  };
}

function discoveryIdentity(track) {
  const provider = firstString(track.externalProvider, track.sourceType, "external");
  const source = firstString(
    track.sourceUrl,
    track.audioPath,
    track.embedPath,
    track.youtubeVideoId,
    track.id,
    `${track.creatorName || ""}-${track.title || ""}`
  );

  return `${provider}:${source}`.toLowerCase();
}

function summarizeSkippedReasons(skipped = []) {
  const labels = {
    duplicate: "gia' presenti",
    "too-short": "troppo brevi",
    "not-playable-in-site": "non riproducibili",
    "unsupported-provider": "provider non supportato",
    "metadata-only": "solo metadata",
  };
  const counts = skipped.reduce((summary, item) => {
    const reason = firstString(item?.reason, "altro");
    summary[reason] = (summary[reason] || 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts).map(([reason, count]) => ({
    reason,
    label: labels[reason] || reason,
    count,
  }));
}

async function importDiscoveryTrack(payload, options = {}) {
  const title = firstString(payload.title);
  if (!title) {
    throw httpError(400, "Il titolo del brano esterno e' obbligatorio.");
  }

  const idSuffix = firstString(options.idSuffix, String(Date.now()));
  return normalizeTrack({
    id: `${slugify(`${payload.externalProvider || "external"}-${title}`)}-${idSuffix}`,
    title,
    subtitle: firstString(payload.subtitle, payload.creatorName),
    mood: firstString(payload.mood, "Focused"),
    bpm: Number(payload.bpm) || 0,
    duration: firstString(payload.duration),
    energy: firstString(payload.energy, "Media"),
    license: firstString(payload.license, "External source"),
    licenseDetail: firstString(payload.licenseDetail),
    licenseUrl: firstString(payload.licenseUrl),
    attributionRequired: Boolean(payload.attributionRequired),
    useCases: parseList(payload.useCases).length > 0
      ? parseList(payload.useCases)
      : ["ADV digital", "Social media", "Video branded"],
    formats: parseList(payload.formats),
    stems: Number(payload.stems) || 0,
    instrument: firstString(payload.instrument),
    accent: firstString(payload.accent, pickAccent(title)),
    description: firstString(payload.description),
    tags: parseList(payload.tags),
    preview: Array.isArray(payload.preview) ? payload.preview : buildPreviewBlueprint(payload.mood).preview,
    wave: firstString(payload.wave, buildPreviewBlueprint(payload.mood).wave),
    sourceType: "provider-import",
    audioPath: firstString(payload.audioPath),
    audioOriginalName: null,
    sourceUrl: firstString(payload.sourceUrl),
    rightsNotes: firstString(payload.rightsNotes),
    externalProvider: firstString(payload.externalProvider),
    commercialStatus: firstString(payload.commercialStatus),
    creatorName: firstString(payload.creatorName),
    creatorUrl: firstString(payload.creatorUrl),
    youtubeVideoId: firstString(payload.youtubeVideoId),
    embedPath: firstString(payload.embedPath),
    canImport: payload.canImport !== false,
    canPreview: payload.canPreview !== false,
    providerIdentity: discoveryIdentity(payload),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function bulkImportDiscoveryTracks(payload = {}) {
  const limitPerQuery = sanitizeBulkImportLimit(payload.limitPerQuery);
  const maxTracks = Math.max(10, Math.min(BULK_IMPORT_MAX_TRACKS, Number(payload.maxTracks) || 80));
  const includeYouTubeChannels = payload.includeYouTubeChannels === true;
  const youtubeResume = payload.youtubeResume !== false;
  const youtubeRestartCompleted = payload.youtubeRestartCompleted !== false;
  const youtubeChannelMaxPages = Math.max(
    1,
    Math.min(120, Number(payload.youtubeChannelMaxPages) || 35)
  );
  const youtubeScanMultiplier = Math.max(
    1,
    Math.min(16, Number(payload.youtubeScanMultiplier) || YOUTUBE_BULK_SCAN_MULTIPLIER)
  );
  const includeYouTubePlaylists = payload.includeYouTubePlaylists !== false;
  const youtubePlaylistScanLimit = Math.max(
    1,
    Math.min(80, Number(payload.youtubePlaylistScanLimit) || YOUTUBE_CURATED_PLAYLIST_SCAN_LIMIT)
  );
  const youtubePlaylistItemsPerPlaylist = Math.max(
    1,
    Math.min(
      150,
      Number(payload.youtubePlaylistItemsPerPlaylist) || YOUTUBE_CURATED_PLAYLIST_ITEMS_LIMIT
    )
  );
  const existingTracks = await readLibrary();
  const knownIdentities = new Set(existingTracks.map(discoveryIdentity));
  const knownTitleKeys = new Set(
    existingTracks.map((track) =>
      `${firstString(track.externalProvider, track.sourceType)}:${slugify(track.title)}:${slugify(track.creatorName)}`
    )
  );
  const importedTracks = [];
  const errors = [];
  const skipped = [];
  const youtubeProgress = [];
  let scanned = 0;

  async function tryImportItem(item) {
    scanned += 1;
    if (importedTracks.length >= maxTracks) {
      return;
    }

    if (!primaryMusicProviders.has(item.externalProvider)) {
      skipped.push({ title: item.title, reason: "unsupported-provider" });
      return;
    }

    const hasPlayableSource = Boolean(
      (item.externalProvider === "jamendo" && item.audioPath) ||
        (item.externalProvider === "youtube_curated" && (item.embedPath || item.youtubeVideoId))
    );
    if (!hasPlayableSource) {
      skipped.push({ title: item.title, reason: "not-playable-in-site" });
      return;
    }

    if (item.canImport === false || item.externalProvider === "theaudiodb") {
      skipped.push({ title: item.title, reason: "metadata-only" });
      return;
    }

    const durationSeconds = parseDurationSeconds(item.duration);
    if (durationSeconds > 0 && durationSeconds < 120) {
      skipped.push({ title: item.title, reason: "too-short" });
      return;
    }

    const identity = discoveryIdentity(item);
    const titleKey = `${firstString(item.externalProvider, item.sourceType)}:${slugify(item.title)}:${slugify(item.creatorName)}`;
    if (knownIdentities.has(identity) || knownTitleKeys.has(titleKey)) {
      skipped.push({ title: item.title, reason: "duplicate" });
      return;
    }

    const importedTrack = await importDiscoveryTrack(item, {
      idSuffix: `${Date.now()}-${importedTracks.length}`,
    });
    knownIdentities.add(discoveryIdentity(importedTrack));
    knownTitleKeys.add(
      `${firstString(importedTrack.externalProvider, importedTrack.sourceType)}:${slugify(importedTrack.title)}:${slugify(importedTrack.creatorName)}`
    );
    importedTracks.push(importedTrack);
  }

  if (includeYouTubeChannels && importedTracks.length < maxTracks) {
    try {
      const result = await fetchYouTubeCuratedChannelBackfill(maxTracks, youtubeChannelMaxPages, {
        resume: youtubeResume,
        restartCompleted: youtubeRestartCompleted,
        scanMultiplier: youtubeScanMultiplier,
        includePlaylists: includeYouTubePlaylists,
        playlistScanLimit: youtubePlaylistScanLimit,
        playlistItemsPerPlaylist: youtubePlaylistItemsPerPlaylist,
      });
      errors.push(...result.errors);
      youtubeProgress.push(...(Array.isArray(result.progress) ? result.progress : []));

      for (const item of result.items) {
        if (importedTracks.length >= maxTracks) {
          break;
        }

        await tryImportItem(item);
      }
    } catch (error) {
      errors.push({
        provider: "youtube_curated",
        message: error.message || "Import massivo canali YouTube non riuscito.",
      });
    }
  }

  for (const plan of bulkImportPlans) {
    for (const query of plan.queries) {
      if (importedTracks.length >= maxTracks) {
        break;
      }

      try {
        const result = await searchDiscoveryProviders({
          providerId: plan.providerId,
          query,
          limit: limitPerQuery,
          rightsMode: plan.rightsMode,
        });

        errors.push(...result.errors);

        for (const item of result.items) {
          if (importedTracks.length >= maxTracks) {
            break;
          }

          await tryImportItem(item);
        }
      } catch (error) {
        errors.push({
          provider: plan.providerId,
          message: error.message || "Import massivo non riuscito.",
        });
      }
    }
  }

  if (importedTracks.length > 0) {
    await writeLibrary([...importedTracks, ...existingTracks]);
  }

  return {
    imported: importedTracks.map(attachComputedFields),
    importedCount: importedTracks.length,
    scanned,
    skippedCount: skipped.length,
    skippedSummary: summarizeSkippedReasons(skipped),
    youtubeProgress,
    errors,
  };
}

async function createTrackFromPayload(payload) {
  const title = String(payload.title || "").trim();
  if (!title) {
    throw httpError(400, "Il titolo del brano e' obbligatorio.");
  }

  const mood = String(payload.mood || "Upbeat");
  const useCases = formatLabelList(payload.useCases);
  if (useCases.length === 0) {
    throw httpError(400, "Inserisci almeno un uso commerciale.");
  }

  const license = String(payload.license || "").trim();
  if (!license) {
    throw httpError(400, "La tipologia di licenza e' obbligatoria.");
  }

  const idBase = slugify(title);
  const timestamp = new Date().toISOString();
  const audioAsset = await saveIncomingFile(payload.audioFile, AUDIO_DIR, `${idBase}-audio`);
  const licenseAsset = await saveIncomingFile(
    payload.licenseFile,
    LICENSES_DIR,
    `${idBase}-license`
  );
  const previewBlueprint = buildPreviewBlueprint(mood);
  const formats = formatLabelList(payload.formats);

  if (audioAsset) {
    const extension = path.extname(audioAsset.originalName).slice(1).toUpperCase();
    if (extension && !formats.includes(extension)) {
      formats.unshift(extension);
    }
  }

  return normalizeTrack({
    id: `${idBase}-${Date.now()}`,
    title,
    subtitle: String(payload.subtitle || "").trim(),
    mood,
    bpm: Number(payload.bpm) || 0,
    duration: String(payload.duration || "").trim(),
    energy: String(payload.energy || "Media"),
    genre: String(payload.genre || "").trim(),
    license,
    licenseDetail: String(payload.licenseDetail || "").trim(),
    attributionRequired: Boolean(payload.attributionRequired),
    useCases,
    formats,
    stems: Number(payload.stems) || 0,
    instrument: String(payload.instrument || "").trim(),
    accent: String(payload.accent || pickAccent(title)),
    description: String(payload.description || "").trim(),
    tags: formatLabelList(payload.tags),
    preview: previewBlueprint.preview,
    wave: previewBlueprint.wave,
    sourceType: "uploaded",
    audioPath: audioAsset ? `/uploads/audio/${audioAsset.storedName}` : null,
    audioOriginalName: audioAsset ? audioAsset.originalName : null,
    licensePath: licenseAsset ? `/uploads/licenses/${licenseAsset.storedName}` : null,
    licenseFileName: licenseAsset ? licenseAsset.originalName : null,
    sourceUrl: String(payload.sourceUrl || "").trim(),
    rightsNotes: String(payload.rightsNotes || "").trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function contentTypeFor(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function serveFile(res, filePath) {
  const content = await fs.readFile(filePath);
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypeFor(filePath),
  });
  res.end(content);
}

function resolveHtmlPartialPath(partialPath) {
  const resolved = path.normalize(path.join(PARTIALS_DIR, partialPath));
  if (!isPathInsideDirectory(PARTIALS_DIR, resolved)) {
    throw httpError(403, "Partial HTML non consentito.");
  }

  return resolved;
}

async function renderHtmlTemplate(filePath = INDEX_TEMPLATE_FILE, seen = new Set()) {
  const normalizedPath = path.normalize(filePath);
  if (seen.has(normalizedPath)) {
    throw httpError(500, "Include HTML circolare rilevato.");
  }

  seen.add(normalizedPath);
  let html = await fs.readFile(normalizedPath, "utf8");
  const includePattern = /<!--\s*@include\s+([a-zA-Z0-9/_-]+\.html)\s*-->/g;
  const includes = [...html.matchAll(includePattern)];

  for (const includeMatch of includes) {
    const partialFile = resolveHtmlPartialPath(includeMatch[1]);
    const partialHtml = await renderHtmlTemplate(partialFile, seen);
    html = html.replace(includeMatch[0], partialHtml.trimEnd());
  }

  seen.delete(normalizedPath);
  return html;
}

async function serveIndexHtml(res) {
  const html = await renderHtmlTemplate();
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(html);
}

async function serveReactApp(res, requestPath) {
  let filePath = path.join(REACT_DIST_DIR, "index.html");

  if (requestPath.startsWith("/react/assets/")) {
    const relativePath = requestPath.replace(/^\/react\/assets\//, "");
    filePath = path.normalize(path.join(REACT_DIST_DIR, "assets", relativePath));

    if (!isPathInsideDirectory(path.join(REACT_DIST_DIR, "assets"), filePath)) {
      throw httpError(403, "Asset React non consentito.");
    }
  }

  if (!isPathInsideDirectory(REACT_DIST_DIR, filePath)) {
    throw httpError(403, "Percorso React non consentito.");
  }

  try {
    await serveFile(res, filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw httpError(404, "Build React non trovata. Esegui npm run build:react.");
    }

    throw error;
  }
}

function isPathInsideDirectory(directory, targetPath) {
  const relative = path.relative(directory, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentDisposition(downloadName) {
  const safeName = String(downloadName || "clearwave-track.wav")
    .replace(/["\\]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .slice(0, 140);
  return `attachment; filename="${safeName || "clearwave-track.wav"}"`;
}

async function serveFileDownload(res, filePath, downloadName) {
  const content = await fs.readFile(filePath);
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": contentDisposition(downloadName),
    "Content-Type": contentTypeFor(filePath),
  });
  res.end(content);
}

function downloadText(res, downloadName, contentType, text) {
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": contentDisposition(downloadName),
    "Content-Type": contentType,
  });
  res.end(text);
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeCatalogSafetyBackup(tracks, reason) {
  const backupName = `library.backup-${exportStamp()}.json`;
  const backupPath = path.join(DATA_DIR, backupName);
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "ClearWave Library",
    version: SERVER_RUNTIME_REVISION,
    reason,
    trackCount: tracks.length,
    tracks,
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(backupPath, JSON.stringify(payload, null, 2), "utf8");
  return backupName;
}

function tracksFromCatalogBackupPayload(payload) {
  const tracks = Array.isArray(payload) ? payload : payload?.tracks;
  if (!Array.isArray(tracks)) {
    throw httpError(400, "Backup catalogo non valido: manca l'array tracks.");
  }

  if (tracks.length > 20000) {
    throw httpError(413, "Backup catalogo troppo grande: limite 20000 tracce.");
  }

  return tracks;
}

function normalizeImportedCatalogTracks(sourceTracks) {
  const now = new Date().toISOString();
  const seenIds = new Set();

  return sourceTracks.map((track, index) => {
    if (!track || typeof track !== "object" || Array.isArray(track)) {
      throw httpError(400, `Traccia ${index + 1} non valida nel backup.`);
    }

    const baseId = firstString(track.id, slugify(firstString(track.title, track.name, `track-${index + 1}`)));
    let id = baseId;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);

    return normalizeTrack({
      ...track,
      id,
      createdAt: firstString(track.createdAt, now),
      updatedAt: firstString(track.updatedAt, now),
    });
  });
}

async function serveCatalogBackup(res) {
  const tracks = await readLibrary();
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "ClearWave Library",
    version: SERVER_RUNTIME_REVISION,
    trackCount: tracks.length,
    tracks,
  };

  downloadText(
    res,
    `clearwave-catalog-backup-${exportStamp()}.json`,
    "application/json; charset=utf-8",
    JSON.stringify(payload, null, 2)
  );
}

async function importCatalogBackup(payload) {
  const sourceTracks = tracksFromCatalogBackupPayload(payload);
  const previousTracks = await readLibrary();
  const backupFile = await writeCatalogSafetyBackup(previousTracks, "pre-catalog-restore");
  const tracks = normalizeImportedCatalogTracks(sourceTracks);

  // Ripristino intenzionalmente distruttivo: prima viene salvato il backup di sicurezza qui sopra.
  await writeLibrary(tracks);
  return {
    ok: true,
    importedAt: new Date().toISOString(),
    importedCount: tracks.length,
    backupFile,
  };
}

async function serveLicenseReportCsv(res) {
  const tracks = (await readLibrary()).map(normalizeTrack);
  const columns = [
    ["id", (track) => track.id],
    ["titolo", (track) => track.title],
    ["autore", (track) => firstString(track.creatorName, track.subtitle)],
    ["provider", (track) => firstString(track.externalProvider, track.sourceType)],
    ["genere", (track) => track.genre],
    ["durata", (track) => track.duration],
    ["licenza", (track) => track.license],
    ["dettaglio_licenza", (track) => track.licenseDetail],
    ["url_licenza", (track) => track.licenseUrl],
    ["status_commerciale", (track) => track.commercialStatus],
    ["attribuzione_richiesta", (track) => (track.attributionRequired ? "si" : "no")],
    ["note_diritti", (track) => track.rightsNotes],
    ["fonte", (track) => track.sourceUrl],
    ["creator_url", (track) => track.creatorUrl],
    ["file_licenza", (track) => firstString(track.licenseFileName, track.licensePath)],
    ["importato_il", (track) => track.createdAt],
    ["aggiornato_il", (track) => track.updatedAt],
  ];
  const rows = [
    columns.map(([name]) => csvValue(name)).join(","),
    ...tracks.map((track) => columns.map(([, getter]) => csvValue(getter(track))).join(",")),
  ];

  downloadText(
    res,
    `clearwave-license-report-${exportStamp()}.csv`,
    "text/csv; charset=utf-8",
    `\uFEFF${rows.join("\r\n")}\r\n`
  );
}

function htmlValue(value) {
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countByValue(tracks, getter) {
  const counts = new Map();
  for (const track of tracks) {
    const key = firstString(getter(track), "n/d");
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function serveLicenseReportHtml(res) {
  const tracks = (await readLibrary()).map(normalizeTrack);
  const providerCounts = countByValue(tracks, (track) => firstString(track.externalProvider, track.sourceType));
  const licenseCounts = countByValue(tracks, (track) => track.license);
  const commercialCounts = countByValue(tracks, (track) => track.commercialStatus);
  const summaryList = (title, entries) => `
    <section>
      <h2>${htmlValue(title)}</h2>
      <ul>
        ${entries.map(([label, count]) => `<li><strong>${htmlValue(label)}</strong>: ${count}</li>`).join("")}
      </ul>
    </section>`;
  const rows = tracks
    .map((track) => {
      const sourceUrl = firstString(track.sourceUrl);
      const licenseUrl = firstString(track.licenseUrl);
      return `<tr>
        <td>${htmlValue(track.title)}</td>
        <td>${htmlValue(firstString(track.creatorName, track.subtitle))}</td>
        <td>${htmlValue(firstString(track.externalProvider, track.sourceType))}</td>
        <td>${htmlValue(track.genre)}</td>
        <td>${htmlValue(track.duration)}</td>
        <td>${htmlValue(track.license)}</td>
        <td>${htmlValue(track.commercialStatus)}</td>
        <td>${track.attributionRequired ? "si" : "no"}</td>
        <td>${sourceUrl ? `<a href="${htmlValue(sourceUrl)}">fonte</a>` : ""}</td>
        <td>${licenseUrl ? `<a href="${htmlValue(licenseUrl)}">licenza</a>` : ""}</td>
        <td>${htmlValue(track.rightsNotes)}</td>
      </tr>`;
    })
    .join("");
  const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>ClearWave - Report licenze</title>
  <style>
    body { margin: 24px; background: #17030a; color: #fff7f4; font: 14px/1.45 system-ui, sans-serif; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    h2 { margin: 20px 0 8px; font-size: 18px; }
    p, li { color: #d9bdc5; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 20px 0; }
    section, table { border: 1px solid #893042; border-radius: 12px; background: #2b111a; }
    section { padding: 14px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { padding: 10px; border-bottom: 1px solid #5b2430; text-align: left; vertical-align: top; }
    th { color: #ff4255; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    a { color: #7efcff; }
  </style>
</head>
<body>
  <h1>ClearWave - Report licenze</h1>
  <p>Esportato il ${htmlValue(new Date().toISOString())}. Tracce totali: ${tracks.length}.</p>
  <div class="summary">
    ${summaryList("Provider", providerCounts)}
    ${summaryList("Licenze", licenseCounts)}
    ${summaryList("Uso commerciale", commercialCounts)}
  </div>
  <table>
    <thead>
      <tr>
        <th>Titolo</th>
        <th>Autore</th>
        <th>Provider</th>
        <th>Genere</th>
        <th>Durata</th>
        <th>Licenza</th>
        <th>Commerciale</th>
        <th>Attribuzione</th>
        <th>Fonte</th>
        <th>Licenza URL</th>
        <th>Note diritti</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  downloadText(
    res,
    `clearwave-license-report-${exportStamp()}.html`,
    "text/html; charset=utf-8",
    html
  );
}

function localAudioPathForTrack(track) {
  const audioPath = String(track.audioPath || "");
  if (!audioPath.startsWith("/uploads/audio/")) {
    return null;
  }

  return resolveUploadPath(audioPath);
}

function serverPlayerSocketPath(runId = serverPlayer.runId || "main") {
  // Ogni avvio mpv ha un socket dedicato: cosi' un processo vecchio non scollega quello nuovo.
  const safeRunId = String(runId || "main").replace(/[^a-z0-9_-]/gi, "");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\clearwave-mpv-${safeRunId}`;
  }

  return path.join(os.tmpdir(), `clearwave-mpv-${safeRunId}.sock`);
}

function cleanupServerPlayerSocket(socketPath) {
  if (!socketPath || process.platform === "win32") {
    return;
  }

  try {
    fsSync.unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      serverPlayer.lastError = error.message;
    }
  }
}

function recordServerPlayerEvent(type, message, details = {}) {
  // Diagnostica breve per capire cosa e' successo senza rileggere tutti i log Docker.
  const event = {
    id: `${Date.now()}-${serverPlayer.events.length}`,
    at: new Date().toISOString(),
    type,
    message: String(message || "").slice(0, 600),
    details,
  };

  serverPlayer.events = [event, ...serverPlayer.events].slice(0, 40);
  return event;
}

function currentServerPlayerPosition() {
  if (!serverPlayer.activeTrack) {
    return 0;
  }

  if (serverPlayer.isPaused || !serverPlayer.startedAt) {
    return Math.max(0, serverPlayer.pausedAt || 0);
  }

  const elapsed = (Date.now() - serverPlayer.startedAt) / 1000;
  return Math.max(0, elapsed);
}

function serverPlayerStatus() {
  const position = currentServerPlayerPosition();
  const mpvVolume = serverPlayerMpvVolumePercent(serverPlayer.volume);
  return {
    available: process.env.CLEARWAVE_SERVER_PLAYER !== "0",
    command: serverPlayerCommand,
    runId: serverPlayer.runId,
    activeTrack: serverPlayer.activeTrack,
    duration: serverPlayer.duration,
    error: serverPlayer.lastError,
    isPlaying: Boolean(serverPlayer.activeTrack && serverPlayer.process && !serverPlayer.isPaused),
    isPaused: Boolean(serverPlayer.activeTrack && serverPlayer.isPaused),
    position,
    progress:
      serverPlayer.duration > 0 ? Math.min(100, (position / serverPlayer.duration) * 100) : 0,
    volume: Math.max(0, Math.min(100, serverPlayer.volume)),
    outputVolume: mpvVolume,
    volumeGain: serverPlayerVolumeGain,
    volumeMax: serverPlayerVolumeMax,
    audioOutput: serverPlayerAudioOutput,
    audioDevice: serverPlayerAudioDevice,
    alsaCard: serverPlayerAlsaCard,
    audioPreflight: serverPlayerAudioPreflight,
    lastExitCode: serverPlayer.lastExitCode,
    lastFailedTrack: serverPlayer.lastFailedTrack,
    ytdlFormat: serverPlayerYtdlFormat,
    ytdlPath: serverPlayerYtdlPath,
    ytdlCookiesConfigured: ytdlCookiesConfigured(),
    ytdlCookiesAvailable: Boolean(ytdlCookiesFileIfAvailable()),
    mpvMsgLevel: serverPlayerMpvMsgLevel,
    events: serverPlayer.events.slice(0, 20),
    playbackContext: {
      count: serverPlayer.playbackContext.tracks.length,
      index: serverPlayer.playbackContext.index,
      repeatMode: serverPlayer.playbackContext.repeatMode,
      shuffleEnabled: serverPlayer.playbackContext.shuffleEnabled,
      skippedCount: serverPlayer.playbackContext.skippedTrackIds.length,
      updatedAt: serverPlayer.playbackContext.updatedAt,
    },
  };
}

function diagnosticCommandResult(command, args = [], timeoutMs = 3500) {
  // Wrapper piccolo per diagnostica: raccoglie output breve senza bloccare il server.
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutId = null;

    const finish = (payload) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({
        command,
        args,
        durationMs: Date.now() - startedAt,
        stdout: stdout.trim().slice(0, 4000),
        stderr: stderr.trim().slice(0, 4000),
        ...payload,
      });
    };

    let processRef;
    try {
      processRef = spawn(command, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({ ok: false, error: error.message });
      return;
    }

    timeoutId = setTimeout(() => {
      try {
        processRef.kill("SIGTERM");
      } catch {
        // Il comando puo' essere gia' terminato.
      }
      finish({ ok: false, error: `Timeout dopo ${timeoutMs}ms.` });
    }, timeoutMs);

    processRef.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    processRef.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    processRef.once("error", (error) => finish({ ok: false, error: error.message }));
    processRef.once("exit", (code, signal) => {
      finish({ ok: code === 0, code, signal, error: code === 0 ? "" : `Codice uscita ${code ?? signal ?? "n/d"}.` });
    });
  });
}

async function readDiagnosticTextFile(filePath) {
  try {
    return (await fs.readFile(filePath, "utf8")).trim().slice(0, 4000);
  } catch (error) {
    return error.code === "ENOENT" ? "" : `Errore lettura ${path.basename(filePath)}: ${error.message}`;
  }
}

async function buildServerDiagnostics() {
  const audioConfigs = serverPlayerAudioConfigs();
  const preflightResults = [];
  const cookies = ytdlCookieStatus();
  const ytdlJsRuntimeCommand = ytdlJsRuntimeExecutable();

  for (const config of audioConfigs) {
    const result = await runServerPlayerAudioPreflight(config);
    preflightResults.push({
      label: config.label,
      ok: result.ok,
      message: result.message,
      args: config.args,
    });
  }

  const [mpv, ytdlp, ytdlJsRuntime, aplayList, aplayNames, asoundCards] = await Promise.all([
    diagnosticCommandResult(serverPlayerCommand, ["--version"], 3500),
    diagnosticCommandResult(serverPlayerYtdlPath, ["--version"], 5000),
    ytdlJsRuntimeCommand
      ? diagnosticCommandResult(ytdlJsRuntimeCommand, ["--version"], 5000)
      : Promise.resolve({ ok: false, command: "", args: [], error: "Runtime JavaScript yt-dlp non configurato." }),
    process.platform === "linux"
      ? diagnosticCommandResult("aplay", ["-l"], 3500)
      : Promise.resolve({ ok: false, command: "aplay", args: ["-l"], error: "Disponibile solo su Linux." }),
    process.platform === "linux"
      ? diagnosticCommandResult("aplay", ["-L"], 3500)
      : Promise.resolve({ ok: false, command: "aplay", args: ["-L"], error: "Disponibile solo su Linux." }),
    process.platform === "linux" ? readDiagnosticTextFile("/proc/asound/cards") : Promise.resolve(""),
  ]);

  return {
    runtime: {
      revision: SERVER_RUNTIME_REVISION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
    },
    config: {
      dataDir: DATA_DIR,
      playerCommand: serverPlayerCommand,
      audioOutput: serverPlayerAudioOutput || "auto",
      audioDevice: serverPlayerAudioDevice || "auto",
      alsaCard: serverPlayerAlsaCard || "auto",
      audioPreflight: serverPlayerAudioPreflight,
      audioPreflightTimeoutMs: serverPlayerAudioPreflightTimeoutMs,
      serverVolumeGain: serverPlayerVolumeGain,
      serverVolumeMax: serverPlayerVolumeMax,
      ytdlPath: serverPlayerYtdlPath,
      ytdlJsRuntime: serverPlayerYtdlJsRuntime,
      ytdlFormat: serverPlayerYtdlFormat,
      ytdlCookiesConfigured: cookies.configured,
      ytdlCookiesAvailable: cookies.available,
      ytdlCookiesPath: cookies.path,
      ytdlCookiesSource: cookies.source,
      ytdlCookieAnalysis: cookies.analysis,
      ytdlCookieProbeUrl: serverPlayerYtdlCookieProbeUrl,
      mpvMsgLevel: serverPlayerMpvMsgLevel,
      hasYouTubeApiKey: Boolean(youtubeApiKey),
      hasJamendoClientId: Boolean(jamendoClientId),
    },
    player: serverPlayerStatus(),
    audioCheck: automaticAudioCheck.status(),
    replacementList: await audioReplacementService.readList(),
    youtubeAudit: audioReplacementService.auditStatus(),
    audioConfigs: audioConfigs.map((config) => ({
      label: config.label,
      args: config.args,
    })),
    audioPreflight: preflightResults,
    tools: {
      mpv,
      ytdlp,
      ytdlJsRuntime,
    },
    alsa: {
      cards: asoundCards,
      listDevices: aplayList,
      listNames: aplayNames,
    },
  };
}

function absoluteInternalUrl(requestPath) {
  const port = Number(process.env.PORT) || 3000;
  return `http://127.0.0.1:${port}${requestPath}`;
}

function youtubeWatchUrl(track) {
  const videoId = firstString(track.youtubeVideoId);
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : "";
}

async function freshJamendoAudioSource(track) {
  const jamendoTrackId = jamendoTrackIdFromTrack(track);
  if (!jamendoClientId || !jamendoTrackId) {
    return "";
  }

  try {
    // Gli URL audio Jamendo possono essere firmati: al play chiediamo un link fresco invece
    // di fidarci sempre del vecchio audioPath salvato nel catalogo.
    const [freshTrack] = await fetchJamendoTrackLink(jamendoTrackId);
    return firstString(freshTrack?.audioPath);
  } catch (error) {
    serverPlayer.lastError = `Refresh Jamendo non riuscito: ${error.message || error}`;
    return "";
  }
}

async function serverPlayerSourceForTrack(track) {
  const normalized = attachComputedFields(track);
  const localAudioPath = localAudioPathForTrack(normalized);
  if (localAudioPath && fsSync.existsSync(localAudioPath)) {
    return localAudioPath;
  }

  const youtubeUrl = firstString(normalized.sourceUrl, youtubeWatchUrl(normalized));
  if (normalized.youtubeVideoId && youtubeUrl) {
    return youtubeUrl;
  }

  if (firstString(normalized.externalProvider) === "jamendo") {
    const freshJamendoUrl = await freshJamendoAudioSource(normalized);
    if (freshJamendoUrl) {
      return freshJamendoUrl;
    }
  }

  const streamPath = firstString(normalized.audioPath, normalized.playbackPath, normalized.previewPath);
  if (!streamPath) {
    throw httpError(400, "Questa traccia non ha una sorgente audio riproducibile dal server.");
  }

  if (/^https?:\/\//i.test(streamPath)) {
    return streamPath;
  }

  if (streamPath.startsWith("/")) {
    return absoluteInternalUrl(streamPath);
  }

  throw httpError(400, "Sorgente audio non valida per il player Raspberry.");
}

function normalizedMpvAudioDevice(value) {
  const device = firstString(value);
  if (!device) {
    return "";
  }

  if (/^(alsa\/|auto|pulse|pipewire|null|jack|oss|openal|wasapi|coreaudio)/i.test(device)) {
    return device;
  }

  if (/^(default|sysdefault|hw|plughw|dmix|front|iec958)(:|$)/i.test(device)) {
    return `alsa/${device}`;
  }

  return device;
}

function audioConfigWithDevice(label, device, baseArgs, env) {
  const normalizedDevice = normalizedMpvAudioDevice(device);
  return {
    args: normalizedDevice ? [...baseArgs, `--audio-device=${normalizedDevice}`] : [...baseArgs],
    env: { ...env },
    label: label || normalizedDevice || (serverPlayerAudioOutput ? `${serverPlayerAudioOutput}/default` : "audio/default"),
  };
}

function uniqueAudioConfigs(configs) {
  const seen = new Set();
  return configs.filter((config) => {
    const key = config.args.join("\u0000");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function serverPlayerAudioConfigs() {
  // Raspberry/ALSA puo' esporre card diverse: proviamo device esplicito, sysdefault e poi default.
  const baseArgs = [];
  const env = { ...process.env };

  if (serverPlayerAudioOutput) {
    baseArgs.push(`--ao=${serverPlayerAudioOutput}`);
  }

  if (serverPlayerAudioOutput && serverPlayerAudioOutput !== "alsa") {
    return [audioConfigWithDevice(serverPlayerAudioDevice || `${serverPlayerAudioOutput}/default`, serverPlayerAudioDevice, baseArgs, env)];
  }

  const configs = [];
  if (serverPlayerAudioDevice) {
    configs.push(audioConfigWithDevice(serverPlayerAudioDevice, serverPlayerAudioDevice, baseArgs, env));
  }

  if (serverPlayerAlsaCard) {
    if (/^\d+$/.test(serverPlayerAlsaCard)) {
      configs.push(
        audioConfigWithDevice(`alsa/sysdefault:CARD=${serverPlayerAlsaCard}`, `alsa/sysdefault:CARD=${serverPlayerAlsaCard}`, baseArgs, env),
        audioConfigWithDevice(`alsa/plughw:CARD=${serverPlayerAlsaCard},DEV=0`, `alsa/plughw:CARD=${serverPlayerAlsaCard},DEV=0`, baseArgs, env),
        audioConfigWithDevice(`alsa/plughw:${serverPlayerAlsaCard},0`, `alsa/plughw:${serverPlayerAlsaCard},0`, baseArgs, env)
      );
    } else {
      configs.push(
        audioConfigWithDevice(`alsa/sysdefault:CARD=${serverPlayerAlsaCard}`, `alsa/sysdefault:CARD=${serverPlayerAlsaCard}`, baseArgs, env),
        audioConfigWithDevice(`alsa/plughw:CARD=${serverPlayerAlsaCard},DEV=0`, `alsa/plughw:CARD=${serverPlayerAlsaCard},DEV=0`, baseArgs, env)
      );
    }
  }

  configs.push(
    audioConfigWithDevice("alsa/default-device", "alsa/default", baseArgs, env),
    audioConfigWithDevice("alsa/default-output", "", baseArgs, env)
  );
  return uniqueAudioConfigs(configs);
}

function ensureServerPlayerProbeFile() {
  const probePath = path.join(os.tmpdir(), "clearwave-audio-probe.wav");
  if (fsSync.existsSync(probePath)) {
    return probePath;
  }

  // WAV mono silenzioso: apre il device audio senza produrre suono udibile durante il test ALSA.
  const sampleRate = 8000;
  const sampleCount = Math.round(sampleRate * 0.16);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  fsSync.writeFileSync(probePath, buffer);
  return probePath;
}

function runServerPlayerAudioPreflight(audioConfig) {
  if (!serverPlayerAudioPreflight || process.platform === "win32") {
    return Promise.resolve({ ok: true, message: "" });
  }

  return new Promise((resolve) => {
    let probePath;
    try {
      probePath = ensureServerPlayerProbeFile();
    } catch (error) {
      resolve({ ok: false, message: `Probe audio non creata: ${error.message}` });
      return;
    }

    const args = [
      "--no-video",
      "--force-window=no",
      "--idle=no",
      "--no-config",
      "--load-scripts=no",
      "--volume=0",
      "--msg-level=all=warn",
      ...audioConfig.args,
      probePath,
    ];
    let output = "";
    let settled = false;

    const finish = (processRef, ok, message) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      if (!ok && processRef && processRef.exitCode === null) {
        try {
          processRef.kill("SIGTERM");
        } catch {
          // Il processo probe puo' essere gia' chiuso: l'esito sotto resta valido.
        }
      }
      resolve({ ok, message: serverPlayerFriendlyError(message || output).slice(0, 400) });
    };

    let processRef;
    try {
      processRef = spawn(serverPlayerCommand, args, {
        env: audioConfig.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ ok: false, message: error.message });
      return;
    }

    const timeoutId = setTimeout(() => {
      finish(processRef, false, `Probe audio timeout dopo ${serverPlayerAudioPreflightTimeoutMs}ms.`);
    }, serverPlayerAudioPreflightTimeoutMs);

    const collectOutput = (chunk) => {
      const message = String(chunk || "").trim();
      if (message) {
        output = `${output}\n${message}`.trim();
      }
    };

    processRef.stdout.on("data", collectOutput);
    processRef.stderr.on("data", collectOutput);
    processRef.once("error", (error) => finish(processRef, false, error.message));
    processRef.once("exit", (code) => {
      finish(processRef, code === 0, output || `mpv probe terminato con codice ${code ?? "sconosciuto"}.`);
    });
  });
}

function serverPlayerNeedsYtdl(source) {
  return /(?:youtube\.com|youtu\.be)/i.test(String(source || ""));
}

function serverPlayerYtdlConfig(source) {
  // YouTube cambia spesso formati disponibili: sul Raspberry chiediamo audio-only e yt-dlp recente.
  if (!serverPlayerNeedsYtdl(source)) {
    return ["--ytdl=no"];
  }

  const args = ["--ytdl=yes"];
  if (serverPlayerYtdlFormat) {
    args.push(`--ytdl-format=${serverPlayerYtdlFormat}`);
  }

  if (serverPlayerYtdlPath) {
    args.push(`--script-opts=ytdl_hook-ytdl_path=${serverPlayerYtdlPath}`);
  }

  const cookiesFile = ytdlCookiesFileIfAvailable();
  const rawOptions = [];
  if (serverPlayerYtdlJsRuntime) {
    rawOptions.push(`js-runtimes=${serverPlayerYtdlJsRuntime}`);
  }
  if (cookiesFile) {
    rawOptions.push(`cookies=${cookiesFile}`);
  }
  if (rawOptions.length > 0) {
    args.push(`--ytdl-raw-options=${rawOptions.join(",")}`);
  }

  return args;
}

function isServerPlayerErrorMessage(message) {
  return /error|failed|unable|denied|timeout|not available|unavailable|could not|no such|sign in|ao\/alsa|failed to|terminato/i.test(
    String(message || "")
  );
}

function isGenericMpvRecognitionFailure(message) {
  return /failed to recognize file format|youtube-dl failed: unexpected error/i.test(String(message || ""));
}

function isYouTubeAuthChallengeMessage(message) {
  return /sign in to confirm|not a bot|inappropriate for some users|use --cookies-from-browser|use --cookies|cookies-from-browser/i.test(
    String(message || "")
  );
}

function serverPlayerFriendlyError(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "";
  }

  if (isYouTubeAuthChallengeMessage(text)) {
    if (ytdlCookiesConfigured() && !ytdlCookiesFileIfAvailable()) {
      return "Cookie YouTube non trovato nel container: traccia saltata.";
    }
    return "YouTube login/bot: traccia saltata. Configura cookie o sostituiscila.";
  }

  if (/Unknown error 524|Playback open error|Could not open\/initialize audio device/i.test(text)) {
    return `${text} ALSA non riesce ad aprire quel device: lascia CLEARWAVE_AUDIO_DEVICE e ALSA_CARD vuoti oppure prova sysdefault/default dal Raspberry.`;
  }

  if (/alsa|audio output|audio device|ao\/alsa/i.test(text)) {
    return `${text} Controlla CLEARWAVE_AUDIO_DEVICE, ALSA_CARD e l'accesso Docker a /dev/snd sul Raspberry Pi.`;
  }

  if (
    /yt-dlp|youtube-dl|signature extraction|JavaScript runtime|js-runtimes|deno|video unavailable|sign in|requested format is not available|failed to recognize file format/i.test(
      text
    )
  ) {
    return `${text} Verifica yt-dlp, Deno/CLEARWAVE_YTDL_JS_RUNTIME, rete del container e CLEARWAVE_YTDL_FORMAT per i video YouTube.`;
  }

  return text;
}

function serverPlayerLogMessage(message) {
  const text = String(message || "").trim();
  if (isYouTubeAuthChallengeMessage(text)) {
    return serverPlayerFriendlyError(text);
  }
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
}

function rememberServerPlayerError(message) {
  const friendly = serverPlayerFriendlyError(message).slice(0, 400);
  if (!friendly) {
    return "";
  }

  if (
    isGenericMpvRecognitionFailure(message) &&
    /youtube.*(?:login|eta|bot)|cookie youtube|video non disponibile|formato|traccia saltata/i.test(serverPlayer.lastError)
  ) {
    return serverPlayer.lastError;
  }

  serverPlayer.lastError = friendly;
  return friendly;
}

function isServerPlayerSkippablePlaybackFailure(message, code, source) {
  const text = String(message || "");
  const isYouTubeSource = /youtube\.com|youtu\.be/i.test(String(source || ""));
  if (!isYouTubeSource || !code) {
    return false;
  }

  return /login\/conferma eta|youtube.*(?:login|eta|bot)|sign in to confirm|not a bot|inappropriate for some users|use --cookies|video unavailable|private video|requested format is not available|failed to recognize file format|youtube-dl failed/i.test(
    text
  );
}

function serverPlayerExitMessage(code, track, source) {
  const title = firstString(track?.title, track?.name, track?.id, "traccia sconosciuta");
  const normalizedSource = String(source || "");

  if (code === 4 && /youtube\.com|youtu\.be/i.test(normalizedSource)) {
    return `mpv ha saltato "${title}" con codice 4: sorgente YouTube non riproducibile, formato cambiato, video non disponibile o richiesta login/bot. Il backend prova a passare alla traccia successiva.`;
  }

  if (code === 4 && /jamendo|storage\.jamendo/i.test(normalizedSource)) {
    return `mpv ha saltato "${title}" con codice 4: stream Jamendo non apribile. Il backend prova a rinfrescare l'URL audio prima del play; se resta cosi', verifica JAMENDO_CLIENT_ID e rete del container.`;
  }

  if (code === 4) {
    return `mpv ha saltato "${title}" con codice 4: file/sorgente non apribile oppure output audio non disponibile.`;
  }

  if (code === 2) {
    return `mpv ha terminato "${title}" con codice 2: opzione o sorgente non accettata dal player.`;
  }

  return `mpv ha terminato "${title}" con codice ${code ?? "sconosciuto"}.`;
}

function stopServerPlayerProcess() {
  const processRef = serverPlayer.process;
  const socketPath = serverPlayer.socketPath;
  const stoppedTrack = serverPlayer.activeTrack;
  const stoppedRunId = serverPlayer.runId;

  if (processRef) {
    serverPlayer.isStopping = true;
    try {
      processRef.kill("SIGTERM");
    } catch {
      // Se mpv e' gia' terminato, puliamo comunque lo stato sotto.
    }
  }

  if (processRef && stoppedTrack) {
    recordServerPlayerEvent("stop", `Stop player: ${firstString(stoppedTrack.title, stoppedTrack.name, stoppedTrack.id)}`, {
      runId: stoppedRunId,
    });
  }

  cleanupServerPlayerSocket(socketPath);
  serverPlayer.process = null;
  serverPlayer.socketPath = "";
  serverPlayer.activeTrack = null;
  serverPlayer.startedAt = 0;
  serverPlayer.pausedAt = 0;
  serverPlayer.duration = 0;
  serverPlayer.isPaused = false;
  serverPlayer.isStopping = false;
  serverPlayer.lastExitCode = null;
  serverPlayer.lastFailedTrack = null;
}

function stopServerPlayerForPayload(payload = {}) {
  // Gli stop asincroni vecchi non devono spegnere un brano nuovo appena avviato.
  const expectedRunId = Number(payload?.runId) || 0;
  const expectedTrackId = firstString(payload?.trackId, payload?.expectedTrackId);
  const activeTrackId = firstString(serverPlayer.activeTrack?.id);
  if (expectedRunId && expectedRunId !== serverPlayer.runId) {
    return serverPlayerStatus();
  }

  if (expectedTrackId && activeTrackId && expectedTrackId !== activeTrackId) {
    return serverPlayerStatus();
  }

  stopServerPlayerProcess();
  serverPlayer.playbackContext = {
    tracks: [],
    index: -1,
    repeatMode: "off",
    shuffleEnabled: false,
    skippedTrackIds: [],
    updatedAt: new Date().toISOString(),
  };
  return serverPlayerStatus();
}

async function updateServerPlayerContextForPayload(req, payload = {}) {
  const activeTrack = serverPlayer.activeTrack || payload?.track;
  if (!activeTrack) {
    return serverPlayerStatus();
  }

  await updateServerPlayerPlaybackContext(req, activeTrack, payload);
  return serverPlayerStatus();
}

function waitForServerPlayerReady(processRef, socketPath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();
    const timeoutMs = 8000;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(timerId);
      processRef.off("error", onError);
      processRef.off("exit", onExit);
      callback(value);
    };

    const onError = (error) => finish(reject, error);
    const onExit = (code) => finish(reject, new Error(`mpv terminato subito con codice ${code ?? "sconosciuto"}.`));
    const timerId = setInterval(() => {
      if (process.platform === "win32" || fsSync.existsSync(socketPath)) {
        finish(resolve);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        finish(reject, new Error("Socket IPC mpv non disponibile entro 8 secondi."));
      }
    }, 90);

    processRef.once("error", onError);
    processRef.once("exit", onExit);
  });
}

function waitForServerPlayerStable(processRef, timeoutMs = 850) {
  return new Promise((resolve, reject) => {
    if (processRef.exitCode !== null || processRef.signalCode) {
      reject(new Error(`mpv terminato subito con codice ${processRef.exitCode ?? processRef.signalCode}.`));
      return;
    }

    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timerId);
      processRef.off("error", onError);
      processRef.off("exit", onExit);
      callback(value);
    };
    const onError = (error) => finish(reject, error);
    const onExit = (code) => finish(reject, new Error(`mpv terminato subito con codice ${code ?? "sconosciuto"}.`));
    const timerId = setTimeout(() => finish(resolve), timeoutMs);

    processRef.once("error", onError);
    processRef.once("exit", onExit);
  });
}

function sendMpvCommand(command) {
  return new Promise((resolve, reject) => {
    if (!serverPlayer.process || !serverPlayer.socketPath) {
      reject(httpError(409, "Player Raspberry non avviato."));
      return;
    }

    const socket = net.createConnection(serverPlayer.socketPath);
    const timeoutId = setTimeout(() => {
      socket.destroy();
      reject(httpError(504, "Timeout comunicazione con mpv."));
    }, 1400);

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ command })}\n`);
    });
    socket.once("data", (chunk) => {
      clearTimeout(timeoutId);
      socket.end();
      resolve(chunk);
    });
    socket.once("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function resolveServerPlayerTrack(req, payload) {
  if (payload?.serverAutoplay && payload?.track) {
    // Autoplay interno: il backend continua la coda anche quando il browser e' chiuso.
    return attachComputedFields(payload.track);
  }

  const user = requireAuthRequest(req);
  const trackId = firstString(payload?.trackId, payload?.track?.id);
  if (trackId) {
    const storedTrack = await findTrackById(trackId);
    if (storedTrack) {
      return attachComputedFields(storedTrack);
    }
  }

  if (payload?.track && user.role === "admin") {
    // Le tracce temporanee non sono nel catalogo: solo admin puo' mandarle al player server.
    return attachComputedFields(payload.track);
  }

  if (payload?.track) {
    throw httpError(403, "Solo admin puo' riprodurre sorgenti temporanee sul Raspberry.");
  }

  throw httpError(404, "Traccia non trovata per il player Raspberry.");
}

function isServerPlayerPlaySuperseded(playToken) {
  return playToken && playToken !== serverPlayer.playSequence;
}

function serverPlayerVolumePercentFromPayload(payload = {}, fallbackPercent = 75) {
  // React invia 0..1, ma accettiamo anche 0..100 per evitare errori da client/diagnostica futuri.
  const sourcePayload = payload || {};
  const explicitPercent = Number(sourcePayload.volumePercent);
  if (Number.isFinite(explicitPercent)) {
    return Math.round(Math.max(0, Math.min(100, explicitPercent)));
  }

  const rawVolume = Number(sourcePayload.volume);
  if (Number.isFinite(rawVolume)) {
    const asPercent = rawVolume > 1 ? rawVolume : rawVolume * 100;
    return Math.round(Math.max(0, Math.min(100, asPercent)));
  }

  return Math.round(Math.max(0, Math.min(100, Number(fallbackPercent) || 75)));
}

function serverPlayerMpvVolumePercent(userVolumePercent) {
  // Lo slider resta 0..100, ma sul Raspberry compensiamo la catena ALSA/mpv spesso piu' bassa del browser YouTube.
  const userVolume = Math.max(0, Math.min(100, Number(userVolumePercent) || 0));
  return Math.round(Math.max(0, Math.min(serverPlayerVolumeMax, userVolume * serverPlayerVolumeGain)));
}

function normalizedServerRepeatMode(value) {
  return value === "one" || value === "all" ? value : "off";
}

async function serverPlaybackContextTracks(payload = {}, user = null) {
  const context = payload?.serverContext || payload?.playbackContext || {};
  const requestedIds = Array.isArray(context.trackIds)
    ? context.trackIds.map((id) => firstString(id)).filter(Boolean).slice(0, 5000)
    : [];

  if (requestedIds.length > 0) {
    const library = await readLibrary();
    const byId = new Map(
      library
        .filter((track) => !isArchivedLibraryTrack(track))
        .map((track) => [firstString(track.id), attachComputedFields(track)])
    );
    return requestedIds.map((trackId) => byId.get(trackId)).filter(Boolean);
  }

  if (user?.role === "admin" && Array.isArray(context.tracks)) {
    // Solo admin puo' passare tracce temporanee complete; gli utenti normali usano id catalogo.
    return context.tracks
      .filter((track) => track && typeof track === "object" && !Array.isArray(track))
      .slice(0, 500)
      .map((track) => attachComputedFields(normalizeTrack(track)));
  }

  return [];
}

async function updateServerPlayerPlaybackContext(req, activeTrack, payload = {}) {
  const user = req ? requireAuthRequest(req) : { role: "admin" };
  const context = payload?.serverContext || payload?.playbackContext || {};
  const tracks = await serverPlaybackContextTracks(payload, user);
  const activeTrackId = firstString(activeTrack?.id);
  let contextTracks = tracks;

  if (activeTrackId && !contextTracks.some((track) => firstString(track.id) === activeTrackId)) {
    contextTracks = [attachComputedFields(activeTrack), ...contextTracks];
  }

  if (contextTracks.length === 0 && activeTrack) {
    contextTracks = [attachComputedFields(activeTrack)];
  }

  const index = Math.max(
    0,
    contextTracks.findIndex((track) => firstString(track.id) === activeTrackId)
  );

  serverPlayer.playbackContext = {
    tracks: contextTracks,
    index,
    repeatMode: normalizedServerRepeatMode(context.repeatMode),
    shuffleEnabled: Boolean(context.shuffleEnabled),
    skippedTrackIds: [],
    updatedAt: new Date().toISOString(),
  };

  recordServerPlayerEvent("context", `Contesto server aggiornato: ${contextTracks.length} tracce`, {
    index,
    repeatMode: serverPlayer.playbackContext.repeatMode,
    shuffleEnabled: serverPlayer.playbackContext.shuffleEnabled,
  });
  return serverPlayer.playbackContext;
}

function nextServerPlaybackContextTrack(options = {}) {
  const context = serverPlayer.playbackContext;
  const tracks = Array.isArray(context.tracks) ? context.tracks : [];
  if (tracks.length === 0) {
    return null;
  }

  const skipTrackId = firstString(options.skipTrackId);
  const skippedTrackIds = new Set(Array.isArray(context.skippedTrackIds) ? context.skippedTrackIds : []);
  if (skipTrackId) {
    skippedTrackIds.add(skipTrackId);
    context.skippedTrackIds = [...skippedTrackIds];
  }

  const isSkippedIndex = (index) => skippedTrackIds.has(firstString(tracks[index]?.id));
  if (tracks.every((_, index) => isSkippedIndex(index))) {
    return null;
  }

  if (!skipTrackId && context.repeatMode === "one" && !isSkippedIndex(Math.max(0, context.index))) {
    return tracks[Math.max(0, context.index)] || tracks[0];
  }

  let nextIndex = context.index + 1;
  if (context.shuffleEnabled && tracks.length > 1) {
    const currentIndex = Math.max(0, context.index);
    let guard = 0;
    do {
      nextIndex = Math.floor(Math.random() * tracks.length);
      guard += 1;
    } while ((nextIndex === currentIndex || isSkippedIndex(nextIndex)) && guard < tracks.length * 2);
  }

  for (let guard = 0; guard < tracks.length; guard += 1) {
    if (nextIndex >= tracks.length) {
      if (context.repeatMode !== "all") {
        return null;
      }
      nextIndex = 0;
    }

    if (!isSkippedIndex(nextIndex)) {
      context.index = nextIndex;
      context.updatedAt = new Date().toISOString();
      return tracks[nextIndex] || null;
    }

    nextIndex += 1;
  }

  return null;
}

function scheduleServerPlayerAutoplay(previousRunId, options = {}) {
  setTimeout(() => {
    if (serverPlayer.process || serverPlayer.runId !== previousRunId) {
      return;
    }

    const nextTrack = nextServerPlaybackContextTrack({ skipTrackId: options.skipTrackId });
    if (!nextTrack) {
      recordServerPlayerEvent(
        options.reason === "skip" ? "skip" : "complete",
        options.reason === "skip"
          ? "Traccia non riproducibile saltata, ma non ci sono altre tracce disponibili."
          : "Coda server completata: nessuna traccia successiva."
      );
      return;
    }

    recordServerPlayerEvent(
      options.reason === "skip" ? "skip" : "autoplay",
      `${options.reason === "skip" ? "Salto traccia non riproducibile, prossima" : "Avvio automatico server"}: ${firstString(
        nextTrack.title,
        nextTrack.id
      )}`,
      {
        runId: previousRunId,
        failedTrackId: options.skipTrackId || "",
      }
    );
    void enqueueServerPlayerPlay(null, {
      track: nextTrack,
      startAt: 0,
      volumePercent: serverPlayer.volume,
      serverAutoplay: true,
    }).catch((error) => {
      serverPlayer.lastError = serverPlayerFriendlyError(error.message || error).slice(0, 400);
      recordServerPlayerEvent("error", serverPlayer.lastError);
    });
  }, 350);
}

function enqueueServerPlayerPlay(req, payload) {
  // Serializza gli avvii mpv: se React manda piu' Play ravvicinati, vince solo l'ultimo comando.
  const playToken = serverPlayer.playSequence + 1;
  serverPlayer.playSequence = playToken;

  const queuedPlay = serverPlayer.playQueue
    .catch(() => serverPlayerStatus())
    .then(() => {
      if (isServerPlayerPlaySuperseded(playToken)) {
        return serverPlayerStatus();
      }

      return playOnServerPlayer(req, payload, playToken);
    });

  serverPlayer.playQueue = queuedPlay.catch(() => serverPlayerStatus());
  return queuedPlay;
}

async function playOnServerPlayer(req, payload, playToken = 0) {
  if (process.env.CLEARWAVE_SERVER_PLAYER === "0") {
    throw httpError(503, "Player Raspberry disattivato da CLEARWAVE_SERVER_PLAYER=0.");
  }

  const track = await resolveServerPlayerTrack(req, payload);
  if (!payload?.serverAutoplay) {
    await updateServerPlayerPlaybackContext(req, track, payload);
  }
  const source = await serverPlayerSourceForTrack(track);
  if (isServerPlayerPlaySuperseded(playToken)) {
    return serverPlayerStatus();
  }

  const startAt = Math.max(0, Number(payload?.startAt) || 0);
  const volume = serverPlayerVolumePercentFromPayload(payload, serverPlayer.volume);
  const mpvVolume = serverPlayerMpvVolumePercent(volume);
  const duration = parseDurationSeconds(track.duration || track.durationSeconds);
  const audioConfigs = serverPlayerAudioConfigs();
  const ytdlArgs = serverPlayerYtdlConfig(source);

  stopServerPlayerProcess();
  const runId = serverPlayer.runId + 1;
  serverPlayer.runId = runId;
  const baseArgs = [
    "--no-video",
    "--force-window=no",
    "--idle=no",
    ...ytdlArgs,
    "--cache=yes",
    `--msg-level=${serverPlayerMpvMsgLevel}`,
    `--volume-max=${serverPlayerVolumeMax}`,
    `--volume=${mpvVolume}`,
  ];

  if (startAt > 0) {
    baseArgs.push(`--start=${startAt}`);
  }

  let lastStartError = "";

  for (let attemptIndex = 0; attemptIndex < audioConfigs.length; attemptIndex += 1) {
    const audioConfig = audioConfigs[attemptIndex];
    const socketPath = serverPlayerSocketPath(`${runId}-${attemptIndex + 1}`);
    cleanupServerPlayerSocket(socketPath);

    const args = [
      ...baseArgs,
      `--input-ipc-server=${socketPath}`,
      ...audioConfig.args,
      source,
    ];

    const attemptLabel =
      audioConfigs.length > 1 ? `${audioConfig.label} tentativo ${attemptIndex + 1}/${audioConfigs.length}` : audioConfig.label;

    if (isServerPlayerPlaySuperseded(playToken)) {
      return serverPlayerStatus();
    }

    const preflight = await runServerPlayerAudioPreflight(audioConfig);
    if (!preflight.ok) {
      lastStartError = preflight.message;
      console.log(`[server-player] Device audio scartato (${attemptLabel}): ${preflight.message}`);
      recordServerPlayerEvent("warn", `Device audio scartato (${attemptLabel})`, {
        message: preflight.message,
      });
      continue;
    }

    if (isServerPlayerPlaySuperseded(playToken)) {
      return serverPlayerStatus();
    }

    console.log(`[server-player] Avvio mpv (${attemptLabel}): ${serverPlayerCommand} ${args.join(" ")}`);
    recordServerPlayerEvent("start", `Avvio: ${firstString(track.title, track.name, track.id)}`, {
      runId,
      audio: attemptLabel,
      sourceType: serverPlayerNeedsYtdl(source) ? "youtube" : "direct",
      volume,
      mpvVolume,
    });

    let processRef;
    try {
      processRef = spawn(serverPlayerCommand, args, {
        env: audioConfig.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      lastStartError = error.message;
      serverPlayer.lastError = error.message;
      recordServerPlayerEvent("error", `mpv non avviato: ${error.message}`, { runId, audio: attemptLabel });
      continue;
    }

    serverPlayer.process = processRef;
    serverPlayer.runId = runId;
    serverPlayer.socketPath = socketPath;
    serverPlayer.activeTrack = track;
    serverPlayer.startedAt = Date.now() - startAt * 1000;
    serverPlayer.pausedAt = startAt;
    serverPlayer.duration = duration;
    serverPlayer.isPaused = false;
    serverPlayer.lastError = "";
    serverPlayer.lastExitCode = null;
    serverPlayer.lastFailedTrack = null;
    serverPlayer.volume = volume;

    processRef.stdout.on("data", (chunk) => {
      if (serverPlayer.process !== processRef || serverPlayer.runId !== runId) {
        return;
      }

      const message = String(chunk || "").trim();
      if (message) {
        if (isServerPlayerErrorMessage(message)) {
          const rememberedError = rememberServerPlayerError(message);
          recordServerPlayerEvent("error", rememberedError, { runId, stream: "stdout" });
        }
        console.log(`[server-player] mpv stdout: ${serverPlayerLogMessage(message)}`);
      }
    });
    processRef.stderr.on("data", (chunk) => {
      if (serverPlayer.process !== processRef || serverPlayer.runId !== runId) {
        return;
      }

      const message = String(chunk || "").trim();
      if (message) {
        if (isServerPlayerErrorMessage(message)) {
          const rememberedError = rememberServerPlayerError(message);
          recordServerPlayerEvent("error", rememberedError, { runId, stream: "stderr" });
        }
        console.log(`[server-player] mpv stderr: ${serverPlayerLogMessage(message)}`);
      }
    });
    processRef.once("exit", (code) => {
      cleanupServerPlayerSocket(socketPath);
      const shouldAutoplayNext = code === 0 && !serverPlayer.isStopping;
      if (serverPlayer.process !== processRef || serverPlayer.runId !== runId) {
        console.log(
          `[server-player] mpv precedente chiuso per cambio traccia/comando (codice ${code ?? "n/d"})`
        );
        recordServerPlayerEvent("switch", "mpv precedente chiuso per cambio traccia/comando", {
          runId,
          code,
        });
        return;
      }

      if (code && !serverPlayer.isStopping) {
        const exitMessage = serverPlayerFriendlyError(firstString(serverPlayer.lastError, serverPlayerExitMessage(code, track, source)));
        const shouldSkipFailure = isServerPlayerSkippablePlaybackFailure(exitMessage, code, source);
        serverPlayer.lastError = exitMessage.slice(0, 400);
        serverPlayer.lastExitCode = code;
        serverPlayer.lastFailedTrack = {
          id: firstString(track?.id),
          title: firstString(track?.title, track?.name, "Traccia senza titolo"),
        };
        console.log(`[server-player] Traccia non riprodotta: ${exitMessage}`);
        recordServerPlayerEvent("error", exitMessage, {
          runId,
          code,
          trackId: firstString(track?.id),
        });
        if (shouldSkipFailure) {
          recordServerPlayerEvent("skip", `Traccia YouTube saltata automaticamente: ${firstString(track?.title, track?.id)}`, {
            runId,
            code,
            trackId: firstString(track?.id),
          });
        }
      } else {
        const completedTitle = firstString(track?.title, track?.name, "traccia");
        console.log(
          code === 0
            ? `[server-player] mpv ha completato "${completedTitle}" correttamente (codice 0)`
            : `[server-player] mpv terminato con codice ${code ?? "sconosciuto"}`
        );
        recordServerPlayerEvent(code === 0 ? "complete" : "exit", `mpv terminato: ${completedTitle}`, {
          runId,
          code,
        });
      }

      if (!serverPlayer.isStopping) {
        serverPlayer.activeTrack = null;
        serverPlayer.duration = 0;
        serverPlayer.process = null;
        serverPlayer.socketPath = "";
        serverPlayer.isPaused = false;
        serverPlayer.startedAt = 0;
        serverPlayer.pausedAt = 0;
      }

      const shouldSkipFailure = code && !serverPlayer.isStopping && isServerPlayerSkippablePlaybackFailure(serverPlayer.lastError, code, source);
      if (shouldAutoplayNext || shouldSkipFailure) {
        scheduleServerPlayerAutoplay(runId, {
          reason: shouldSkipFailure ? "skip" : "complete",
          skipTrackId: shouldSkipFailure ? firstString(track?.id) : "",
        });
      }
    });

    try {
      await waitForServerPlayerReady(processRef, socketPath);
      await waitForServerPlayerStable(processRef);
      if (isServerPlayerPlaySuperseded(playToken)) {
        stopServerPlayerProcess();
        return serverPlayerStatus();
      }

      return serverPlayerStatus();
    } catch (error) {
      lastStartError = firstString(serverPlayer.lastError, error.message);
      console.log(`[server-player] Tentativo audio fallito (${audioConfig.label}): ${lastStartError}`);
      recordServerPlayerEvent("error", `Tentativo audio fallito (${audioConfig.label}): ${lastStartError}`, {
        runId,
      });
      stopServerPlayerProcess();
    }
  }

  serverPlayer.lastError = serverPlayerFriendlyError(lastStartError).slice(0, 400);
  throw httpError(503, `Player Raspberry non avviato: ${serverPlayer.lastError || "nessun device audio disponibile."}`);
}

async function pauseServerPlayer(payload) {
  const paused = payload?.paused !== false;
  const currentPosition = currentServerPlayerPosition();
  await sendMpvCommand(["set_property", "pause", paused]);
  serverPlayer.isPaused = paused;
  serverPlayer.pausedAt = currentPosition;
  serverPlayer.startedAt = paused ? 0 : Date.now() - currentPosition * 1000;
  recordServerPlayerEvent(paused ? "pause" : "resume", paused ? "Player in pausa" : "Player ripreso", {
    position: Math.round(currentPosition),
  });
  return serverPlayerStatus();
}

async function seekServerPlayer(payload) {
  const seconds = Math.max(0, Number(payload?.seconds) || 0);
  await sendMpvCommand(["seek", seconds, "absolute"]);
  serverPlayer.pausedAt = seconds;
  serverPlayer.startedAt = serverPlayer.isPaused ? 0 : Date.now() - seconds * 1000;
  recordServerPlayerEvent("seek", `Seek a ${Math.round(seconds)}s`, { seconds: Math.round(seconds) });
  return serverPlayerStatus();
}

async function volumeServerPlayer(payload) {
  const volume = serverPlayerVolumePercentFromPayload(payload, serverPlayer.volume);
  const mpvVolume = serverPlayerMpvVolumePercent(volume);
  serverPlayer.volume = volume;
  if (serverPlayer.process) {
    await sendMpvCommand(["set_property", "volume", mpvVolume]);
  }
  recordServerPlayerEvent("volume", `Volume server ${volume}% (mpv ${mpvVolume}%)`, {
    volume,
    mpvVolume,
    gain: serverPlayerVolumeGain,
  });
  return serverPlayerStatus();
}

async function serveTrackDownload(res, track) {
  const localAudioPath = localAudioPathForTrack(track);

  if (localAudioPath) {
    try {
      const extension =
        path.extname(track.audioOriginalName || "") || path.extname(localAudioPath) || ".bin";
      await serveFileDownload(res, localAudioPath, `${slugify(track.title)}${extension}`);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const audioBuffer = buildPreviewWavBuffer(track);
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": contentDisposition(`${slugify(track.title)}-preview.wav`),
    "Content-Type": "audio/wav",
  });
  res.end(audioBuffer);
}

async function proxyAudiusStream(res, audiusTrackId) {
  if (!audiusApiKey) {
    throw httpError(400, "AUDIUS_API_KEY non configurato.");
  }

  const url = new URL(`https://api.audius.co/v1/tracks/${encodeURIComponent(audiusTrackId)}/stream`);
  const response = await fetch(url, {
    headers: audiusHeaders(),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  if (!response.ok || !response.body) {
    throw httpError(response.status || 502, "Stream Audius non disponibile.");
  }

  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": response.headers.get("content-type") || "audio/mpeg",
  });

  for await (const chunk of response.body) {
    res.write(chunk);
  }

  res.end();
}

function resolveUploadPath(requestPath) {
  const relative = requestPath.replace(/^\/uploads\//, "");
  const resolved = path.normalize(path.join(UPLOADS_DIR, relative));
  if (!isPathInsideDirectory(UPLOADS_DIR, resolved)) {
    throw httpError(403, "Percorso non consentito.");
  }
  return resolved;
}

function resolveAssetPath(requestPath) {
  const relative = requestPath.replace(/^\/assets\//, "");
  const resolved = path.normalize(path.join(ASSETS_DIR, relative));
  if (!isPathInsideDirectory(ASSETS_DIR, resolved)) {
    throw httpError(403, "Percorso non consentito.");
  }
  return resolved;
}

function resolveSourcePath(requestPath) {
  const relative = requestPath.replace(/^\/src\//, "");
  const resolved = path.normalize(path.join(SRC_DIR, relative));
  if (!isPathInsideDirectory(SRC_DIR, resolved) || path.extname(resolved) !== ".js") {
    throw httpError(403, "Percorso non consentito.");
  }
  return resolved;
}

function resolveStylesPath(requestPath) {
  const relative = requestPath.replace(/^\/styles\//, "");
  const resolved = path.normalize(path.join(STYLES_DIR, relative));
  if (!isPathInsideDirectory(STYLES_DIR, resolved) || path.extname(resolved) !== ".css") {
    throw httpError(403, "Percorso stile non consentito.");
  }
  return resolved;
}

function resolveStaticPath(requestPath) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  if (!publicFiles.has(safePath)) {
    throw httpError(404, "Risorsa non trovata.");
  }
  const resolved = path.normalize(path.join(ROOT_DIR, safePath));
  if (!isPathInsideDirectory(ROOT_DIR, resolved)) {
    throw httpError(403, "Percorso non consentito.");
  }
  return resolved;
}

async function requestHandler(req, res) {
  // Router HTTP minimale senza framework: ogni blocco gestisce una famiglia di endpoint.
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const previewMatch = pathname.match(/^\/api\/tracks\/([^/]+)\/preview\.wav$/);
  const downloadMatch = pathname.match(/^\/api\/tracks\/([^/]+)\/download$/);
  const deleteTrackMatch = pathname.match(/^\/api\/tracks\/([^/]+)$/);
  const deleteUserMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  const resetUserPasswordMatch = pathname.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  const audiusStreamMatch = pathname.match(/^\/api\/providers\/audius\/([^/]+)\/stream$/);
  const jamendoCoverMatch = pathname.match(/^\/api\/covers\/jamendo\/([0-9]+)\.jpg$/);

  try {
    if (
      req.method === "GET" &&
      (pathname === "/" || pathname === "/index.html" || pathname === "/react" || pathname.startsWith("/react/"))
    ) {
      // La UI principale e' React: la legacy resta disponibile piu' sotto su /legacy.
      await serveReactApp(res, pathname);
      return;
    }

    if (req.method === "GET" && (pathname === "/legacy" || pathname === "/legacy/" || pathname === "/legacy/index.html")) {
      await serveIndexHtml(res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      // Ritorna null se non c'e' sessione: il frontend decide se mostrare la login page.
      json(res, 200, { user: authUserFromRequest(req) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const payload = await readJsonBody(req);
      json(res, 200, loginAuthUser(payload));
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const token = getBearerToken(req);
      logoutAuthToken(token);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/change-password") {
      const payload = await readJsonBody(req);
      json(res, 200, { user: changeAuthPassword(req, payload) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/server-player/status") {
      requireAuthRequest(req);
      json(res, 200, { player: serverPlayerStatus() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/server-player/play") {
      const payload = await readJsonBody(req);
      json(res, 200, { player: await enqueueServerPlayerPlay(req, payload) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/server-player/pause") {
      requireAuthRequest(req);
      const payload = await readJsonBody(req);
      json(res, 200, { player: await pauseServerPlayer(payload) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/server-player/seek") {
      requireAuthRequest(req);
      const payload = await readJsonBody(req);
      json(res, 200, { player: await seekServerPlayer(payload) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/server-player/volume") {
      requireAuthRequest(req);
      const payload = await readJsonBody(req);
      json(res, 200, { player: await volumeServerPlayer(payload) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/server-player/context") {
      requireAuthRequest(req);
      const payload = await readJsonBody(req);
      json(res, 200, { player: await updateServerPlayerContextForPayload(req, payload) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/server-player/stop") {
      requireAuthRequest(req);
      const payload = await readJsonBody(req);
      json(res, 200, { player: stopServerPlayerForPayload(payload) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/diagnostics") {
      requireAdminRequest(req);
      json(res, 200, { diagnostics: await buildServerDiagnostics() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/audio-check/youtube-login-recheck") {
      requireAdminRequest(req);
      const result = await audioReplacementService.recheckYouTubeLoginFailures();
      json(res, 200, { ...result, diagnostics: await buildServerDiagnostics() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/audio-check/youtube-full-audit") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      const result = audioReplacementService.startFullYouTubeAudit(payload);
      json(res, 202, { ...result, diagnostics: await buildServerDiagnostics() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/audio-check/cleanup-broken") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      const result = await audioReplacementService.cleanupHardBrokenTracks(payload);
      json(res, 200, { ...result, diagnostics: await buildServerDiagnostics() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/audio-check/recheck-archived") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      const result = await audioReplacementService.recheckArchivedTracks(payload);
      json(res, 200, { ...result, diagnostics: await buildServerDiagnostics() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/audio-check/youtube-full-audit") {
      requireAdminRequest(req);
      json(res, 200, {
        audit: audioReplacementService.auditStatus(),
        replacementList: await audioReplacementService.readList(),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/youtube-cookies") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      const result = await installYtdlCookies(payload);
      json(res, 200, { ...result, diagnostics: await buildServerDiagnostics() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/youtube-cookies/status") {
      requireAdminRequest(req);
      json(res, 200, { cookies: ytdlCookieStatus() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/youtube-cookies/probe") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      const result = await probeYtdlCookies(payload);
      json(res, 200, { ...result, diagnostics: await buildServerDiagnostics() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/youtube-import-state/reset") {
      requireAdminRequest(req);
      json(res, 200, await resetYouTubeImportState());
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/export/catalog.json") {
      requireAdminRequest(req);
      await serveCatalogBackup(res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/import/catalog-backup") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      json(res, 200, await importCatalogBackup(payload));
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/export/licenses.csv") {
      requireAdminRequest(req);
      await serveLicenseReportCsv(res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/export/licenses.html") {
      requireAdminRequest(req);
      await serveLicenseReportHtml(res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/users") {
      requireAdminRequest(req);
      json(res, 200, { users: listAuthUsers() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/users") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      json(res, 201, createAuthUser(payload));
      return;
    }

    if (req.method === "POST" && resetUserPasswordMatch) {
      requireAdminRequest(req);
      json(res, 200, resetAuthUserPassword(req, decodeURIComponent(resetUserPasswordMatch[1])));
      return;
    }

    if (req.method === "DELETE" && deleteUserMatch) {
      requireAdminRequest(req);
      const removedUser = deleteAuthUser(req, decodeURIComponent(deleteUserMatch[1]));
      json(res, 200, { ok: true, user: removedUser });
      return;
    }

    if (req.method === "GET" && jamendoCoverMatch) {
      await serveJamendoCover(res, jamendoCoverMatch[1]);
      return;
    }

    if (req.method === "GET" && pathname === "/api/tracks") {
      // Con page/limit/q/genre/source la paginazione e' lato server; senza parametri resta compatibile.
      const tracks = await readLibrary();
      json(res, 200, catalogPageResponse(tracks, url.searchParams, { attachComputedFields }));
      return;
    }

    if (req.method === "GET" && previewMatch) {
      const trackId = decodeURIComponent(previewMatch[1]);
      const track = await findTrackById(trackId);
      if (!track) {
        throw httpError(404, "Traccia non trovata.");
      }

      const audioBuffer = buildPreviewWavBuffer(track);
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "audio/wav",
      });
      res.end(audioBuffer);
      return;
    }

    if (req.method === "GET" && downloadMatch) {
      const trackId = decodeURIComponent(downloadMatch[1]);
      const track = await findTrackById(trackId);
      if (!track) {
        throw httpError(404, "Traccia non trovata.");
      }

      await serveTrackDownload(res, track);
      return;
    }

    if (req.method === "GET" && audiusStreamMatch) {
      await proxyAudiusStream(res, decodeURIComponent(audiusStreamMatch[1]));
      return;
    }

    if (req.method === "GET" && pathname === "/api/discovery/providers") {
      // Utile alla UI per mostrare quali sorgenti hanno chiavi configurate.
      json(res, 200, { providers: buildDiscoveryProviders() });
      return;
    }

      if (req.method === "GET" && pathname === "/api/discovery/search") {
      requireAdminRequest(req);
      const providerId = url.searchParams.get("provider") || "all";
      const query = url.searchParams.get("q") || "";
      const limit = url.searchParams.get("limit") || "8";
      const rightsMode = url.searchParams.get("rights_mode") || "public_domain_only";
      const result = await searchDiscoveryProviders({
        providerId,
        query,
        limit,
        rightsMode,
      });

        json(res, 200, {
          provider: providerId,
          query,
          rightsMode,
          items: result.items.map(attachComputedFields),
          errors: result.errors,
          providers: result.providers,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/tracks") {
        requireAdminRequest(req);
        const payload = await readJsonBody(req);
        const tracks = await readLibrary();
        const createdTrack = await createTrackFromPayload(payload);
        const nextTracks = [createdTrack, ...tracks];
        await writeLibrary(nextTracks);
        json(res, 201, { track: attachComputedFields(createdTrack) });
        return;
      }

      if (req.method === "DELETE" && deleteTrackMatch) {
        requireAdminRequest(req);
        const trackId = decodeURIComponent(deleteTrackMatch[1]);
        const tracks = await readLibrary();
        const nextTracks = tracks.filter((track) => track.id !== trackId);
        if (nextTracks.length === tracks.length) {
          throw httpError(404, "Traccia non trovata.");
        }

        await writeLibrary(nextTracks);
        json(res, 200, { ok: true, removedId: trackId });
        return;
      }

      if (req.method === "POST" && pathname === "/api/discovery/import") {
        requireAdminRequest(req);
        const payload = await readJsonBody(req);
        const tracks = await readLibrary();
        const importedTrack = await importDiscoveryTrack(payload);
        const nextTracks = [importedTrack, ...tracks];
        await writeLibrary(nextTracks);
        json(res, 201, { track: attachComputedFields(importedTrack) });
        return;
      }

      if (req.method === "POST" && pathname === "/api/discovery/bulk-import") {
        requireAdminRequest(req);
        const payload = await readJsonBody(req);
        const result = await bulkImportDiscoveryTracks(payload);
        json(res, 201, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/discovery/import-link") {
        requireAdminRequest(req);
        const payload = await readJsonBody(req);
        const result = await importDiscoveryLink(payload);
        json(res, 201, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/session/import-link") {
        requireAdminRequest(req);
        const payload = await readJsonBody(req);
        const result = await importSessionLink(payload);
        json(res, 201, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/covers/generate") {
        json(res, 410, {
          error: "Generazione copertine rimossa: ClearWave usa solo artwork originali dei provider o fallback grafici locali.",
        });
        return;
      }

    if (req.method === "GET" && pathname.startsWith("/uploads/")) {
      const filePath = resolveUploadPath(pathname);
      await serveFile(res, filePath);
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/assets/")) {
      const filePath = resolveAssetPath(pathname);
      await serveFile(res, filePath);
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/src/")) {
      const filePath = resolveSourcePath(pathname);
      await serveFile(res, filePath);
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/styles/")) {
      const filePath = resolveStylesPath(pathname);
      await serveFile(res, filePath);
      return;
    }

    if (req.method === "GET") {
      const filePath = resolveStaticPath(pathname);
      await serveFile(res, filePath);
      return;
    }

    throw httpError(404, "Risorsa non trovata.");
  } catch (error) {
    if (error.code === "ENOENT") {
      json(res, 404, { error: "Risorsa non trovata." });
      return;
    }

    const status = error.status || 500;
    json(res, status, { error: error.message || "Errore interno del server." });
  }
}

function createAppServer() {
  return http.createServer(requestHandler);
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;

  ensureStorage()
    .then(() => {
      createAppServer().listen(port, () => {
        const cookies = ytdlCookieStatus();
        console.log(`ClearWave Library attiva su http://localhost:${port}`);
        console.log(
          `[server-player] Runtime ${SERVER_RUNTIME_REVISION}: queue=on, preflight=${
            serverPlayerAudioPreflight ? "on" : "off"
          }, output=${serverPlayerAudioOutput || "auto"}, device=${serverPlayerAudioDevice || "auto"}, alsaCard=${
            serverPlayerAlsaCard || "auto"
          }, fallback=${serverPlayerAudioConfigs()
            .map((config) => config.label)
            .join(" -> ")}`
        );
        console.log(
          `[server-player] Cookie YouTube: ${
            cookies.available
              ? `attivi (${cookies.source})`
              : cookies.configured
                ? `configurati ma non leggibili: ${cookies.path}`
                : `non configurati, percorso automatico: ${DEFAULT_YTDL_COOKIES_FILE}`
          }`
        );

        if (process.env.CLEARWAVE_AUTO_EXPAND === "1") {
          setTimeout(() => {
            bulkImportDiscoveryTracks({
              includeYouTubeChannels: true,
              limitPerQuery: 8,
              maxTracks: 60,
              youtubeChannelMaxPages: 12,
              youtubeRestartCompleted: true,
              youtubeScanMultiplier: 8,
              includeYouTubePlaylists: true,
              youtubePlaylistScanLimit: 24,
              youtubePlaylistItemsPerPlaylist: 80,
            })
              .then((result) => {
                console.log(
                  `Auto-import libreria completato: ${result.importedCount} nuove tracce, ${result.scanned} risultati letti.`
                );
                if (result.errors.length > 0) {
                  console.log(
                    `Auto-import con avvisi: ${result.errors
                      .map((entry) => `${entry.provider}: ${entry.message}`)
                      .join(" | ")}`
                  );
                }
              })
              .catch((error) => {
                console.error("Auto-import libreria non riuscito:", error.message || error);
              });
          }, 800);
        }

        automaticAudioCheck.schedule();
      });
    })
    .catch((error) => {
      console.error("Impossibile avviare il server:", error);
      process.exitCode = 1;
    });
}

module.exports = {
  AUDIO_DIR,
  ASSETS_DIR,
  COVERS_DIR,
  DATA_DIR,
  LICENSES_DIR,
  UPLOADS_DIR,
  createAppServer,
  bulkImportDiscoveryTracks,
  importDiscoveryLink,
  importSessionLink,
  ensureStorage,
};
