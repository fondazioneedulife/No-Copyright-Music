# Guida Raspberry, Docker e Audio

Questa guida serve quando ClearWave deve girare sul Raspberry Pi e la musica deve uscire dal Raspberry, non dal PC.

Usala soprattutto per:

- aggiornare il progetto sul Raspberry;
- ricreare il container Docker in modo pulito;
- capire se il codice nuovo e' davvero dentro al container;
- diagnosticare `mpv`, `yt-dlp` e ALSA;
- leggere i log senza confondere problemi diversi.

## Regola fondamentale

Ci sono due ambienti diversi:

| Ambiente | Dove sei | Cosa puoi fare |
| --- | --- | --- |
| Host Raspberry | Cartella progetto reale, fuori da Docker | `git pull`, `docker compose build`, `docker compose up` |
| Container ClearWave | Dentro `docker compose exec clearwave ...` | test runtime, `aplay`, `yt-dlp`, lettura `/app/server.js` |

`git pull` va fatto sempre sull'host Raspberry, nella cartella che contiene `.git`.

Se sei dentro al container, `git pull` puo' dare:

```text
fatal: not a git repository (or any of the parent directories): .git
```

In quel caso esci dal container:

```bash
exit
```

poi vai nella cartella host del progetto.

## Stato atteso

Quando il container usa il codice aggiornato, nei log devono comparire queste cose:

```text
[startup] yt-dlp aggiornato:
[server-player] Runtime raspberry-audio-queue-2026-04-29: queue=on, preflight=on, ...
```

Quando avvii una canzone in modalita' `Pi`, i log devono mostrare una forma simile:

```text
[server-player] Avvio mpv (alsa/default-device tentativo 1/2): ...
```

Oppure, se un device ALSA non funziona:

```text
[server-player] Device audio scartato (...): ...
```

Se invece vedi ancora:

```text
/tmp/clearwave-mpv-1.sock
```

senza `tentativo`, il container sta usando codice vecchio.

## Aggiornare il progetto sul Raspberry

Procedura consigliata: usa lo script unico. Aggiorna Git, ricostruisce il container, riavvia ClearWave e pulisce cache/immagini Docker inutilizzate senza toccare i volumi.

```bash
cd ~/No-Copyright-Music
sh tools/update-raspberry.sh
```

Lo script usa una build normale con cache. Sul Raspberry evita `--no-cache` come routine, perche' ricrea molta cache e puo' riempire la SD. Per forzare una build completamente pulita solo quando serve:

```bash
CLEARWAVE_NO_CACHE=1 sh tools/update-raspberry.sh
```

Prima di aggiornare a mano controlla dove sei:

```bash
pwd
ls -la
```

Se nella lista non vedi `.git`, quella cartella non e' un clone Git. Devi entrare nella cartella corretta o clonare il progetto.

Se `.git` esiste e vuoi fare il giro manuale:

```bash
git pull --ff-only
docker compose build clearwave
docker compose up -d --force-recreate
docker builder prune -af
docker image prune -af
```

Se `git pull` non cambia nulla ma il container resta vecchio, controlla che Docker stia buildando questa stessa cartella:

```bash
pwd
cat docker-compose.yml | head
```

## Spazio pieno sul Raspberry

Se `git pull`, `docker compose build` o Buildx falliscono con messaggi tipo:

```text
No space left on device
fatal: write error: No space left on device
failed to update builder last activity time
```

prima controlla quanto spazio resta:

```bash
df -h
docker system df
```

Se `/` e' al 100%, libera spazio Docker senza toccare dati, utenti, upload o cookie:

```bash
docker builder prune -af
docker image prune -af
docker container prune -f
```

Questi comandi cancellano cache di build, immagini non usate e container fermi. Non cancellano `~/No-Copyright-Music/data` e `~/No-Copyright-Music/uploads`, perche' sono cartelle normali del progetto montate nel container.

Se serve una pulizia piu' ampia ma ancora senza cancellare volumi:

```bash
docker system prune -af
```

Evita invece questo comando, salvo backup e decisione consapevole:

```bash
docker system prune -af --volumes
```

`--volumes` puo' cancellare volumi Docker generici. ClearWave usa bind mount su `./data` e `./uploads`, ma la regola resta: non usare `--volumes` come routine.

Se dopo Docker lo spazio resta poco, controlla log e cache di sistema:

```bash
journalctl --disk-usage
sudo journalctl --vacuum-time=3d
sudo apt clean
```

Per trovare cartelle grandi:

```bash
du -hxd1 ~ | sort -h
du -hxd1 ~/No-Copyright-Music | sort -h
```

Non cancellare manualmente:

- `~/No-Copyright-Music/data/library.json`;
- `~/No-Copyright-Music/data/clearwave-auth.sqlite`;
- `~/No-Copyright-Music/data/youtube-cookies.txt`;
- `~/No-Copyright-Music/uploads/`;
- backup `data/library.backup-*` o `data/library-before-audio-cleanup-*` prima di averli copiati altrove.

Dopo avere liberato spazio, aggiorna e ricrea:

```bash
cd ~/No-Copyright-Music
git pull --ff-only
sh tools/update-raspberry.sh
```

Se hai cancellato tutte le immagini Docker, e' normale: il comando sopra ricostruisce l'immagine ClearWave.

## Configurazione `.env` consigliata

Nel primo test audio lascia vuoti `ALSA_CARD` e `CLEARWAVE_AUDIO_DEVICE`.

```env
CLEARWAVE_DOCKER_PRIVILEGED=true
CLEARWAVE_AUDIO_OUTPUT=alsa
CLEARWAVE_AUDIO_DEVICE=
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
CLEARWAVE_YOUTUBE_CACHE_ENABLED=1
CLEARWAVE_YOUTUBE_CACHE_ON_PLAY=1
CLEARWAVE_YOUTUBE_CACHE_AUDIO_FORMAT=mp3
CLEARWAVE_MPV_MSG_LEVEL=all=warn,ytdl_hook=info
```

Motivo: ClearWave prova prima il default ALSA e scarta automaticamente i device che non si aprono. Per i brani YouTube whitelist, il primo play puo' salvare una copia audio in `uploads/audio/youtube-cache`: i play successivi usano il file locale invece dello stream `googlevideo.com`.

Imposta `ALSA_CARD` o `CLEARWAVE_AUDIO_DEVICE` solo dopo aver letto `aplay -l` e `aplay -L`.

## Rebuild pulito

Quando devi essere sicuro che il container stia usando il codice nuovo, preferisci:

```bash
sh tools/update-raspberry.sh
```

Usa `--no-cache` solo se e' cambiato il Dockerfile, sono cambiate dipendenze di sistema/Node oppure il container continua a risultare vecchio dopo una build normale:

```bash
docker compose down --remove-orphans
docker compose build --no-cache clearwave
docker compose up -d --force-recreate
docker builder prune -af
docker image prune -af
docker compose logs -f clearwave
```

Se vuoi solo riavviare senza rebuild:

```bash
docker compose restart clearwave
docker compose logs -f clearwave
```

## Verifica codice dentro al container

Questo comando controlla se `/app/server.js` contiene davvero la versione nuova del player:

```bash
docker compose exec clearwave sh -lc "grep -n 'raspberry-audio-queue\|playSequence\|tentativo' /app/server.js"
```

Risultato buono: stampa almeno una riga.

Risultato cattivo: non stampa nulla. In quel caso il container ha codice vecchio.

## Diagnosi audio ALSA

Controlla quali device ALSA vede il container:

```bash
docker compose exec clearwave aplay -l
docker compose exec clearwave aplay -L
```

Se non vede device audio, il problema e' Docker/permessi:

- verifica `CLEARWAVE_DOCKER_PRIVILEGED=true`;
- verifica che `docker-compose.yml` contenga `/dev/snd:/dev/snd`;
- ricrea il container con `docker compose up -d --force-recreate`.

