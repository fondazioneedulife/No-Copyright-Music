# Docker

Questa guida avvia ClearWave in un container Docker unico.

Il container contiene:

- backend Node `server.js`;
- UI React principale su `/`;
- UI legacy di fallback su `/legacy`;
- build React servita anche su `/react/` per compatibilita';
- player server-side con `mpv` per uscire dall'audio del Raspberry Pi;
- asset, partial, script legacy e CSS;
- healthcheck su `/api/health`.

I dati runtime non vengono salvati nell'immagine: `docker-compose.yml` monta le cartelle locali `./data` e `./uploads`.

## File Docker

| File | Ruolo |
| --- | --- |
| `Dockerfile` | Build multi-stage: compila React e prepara il runtime Node. |
| `docker-compose.yml` | Unico file Compose: avvia il servizio, monta dati/upload locali e include le opzioni Raspberry audio. |
| `.dockerignore` | Esclude segreti, dati runtime, upload e dipendenze locali dal contesto build. |
| `.env.example` | Template per variabili Docker Compose. |

## Primo avvio

Se vuoi usare solo il catalogo locale senza chiavi API:

```powershell
docker compose up --build
```

Su Windows assicurati prima che Docker Desktop sia aperto. Se `docker compose ps` risponde con un errore sul pipe `dockerDesktopLinuxEngine`, significa che il daemon non e' ancora avviato.

Poi apri:

```text
http://localhost:3000
http://localhost:3000/react/
http://localhost:3000/legacy
```

Per avviarlo in background:

```powershell
docker compose up -d --build
```

## Avvio su Raspberry Pi con audio server-side

Sul Raspberry l'app React funziona come telecomando: il browser invia comandi al backend e l'audio esce dal Pi tramite `mpv`.

Per una checklist completa di aggiornamento, rebuild, Git, ALSA e log, usa anche `docs/GUIDA_RASPBERRY_DOCKER_AUDIO.md`.

```bash
docker compose up -d --build
```

Nel `.env` del Raspberry imposta almeno:

```env
CLEARWAVE_DOCKER_PRIVILEGED=true
CLEARWAVE_AUDIO_OUTPUT=alsa
ALSA_CARD=
CLEARWAVE_AUDIO_PREFLIGHT=1
CLEARWAVE_UPDATE_YTDLP_ON_START=1
CLEARWAVE_YTDL_PATH=/usr/bin/yt-dlp
CLEARWAVE_YTDL_FORMAT=bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best
```

Poi apri l'app da un altro dispositivo nella rete usando l'IP del Raspberry:

```text
http://IP_DEL_RASPBERRY:3000
```

Nel player in basso lascia selezionato `Pi`. `PC` resta solo come fallback per ascoltare dal browser durante lo sviluppo.

Se il Raspberry non riproduce audio, lascia prima `ALSA_CARD` e `CLEARWAVE_AUDIO_DEVICE` vuoti. Il backend fa un probe silenzioso dei device ALSA: nei log devi vedere righe come `Device audio scartato (...)` quando un device non e' apribile e poi `Avvio mpv (... tentativo ...)` sul fallback successivo.

Per controllare che ALSA veda la scheda dentro al container:

```bash
docker compose exec clearwave aplay -l
docker compose exec clearwave aplay -L
```

Poi puoi scegliere la scheda con `ALSA_CARD` oppure passare direttamente `CLEARWAVE_AUDIO_DEVICE` nel file `.env`. Preferisci `alsa/sysdefault:CARD=1` o `alsa/default`; `alsa/plughw:1,0` resta supportato ma puo' fallire se il device e' gia' occupato.

Se invece nei log compare `Requested format is not available`, il problema non e' ALSA: `mpv` e' partito, ma YouTube non ha dato un formato riproducibile. L'immagine Docker installa `yt-dlp` aggiornato da `/usr/bin/yt-dlp` e il backend passa a `mpv` un formato audio-only tramite `CLEARWAVE_YTDL_FORMAT`.

Docker puo' riusare la cache del layer `RUN curl ... latest/download/yt-dlp`. Per questo il container prova anche ad aggiornare `/usr/bin/yt-dlp` ad ogni avvio quando `CLEARWAVE_UPDATE_YTDLP_ON_START=1`. Nei log devi vedere:

```text
[startup] Controllo aggiornamento yt-dlp...
[startup] yt-dlp aggiornato:
```

Subito dopo l'avvio del server devi vedere anche la firma del codice player:

```text
[server-player] Runtime raspberry-audio-queue-2026-04-29: queue=on, preflight=on, ...
```

Se questa riga non compare, il Raspberry sta ancora usando un'immagine o una cartella progetto vecchia anche se `yt-dlp` si aggiorna correttamente.

