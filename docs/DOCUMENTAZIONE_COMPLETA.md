# Documentazione completa ClearWave Library

Questa documentazione e' il manuale principale del progetto ClearWave Library.
Serve a capire, installare, usare, amministrare, testare e consegnare l'applicazione senza dover inseguire informazioni sparse tra codice, Docker, Raspberry e vecchia UI.

## Indice

1. Obiettivo del progetto
2. Funzioni principali
3. Architettura generale
4. Requisiti
5. Avvio locale su Windows
6. Avvio con Docker
7. Installazione e uso su Raspberry Pi
8. Accesso, utenti e ruoli
9. Uso dell'app React
10. Catalogo musicale
11. Import musica
12. Player audio Pi/PC
13. Diagnostica Raspberry
14. Backup, export e report licenze
15. Dati persistenti
16. Variabili ambiente
17. API principali
18. Struttura del codice
19. Workflow Git e aggiornamento
20. Troubleshooting
21. Checklist finale di consegna
22. Documenti collegati

## 1. Obiettivo del progetto

ClearWave Library e' una web app locale per cercare, catalogare, importare e riprodurre musica utilizzabile in contesti commerciali, mantenendo traccia di fonti, licenze e prove di utilizzo.

L'applicazione nasce per funzionare in due modi:

- su PC, per sviluppo e gestione comoda;
- su Raspberry Pi, come player fisico server-side: il browser diventa un telecomando e l'audio esce dal Raspberry.

Il progetto contiene:

- backend Node locale senza framework;
- frontend React come interfaccia principale;
- UI legacy disponibile come fallback;
- autenticazione locale con SQLite;
- catalogo JSON persistente;
- import da Jamendo e canali YouTube whitelist;
- player Raspberry basato su `mpv` e `yt-dlp`;
- Dockerfile e `docker-compose.yml` unico;
- diagnostica admin per audio, mpv, yt-dlp e ALSA;
- export e ripristino backup catalogo;
- report licenze CSV e HTML.

ClearWave non sostituisce una verifica legale finale. Il report licenze aiuta a sapere da dove arrivano i brani e quali prove conservare, ma prima di usare musica in campagne o spazi commerciali vanno sempre controllati i termini del provider.

## 2. Funzioni principali

| Area | Funzione |
| --- | --- |
| Catalogo | Lista brani, filtri, generi, ricerca, paginazione lato server. |
| Import | Jamendo, YouTube whitelist, import da link, import lotti 120/250/500. |
| Playlist temporanea | Link YouTube di prova non salvati nel catalogo. |
| Player | Play, pausa, seek, next, prev, shuffle, repeat, volume slider e input numerico. |
| Uscita audio | `PC` per browser locale, `Pi` per audio server-side su Raspberry. |
| Admin | Utenti, reset password, elimina utente, reset scan YouTube. |
| Diagnostica | Runtime, mpv, yt-dlp, ALSA, preflight audio, ultimo errore ed eventi player. |
| Backup | Export JSON del catalogo e ripristino con copia automatica preventiva. |
| Report | Export CSV e HTML licenze/fonti. |
| Docker | Un solo container con backend, React, mpv, ffmpeg, yt-dlp. |

## 3. Architettura generale

ClearWave e' divisa in quattro blocchi:

| Blocco | Percorsi principali | Responsabilita' |
| --- | --- | --- |
| Backend Node | `server.js`, `lib/` | API, auth, catalogo, import provider, player Raspberry, export. |
| Frontend React | `frontend/src/` | UI principale, catalogo, admin, player, import, diagnostica. |
| Storage runtime | `data/`, `uploads/` | Catalogo, SQLite utenti, stato import, audio, licenze. |
| Docker/Raspberry | `Dockerfile`, `docker-compose.yml`, `.env` | Avvio container, volumi, audio ALSA, mpv, yt-dlp. |

Flusso normale:

1. Il browser apre la UI React.
2. React chiama le API `/api/...` sul backend.
3. Il backend legge/scrive `data/library.json` e SQLite utenti.
4. Per import musica il backend usa API provider o `yt-dlp`.
5. In modalita' `Pi`, React manda comandi al backend.
6. Il backend avvia `mpv` e l'audio esce dal Raspberry.

## 4. Requisiti

### Sviluppo su PC Windows

- Node.js compatibile con il progetto.
- npm.
- PowerShell.
- Docker Desktop, se vuoi testare il container.
- Git.

### Raspberry Pi