Se ALSA vede piu' schede, puoi provare nel `.env`:

```env
ALSA_CARD=1
```

oppure un device esplicito:

```env
CLEARWAVE_AUDIO_DEVICE=alsa/sysdefault:CARD=1
```

Preferisci `sysdefault` o `default`. Usa `alsa/plughw:1,0` solo come test, perche' puo' fallire quando il device e' occupato.

## Diagnosi yt-dlp

Controlla la versione dentro al container:

```bash
docker compose exec clearwave yt-dlp --version
docker compose exec clearwave /usr/bin/yt-dlp --version
docker compose exec clearwave deno --version
```

Nei log di avvio deve comparire:

```text
[startup] Controllo aggiornamento yt-dlp...
[startup] yt-dlp aggiornato:
```

Se YouTube restituisce `Requested format is not available`, il problema non e' ALSA: `mpv` e' partito, ma YouTube non ha dato uno stream compatibile. In quel caso ricrea il container e controlla `CLEARWAVE_YTDL_FORMAT`.
Se invece vedi `HTTP error 403 Forbidden`, `[lavf] avformat_open_input() failed` o `Failed to open ... googlevideo.com`, YouTube ha firmato uno stream ma poi lo ha rifiutato. Il container aggiornato avvia il provider PO token bgutil, passa a `yt-dlp` `CLEARWAVE_YTDL_BGUTIL_BASE_URL=http://127.0.0.1:4416` e usa `CLEARWAVE_YTDL_EXTRACTOR_ARGS=youtube:player_client=mweb`; in diagnostica `PO token` deve risultare attivo. Se continua anche cosi', la singola traccia e' instabile o bloccata lato YouTube.
Se compare `No supported JavaScript runtime could be found`, l'immagine non contiene ancora Deno: fai `git pull`, rebuild senza cache e ricrea il container.

Per verificare in batch quali tracce del catalogo partono davvero:

```bash
docker compose exec clearwave npm run check:tracks:probe
```

Il controllo usa `mpv --ao=null`, quindi prova le sorgenti senza far uscire audio fisico. I report finiscono in `/app/data/reports/`; la guida completa e' in `docs/VERIFICA_CATALOGO_AUDIO.md`.
Per farlo partire da solo, imposta `CLEARWAVE_AUDIO_CHECK_ENABLED=1` nel `.env`: il backend lo esegue in background e la diagnostica admin mostra l'ultimo esito.
Se il check catalogo o `Verifica tutto YouTube` sono in corso, la pagina Admin si aggiorna da sola. Il banner `Auto-refresh attivo` conferma che React sta rileggendo stato e log; premi `Aggiorna diagnostica` solo se vuoi forzare un refresh manuale fuori dai job lunghi.

## Cache locale YouTube per stabilita'

Lo streaming live YouTube non puo' essere garantito al 100%: anche con cookie, Deno e PO token YouTube puo' rifiutare lo stream `googlevideo.com` con `403`. Per rendere stabile l'uso operativo, ClearWave puo' cacheare sul Raspberry i brani YouTube del catalogo whitelist.

Con questa configurazione:

```env
CLEARWAVE_YOUTUBE_CACHE_ENABLED=1
CLEARWAVE_YOUTUBE_CACHE_ON_PLAY=1
CLEARWAVE_YOUTUBE_CACHE_AUDIO_FORMAT=mp3
CLEARWAVE_YOUTUBE_CACHE_TIMEOUT_MS=600000
```

succede questo:

1. al primo play di una traccia YouTube whitelist, il backend prova a scaricare l'audio con `yt-dlp`;
2. il file viene salvato in `uploads/audio/youtube-cache/`;
3. `data/library.json` viene aggiornato con `audioPath`;
4. i play successivi partono da file locale, quindi non dipendono piu' dal link temporaneo `googlevideo.com`.

