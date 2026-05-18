# Mappa del progetto

Questa pagina spiega cosa contiene ogni area del progetto ClearWave e quando conviene modificarla.

## Radice

| Percorso | Ruolo |
| --- | --- |
| `server.js` | Backend Node locale. Serve HTML, asset, API JSON, catalogo, import provider, autenticazione SQLite e build React. |
| `package.json` | Script principali del progetto: avvio backend, dev React, build React e preview. |
| `index.html` | Template della UI legacy. Usa commenti `@include` per inserire i partial HTML. |
| `app.js` | Bootstrap della UI legacy: applica tema, collega eventi, verifica sessione, carica catalogo e provider. |
| `styles.css` | Entry point CSS legacy. Importa i CSS sotto `styles/`. |
| `.gitignore` | Esclude file runtime, database, upload, build React, dipendenze e script con segreti locali. |
| `.dockerignore` | Esclude dati runtime, segreti e dipendenze locali dal contesto Docker. |
| `Dockerfile` | Build multi-stage: compila React e prepara il runtime Node del container. |
| `docker-compose.yml` | Unico file Compose: avvia ClearWave, definisce volumi, env e opzioni audio Raspberry. |
| `.env.example` | Template per configurare Docker Compose senza esporre segreti reali. |
| `start-local.example.ps1` | Template sicuro per creare `start-local.ps1`. |
| `start-local.ps1` | Script locale privato con variabili ambiente. Non va condiviso e non va committato. |

## Backend

Il backend resta senza framework, ma le parti piu' delicate vengono separate in moduli piccoli.
`server.js` mantiene router HTTP, storage e player; `lib/` contiene logiche riusabili.

| Area | Cosa fa |
| --- | --- |
| Costanti iniziali | Definiscono cartelle, file runtime, chiavi API lette da `process.env`, provider e limiti import. |
| Seed/demo | Contiene tracce demo e varianti, usate solo se `CLEARWAVE_ENABLE_DEMOS=1`. |
| Provider discovery | Costruisce la lista provider disponibili e marca quelli configurati con chiavi API. |
| Autenticazione | Hash password, SQLite utenti, login, logout, cambio password, reset password e cancellazione utenti. |
| Storage catalogo | Legge e scrive `data/library.json`, normalizza le tracce, verifica i generi da tag espliciti/metadata e aggiunge campi calcolati. |
| Copertine | Sceglie copertine locali, thumbnail provider o proxy Jamendo. |
| Preview audio | Genera una preview WAV sintetica quando non esiste audio diretto. |
| Player server | API `/api/server-player/...`, processo `mpv`, seek, pausa, volume e stop sul Raspberry. |
| Import provider | Cerca e importa da Jamendo, YouTube whitelist, Audius e TheAudioDB. |
| Import link | Interpreta URL Jamendo/YouTube e importa uno o piu' brani. |
| Static serving | Serve `index.html`, partial, JS, CSS, asset, upload e build React. |
| Router HTTP | La funzione `requestHandler(req, res)` collega metodi e URL alle funzioni sopra. |

Moduli backend estratti:

| Modulo | Ruolo |
| --- | --- |
| `lib/audio-check-service.js` | Configura, schedula e monitora il check automatico del catalogo audio. |
| `lib/audio-replacement-service.js` | Ricontrolla errori YouTube/login, avvia l'audit completo YouTube e mantiene la lista runtime delle tracce da sostituire. |
| `lib/auth-service.js` | SQLite utenti, hash password, token sessione, ruoli admin/user e cambio password. |
| `lib/catalog-page.js` | Filtri, facets e paginazione server-side di `GET /api/tracks`. |
| `lib/youtube-cache-service.js` | Cache locale dei brani YouTube whitelist: scarica audio con `yt-dlp`, salva in `uploads/audio/youtube-cache` e aggiorna `audioPath` nel catalogo. |
| `lib/ytdl-cookie-service.js` | Gestisce cookies.txt YouTube: validazione Netscape, upload admin, stato diagnostico, probe account e opzioni comuni per `yt-dlp`. |
| `lib/ytdl-options.js` | Costruisce opzioni `yt-dlp`/`mpv` condivise da backend e audit catalogo: PO token, bgutil, escaping `--ytdl-raw-options` e mascheramento segreti. |

## UI legacy

La UI legacy e' servita come fallback da `http://localhost:3000/legacy`.

### `partials/`

