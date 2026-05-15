# Configurazione API e chiavi

Questo progetto usa le API esterne solo dal backend Node, cioe' da `server.js`.
Il browser non deve mai contenere chiavi API reali.

## Dove inserire le chiavi

Per uso locale su Windows, il punto piu' semplice e' `start-local.ps1`.
Quel file contiene segreti personali ed e' escluso da git tramite `.gitignore`.

Per creare un nuovo ambiente:

1. Copia `start-local.example.ps1`.
2. Rinominalo in `start-local.ps1`.
3. Inserisci le chiavi reali nei valori `INSERISCI_...`.
4. Avvia con `npm start`.

Esempio:

```powershell
Copy-Item .\start-local.example.ps1 .\start-local.ps1
notepad .\start-local.ps1
npm start
```

## Variabili ambiente supportate

| Variabile | Dove viene letta | A cosa serve |
| --- | --- | --- |
| `JAMENDO_CLIENT_ID` | `server.js` | Ricerca e import di brani Jamendo con filtro commerciale. |
| `YOUTUBE_API_KEY` | `server.js` | Lettura video, playlist e canali YouTube whitelist tramite YouTube Data API. |
| `AUDIUS_API_KEY` | `server.js` | Ricerca/stream Audius, da usare solo con verifica licenza creator. |
| `THEAUDIODB_API_KEY` | `server.js` | Metadati artisti/immagini, non audio commercial-safe. |
| `CLEARWAVE_ADMIN_PASSWORD` | `server.js` | Password iniziale del primo admin quando SQLite viene creato da zero. |
| `CLEARWAVE_DATA_DIR` | `server.js` | Percorso alternativo per `library.json`, SQLite e stato import. |
| `CLEARWAVE_UPLOADS_DIR` | `server.js` | Percorso alternativo per audio/licenze caricati. |
| `CLEARWAVE_ENABLE_DEMOS` | `server.js` | Se `1`, reinserisce demo locali. In produzione tienilo `0`. |
| `CLEARWAVE_AUTO_EXPAND` | `server.js` | Se `1`, prova un piccolo auto-import all'avvio. |
| `CLEARWAVE_DOCKER_PRIVILEGED` | `docker-compose.yml` | Su Raspberry conviene `true` per dare al container accesso ai device audio host. |
| `CLEARWAVE_AUDIO_CHECK_ENABLED` | `server.js` | Se `1`, abilita il controllo automatico catalogo in background. |
| `CLEARWAVE_AUDIO_CHECK_ON_START` | `server.js` | Se `1`, lancia il primo controllo dopo l'avvio. |
| `CLEARWAVE_AUDIO_CHECK_MODE` | `tools/check-library-audio.js` | Modalita `source`, `metadata` o `probe`; default `probe`. |
| `CLEARWAVE_AUDIO_CHECK_INTERVAL_HOURS` | `server.js` | Ogni quante ore ripetere il controllo automatico, default `24`. |
| `CLEARWAVE_AUDIO_CHECK_CONCURRENCY` | `tools/check-library-audio.js` | Numero controlli paralleli, default `2`. |
| `CLEARWAVE_SERVER_PLAYER` | `server.js` | Se `1`, abilita il controllo `mpv` lato server/Raspberry. |
| `CLEARWAVE_PLAYER_COMMAND` | `server.js` | Comando usato per il player server-side, default `mpv`. |
| `CLEARWAVE_SERVER_VOLUME` | `server.js` | Volume iniziale del player Raspberry, 0-100. |
| `CLEARWAVE_SERVER_VOLUME_GAIN` | `server.js` | Moltiplicatore volume mpv per compensare Raspberry/ALSA rispetto al browser, default `1.15`. |
| `CLEARWAVE_SERVER_VOLUME_MAX` | `server.js` | Massimo volume mpv dopo il gain, default `130`. |
| `CLEARWAVE_AUDIO_OUTPUT` | `server.js` | Output mpv, default `alsa`. |
| `CLEARWAVE_AUDIO_DEVICE` | `server.js` | Device mpv completo, per esempio `alsa/sysdefault:CARD=1` o `alsa/default`. |
| `CLEARWAVE_AUDIO_PREFLIGHT` | `server.js` | Se `1`, prova in silenzio il device ALSA prima di avviare la canzone. |
| `CLEARWAVE_AUDIO_PREFLIGHT_TIMEOUT_MS` | `server.js` | Timeout del probe audio ALSA, default `2500`. |
| `ALSA_CARD` | Docker/Raspberry | Scheda audio ALSA opzionale. Se vuota usa il default ALSA del Raspberry. |
| `CLEARWAVE_YTDLP_DOWNLOAD_URL` | Docker | URL del binario yt-dlp scaricato in build e all'avvio; default nightly per ricevere prima i fix YouTube/PO token. |
| `CLEARWAVE_YTDL_COOKIES_FILE` | `server.js` | File cookie YouTube Netscape nel container. Se vuoto, ClearWave usa automaticamente `/app/data/youtube-cookies.txt` quando il file esiste. |
| `CLEARWAVE_YTDL_JS_RUNTIME` | `server.js`, `tools/check-library-audio.js` | Runtime JavaScript per `yt-dlp`, default `deno:/usr/local/bin/deno`. Serve quando YouTube richiede decifratura JS. |
| `CLEARWAVE_YTDL_EXTRACTOR_ARGS` | `server.js`, `tools/check-library-audio.js` | Argomenti extractor per `yt-dlp`, default `youtube:player_client=mweb` quando il provider PO token e' attivo. |
| `CLEARWAVE_YTDL_PO_TOKEN` | `server.js`, `tools/check-library-audio.js` | PO token opzionale per yt-dlp quando YouTube rifiuta gli stream firmati anche con cookie validi. Viene mascherato nei log e nei report. |
| `CLEARWAVE_YTDL_PO_TOKEN_CLIENT` | `server.js`, `tools/check-library-audio.js` | Contesto del PO token, default `mweb.gvs`; se il token contiene gia' `mweb.gvs+...`, ClearWave lo usa cosi'. |
| `CLEARWAVE_YTDL_BGUTIL_PROVIDER` | Docker, `server.js`, `tools/check-library-audio.js` | Se `1`, avvia e usa il provider PO token bgutil nello stesso container per ridurre i `403` YouTube/GVS. |
| `CLEARWAVE_YTDL_BGUTIL_PORT` | Docker, `server.js` | Porta locale del provider bgutil, default `4416`. |
| `CLEARWAVE_YTDL_BGUTIL_BASE_URL` | Docker, `server.js`, `tools/check-library-audio.js` | URL locale del provider bgutil HTTP passato esplicitamente a `yt-dlp`, default `http://127.0.0.1:4416`. |
| `CLEARWAVE_YTDL_FALLBACK_PROFILES` | `server.js` | Se `1`, prova profili YouTube alternativi quando il profilo principale cade subito con errore stream. |
| `CLEARWAVE_YOUTUBE_START_STABLE_MS` | `server.js` | Millisecondi di stabilita' iniziale prima di considerare riuscito un avvio YouTube, default `12000`. |
| `CLEARWAVE_YTDL_COOKIE_PROBE_URL` | `server.js` | Video pubblico usato dal pulsante admin `Test cookie YouTube` per verificare se i cookie sono accettati dal Raspberry. |
| `CLEARWAVE_YTDL_COOKIE_EXPIRY_WARNING_DAYS` | `server.js`, React | Giorni prima della scadenza dei cookie YouTube in cui mostrare un popup admin ricorrente, default `14`. |
| `CLEARWAVE_YOUTUBE_LOGIN_RECHECK_LIMIT` | `lib/audio-replacement-service.js` | Numero massimo di tracce YouTube/login ricontrollate dal pulsante admin, default `80`. |
| `CLEARWAVE_YOUTUBE_ARCHIVED_RECHECK_LIMIT` | `lib/audio-replacement-service.js` | Numero massimo di tracce YouTube archiviate riverificate con i cookie attuali, default `120`. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_MODE` | `lib/audio-replacement-service.js` | Modalita della verifica completa YouTube da pannello Admin: `metadata` consigliata, `probe` piu' severa, `source` solo rapido. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_CONCURRENCY` | `lib/audio-replacement-service.js` | Numero di controlli YouTube paralleli per l'audit completo, default `5`. Se il Raspberry accumula molti `timeout`, scendi temporaneamente a `3` o `2`. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_TIMEOUT_MS` | `lib/audio-replacement-service.js` | Timeout per singola traccia nell'audit completo, default `25000`. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_SAMPLE_SECONDS` | `lib/audio-replacement-service.js` | Secondi di campione quando l'audit usa `probe`, default `4`. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_LIMIT` | `lib/audio-replacement-service.js` | Limite opzionale per test; `0` controlla tutto il catalogo YouTube. |
| `CLEARWAVE_MPV_MSG_LEVEL` | `server.js` | Livello log passato a `mpv`, default `all=warn,ytdl_hook=info`. |
| `PORT` | `server.js` | Porta del server, default `3000`. |

