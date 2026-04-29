# ClearWave Library

ClearWave e' una web app locale per catalogare, cercare, importare e riprodurre musica da usare in contesti commerciali, con attenzione a licenze, fonti e prove di utilizzo.

Il progetto contiene:

- backend Node locale senza framework;
- UI React principale su `http://localhost:3000`, `http://localhost:3000/react/` o in dev su `http://localhost:5173`;
- UI legacy di fallback su `http://localhost:3000/legacy`;
- autenticazione locale con SQLite;
- gestione utenti/admin;
- catalogo JSON locale;
- import da Jamendo e YouTube whitelist;
- supporto provider Audius e TheAudioDB;
- upload manuale audio e licenze;
- player globale browser/Raspberry, con audio server-side tramite `mpv`;
- documentazione tecnica e operativa.

## Avvio rapido

Apri PowerShell nella cartella del progetto e avvia:

```powershell
npm start
```

Poi apri:

```text
http://localhost:3000
```

Per sviluppare la UI React:

```powershell
npm run dev
```

Poi apri:

```text
http://localhost:5173
```

`npm run dev` avvia il backend su `3000` e React su `5173`. Le chiamate `http://localhost:5173/api/...` vengono collegate al backend tramite proxy Vite.

Per generare la build React servita dal backend come UI principale:

```powershell
npm run build:react
npm start
```

Poi apri:

```text
http://localhost:3000/react/
http://localhost:3000
```

## Accesso

Al primo avvio il backend crea un admin solo se il database SQLite non esiste ancora.

Valori iniziali in sviluppo:

- username: `admin`
- password: valore di `CLEARWAVE_ADMIN_PASSWORD`, oppure `admin123`

Dopo il primo login cambia subito password da Impostazioni.

## Comandi disponibili

| Comando | Cosa fa |
| --- | --- |
| `npm start` | Avvia `start-local.ps1`, imposta variabili ambiente locali e avvia `server.js`. |
| `npm run start:plain` | Avvia solo `node server.js`. |
| `npm run dev` | Avvia backend e React insieme; usa `5173` per la UI e proxy `/api` verso `3000`. |
| `npm run dev:react` | Avvia Vite per la UI React. |
| `npm run build:react` | Genera `frontend/dist/` con base `/react/`. |
| `npm run preview:react` | Anteprima Vite della build React. |
| `npm run docker:build` | Costruisce l'immagine Docker locale. |
| `npm run docker:up` | Avvia ClearWave con Docker Compose. |
| `npm run docker:down` | Ferma il servizio Docker Compose senza cancellare `data/` e `uploads/`. |

## Struttura essenziale

| Percorso | Descrizione |
| --- | --- |
| `server.js` | Backend, API, import, auth, storage e static serving. |
| `index.html` | Template della UI legacy. |
| `partials/` | Blocchi HTML della UI legacy. |
| `src/` | Logica browser della UI legacy. |
| `styles/` | Stili e temi della UI legacy. |
| `frontend/` | UI React/Vite principale. |
| `assets/` | Asset statici e copertine locali. |
| `data/` | File runtime: catalogo, SQLite e stato import. |
| `uploads/` | Audio e licenze caricati. |
| `docs/` | Documentazione completa del progetto. |
| `Dockerfile` | Immagine Docker multi-stage con build React e runtime Node. |
| `docker-compose.yml` | Unico file Compose: avvio container, variabili ambiente e opzioni Raspberry audio. |

## Documentazione

Leggi in questo ordine:

1. `docs/MAPPA_PROGETTO.md`: cosa contiene ogni file/cartella.
2. `docs/ARCHITETTURA.md`: come funzionano backend, UI, storage, auth e provider.
3. `docs/FLUSSI_OPERATIVI.md`: come usare l'app nelle operazioni reali.
4. `docs/ENDPOINT_API.md`: elenco e contratto degli endpoint locali.
5. `docs/CONFIGURAZIONE_API.md`: chiavi API, variabili ambiente e provider esterni.
6. `docs/GUIDA_SVILUPPATORE.md`: regole pratiche per modificare codice e UI.
7. `docs/DOCKER.md`: build e avvio del progetto in container.
8. `docs/RAPPORTO_MIGRAZIONE_REACT_RASPBERRY.md`: riepilogo del lavoro fatto su React, player Raspberry e Docker.

## Docker

Per provare ClearWave in container:

```powershell
docker compose up --build
```

Poi apri:

```text
http://localhost:3000
http://localhost:3000/react/
http://localhost:3000/legacy
```

Per configurare chiavi API in Docker:

