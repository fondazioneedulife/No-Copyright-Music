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

Prima controlla dove sei:

```bash
pwd
ls -la
```

Se nella lista non vedi `.git`, quella cartella non e' un clone Git. Devi entrare nella cartella corretta o clonare il progetto.

Se `.git` esiste:

```bash
git fetch
git pull
```

Se `git pull` non cambia nulla ma il container resta vecchio, controlla che Docker stia buildando questa stessa cartella:

```bash
pwd
cat docker-compose.yml | head
```

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
CLEARWAVE_YTDL_FORMAT=bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best
CLEARWAVE_MPV_MSG_LEVEL=all=warn,ytdl_hook=info
```

Motivo: ClearWave prova prima il default ALSA e scarta automaticamente i device che non si aprono.

Imposta `ALSA_CARD` o `CLEARWAVE_AUDIO_DEVICE` solo dopo aver letto `aplay -l` e `aplay -L`.

## Rebuild pulito

Quando devi essere sicuro che il container stia usando il codice nuovo:

```bash
docker compose down --remove-orphans
docker compose build --no-cache clearwave
docker compose up -d --force-recreate
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
```

Nei log di avvio deve comparire:

```text
[startup] Controllo aggiornamento yt-dlp...
[startup] yt-dlp aggiornato:
```

Se YouTube restituisce `Requested format is not available`, il problema non e' ALSA: `mpv` e' partito, ma YouTube non ha dato uno stream compatibile. In quel caso ricrea il container e controlla `CLEARWAVE_YTDL_FORMAT`.

## Errori comuni

| Log/errore | Significato probabile | Cosa fare |
| --- | --- | --- |
| `fatal: not a git repository` | Sei in una cartella senza `.git`, spesso dentro al container | Esci dal container e fai `git pull` nella cartella host del progetto |
| Manca `Runtime raspberry-audio-queue...` | Container con codice vecchio | `docker compose build --no-cache clearwave` e `up -d --force-recreate` |
| Socket `/tmp/clearwave-mpv-1.sock` senza `tentativo` | Player vecchio | Ricostruisci immagine o verifica che Docker usi la cartella giusta |
| `Playback open error` / `Unknown error 524` | ALSA non apre quel device | Lascia vuoti `ALSA_CARD` e `CLEARWAVE_AUDIO_DEVICE`, poi usa `aplay -l` |
| `Requested format is not available` | Problema YouTube/formato, non device audio | Verifica `yt-dlp --version` e `CLEARWAVE_YTDL_FORMAT` |
| `mpv terminato con codice 4` | `mpv` non e' riuscito ad aprire quella sorgente; spesso un video YouTube non disponibile o formato cambiato | Se la traccia successiva parte, la coda sta recuperando. Controlla la riga `Traccia non riprodotta` per sapere quale brano e' stato saltato |
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