## Dove sono nel codice

Le variabili vengono lette all'inizio di `server.js`:

```js
const jamendoClientId = process.env.JAMENDO_CLIENT_ID || process.env.JAMIENDO_CLIENT_ID;
const audioDbApiKey = process.env.THEAUDIODB_API_KEY || process.env.AUDIODB_API_KEY;
const audiusApiKey = process.env.AUDIUS_API_KEY;
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
const serverPlayerCommand = process.env.CLEARWAVE_PLAYER_COMMAND || "mpv";
```

## Provider attivi

### Jamendo

- Funzioni principali: `searchJamendo`, `fetchJamendoTrackLink`, `mapJamendoTrack`.
- Endpoint usati lato server: `https://api.jamendo.com/v3.0/tracks/`.
- Nota licenza: il backend filtra risultati compatibili, ma prima dell'uso commerciale va conservata prova della licenza finale.

### YouTube

- Funzioni principali: `searchYouTubeCurated`, `fetchYouTubePlaylistLink`, `fetchYouTubeCuratedChannelBackfill`, `mapYouTubeCuratedVideo`.
- Endpoint usati lato server: YouTube Data API v3.
- Canali whitelist per import permanente: NoCopyrightSounds (`UC_aEa8K-EOJ3D6gOs7HcyNg`), Infraction - No Copyright Music (`UCkRrhwhJ2Ia_ZlkTQ4XFWJA`), BreakingCopyright - Royalty Free Music (`UCUFDNffZtBGisDliMx12fYw`).
- `Importa lotto` legge questi canali in modo progressivo: conserva il cursore in `data/youtube-import-state.json`, scansiona piu' video dei brani richiesti per superare duplicati gia' presenti, legge anche una selezione profonda di playlist pubbliche del canale e riparte dall'inizio se YouTube rifiuta un vecchio page token. La UI forza anche la riscan degli upload completati, per non trattare `completed` come "catalogo del canale esaurito".
- La UI admin permette lotti da 120, 250 o 500 tracce: valori piu' alti leggono piu' risultati e consumano piu' quota YouTube.
- Il pannello admin puo' azzerare lo stato import YouTube: viene creato un backup del file stato e il lotto successivo riparte dai canali whitelist dall'inizio.
- Nota licenza: YouTube non permette download audio via Data API. ClearWave riproduce con embed interno e conserva metadata/link.