La cache non viene applicata alle playlist temporanee utente, perche' quelle non fanno parte del catalogo commercial-safe. Prima di affidarti alla cache in produzione conserva sempre la prova licenza/policy del canale.

Controlla lo spazio prima di cacheare tanti brani:

```bash
df -h
du -hxd1 ~/No-Copyright-Music/uploads/audio | sort -h
```

Se lo spazio scende troppo, cancella solo cache YouTube dopo avere fermato ClearWave:

```bash
docker compose stop clearwave
rm -rf ~/No-Copyright-Music/uploads/audio/youtube-cache
docker compose up -d
```

La cancellazione della cache non rimuove i brani dal catalogo, ma al play successivo ClearWave dovra' riscaricarli.

## Cookie YouTube automatici da PC Windows

Se molte tracce YouTube chiedono login, eta o anti-bot, puoi caricare i cookie in modo assistito senza copiare file a mano.

Sul PC dove sei loggato su YouTube:

```powershell
cd "C:\Users\Riccardo\Documents\New project"
.\tools\export-upload-youtube-cookies.ps1 -ClearWaveUrl "http://10.30.10.142:3000" -Browser chrome -Username admin
```

Lo script:

1. usa `yt-dlp --cookies-from-browser chrome`;
2. se Chrome risponde con DPAPI o blocca DevTools, apre la pagina dell'estensione Chrome e aspetta il file `cookies.txt`;
3. crea un `cookies.txt` temporaneo;
4. fa login admin su ClearWave;
5. carica il file nel backend;
6. chiede al Raspberry di provare i cookie con `yt-dlp`, usando una traccia gia' bloccata da login quando esiste nei report;
7. elimina il file temporaneo dal PC, salvo opzione `-KeepFile`.

Se manca `yt-dlp`, installalo con:

```powershell
winget install yt-dlp.yt-dlp
```

Dopo una nuova installazione puo' servire riaprire PowerShell. Lo script prova anche il percorso winget standard; se serve puoi forzarlo con `-YtDlpPath`.
Se `yt-dlp` risponde `Could not copy Chrome cookie database`, rilancia con `-CloseBrowser`: lo script chiude il browser scelto per sbloccare il file cookie prima dell'export.
Se risponde `Failed to decrypt with DPAPI`, segui il prompt: esporta `youtube-cookies.txt` con l'estensione Chrome e premi Invio. In alternativa passa direttamente `-ExistingCookieFile`.
Per testare un video specifico che dava login/bot, aggiungi `-ProbeUrl "https://www.youtube.com/watch?v=ID_VIDEO"`.
Se lo script stampa `Account YouTube autorizzato`, l'account dietro ai cookie e' stato accettato dal Raspberry. Se stampa `Test non conclusivo`, il file cookie e' leggibile ma devi riprovare con `-ProbeUrl` su un video realmente bloccato.

Dopo cookie nuovi:

1. apri Admin -> Diagnostica audio/server;
2. usa `Test cookie YouTube`;
3. se il test e' autorizzato, usa `Riverifica archiviate`;
4. se serve una pulizia completa, lancia `Verifica tutto YouTube` e aspetta il report finale.

Se durante il giro compaiono alcuni `timeout`, non archiviarli subito: su Raspberry possono dipendere da rete o carico. Segui il riepilogo finale e riprova con meno concorrenza se i timeout sono tanti.

## Errori comuni

