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

Per aggiornare un Raspberry gia' installato usa lo script dedicato, cosi' non accumuli cache Docker fino a riempire la SD:

```bash
cd ~/No-Copyright-Music
sh tools/update-raspberry.sh
```

Lo script fa `git pull --ff-only`, build normale, `up -d --force-recreate` e poi pulisce solo cache/immagini/container inutilizzati. Non usa `docker prune --volumes`, quindi non cancella catalogo, utenti, cookie o upload. Usa `CLEARWAVE_NO_CACHE=1 sh tools/update-raspberry.sh` solo per build davvero pulite.

Se il Raspberry finisce lo spazio durante pull/build:

```bash
df -h
docker system df
docker builder prune -af
docker image prune -af
docker container prune -f
```

Se non basta:

```bash
docker system prune -af
sudo journalctl --vacuum-time=3d
sudo apt clean
```

Non usare `docker system prune --volumes` come routine e non cancellare a mano `data/` o `uploads/`: contengono catalogo, utenti, cookie YouTube, report, audio e licenze. Dopo la pulizia puoi rilanciare `sh tools/update-raspberry.sh`; se le immagini sono state rimosse, Docker le ricostruisce.

Nel `.env` del Raspberry imposta almeno:

```env
CLEARWAVE_DOCKER_PRIVILEGED=true
CLEARWAVE_AUDIO_OUTPUT=alsa
ALSA_CARD=
CLEARWAVE_AUDIO_PREFLIGHT=1
CLEARWAVE_UPDATE_YTDLP_ON_START=1
CLEARWAVE_YTDL_PATH=/usr/bin/yt-dlp
CLEARWAVE_YTDL_FORMAT=bestaudio[protocol^=m3u8]/bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best
CLEARWAVE_YTDL_JS_RUNTIME=deno:/usr/local/bin/deno
CLEARWAVE_YTDL_EXTRACTOR_ARGS=youtube:player_client=mweb
CLEARWAVE_YTDL_PO_TOKEN=
CLEARWAVE_YTDL_PO_TOKEN_CLIENT=mweb.gvs
CLEARWAVE_YTDL_BGUTIL_PROVIDER=1
CLEARWAVE_YTDL_BGUTIL_PORT=4416
CLEARWAVE_YTDL_BGUTIL_BASE_URL=http://127.0.0.1:4416
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
Se invece compare `HTTP error 403 Forbidden`, `[lavf] avformat_open_input() failed` o `Failed to open ... googlevideo.com`, YouTube ha dato uno stream firmato ma lo ha rifiutato quando `mpv` lo ha aperto. ClearWave usa `player_client=mweb`, avvia nello stesso container il provider PO token `bgutil-ytdlp-pot-provider` e passa esplicitamente a `yt-dlp` `youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416`. Se il primo avvio fallisce subito, prova prima `youtube/tv`, poi `youtube/web-safari-hls` e infine `youtube/web-embedded` prima di saltare traccia. Nei log devi vedere `Avvio provider PO token bgutil...`, `bgutil=on/http://127.0.0.1:4416` e le etichette dei fallback.
Per i brani YouTube whitelist del catalogo, la soluzione piu' stabile e' la cache locale: con `CLEARWAVE_YOUTUBE_CACHE_ENABLED=1` il primo play scarica l'audio in `uploads/audio/youtube-cache/` e aggiorna il catalogo. Dal secondo play `mpv` apre un file locale, quindi non dipende piu' dal link `googlevideo.com` temporaneo. Serve spazio su disco: controlla `df -h` se inizi a cacheare molte tracce.

Docker puo' riusare la cache del layer `RUN curl ... yt-dlp`. Per questo il container prova anche ad aggiornare `/usr/bin/yt-dlp` ad ogni avvio quando `CLEARWAVE_UPDATE_YTDLP_ON_START=1`. Di default usa il canale nightly configurato da `CLEARWAVE_YTDLP_DOWNLOAD_URL`, per ricevere prima i fix YouTube/PO token. Nei log devi vedere:

```text
[startup] Controllo aggiornamento yt-dlp...
[startup] yt-dlp aggiornato:
```

Subito dopo l'avvio del server devi vedere anche la firma del codice player:

