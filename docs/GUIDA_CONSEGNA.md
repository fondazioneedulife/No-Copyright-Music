# Guida consegna ClearWave

Questa guida riassume i passaggi essenziali per portare ClearWave sul Raspberry, testarlo e lasciarlo pronto all'uso.
Per il manuale completo del progetto leggi `docs/DOCUMENTAZIONE_COMPLETA.md`.

## Cosa consegnare

- UI React principale su `http://IP_DEL_RASPBERRY:3000`.
- Backend Node nello stesso container Docker.
- Catalogo persistente in `data/library.json`.
- Utenti admin/user in `data/clearwave-auth.sqlite`.
- Audio e allegati licenza in `uploads/`.
- Player server-side con audio fisico dal Raspberry tramite `mpv`.

## Aggiornare il Raspberry

Esegui sempre i comandi nella cartella del progetto sull'host Raspberry:

```bash
cd ~/No-Copyright-Music
sh tools/update-raspberry.sh
```

Lo script evita `--no-cache` di default e pulisce cache/immagini Docker inutilizzate senza cancellare volumi. Se serve davvero una build pulita per Dockerfile o dipendenze cambiate, usa `CLEARWAVE_NO_CACHE=1 sh tools/update-raspberry.sh`.

Se l'aggiornamento fallisce con `No space left on device`, libera prima spazio sul Raspberry:

```bash
df -h
docker system df
docker builder prune -af
docker image prune -af
docker container prune -f
```

Se resta pieno:

```bash
docker system prune -af
sudo journalctl --vacuum-time=3d
sudo apt clean
```

Non cancellare `data/`, `uploads/` o `youtube-cookies.txt`: sono dati dell'app, non cache.

Nei log iniziali devono comparire:

```text
[startup] yt-dlp aggiornato:
ClearWave Library attiva su http://localhost:3000
[server-player] Runtime raspberry-audio-queue-2026-04-29: queue=on, preflight=on, ...
```

## Variabili minime Raspberry

Nel file `.env` del Raspberry:

```env
CLEARWAVE_DOCKER_PRIVILEGED=true
CLEARWAVE_SERVER_PLAYER=1
CLEARWAVE_AUDIO_OUTPUT=alsa
CLEARWAVE_AUDIO_PREFLIGHT=1
CLEARWAVE_UPDATE_YTDLP_ON_START=1
CLEARWAVE_YTDL_PATH=/usr/bin/yt-dlp
CLEARWAVE_YTDL_FORMAT=bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best
```

All'inizio lascia vuoti `ALSA_CARD` e `CLEARWAVE_AUDIO_DEVICE`. Se la diagnostica mostra un device stabile, puoi fissarlo dopo.

## Test finale

1. Apri `http://IP_DEL_RASPBERRY:3000`.
2. Entra come admin.
3. Vai in `Impostazioni` e premi `Aggiorna diagnostica`.
4. Controlla che `mpv`, `yt-dlp` e almeno un preflight audio siano `OK`.
5. Avvia una traccia YouTube.
6. Avvia una traccia Jamendo.
7. Chiudi la pagina o il browser durante la riproduzione in modalita' `Pi`: la musica deve continuare dal Raspberry.
8. Riapri la pagina e verifica che il player si riallinei allo stato del server.
9. Prova play/pausa, next, prev, shuffle e repeat.
10. Cambia volume con slider e input numerico, per esempio `30`, `60`, `85`.
11. Se usi YouTube, controlla `Cookie YouTube`: deve essere `OK / Attivi`; se serve carica un `cookies.txt` nuovo.
12. Avvia `Verifica tutto YouTube` solo dopo il test cookie: mentre gira deve comparire `Auto-refresh attivo`.
13. Importa un lotto da `120` tracce.
14. Esporta `Backup catalogo`, `Report licenze` e `Report HTML`.
15. Premi `Importa backup` solo se devi ripristinare: il backend salva prima una copia automatica del catalogo corrente.

## Import musica

`Aggiungi brani` permette:

- import temporaneo da link YouTube, non salvato nel catalogo;
- import permanente da link, solo admin;
- import lotto `120`, `250` o `500`, solo admin;
- ricerca provider esterni.

I canali YouTube permanenti sono whitelist:

- NoCopyrightSounds;
- Infraction - No Copyright Music;
- BreakingCopyright - Royalty Free Music.