```powershell
Copy-Item .\.env.example .\.env
notepad .\.env
docker compose up -d --build
```

Docker monta le cartelle locali `./data` e `./uploads`: il container usa lo stesso catalogo del progetto e non riparte vuoto.

Per usare il Raspberry come uscita audio, usa sempre lo stesso `docker-compose.yml`:

```bash
docker compose up -d --build
```

Nel file `.env` del Raspberry imposta:

```env
CLEARWAVE_DOCKER_PRIVILEGED=true
CLEARWAVE_AUDIO_OUTPUT=alsa
ALSA_CARD=
CLEARWAVE_YTDL_PATH=/usr/bin/yt-dlp
CLEARWAVE_YTDL_FORMAT=bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best
```

Nel player React seleziona `Pi`: da quel momento il browser comanda il backend e la musica esce dal Raspberry, non dal PC.
Se nei log vedi `Requested format is not available`, rebuilda e ricrea il container: il Dockerfile installa `yt-dlp` aggiornato e il backend forza un formato YouTube audio-only. Per evitare la cache Docker, il container prova anche ad aggiornare `/usr/bin/yt-dlp` ad ogni avvio quando `CLEARWAVE_UPDATE_YTDLP_ON_START=1`.

## Backend in breve

`server.js` espone:

- `GET /api/health`;
- API autenticazione sotto `/api/auth/...`;
- API utenti sotto `/api/users`;
- API catalogo sotto `/api/tracks`;
- API discovery/import sotto `/api/discovery/...`;
- API player Raspberry sotto `/api/server-player/...`;
- media dinamici come preview WAV, download e proxy copertine;
- UI React da `/` e `/react/`;
- UI legacy di fallback da `/legacy`.

Le API admin richiedono token `Authorization: Bearer <token>` di un utente con ruolo `admin`.

## React in breve

La UI React usa:

- `frontend/src/App.jsx` per stato globale;
- `frontend/src/api/client.js` per fetch API;
- `frontend/src/components/` per sezioni UI;
- `frontend/src/styles/app.css` per layout e tema.

Funzioni React attuali:

- login/logout;
- catalogo filtrabile con paginazione lato server;
- coda;
- player con uscita `Pi` server-side o `PC` browser;
- tema dark/light;
- gestione utenti admin;
- import sicuro da Jamendo/YouTube whitelist;
- playlist YouTube temporanea admin con pulizia al logout e fallback `yt-dlp` per liste non lette dalla Data API;
- archivio licenze e upload manuale;
- reset password temporanea;
- cambio password.

## UI legacy in breve

La UI legacy usa:

- `partials/` per HTML;
- `src/config.js` e `src/runtime.js` per stato;
- `src/auth.js` per sessione e utenti;
- `src/catalog.js` e `src/render.js` per catalogo;
- `src/imports.js` per discovery/import;
- `src/player-*` per player;
- `styles/` per tema.

Resta come riferimento storico/fallback. La UI principale da usare e dockerizzare e' React.

## Storage locale

Il backend crea e usa:

| Percorso | Contenuto |
| --- | --- |
| `data/library.json` | Catalogo brani importati o caricati. |
| `data/clearwave-auth.sqlite` | Utenti, ruoli e hash password. |
| `data/youtube-import-state.json` | Avanzamento import progressivo YouTube. |
| `uploads/audio/` | Audio caricati manualmente. |
| `uploads/licenses/` | Licenze, ricevute e allegati diritti. |

Questi file sono esclusi da git.

## Chiavi API

Le chiavi reali non devono stare nel frontend o nella documentazione.

Per l'ambiente locale crea `start-local.ps1` partendo da:

```powershell
Copy-Item .\start-local.example.ps1 .\start-local.ps1
```

Poi inserisci li' le variabili:

- `JAMENDO_CLIENT_ID`;
- `YOUTUBE_API_KEY`;
- `AUDIUS_API_KEY`;
- `THEAUDIODB_API_KEY`;
- `CLEARWAVE_ADMIN_PASSWORD`.

## Verifiche rapide

Backend:

```powershell
node --check server.js
npm start
```

React:

```powershell
npm --prefix frontend run build
```

Smoke test:

```text
GET http://localhost:3000/api/health
GET http://localhost:3000/api/tracks?page=1&limit=20
```

## Nota licenze

ClearWave aiuta a organizzare musica commercial-safe, ma non sostituisce una verifica legale.

Per uso commerciale conserva sempre:

- fonte originale;
- autore/canale;
- licenza dichiarata;
- data di verifica;
- prova licenza o screenshot;
- ricevuta/acquisto se presente.

"Royalty-free" non significa automaticamente "senza copyright".