| File | Ruolo |
| --- | --- |
| `app-shell.html` | Contenitore base della pagina legacy. |
| `main-shell.html` | Layout centrale della pagina. |
| `topbar.html` | Barra alta, ricerca e comandi principali. |
| `sidebar.html` | Navigazione laterale, account e scorciatoie. |
| `hero.html` | Sezione introduttiva e metriche principali. |
| `catalog.html` | Griglia catalogo e filtri. |
| `playlists.html` | Playlist automatiche e raccolte derivate dal catalogo. |
| `discovery.html` | Ricerca provider, import lotto e import da link. |
| `settings.html` | Gestione utenti, account e password nella UI legacy. |
| `studio.html` | Contenitore area avanzata/studio. |
| `studio-upload.html` | Upload manuale audio e licenze. |
| `studio-compliance.html` | Area note licenza e compliance. |
| `studio-archive.html` | Archivio e report dei brani. |
| `right-rail.html` | Colonna laterale informativa. |
| `overlays.html` | Login gate, menu contestuali e overlay. |
| `player.html` | Player globale inferiore. |
| `scripts.html` | Caricamento ordinato degli script legacy. |

### `src/`

| File | Ruolo |
| --- | --- |
| `config.js` | Costanti browser, stato iniziale, riferimenti DOM e icone player. |
| `runtime.js` | Variabili runtime condivise: catalogo, sessione, player, coda, token e risultati discovery. |
| `state.js` | Lettura/scrittura dello stato browser in `localStorage`. |
| `shared.js` | Helper comuni: escape HTML, formattazione, select, status e testi import. |
| `auth.js` | Login, logout, cambio password, gestione account/admin e tema legacy. |
| `library.js` | Caricamento catalogo e provider discovery dal backend. |
| `catalog.js` | Filtri, preferiti, coda, playlist automatiche e menu contestuale. |
| `render.js` | Rendering catalogo, playlist, coda, metriche, report, archivio e risultati discovery. |
| `events.js` | Binding dei controlli UI e delega eventi. |
| `imports.js` | Ricerca provider, import da risultato, import da link, session import, bulk import e delete track. |
| `upload.js` | Upload manuale di tracce, audio e allegati licenza. |
| `player-core.js` | Stato base del player e gestione audio/embed/synth. |
| `player-playback.js` | Play, pausa, traccia successiva, repeat, shuffle e fine traccia. |
| `player-controls.js` | Controlli player: volume, seek, shuffle e repeat. |
| `player-render.js` | Rendering del player globale e aggiornamento icone/stato. |
| `player.js` | Piccolo entry point del player legacy. |

## UI React

La UI React e' la UI principale. In sviluppo gira su `http://localhost:5173`, dopo build viene servita da `http://localhost:3000` e anche da `http://localhost:3000/react/`.

| File | Ruolo |
| --- | --- |
| `frontend/package.json` | Script Vite e dipendenze React. |
| `frontend/vite.config.js` | Configurazione Vite con proxy dev verso il backend locale. |
| `frontend/index.html` | HTML base usato da Vite. |
| `frontend/src/main.jsx` | Monta React dentro `#root`. |
| `frontend/src/App.jsx` | Stato globale React: auth, catalogo, utenti, filtri, coda, player Pi/PC, tema e routing interno. |
| `frontend/src/api/client.js` | Wrapper unico per chiamate fetch: JSON, bearer token, player Raspberry e gestione errori. |
| `frontend/src/hooks/useCatalogPage.js` | Stato e fetch della pagina catalogo, separati da `App.jsx`. |
| `frontend/src/hooks/useDiscoveryProviders.js` | Caricamento provider discovery/import quando l'utente e' autenticato. |
| `frontend/src/hooks/useYouTubeCookieAlert.js` | Polling admin, upload e stato dell'avviso cookie YouTube, separati da `App.jsx`. |
| `frontend/src/utils.js` | Helper React per classi CSS, sorgenti, ricerca, durate e YouTube embed. |
| `frontend/src/styles/app.css` | Tema, layout e componenti principali della UI React. |
| `frontend/src/styles/admin.css` | Stili admin: utenti, diagnostica Raspberry, cookie YouTube, modali e banner stato. |
| `frontend/src/styles/catalog.css` | Stili catalogo: griglia brani, card, copertine, badge, pulsanti play e paginazione. |
| `frontend/src/styles/hero.css` | Stili della hero React: headline, metriche, CTA e spotlight. |
| `frontend/src/styles/player.css` | Stili isolati del player inferiore: dock, progress, volume, Pi/PC e marquee titolo. |

### Componenti React