Il reset `Reset scan YouTube` non cancella brani. Azzera solo i cursori di import e crea prima un backup dello stato in `data/`.

## Backup e report

Nel pannello admin:

- `Backup catalogo` scarica un JSON con tutte le tracce di `data/library.json`;
- `Importa backup` ripristina un JSON ClearWave e crea prima `data/library.backup-*.json`;
- `Report licenze` scarica un CSV con fonte, autore, licenza, note diritti e stato commerciale;
- `Report HTML` crea una versione leggibile/stampabile del report.

Il report non sostituisce la verifica legale finale: serve a sapere da dove arrivano le tracce e quali prove conservare.

## Errori comuni

| Sintomo | Significato | Cosa fare |
| --- | --- | --- |
| `Playback open error` | ALSA non apre il device audio | Usa diagnostica admin, poi prova `ALSA_CARD` o `CLEARWAVE_AUDIO_DEVICE`. |
| `No space left on device` | SD piena per cache Docker/log/sistema | Usa i comandi di pulizia spazio sopra, poi rilancia `sh tools/update-raspberry.sh`. |
| `Requested format is not available` | YouTube/yt-dlp non trova uno stream compatibile | Ricostruisci senza cache e controlla `yt-dlp --version`. |
| `Sign in to confirm your age` / `not a bot` | YouTube richiede cookie/sessione autorizzata | Carica `cookies.txt`, usa `Test cookie YouTube`, poi rilancia `Verifica tutto YouTube`. |
| Tanti `timeout` nel check YouTube | Rete lenta, Raspberry carico o YouTube lento | Aspetta il report finale; se restano molti timeout, rifai il giro con meno concorrenza. |
| `youtube-error` o `exit-1` | Errore generico di `yt-dlp`/`mpv`; nei nuovi report c'e' anche il messaggio breve | Leggi la riga nella diagnostica o apri il JSON in `data/reports`; spesso serve cookie nuovo, rete stabile o archiviazione del video. |
| `youtube-expired-url` o URL `googlevideo.com` | E' stato salvato uno stream temporaneo invece del video YouTube originale | Reimporta dal link YouTube o aggiungi `youtubeVideoId`; lo stream diretto scade e non va usato come sorgente stabile. |
| `youtube-stream-open-failed` | `yt-dlp` risolve YouTube ma `mpv` non apre lo stream firmato | Riprova; se si ripete, controlla cookie/account YouTube e rete del container. |
| `mpv precedente chiuso per cambio traccia/comando` | Un nuovo comando ha sostituito il vecchio mpv | Non e' un errore se la traccia successiva parte. |
| `mpv ha completato ... codice 0` | Traccia terminata correttamente | Normale. |
| Importa poche tracce | Molti duplicati o filtri durata/licenza | Usa lotto piu' grande o reset scan YouTube. |

## Cookie YouTube e audit

Per YouTube su Raspberry, i cookie sono un file di sessione, non una configurazione permanente eterna. Quando scadono o YouTube richiede una verifica, ClearWave mostra un popup admin ogni 10 minuti finche' non carichi un file nuovo.

Procedura piu' sicura:

1. esporta o carica `cookies.txt` dal PC dove YouTube e' loggato;
2. usa `Test cookie YouTube`;
3. se leggi `Account YouTube autorizzato`, rilancia `Verifica tutto YouTube`;
4. se il report finale contiene tracce definitive non disponibili, usa `Archivia non disponibili`;
5. dopo cookie nuovi usa `Riverifica archiviate` per recuperare brani nascosti.

## Comandi utili

```bash
docker compose ps
docker compose logs -f clearwave
docker compose exec clearwave yt-dlp --version
docker compose exec clearwave mpv --version
docker compose exec clearwave aplay -l
docker compose exec clearwave aplay -L
```

## File importanti

- `Dockerfile`: immagine unica backend + React + mpv + yt-dlp.
- `docker-compose.yml`: servizio `clearwave`, porta, volumi e audio Raspberry.
- `server.js`: API, import, player Raspberry e export admin.
- `frontend/src/App.jsx`: stato React globale.
- `frontend/src/components/AdminPanel.jsx`: utenti, diagnostica, reset scan, backup, ripristino e report.
- `frontend/src/components/PlayerDock.jsx`: player inferiore e volume.
- `docs/GUIDA_RASPBERRY_DOCKER_AUDIO.md`: guida dettagliata audio Docker/Raspberry.