```text
[server-player] Runtime raspberry-audio-queue-2026-04-29: queue=on, preflight=on, ...
```

Se questa riga non compare, il Raspberry sta ancora usando un'immagine o una cartella progetto vecchia anche se `yt-dlp` si aggiorna correttamente.
Se nei log di `yt-dlp` compare `No supported JavaScript runtime could be found`, ricostruisci l'immagine: il Dockerfile installa Deno e ClearWave lo passa a `yt-dlp` con `CLEARWAVE_YTDL_JS_RUNTIME`.

Per controllare la versione dentro il container:

```bash
docker compose exec clearwave yt-dlp --version
docker compose exec clearwave deno --version
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
Quando il check catalogo o `Verifica tutto YouTube` sono attivi, la UI React aggiorna la diagnostica da sola. Il banner `Auto-refresh attivo` indica che non devi premere manualmente `Aggiorna diagnostica`; il refresh completo resta distanziato per non sovraccaricare il Raspberry con troppi probe audio.

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
| `CLEARWAVE_UPDATE_YTDLP_ON_START` | Se `1`, riscarica `yt-dlp` all'avvio del container. |
| `CLEARWAVE_YTDLP_DOWNLOAD_URL` | URL del binario yt-dlp da scaricare; default nightly per fix YouTube piu' rapidi. |
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
| `CLEARWAVE_YTDL_FORMAT` | Formato richiesto a YouTube; default audio-only con preferenza HLS/m3u8 per ridurre i 403 sugli stream `googlevideo.com`. |
| `CLEARWAVE_YTDL_JS_RUNTIME` | Runtime JavaScript passato a `yt-dlp`, default `deno:/usr/local/bin/deno`. |
| `CLEARWAVE_YTDL_EXTRACTOR_ARGS` | Argomenti extractor passati a `yt-dlp`, default `youtube:player_client=mweb` quando il provider PO e' attivo. |
| `CLEARWAVE_YTDL_PO_TOKEN` | Token PO opzionale per YouTube quando cookie validi ricevono ancora `403` sugli stream `googlevideo.com`. Non committare mai un token reale. |
| `CLEARWAVE_YTDL_PO_TOKEN_CLIENT` | Contesto del PO token, default `mweb.gvs`. Se `CLEARWAVE_YTDL_PO_TOKEN` contiene gia' `mweb.gvs+...`, questo valore non serve. |
| `CLEARWAVE_YTDL_BGUTIL_PROVIDER` | Se `1`, avvia il provider PO token bgutil dentro lo stesso container ClearWave. |
| `CLEARWAVE_YTDL_BGUTIL_PORT` | Porta locale del provider PO token, default `4416`. |
| `CLEARWAVE_YTDL_BGUTIL_BASE_URL` | URL locale passato a `yt-dlp` per il provider bgutil HTTP, default `http://127.0.0.1:4416`. |
| `CLEARWAVE_YTDL_FALLBACK_PROFILES` | Se `1`, prova profili YouTube alternativi quando `mweb` fallisce subito. |
| `CLEARWAVE_YOUTUBE_START_STABLE_MS` | Millisecondi di stabilita' iniziale prima di considerare riuscito un avvio YouTube, default `12000`. |
| `CLEARWAVE_YOUTUBE_CACHE_ENABLED` | Se `1`, abilita la cache locale dei brani YouTube whitelist in `uploads/audio/youtube-cache`. |
| `CLEARWAVE_YOUTUBE_CACHE_ON_PLAY` | Se `1`, scarica/cachea automaticamente al primo play server-side. |
| `CLEARWAVE_YOUTUBE_CACHE_AUDIO_FORMAT` | Formato locale della cache, default `mp3`. |
| `CLEARWAVE_YOUTUBE_CACHE_TIMEOUT_MS` | Timeout download cache per traccia, default `600000` ms. |
| `CLEARWAVE_YTDL_COOKIES_FILE` | File cookie YouTube Netscape dentro al container, opzionale per video che richiedono login/conferma eta. |
| `CLEARWAVE_YOUTUBE_LOGIN_RECHECK_LIMIT` | Massimo di tracce YouTube/login ricontrollate dal pulsante admin in un giro, default `80`. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_MODE` | Modalita del controllo completo YouTube da Admin, default `metadata`. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_CONCURRENCY` | Parallelismo del controllo completo YouTube, default `5` sul Raspberry. Se compaiono molti `timeout`, scendi temporaneamente a `3` o `2`. |
| `CLEARWAVE_YOUTUBE_FULL_AUDIT_LIMIT` | Limite opzionale per test; `0` controlla tutte le tracce YouTube. |
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