### Audius

- Funzioni principali: `searchAudius`, `proxyAudiusStream`, `mapAudiusTrack`.
- Nota licenza: Audius e' user-generated. Importare solo con licenza esplicita del creator.

### TheAudioDB

- Funzioni principali: `searchTheAudioDb`, `mapTheAudioDbArtist`.
- Nota licenza: TheAudioDB fornisce metadata/immagini, non file audio royalty-free.

## Regola importante

Non inserire chiavi API in:

- `frontend/`
- `src/` lato browser
- `partials/`
- `styles/`
- file committati su git

Le chiavi devono restare in variabili ambiente, script locali ignorati o secret manager.

## Avvio senza chiavi

Il progetto puo' partire anche senza chiavi API esterne.

In quel caso:

- `GET /api/health` funziona comunque;
- il catalogo locale continua a funzionare;
- gli upload manuali continuano a funzionare;
- i provider non configurati vengono mostrati come non disponibili;
- discovery/import da provider esterni puo' restituire pochi risultati o errori controllati.

Questa modalita' e' utile per lavorare su UI, auth, player e documentazione senza consumare quota API.

## Script locali

`start-local.example.ps1` e' il template sicuro.

`start-local.ps1` e' il file privato della macchina locale. Puo' contenere:

- chiavi API reali;
- porta locale;
- flag demo/import automatico;
- password iniziale admin.

Il file e' ignorato da git. Se devi condividere il progetto, condividi il template e non il file privato.

## Flag runtime

### `CLEARWAVE_ENABLE_DEMOS`

Se vale `1`, il backend puo' inizializzare tracce demo quando crea il catalogo da zero.

Per un catalogo pulito usa:

```powershell
$env:CLEARWAVE_ENABLE_DEMOS = "0"
```

### `CLEARWAVE_AUTO_EXPAND`

Se vale `1`, il backend puo' provare piccoli import automatici all'avvio.

Per lavorare senza chiamate esterne usa:

```powershell
$env:CLEARWAVE_AUTO_EXPAND = "0"
```

### `CLEARWAVE_AUDIO_CHECK_ENABLED`

Se vale `1`, il backend avvia in background `tools/check-library-audio.js` senza bloccare l'app.
Con le impostazioni predefinite fa un controllo `probe` dopo l'avvio e poi ogni 24 ore.
I report finiscono in `data/reports/`.

```env
CLEARWAVE_AUDIO_CHECK_ENABLED=1
CLEARWAVE_AUDIO_CHECK_MODE=probe
CLEARWAVE_AUDIO_CHECK_INTERVAL_HOURS=24
```

### `CLEARWAVE_SERVER_PLAYER`

Se vale `1`, il backend espone il player Raspberry e puo' avviare `mpv`.
La diagnostica admin `/api/admin/diagnostics` mostra versione `mpv`, versione `yt-dlp`, device ALSA, preflight audio e ultimo errore player senza mostrare segreti API.

In Docker su Raspberry usa un solo file Compose:

```bash
docker compose up -d --build
```

Per disattivarlo in ambienti senza audio server:

```powershell
$env:CLEARWAVE_SERVER_PLAYER = "0"
```

## Rotazione chiavi

Se una chiave API viene cambiata:

1. aggiorna `start-local.ps1` o il secret manager;
2. riavvia il backend;
3. controlla `GET /api/discovery/providers`;
4. prova una ricerca piccola prima di lanciare import a lotti.

Non serve rebuild React: le chiavi sono lette solo dal backend.