| Componente | Ruolo |
| --- | --- |
| `AuthGate.jsx` | Login iniziale. |
| `Sidebar.jsx` | Navigazione tra Catalogo, Coda, Admin e Impostazioni. |
| `Topbar.jsx` | Barra ricerca, tema e logout. |
| `Hero.jsx` | Riepilogo alto con numero tracce e coda. |
| `Catalog.jsx` | Griglia tracce, filtri, paginazione e play. |
| `QueuePanel.jsx` | Visualizza e svuota la coda React. |
| `AdminPanel.jsx` | Crea utenti, resetta password temporanea, elimina utenti, resetta stato YouTube, mostra diagnostica Raspberry con auto-refresh, gestisce cookie/audit YouTube, archiviazione tracce e report licenze. |
| `adminDiagnostics.js` | Helper diagnostici dell'admin: etichette errori, salute Raspberry, riassunti audit/check e righe cookie. |
| `CookieAlertModal.jsx` | Pop-up admin che avvisa quando i cookie YouTube vanno aggiornati e permette di caricare `cookies.txt`. |
| `SettingsPanel.jsx` | Cambio password dell'utente loggato. |
| `PlayerDock.jsx` | Player inferiore React: play, prev, next, progress, shuffle, repeat, volume e uscita Pi/PC. |

## CSS e temi legacy

| Percorso | Ruolo |
| --- | --- |
| `styles/core-*.css` | Blocchi principali del layout legacy compatto/neon. |
| `styles/foundation-*.css` | Prima famiglia di layout e componenti legacy. |
| `styles/theme-neon.css` | Tema neon attivo e piu' completo. |
| `styles/theme-coastal.css` | Entry point tema coastal. |
| `styles/theme-editorial.css` | Entry point tema editorial. |
| `styles/themes/coastal/` | Token e sezioni CSS del tema coastal. |
| `styles/themes/editorial/` | Token e sezioni CSS del tema editorial. |

## Asset e runtime

| Percorso | Ruolo |
| --- | --- |
| `assets/covers/` | Copertine locali/fallback per generi musicali. |
| `tools/check-library-audio.js` | Script CLI per verificare se le sorgenti del catalogo partono davvero. |
| `tools/export-upload-youtube-cookies.ps1` | Helper Windows per esportare cookie YouTube dal browser con `yt-dlp` e caricarli nel backend. |
| `tools/update-raspberry.sh` | Helper Raspberry per fare pull, rebuild e pulizia Docker senza cancellare dati persistenti. |
| `uploads/audio/` | Audio caricati manualmente. Runtime, escluso da git. |
| `uploads/licenses/` | Licenze, ricevute e allegati diritti. Runtime, escluso da git. |
| `data/library.json` | Catalogo permanente. Runtime, escluso da git. |
| `data/clearwave-auth.sqlite` | Database utenti/admin. Runtime, escluso da git. |
| `data/youtube-import-state.json` | Stato import progressivo YouTube. Runtime, escluso da git. |
| `data/youtube-cookies.txt` | Cookie YouTube Netscape caricati dall'admin. Runtime segreto, escluso da git. |
| `data/audio-replacement-list.json` | Elenco runtime delle tracce da sostituire, archiviare o riverificare dopo controlli audio. |
| `data/reports/` | Report JSON/CSV dei check catalogo e audit YouTube. Runtime, escluso da git. |
| `.tmp-*` | Cartelle temporanee usate durante test/import. Non fanno parte del prodotto. |

## Documentazione

| File | Quando leggerlo |
| --- | --- |
| `README.md` | Panoramica, avvio veloce e indice documentazione. |
| `docs/DOCUMENTAZIONE_COMPLETA.md` | Manuale principale completo: installazione, uso, Raspberry, backup, API, codice e troubleshooting. |
| `docs/ARCHITETTURA.md` | Spiegazione tecnica dei layer e dei flussi. |
| `docs/MAPPA_PROGETTO.md` | Mappa file-per-file. |
| `docs/FLUSSI_OPERATIVI.md` | Come usare l'app e cosa fare nei casi comuni. |
| `docs/ENDPOINT_API.md` | API locali esposte dal backend. |
| `docs/CONFIGURAZIONE_API.md` | Chiavi API, variabili ambiente e provider. |
| `docs/GUIDA_SVILUPPATORE.md` | Regole pratiche per modificare il codice. |
| `docs/GUIDA_RASPBERRY_DOCKER_AUDIO.md` | Checklist operativa per Raspberry, Docker, Git, ALSA, mpv e yt-dlp. |
| `docs/VERIFICA_CATALOGO_AUDIO.md` | Come controllare in batch quali tracce sono realmente riproducibili. |
| `docs/GUIDA_CONSEGNA.md` | Guida rapida finale per installare, aggiornare, testare e consegnare ClearWave. |
| `docs/DOCKER.md` | Build, avvio e gestione dei volumi Docker. |
| `docs/RAPPORTO_MIGRAZIONE_REACT_RASPBERRY.md` | Rapporto sul porting React, player Raspberry e stato del lavoro. |