Per controllare la versione dentro il container:

```bash
docker compose exec clearwave yt-dlp --version
```

Per controllare se le tracce del catalogo partono davvero, usa lo script incluso nel container:

```bash
docker compose exec clearwave npm run check:tracks:probe
```

Il comando non emette audio: usa `mpv --ao=null` e salva i report in `/app/data/reports/`.
La guida completa e' in `docs/VERIFICA_CATALOGO_AUDIO.md`.

Per renderlo automatico, abilita nel `.env`:

```env
CLEARWAVE_AUDIO_CHECK_ENABLED=1
CLEARWAVE_AUDIO_CHECK_ON_START=1
CLEARWAVE_AUDIO_CHECK_MODE=probe
CLEARWAVE_AUDIO_CHECK_INTERVAL_HOURS=24
```

Il backend lancia il controllo in background: l'app resta utilizzabile e la diagnostica admin mostra ultimo esito e stato corrente.

`docker-compose.yml` contiene gia' `privileged: ${CLEARWAVE_DOCKER_PRIVILEGED:-false}`. Su Raspberry conviene metterlo a `true`; su PC puoi lasciarlo `false`.

Oppure con gli script npm:

```powershell
npm run docker:build
npm run docker:up
```

## Variabili ambiente

Per usare chiavi API:

```powershell
Copy-Item .\.env.example .\.env
notepad .\.env
docker compose up -d --build
```

Variabili principali:

| Variabile | Uso |
| --- | --- |
| `CLEARWAVE_PORT` | Porta host pubblicata, default `3000`. |
| `CLEARWAVE_ADMIN_PASSWORD` | Password iniziale del primo admin se SQLite non esiste. |
| `CLEARWAVE_ENABLE_DEMOS` | Se `1`, abilita demo al primo catalogo vuoto. |
| `CLEARWAVE_AUTO_EXPAND` | Se `1`, prova import automatico all'avvio. |
| `CLEARWAVE_DOCKER_PRIVILEGED` | Se `true`, il container puo' accedere ai device host audio del Raspberry. |
| `CLEARWAVE_UPDATE_YTDLP_ON_START` | Se `1`, riscarica `yt-dlp` latest all'avvio del container. |
| `CLEARWAVE_AUDIO_CHECK_ENABLED` | Se `1`, abilita il check automatico del catalogo in background. |
| `CLEARWAVE_AUDIO_CHECK_ON_START` | Se `1`, esegue un check dopo l'avvio del backend. |
| `CLEARWAVE_AUDIO_CHECK_MODE` | `source`, `metadata` o `probe`, default `probe`. |
| `CLEARWAVE_AUDIO_CHECK_INTERVAL_HOURS` | Ore tra un check automatico e il successivo, default `24`. |
| `CLEARWAVE_AUDIO_CHECK_CONCURRENCY` | Controlli paralleli, default `2` sul Raspberry. |
| `CLEARWAVE_SERVER_PLAYER` | Se `1`, abilita il player backend per audio sul Raspberry. |
| `CLEARWAVE_PLAYER_COMMAND` | Comando player server-side, default `mpv`. |
| `CLEARWAVE_SERVER_VOLUME` | Volume iniziale del player server, 0-100. |
| `CLEARWAVE_SERVER_VOLUME_GAIN` | Gain applicato a mpv: `55` in UI con default `1.15` diventa circa `63` lato mpv. |
| `CLEARWAVE_SERVER_VOLUME_MAX` | Limite massimo mpv dopo il gain, default `130`. |
| `CLEARWAVE_AUDIO_OUTPUT` | Output mpv, default `alsa`. |
| `CLEARWAVE_AUDIO_DEVICE` | Device mpv completo, es. `alsa/sysdefault:CARD=1` o `alsa/default`. |
| `CLEARWAVE_AUDIO_PREFLIGHT` | Se `1`, testa in silenzio il device ALSA prima di avviare la canzone. |
| `CLEARWAVE_AUDIO_PREFLIGHT_TIMEOUT_MS` | Timeout del probe audio ALSA, default `2500`. |
| `ALSA_CARD` | Scheda audio ALSA usata dal container Raspberry. |
| `CLEARWAVE_YTDL_PATH` | Binario `yt-dlp` usato dal hook YouTube di `mpv`. |
| `CLEARWAVE_YTDL_FORMAT` | Formato richiesto a YouTube; default audio-only per Raspberry. |
| `CLEARWAVE_YTDL_COOKIES_FILE` | File cookie YouTube Netscape dentro al container, opzionale per video che richiedono login/conferma eta. |
| `CLEARWAVE_YOUTUBE_LOGIN_RECHECK_LIMIT` | Massimo di tracce YouTube/login ricontrollate dal pulsante admin in un giro, default `80`. |
| `CLEARWAVE_MPV_MSG_LEVEL` | Livello log `mpv`, default `all=warn,ytdl_hook=info` per vedere avvisi e risoluzione YouTube. |
| `JAMENDO_CLIENT_ID` | Discovery/import Jamendo. |
| `YOUTUBE_API_KEY` | Discovery/import canali YouTube whitelist. |
| `AUDIUS_API_KEY` | Ricerca/stream Audius. |
| `THEAUDIODB_API_KEY` | Metadata TheAudioDB. |