- Raspberry Pi 4 consigliato.
- Docker e Docker Compose.
- Accesso alla rete.
- Output audio configurato lato sistema.
- Container con accesso a `/dev/snd`.
- Variabile `CLEARWAVE_DOCKER_PRIVILEGED=true` consigliata.

### Provider esterni

Facoltativi ma utili:

- `JAMENDO_CLIENT_ID`;
- `YOUTUBE_API_KEY`;
- `AUDIUS_API_KEY`;
- `THEAUDIODB_API_KEY`.

Senza chiavi esterne l'app resta avviabile, ma import e discovery risultano limitati.

## 5. Avvio locale su Windows

Per avviare backend e UI principale servita dal backend:

```powershell
npm start
```

Apri:

```text
http://localhost:3000
```

Per sviluppare React con Vite:

```powershell
npm run dev
```

Apri:

```text
http://localhost:5173
```

In sviluppo, Vite inoltra `/api/...` al backend su `localhost:3000`.

Per buildare React:

```powershell
npm run build:react
npm start
```

La build React viene servita sia da:

```text
http://localhost:3000
http://localhost:3000/react/
```

## 6. Avvio con Docker

Primo avvio:

```powershell
docker compose up --build
```

Avvio in background:

```powershell
docker compose up -d --build
```

Log:

```powershell
docker compose logs -f clearwave
```

Stop:

```powershell
docker compose down
```

Il container monta:

| Cartella host | Cartella container | Contenuto |
| --- | --- | --- |
| `./data` | `/app/data` | Catalogo, SQLite utenti, stato YouTube. |
| `./uploads` | `/app/uploads` | Audio caricati e allegati licenze. |

Quindi ricreare il container non cancella catalogo e utenti, se le cartelle locali restano al loro posto.

## 7. Installazione e uso su Raspberry Pi

Sul Raspberry esegui sempre i comandi nella cartella del progetto:

```bash
cd ~/No-Copyright-Music
git pull --ff-only
docker compose down
docker compose build --no-cache clearwave
docker compose up -d --force-recreate
docker compose logs -f clearwave
```

Nel file `.env` del Raspberry imposta almeno:

```env
CLEARWAVE_PORT=3000
CLEARWAVE_DOCKER_PRIVILEGED=true
CLEARWAVE_SERVER_PLAYER=1
CLEARWAVE_AUDIO_OUTPUT=alsa
CLEARWAVE_AUDIO_PREFLIGHT=1
CLEARWAVE_UPDATE_YTDLP_ON_START=1
CLEARWAVE_YTDL_PATH=/usr/bin/yt-dlp
CLEARWAVE_YTDL_FORMAT=bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best
```

All'inizio lascia vuoti:

```env
ALSA_CARD=
CLEARWAVE_AUDIO_DEVICE=
```

Apri l'app da un browser nella stessa rete:

```text
http://IP_DEL_RASPBERRY:3000
```

Nel player in basso seleziona `Pi`. Da quel momento:

- il browser manda comandi;
- il backend avvia `mpv`;
- il suono esce dal Raspberry.

## 8. Accesso, utenti e ruoli

Il backend crea il primo admin solo se il database SQLite non esiste ancora.

Credenziali iniziali di sviluppo:

| Campo | Valore |
| --- | --- |
| Username | `admin` |
| Password | `CLEARWAVE_ADMIN_PASSWORD` oppure `admin123` |

Dopo il primo accesso cambia password da `Impostazioni`.

Ruoli:

| Ruolo | Permessi |
| --- | --- |
| `admin` | Gestione utenti, import permanente, reset YouTube, diagnostica, backup, report. |
| `user` | Accesso limitato alla libreria e uso normale. |

L'admin puo':

- creare utenti;
- eliminare utenti;
- resettare password temporanee;
- fare import permanente;
- usare playlist temporanea;
- esportare backup e report;
- vedere diagnostica Raspberry.

## 9. Uso dell'app React

La UI React e' la UI principale.

Sezioni principali:

| Sezione | Cosa fa |
| --- | --- |
| Catalogo | Mostra brani disponibili, filtri, ricerca e paginazione. |
| Coda | Mostra e gestisce brani in coda. |
| Aggiungi brani | Import temporaneo, import permanente, ricerca provider e import lotti. |
| Impostazioni | Admin utenti, diagnostica, reset scan, backup, report e cambio password. |
| Studio | Upload manuale audio/licenze e strumenti avanzati. |

Il player e' fisso in basso e include:

- copertina mini;
- titolo con scorrimento se lungo;
- stato player;
- shuffle;
- precedente;
- play/pausa;
- successiva;
- repeat;
- seek;
- volume slider;
- input numerico volume;
- selettore uscita `Pi`/`PC`.

## 10. Catalogo musicale

Il catalogo permanente vive in:

```text
data/library.json
```

Ogni traccia puo' contenere:

- titolo;
- autore/creator;
- genere;
- durata;
- provider;
- fonte;
- licenza;
- note diritti;
- stato commerciale;
- URL licenza;
- copertina;
- audio locale o sorgente remota.

La paginazione del catalogo React e' lato server tramite:

```text
GET /api/tracks
```

Questo evita di mandare migliaia di tracce al browser in un solo colpo.

## 11. Import musica

ClearWave distingue tra import temporaneo e import permanente.

### Import temporaneo

Usato per provare link YouTube senza salvarli nel catalogo.

Caratteristiche:

- solo admin;
- resta nella sessione React;
- si pulisce con logout o svuotamento playlist;
- utile per testare playlist/video/canali.

Endpoint:

```text
POST /api/session/import-link
```

### Import permanente da link

Salva nel catalogo locale.

Endpoint:

```text
POST /api/discovery/import-link
```

### Import lotto

Il bottone `Importa` puo' lavorare con dimensioni:

| Lotto | Uso consigliato |
| --- | --- |
| `120` | Import normale e piu' leggero. |
| `250` | Import medio. |
| `500` | Riempimento catalogo piu' aggressivo. |

L'import lotto:

- legge Jamendo;
- legge canali YouTube whitelist;
- legge upload e playlist pubbliche dei canali;
- evita duplicati;
- scarta brani troppo brevi;
- mostra quanti risultati sono stati letti, importati o saltati.

Canali YouTube whitelist:

- NoCopyrightSounds;
- Infraction - No Copyright Music;
- BreakingCopyright - Royalty Free Music.

Stato import YouTube:

```text
data/youtube-import-state.json
```

Se lo stato e' vecchio o un canale risulta completato troppo presto, usa `Reset scan YouTube`.
Il reset non cancella il catalogo: azzera solo i cursori e crea un backup dello stato.

## 12. Player audio Pi/PC

ClearWave puo' riprodurre in due modi:

| Modalita' | Dove esce l'audio | Uso |
| --- | --- | --- |
| `PC` | Browser del computer | Sviluppo locale o fallback. |
| `Pi` | Raspberry/server | Produzione e installazione fisica. |

### Modalita' PC

Il browser usa:

- tag `<audio>` per stream/file;
- iframe YouTube invisibile per video YouTube.

### Modalita' Pi

React chiama:

```text
/api/server-player/play
/api/server-player/pause
/api/server-player/seek
/api/server-player/volume
/api/server-player/context
/api/server-player/stop
/api/server-player/status
```

Il backend:

1. risolve la traccia;
2. decide la sorgente audio;
3. prepara `mpv`;
4. prova output ALSA;
5. apre un socket IPC;
6. invia comandi play/pausa/seek/volume;
7. conserva una coda lato server per continuare la riproduzione anche se la pagina web viene chiusa.

Quando React avvia una traccia in modalita' `Pi`, manda anche `serverContext` con lista, repeat e shuffle.
Se il browser viene chiuso, `mpv` resta attivo sul Raspberry e il backend puo' passare alla traccia successiva senza dipendere dal frontend.
Se YouTube blocca un video con richiesta login/conferma eta, il backend non chiede cookie al Raspberry: registra l'errore, salta quella traccia e prova la successiva nella coda server.

Il volume accetta sia formato normalizzato che percentuale:

```json
{ "volume": 0.75, "volumePercent": 75 }
```

Questo evita errori tra slider `0-100` e valore interno `0-1`.

## 13. Diagnostica Raspberry

Nel pannello admin usa `Aggiorna diagnostica`.

La diagnostica mostra:

- revisione runtime;
- versione Node;
- piattaforma e architettura;
- stato player;
- volume server;
- output audio;
- device audio;
- `ALSA_CARD`;
- `mpv --version`;
- `yt-dlp --version`;
- `aplay -l`;
- `aplay -L`;
- `/proc/asound/cards`;
- risultati preflight audio;
- ultimi eventi player, per vedere start, stop, cambio traccia, errori mpv e completamenti codice `0`.

Endpoint:

```text
GET /api/admin/diagnostics
```

La diagnostica non mostra chiavi API reali. Indica solo se sono configurate.