Procedura consigliata dalla UI:

1. Esporta i cookie YouTube in formato Netscape da un account autorizzato.
2. Entra come admin in ClearWave.
3. Apri `Impostazioni` -> `Diagnostica audio/server`.
4. Usa `Carica cookies.txt`.

Il backend salva il file nel volume persistente `data/youtube-cookies.txt`; nel container il percorso diventa `/app/data/youtube-cookies.txt` e viene usato automaticamente dal prossimo play YouTube.
Il file e' una fotografia della sessione: aprire YouTube dopo l'export non aggiorna automaticamente il Raspberry. Se cambi login, accetti un controllo Google o rigeneri la sessione, devi esportare e caricare un nuovo `cookies.txt`.

ClearWave controlla anche la scadenza dei cookie caricati. Se il file manca, e' scaduto o entra nella finestra configurata da `CLEARWAVE_YTDL_COOKIE_EXPIRY_WARNING_DAYS` (default 14 giorni), gli admin vedono un popup ogni 10 minuti finche' non caricano un `cookies.txt` nuovo e valido. Il popup permette di caricare subito il file senza passare dalla diagnostica.

Procedura automatica da PC Windows:

```powershell
cd "C:\Users\Riccardo\Documents\New project"
.\tools\export-upload-youtube-cookies.ps1 -ClearWaveUrl "http://10.30.10.142:3000" -Browser chrome -Username admin
```

Lo script prova prima `yt-dlp --cookies-from-browser chrome`; se Chrome risponde con errore DPAPI o blocca DevTools, apre la pagina dell'estensione Chrome e ti chiede di esportare un solo `cookies.txt`. Appena premi Invio, lo script cerca il file in Download/Desktop e lo invia all'endpoint admin `/api/admin/youtube-cookies`.
Dopo l'upload lo script chiama anche il test server `/api/admin/youtube-cookies/probe`: il Raspberry prova i cookie con `yt-dlp` usando una traccia gia' finita nei report `youtube-age-or-login` quando disponibile. Se quel test fallisce, il file cookie non e' ancora quello giusto per sbloccare YouTube dal container.
Il risultato importante e' `Account YouTube autorizzato`: significa che i cookie sono stati accettati proprio su una traccia problematica. Se invece leggi `Test non conclusivo`, i cookie sono leggibili ma manca ancora una prova su un video che prima chiedeva login/eta/bot.

Se `yt-dlp` non e' installato sul PC:

```powershell
winget install yt-dlp.yt-dlp
```

Se lo hai appena installato e PowerShell dice ancora `yt-dlp non trovato`, chiudi e riapri PowerShell. In alternativa passa il percorso completo:

```powershell
.\tools\export-upload-youtube-cookies.ps1 -ClearWaveUrl "http://10.30.10.142:3000" -Browser chrome -Username admin -YtDlpPath "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe"
```

Se compare `Could not copy Chrome cookie database`, Chrome e' ancora aperto o ha processi in background. Rilancia con chiusura automatica del browser:

```powershell
.\tools\export-upload-youtube-cookies.ps1 -ClearWaveUrl "http://10.30.10.142:3000" -Browser chrome -Username admin -CloseBrowser
```

Se preferisci esportare il file tu, puoi saltare ogni tentativo automatico e farlo caricare direttamente:

```powershell
.\tools\export-upload-youtube-cookies.ps1 -ClearWaveUrl "http://10.30.10.142:3000" -Username admin -ExistingCookieFile "$env:USERPROFILE\Desktop\youtube-cookies.txt"
```

Con `-ExistingCookieFile` il file locale non viene cancellato: ClearWave ne legge il contenuto e salva una copia nel volume `data` del server.
Se vuoi forzare il test su uno dei video che ti dava errore login/bot, aggiungi `-ProbeUrl`:

```powershell
.\tools\export-upload-youtube-cookies.ps1 -ClearWaveUrl "http://10.30.10.142:3000" -Username admin -ExistingCookieFile "$env:USERPROFILE\Desktop\youtube-cookies.txt" -ProbeUrl "https://www.youtube.com/watch?v=ID_VIDEO_PROBLEMATICO"
```

Un solo file cookie valido basta per tutte le tracce YouTube accessibili da quell'account. Non recupera video rimossi, privati, bloccati per regione o non consentiti dall'account.

Procedura manuale via SSH:

```bash
# Sul tuo PC esporta i cookie YouTube in formato Netscape e porta il file sul Raspberry.
# Poi salvalo nel progetto, cartella data:
cp youtube-cookies.txt ~/No-Copyright-Music/data/youtube-cookies.txt
chmod 600 ~/No-Copyright-Music/data/youtube-cookies.txt
```

Non serve impostare variabili se usi il percorso standard. Nel `.env` del Raspberry aggiungi la variabile solo se vuoi un percorso diverso:

```bash
CLEARWAVE_YTDL_COOKIES_FILE=/app/data/youtube-cookies.txt
CLEARWAVE_YTDL_COOKIE_EXPIRY_WARNING_DAYS=14
```

Poi ricrea il container solo se hai cambiato `.env`; se hai caricato il file dalla UI basta riprovare la traccia o usare il ricontrollo admin:

```bash
docker compose down
docker compose build --no-cache clearwave
docker compose up -d --force-recreate
```

Il file `data/youtube-cookies.txt` non va mai committato: contiene una sessione privata.

Dal pannello admin puoi poi usare due controlli:

- `Test cookie YouTube`: prova subito `yt-dlp` dal Raspberry con i cookie caricati. Se fallisce con `youtube-age-or-login`, non lanciare il controllo da 3000+ video: rigenera i cookie o verifica l'account prima.
- `Ricontrolla login YouTube`: rapido, legge gli ultimi report in `data/reports`, prende solo le tracce con motivo `youtube-age-or-login` e aggiorna `data/audio-replacement-list.json`.
- `Riverifica archiviate`: dopo avere caricato cookie nuovi, ricontrolla le tracce YouTube archiviate e riattiva automaticamente quelle tornate riproducibili.
- `Verifica tutto YouTube`: lungo, passa su tutte le tracce YouTube del catalogo e mostra progresso nella diagnostica. Con 3000+ video puo' durare parecchio, ma resta in background e alla fine produce lo stesso file `data/audio-replacement-list.json`.
- `Archivia non disponibili`: dopo un report, nasconde dal catalogo attivo le tracce con errori definitivi come `youtube-unavailable`, creando prima un backup `data/library-before-audio-cleanup-*.json` e senza cancellarle da `library.json`.

Lettura pratica dei risultati:

- molti `youtube-age-or-login` subito all'inizio indicano quasi sempre cookie non accettati o account non autorizzato dal container;
- `timeout` isolati possono essere solo lentezza di rete o carico Raspberry, quindi vanno confermati con un secondo giro;
- `youtube-unavailable`, `not-found`, `forbidden`, `missing-source` e `missing-file` sono candidati piu' forti per `Archivia non disponibili`;
- dopo avere caricato cookie nuovi, usa prima `Test cookie YouTube`, poi `Riverifica archiviate`, poi eventualmente `Verifica tutto YouTube`.

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
- Il runtime installa `mpv`, `ffmpeg`, `alsa-utils`, `libasound2-plugins`, Deno e scarica `yt-dlp` aggiornato in `/usr/bin/yt-dlp`: servono per riprodurre file, stream e link YouTube dal server e per diagnosticare i device audio del Raspberry.
- All'avvio il container puo' riscaricare `yt-dlp` per evitare che la cache Docker lasci una versione vecchia.
- React viene buildato in uno stage separato con `npm ci --prefix frontend`.
- Nel runtime finale non vengono installate dipendenze frontend.
- `CLEARWAVE_DATA_DIR` e `CLEARWAVE_UPLOADS_DIR` puntano alle cartelle bind mount `./data` e `./uploads`.
- Il backend ascolta sulla porta `3000` dentro il container.
