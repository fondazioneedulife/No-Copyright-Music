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
| `CLEARWAVE_SERVER_PLAYER` | `server.js` | Se `1`, abilita il controllo `mpv` lato server/Raspberry. |
| `CLEARWAVE_PLAYER_COMMAND` | `server.js` | Comando usato per il player server-side, default `mpv`. |
| `CLEARWAVE_SERVER_VOLUME` | `server.js` | Volume iniziale del player Raspberry, 0-100. |
| `CLEARWAVE_AUDIO_OUTPUT` | `server.js` | Output mpv, default `alsa`. |
| `CLEARWAVE_AUDIO_DEVICE` | `server.js` | Device mpv completo, per esempio `alsa/sysdefault:CARD=1` o `alsa/default`. |
| `CLEARWAVE_AUDIO_PREFLIGHT` | `server.js` | Se `1`, prova in silenzio il device ALSA prima di avviare la canzone. |
| `CLEARWAVE_AUDIO_PREFLIGHT_TIMEOUT_MS` | `server.js` | Timeout del probe audio ALSA, default `2500`. |
| `ALSA_CARD` | Docker/Raspberry | Scheda audio ALSA opzionale. Se vuota usa il default ALSA del Raspberry. |
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
- Canali whitelist: NoCopyrightSounds, Infraction, BreakingCopyright.
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

### `CLEARWAVE_SERVER_PLAYER`

Se vale `1`, il backend espone il player Raspberry e puo' avviare `mpv`.

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