## 14. Backup, export e report licenze

Nel pannello admin sono disponibili export, ripristino e report leggibili.

### Backup catalogo

Scarica un JSON con:

- data export;
- nome app;
- revisione runtime;
- numero tracce;
- array completo `tracks`.

Endpoint:

```text
GET /api/admin/export/catalog.json
```

### Ripristino backup catalogo

Il bottone `Importa backup` accetta il JSON esportato da ClearWave.
Prima di sostituire `data/library.json`, il backend crea automaticamente un backup del catalogo corrente in `data/library.backup-*.json`.

Endpoint:

```text
POST /api/admin/import/catalog-backup
```

Uso consigliato:

1. esporta sempre un backup recente;
2. importa solo file JSON generati da ClearWave o verificati;
3. dopo il ripristino aggiorna la pagina catalogo e controlla numero tracce, filtri e player.

### Report licenze

Scarica un CSV o un HTML con:

- id;
- titolo;
- autore;
- provider;
- genere;
- durata;
- licenza;
- dettaglio licenza;
- URL licenza;
- stato commerciale;
- attribuzione richiesta;
- note diritti;
- fonte;
- creator URL;
- file licenza;
- data import;
- data aggiornamento.

Endpoint:

```text
GET /api/admin/export/licenses.csv
GET /api/admin/export/licenses.html
```

Il CSV e' pensato per aprirsi bene anche in Excel.
L'HTML e' piu' comodo per lettura, stampa o controllo rapido durante la consegna.

## 15. Dati persistenti

| Percorso | Descrizione | Git |
| --- | --- | --- |
| `data/library.json` | Catalogo permanente. | Escluso |
| `data/clearwave-auth.sqlite` | Utenti, ruoli, hash password. | Escluso |
| `data/youtube-import-state.json` | Stato pagine import YouTube. | Escluso |
| `uploads/audio/` | File audio caricati. | Escluso |
| `uploads/licenses/` | Licenze e allegati. | Escluso |
| `frontend/dist/` | Build React. | Escluso |

I dati runtime non devono essere committati.

## 16. Variabili ambiente

Variabili principali:

| Variabile | Default | Uso |
| --- | --- | --- |
| `CLEARWAVE_PORT` | `3000` | Porta pubblica Docker. |
| `PORT` | `3000` | Porta interna backend. |
| `CLEARWAVE_ADMIN_PASSWORD` | `admin123` | Password iniziale primo admin. |
| `CLEARWAVE_ENABLE_DEMOS` | `0` | Se `1`, inserisce tracce demo. |
| `CLEARWAVE_AUTO_EXPAND` | `0` | Se `1`, prova import automatico all'avvio. |
| `CLEARWAVE_DOCKER_PRIVILEGED` | `false` | Su Raspberry consigliato `true`. |
| `CLEARWAVE_SERVER_PLAYER` | `1` | Abilita player server-side. |
| `CLEARWAVE_PLAYER_COMMAND` | `mpv` | Comando player. |
| `CLEARWAVE_SERVER_VOLUME` | `75` | Volume iniziale server. |
| `CLEARWAVE_AUDIO_OUTPUT` | `alsa` | Output mpv. |
| `CLEARWAVE_AUDIO_DEVICE` | vuoto | Device mpv esplicito. |
| `CLEARWAVE_AUDIO_PREFLIGHT` | `1` | Test silenzioso device audio. |
| `CLEARWAVE_AUDIO_PREFLIGHT_TIMEOUT_MS` | `2500` | Timeout preflight. |
| `ALSA_CARD` | vuoto | Scheda ALSA preferita. |
| `CLEARWAVE_YTDL_PATH` | `/usr/bin/yt-dlp` | Binario yt-dlp. |
| `CLEARWAVE_YTDL_FORMAT` | audio-only | Formato YouTube richiesto. |
| `CLEARWAVE_MPV_MSG_LEVEL` | `all=warn,ytdl_hook=info` | Verbosita' log mpv. |
| `CLEARWAVE_UPDATE_YTDLP_ON_START` | `1` | Aggiorna yt-dlp all'avvio. |
| `JAMENDO_CLIENT_ID` | vuoto | Import Jamendo. |
| `YOUTUBE_API_KEY` | vuoto | Import YouTube whitelist. |
| `AUDIUS_API_KEY` | vuoto | Ricerca Audius. |
| `THEAUDIODB_API_KEY` | vuoto | Metadata TheAudioDB. |

Le chiavi reali non vanno mai scritte nel codice o committate.

