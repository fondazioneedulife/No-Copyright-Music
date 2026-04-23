let tracks = [];
let sessionUser = "";
let sessionTracks = [];
let discoveryProviders = [];
let discoveryResults = [];
let state = loadState();
let audioContext;
let synthPreview = null;
let activePlayback = null;
let embeddedTimerId = null;
let embeddedEndTimerId = null;
let shuffleQueueIds = [];
let externalRiskAccepted = false;
let pendingExternalTrackId = "";
let authToken = window.localStorage.getItem(authTokenStorageKey) || "";
let authenticatedUser = null;
let contextMenuTrackId = "";
let playbackAdvanceScheduled = false;

const externalRiskWarningText =
  "Hey, stai per riprodurre una canzone esterna non verificata nel catalogo commercial-safe. Potrebbe avere copyright o limiti di licenza: ti assumi tu il rischio della riproduzione. Quando hai finito, esci dalla sessione e pulisci le canzoni temporanee.";

const audioPreview = new Audio();
audioPreview.preload = "none";
audioPreview.volume = state.playerVolume;
audioPreview.addEventListener("play", () => {
  renderPlayer();
});
audioPreview.addEventListener("pause", () => {
  renderPlayer();
});
audioPreview.addEventListener("timeupdate", () => {
  renderPlayer();
});
audioPreview.addEventListener("loadedmetadata", () => {
  renderPlayer();
});
audioPreview.addEventListener("durationchange", () => {
  renderPlayer();
});
audioPreview.addEventListener("ended", () => {
  void handlePlaybackEnded();
});