| Log/errore | Significato probabile | Cosa fare |
| --- | --- | --- |
| `fatal: not a git repository` | Sei in una cartella senza `.git`, spesso dentro al container | Esci dal container e fai `git pull` nella cartella host del progetto |
| Manca `Runtime raspberry-audio-queue...` | Container con codice vecchio | `docker compose build --no-cache clearwave` e `up -d --force-recreate` |
| Socket `/tmp/clearwave-mpv-1.sock` senza `tentativo` | Player vecchio | Ricostruisci immagine o verifica che Docker usi la cartella giusta |
| `Playback open error` / `Unknown error 524` | ALSA non apre quel device | Lascia vuoti `ALSA_CARD` e `CLEARWAVE_AUDIO_DEVICE`, poi usa `aplay -l` |
| `Requested format is not available` | Problema YouTube/formato, non device audio | Verifica `yt-dlp --version` e `CLEARWAVE_YTDL_FORMAT` |
| `HTTP error 403` su `googlevideo.com` | YouTube rifiuta lo stream firmato dopo la risoluzione yt-dlp | Usa il container aggiornato: deve mostrare `yt-dlp` nightly, `bgutil=on/http://127.0.0.1:4416` e fallback `youtube/tv`/`youtube/web-safari-hls`/`youtube/web-embedded` quando `mweb` fallisce subito |
| `No supported JavaScript runtime could be found` | yt-dlp non trova Deno per i controlli JavaScript YouTube | Ricostruisci l'immagine aggiornata e controlla `deno --version` nel container |
| `Sign in to confirm your age` / `not a bot` | YouTube richiede una sessione autenticata | Carica un `cookies.txt` Netscape dal pannello Admin oppure salvalo in `data/youtube-cookies.txt`; il container lo usa come `/app/data/youtube-cookies.txt`. |
| Audit YouTube fermato dopo pochi KO | Le prime tracce chiedono tutte login/anti-bot | Rigenera `cookies.txt` da YouTube loggato, caricalo di nuovo e rilancia l'audit. |
| Playlist importata con 1 solo brano | Link radio/mix `RD...` oppure Data API ha visto solo il video corrente | Usa un link `playlist?list=...`; per playlist normali il backend prova anche `yt-dlp` se la API restituisce solo 1 brano |
| `mpv precedente chiuso per cambio traccia/comando` | Un nuovo play ha sostituito il processo mpv precedente | Non e' un errore finale: vuol dire che React/server hanno cambiato brano o comando prima che il vecchio processo chiudesse |
| `mpv ha completato "... " correttamente (codice 0)` | La traccia e' finita o mpv ha chiuso normalmente | Non e' un errore. Se succede dopo pochi secondi, controlla durata reale della sorgente o eventuali click/skip dalla UI |
| `mpv terminato con codice 4` senza `precedente chiuso` | `mpv` non e' riuscito ad aprire quella sorgente; spesso un video YouTube non disponibile, formato cambiato o stream Jamendo scaduto | Se la traccia successiva parte, la coda sta recuperando. Controlla la riga `Traccia non riprodotta` per sapere quale brano e' stato saltato |
| `SQLite is an experimental feature` | Warning Node su `node:sqlite` | Non blocca l'app, si puo' ignorare |
| Docker Desktop pipe error su Windows | Docker Desktop non e' acceso | Apri Docker Desktop e rilancia il comando |

## Test funzionale rapido

Dopo rebuild:

1. Apri `http://IP_DEL_RASPBERRY:3000`.
2. Fai login.
3. Nel player scegli uscita `Pi`.
4. Avvia una traccia.
5. Guarda i log:

```bash
docker compose logs -f clearwave
```

Il test e' buono se:

- compare la firma `Runtime raspberry-audio-queue-2026-04-29`;
- `mpv` parte con `tentativo`;
- non compaiono processi `mpv` sovrapposti per ogni click;
- il volume cambia dalla UI e resta coerente nei log/stato.

## Cosa mandare quando chiedi aiuto

Quando l'audio non parte, manda sempre questi output:

```bash
docker compose logs --tail=120 clearwave
docker compose exec clearwave sh -lc "grep -n 'raspberry-audio-queue\|playSequence\|tentativo' /app/server.js"
docker compose exec clearwave aplay -l
docker compose exec clearwave aplay -L
docker compose exec clearwave yt-dlp --version
```

Con queste informazioni si capisce subito se il problema e':

- codice vecchio;
- Docker/permessi audio;
- device ALSA sbagliato;
- YouTube/yt-dlp;
- doppio comando player dalla UI.