## 17. API principali

### Sistema

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/health` | Healthcheck. |

### Auth

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Login. |
| `POST` | `/api/auth/logout` | Logout. |
| `GET` | `/api/auth/me` | Utente corrente. |
| `POST` | `/api/auth/change-password` | Cambio password. |

### Catalogo

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/tracks` | Lista catalogo con filtri e paginazione. |
| `POST` | `/api/tracks` | Crea traccia manuale, solo admin. |
| `DELETE` | `/api/tracks/:id` | Elimina traccia, solo admin. |
| `GET` | `/api/tracks/:id/download` | Scarica audio o preview. |
| `GET` | `/api/tracks/:id/preview.wav` | Preview WAV. |

### Discovery/import

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/discovery/providers` | Provider disponibili. |
| `GET` | `/api/discovery/search` | Ricerca esterna, solo admin. |
| `POST` | `/api/discovery/import` | Import singola traccia, solo admin. |
| `POST` | `/api/discovery/bulk-import` | Import lotto, solo admin. |
| `POST` | `/api/discovery/import-link` | Import permanente da link, solo admin. |
| `POST` | `/api/session/import-link` | Import temporaneo sessione, solo admin. |

### Player Raspberry

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/server-player/status` | Stato player. |
| `POST` | `/api/server-player/play` | Avvio traccia. |
| `POST` | `/api/server-player/pause` | Pausa/riprendi. |
| `POST` | `/api/server-player/seek` | Seek assoluto. |
| `POST` | `/api/server-player/volume` | Volume. |
| `POST` | `/api/server-player/context` | Aggiorna coda server per continuita' senza browser. |
| `POST` | `/api/server-player/stop` | Stop. |