Non inserire chiavi reali nel `Dockerfile` o nel codice.

## YouTube con richiesta login/eta/bot

Alcuni video YouTube richiedono una sessione autenticata o una verifica anti-bot anche se sono pubblici. In quel caso nei log puoi vedere:

```text
Sign in to confirm your age
Sign in to confirm you're not a bot
Use --cookies-from-browser or --cookies
```

ClearWave non aggira il controllo: puo' usare un file cookie esportato da un account YouTube autorizzato, se l'uso e' consentito dalle policy del servizio e dal progetto.

Procedura consigliata:

```bash
# Sul tuo PC esporta i cookie YouTube in formato Netscape e porta il file sul Raspberry.
# Poi salvalo nel progetto, cartella data:
cp youtube-cookies.txt ~/No-Copyright-Music/data/youtube-cookies.txt
chmod 600 ~/No-Copyright-Music/data/youtube-cookies.txt
```

Nel `.env` del Raspberry aggiungi:

```bash
CLEARWAVE_YTDL_COOKIES_FILE=/app/data/youtube-cookies.txt
```

Poi ricrea il container:

```bash
docker compose down
docker compose build --no-cache clearwave
docker compose up -d --force-recreate
```

Il file `data/youtube-cookies.txt` non va mai committato: contiene una sessione privata.

Dal pannello admin puoi poi usare `Ricontrolla login YouTube`. Il backend legge gli ultimi report in `data/reports`, prende solo le tracce con motivo `youtube-age-or-login`, le ricontrolla con i cookie configurati e aggiorna `data/audio-replacement-list.json` con le tracce da sostituire se anche il ricontrollo fallisce.

## Dati persistenti

`docker-compose.yml` monta due cartelle del progetto dentro al container:

| Cartella locale | Montata su | Contiene |
| --- | --- | --- |
| `./data` | `/app/data` | `library.json`, SQLite utenti, stato import YouTube. |
| `./uploads` | `/app/uploads` | Audio caricati e documenti licenza. |

Questo significa che il container usa gli stessi  dati del progetto locale: se `data/library.json` contiene il catalogo, lo vedrai subito anche in Docker.

## Comandi utili

Build:

```powershell
docker compose build
```

Avvio:

```powershell
docker compose up -d
```

Log:

```powershell
docker compose logs -f clearwave
```

Stato:

```powershell
docker compose ps
```

Stop mantenendo i dati locali:

```powershell
docker compose down
```

Stop cancellando eventuali volumi Docker non piu' usati:

```powershell
docker compose down -v
```

Con l'attuale compose a bind mount, `down -v` non elimina `./data` e `./uploads`; evita comunque di cancellare manualmente quelle cartelle se vuoi mantenere catalogo, utenti e upload.

## URL

| URL | Cosa apre |
| --- | --- |
| `http://localhost:3000` | UI React principale. |
| `http://localhost:3000/react/` | UI React buildata dentro l'immagine, alias compatibile. |
| `http://localhost:3000/legacy` | UI legacy di fallback. |
| `http://localhost:3000/api/health` | Healthcheck backend. |

## Note tecniche

- L'immagine usa `node:22-bookworm-slim`, coerente con l'uso di `node:sqlite`.
- Il runtime installa `mpv`, `ffmpeg`, `alsa-utils`, `libasound2-plugins` e scarica `yt-dlp` aggiornato in `/usr/bin/yt-dlp`: servono per riprodurre file, stream e link YouTube dal server e per diagnosticare i device audio del Raspberry.
- All'avvio il container puo' riscaricare `yt-dlp` per evitare che la cache Docker lasci una versione vecchia.
- React viene buildato in uno stage separato con `npm ci --prefix frontend`.
- Nel runtime finale non vengono installate dipendenze frontend.
- `CLEARWAVE_DATA_DIR` e `CLEARWAVE_UPLOADS_DIR` puntano alle cartelle bind mount `./data` e `./uploads`.
- Il backend ascolta sulla porta `3000` dentro il container.