### Admin

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/users` | Lista utenti. |
| `POST` | `/api/users` | Crea utente. |
| `DELETE` | `/api/users/:username` | Elimina utente. |
| `POST` | `/api/users/:username/reset-password` | Reset password. |
| `GET` | `/api/admin/diagnostics` | Diagnostica Raspberry. |
| `POST` | `/api/admin/youtube-import-state/reset` | Reset cursori YouTube. |
| `GET` | `/api/admin/export/catalog.json` | Backup catalogo JSON. |
| `POST` | `/api/admin/import/catalog-backup` | Ripristino catalogo da backup JSON. |
| `GET` | `/api/admin/export/licenses.csv` | Report licenze CSV. |
| `GET` | `/api/admin/export/licenses.html` | Report licenze HTML. |

## 18. Struttura del codice

### Backend

| Percorso | Ruolo |
| --- | --- |
| `server.js` | Router HTTP, API, storage, import, player, export. |
| `lib/auth-service.js` | SQLite utenti, password, token, ruoli. |
| `lib/catalog-page.js` | Filtri, facets e paginazione catalogo. |

### Frontend React

| Percorso | Ruolo |
| --- | --- |
| `frontend/src/App.jsx` | Stato globale e collegamento componenti/API. |
| `frontend/src/api/client.js` | Wrapper fetch JSON/download. |
| `frontend/src/hooks/useCatalogPage.js` | Paginazione e fetch catalogo. |
| `frontend/src/components/AdminPanel.jsx` | Utenti, reset scan, diagnostica, backup, ripristino e report. |
| `frontend/src/components/DiscoveryPanel.jsx` | Import brani e playlist temporanea. |
| `frontend/src/components/PlayerDock.jsx` | Player inferiore. |
| `frontend/src/components/Catalog.jsx` | Griglia catalogo e filtri. |
| `frontend/src/styles/app.css` | Stile React completo. |

### Legacy

La UI legacy resta su:

```text
http://localhost:3000/legacy
```

Serve come fallback e riferimento storico.
La UI principale da usare e consegnare e' React.

## 19. Workflow Git e aggiornamento

### Aggiornare dal Raspberry

```bash
cd ~/No-Copyright-Music
git pull --ff-only
docker compose down
docker compose build --no-cache clearwave
docker compose up -d --force-recreate
```

### Se `git pull` si blocca per file modificati

Esempio:

```text
Your local changes to the following files would be overwritten by merge
```

Soluzione prudente:

```bash
git status
git stash push -m "backup modifiche locali"
git pull --ff-only
```

Poi controlla se serve recuperare qualcosa dallo stash.

### Se compare `fatal: not a git repository`

Vuol dire che non sei nella cartella del progetto con `.git`.

```bash
cd ~/No-Copyright-Music
git status
```

## 20. Troubleshooting

### Audio non esce dal Raspberry

1. Controlla che nel player sia selezionato `Pi`.
2. Apri `Impostazioni`.
3. Premi `Aggiorna diagnostica`.
4. Guarda `mpv`, `yt-dlp`, `aplay -l` e preflight audio.
5. Se nessun device e' OK, controlla `.env` e accesso a `/dev/snd`.

Comandi:

```bash
docker compose exec clearwave aplay -l
docker compose exec clearwave aplay -L
```

### `Playback open error`

Problema ALSA/device audio.

Azioni:

1. lascia vuoti `ALSA_CARD` e `CLEARWAVE_AUDIO_DEVICE`;
2. ricrea il container;
3. usa diagnostica;
4. se trovi un device stabile, fissalo in `.env`.

### `Requested format is not available`

Problema YouTube/yt-dlp/formato, non ALSA.

Azioni:

```bash
docker compose exec clearwave yt-dlp --version
docker compose build --no-cache clearwave
docker compose up -d --force-recreate
```

Controlla che nei log compaia:

```text
[startup] yt-dlp aggiornato:
```

### `mpv precedente chiuso per cambio traccia/comando`

Non e' per forza un errore.
Significa che un nuovo play/skip/comando ha sostituito il processo precedente.

### `mpv ha completato ... codice 0`

Normale: la traccia e' finita o mpv ha chiuso correttamente.

### Importa poche tracce

Possibili cause:

- duplicati gia' presenti;
- brani troppo brevi;
- quota YouTube;
- cursori YouTube vecchi;
- pochi risultati compatibili.

Azioni:

1. prova lotto `250` o `500`;
2. usa `Reset scan YouTube`;
3. controlla il riepilogo `Saltate`;
4. controlla eventuali errori provider.

### Volume non segue la UI

1. Prova slider e input numerico.
2. Controlla diagnostica: `Volume server`.
3. Verifica che l'uscita sia `Pi`.
4. Controlla log `/api/server-player/volume`.

Il backend accetta sia `volume` 0..1 sia `volumePercent` 0..100.

## 21. Checklist finale di consegna

### Codice

- `git status` pulito.
- Ultimo commit pushato.
- `node --check server.js` passato.
- `npm --prefix frontend run build` passato.
- `docker compose config --quiet` passato.

### Raspberry

- `git pull --ff-only` completato.
- Build Docker senza cache completata.
- Container avviato.
- Log con runtime player corretto.
- `yt-dlp` aggiornato all'avvio.

### App

- Login admin funziona.
- Cambio password funziona.
- Catalogo carica.
- Import lotto funziona.
- Reset scan YouTube funziona.
- Diagnostica admin funziona.
- Backup catalogo scarica JSON.
- Report licenze scarica CSV.

### Player

- YouTube suona.
- Jamendo suona.
- Play/pausa funzionano.
- Next/prev funzionano.
- Shuffle/repeat visibili e funzionanti.
- Volume slider funziona.
- Volume numerico funziona.
- Audio esce dal Raspberry quando selezionato `Pi`.

### Consegna

- Consegnare URL dell'app.
- Consegnare credenziali admin temporanee o istruzione per crearle.
- Consegnare posizione cartella progetto sul Raspberry.
- Consegnare comando di aggiornamento.
- Consegnare backup catalogo.
- Consegnare report licenze.

## 22. Documenti collegati

| Documento | Quando usarlo |
| --- | --- |
| `README.md` | Panoramica e avvio rapido. |
| `docs/GUIDA_CONSEGNA.md` | Checklist breve di consegna. |
| `docs/GUIDA_RASPBERRY_DOCKER_AUDIO.md` | Debug dettagliato Raspberry, Docker, ALSA, mpv, yt-dlp. |
| `docs/DOCKER.md` | Uso Docker e variabili container. |
| `docs/ENDPOINT_API.md` | Contratto API locale. |
| `docs/CONFIGURAZIONE_API.md` | Provider, chiavi API, variabili ambiente. |
| `docs/MAPPA_PROGETTO.md` | Mappa file e componenti. |
| `docs/ARCHITETTURA.md` | Architettura tecnica. |
| `docs/FLUSSI_OPERATIVI.md` | Operazioni quotidiane. |
| `docs/GUIDA_SVILUPPATORE.md` | Regole per modificare il codice. |
| `docs/RAPPORTO_MIGRAZIONE_REACT_RASPBERRY.md` | Storico migrazione React/Raspberry. |
