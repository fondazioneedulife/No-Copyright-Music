# Verifica catalogo audio

Questa guida serve per controllare se le tracce del catalogo ClearWave partono davvero.
Il controllo non modifica `data/library.json`: legge il catalogo, prova le sorgenti e salva un report in `data/reports/`.

## Quando usarla

Usala quando:

- alcune canzoni non partono;
- vuoi sapere quali link YouTube sono bloccati, rimossi o richiedono login;
- vuoi scoprire URL Jamendo scaduti o file upload mancanti;
- prima di una consegna vuoi avere una lista delle tracce realmente riproducibili.

## Comando consigliato su Raspberry

Esegui dentro il progetto gia' aggiornato:

```bash
cd ~/No-Copyright-Music
docker compose exec clearwave npm run check:tracks:probe
```

`probe` usa `mpv --ao=null`: la traccia viene aperta davvero per alcuni secondi, ma non esce audio fisico dalle casse.
Questo evita di disturbare mentre fai il controllo e verifica comunque se `mpv`, `yt-dlp`, Jamendo e gli stream diretti riescono a partire.

## Check automatico

Se vuoi che ClearWave controlli il catalogo da solo, abilita nel `.env`:

```env
CLEARWAVE_AUDIO_CHECK_ENABLED=1
CLEARWAVE_AUDIO_CHECK_ON_START=1
CLEARWAVE_AUDIO_CHECK_MODE=probe
CLEARWAVE_AUDIO_CHECK_INTERVAL_HOURS=24
CLEARWAVE_AUDIO_CHECK_CONCURRENCY=2
```

Poi ricrea il container:

```bash
docker compose down
docker compose up -d --build
```

Il backend aspetta qualche secondo, lancia il controllo in background e poi lo ripete ogni 24 ore.
L'app resta utilizzabile; dalla diagnostica admin puoi vedere se il controllo e' in corso e l'ultimo riepilogo `OK/KO`.

## Controllo rapido

Per un test corto:

```bash
docker compose exec clearwave npm run check:tracks:quick
```

Oppure:

```bash
docker compose exec clearwave node tools/check-library-audio.js --mode metadata --limit 50
```

`metadata` e' piu' veloce: YouTube viene risolto con `yt-dlp`, gli stream diretti vengono aperti con una richiesta corta.
Non e' forte quanto `probe`, ma aiuta a capire subito se ci sono problemi grossi.

## Controllo per provider

Solo YouTube:

```bash
docker compose exec clearwave node tools/check-library-audio.js --mode probe --provider youtube --concurrency 1 --only-errors
```

Solo Jamendo:

```bash
docker compose exec clearwave node tools/check-library-audio.js --mode probe --provider jamendo --concurrency 2 --only-errors
```

Solo file caricati:

```bash
docker compose exec clearwave node tools/check-library-audio.js --mode source --provider upload
```

## Report generati

Ogni esecuzione crea:

```text
/app/data/reports/library-audio-check-*.json
/app/data/reports/library-audio-check-*.csv
```

Per copiarli fuori dal container:

```bash
docker compose cp clearwave:/app/data/reports ./reports
```

Il JSON contiene:

- modalita usata;
- numero tracce controllate;
- riepilogo `ok` e `failed`;
- conteggio per provider;
- conteggio per motivo errore;
- dettaglio traccia per traccia.

## Motivi errore principali

| Motivo | Significato | Cosa fare |
| --- | --- | --- |
| `youtube-age-or-login` | YouTube richiede login, cookie, conferma eta o verifica anti-bot. | Carica `cookies.txt` dal pannello Admin o salva `data/youtube-cookies.txt`; se fallisce ancora, sostituisci la traccia con una sorgente pubblica. |
| `youtube-unavailable` | Video rimosso, privato, non disponibile o bloccato. | Sostituisci il brano. |
| `youtube-format` | `yt-dlp` non trova un formato audio compatibile. | Controlla versione `yt-dlp` e `CLEARWAVE_YTDL_FORMAT`. |
| `forbidden` | Stream vietato o URL firmato non piu' valido. | Per Jamendo controlla `JAMENDO_CLIENT_ID`; per altri provider reimporta. |
| `missing-source` | La traccia non ha una sorgente audio reale. | Rimuovi o correggi la traccia. |
| `missing-file` | File locale caricato non trovato in `uploads/audio`. | Ripristina il file o rimuovi la traccia. |
| `stream-not-playable` | `mpv` non riesce a decodificare lo stream. | Reimporta o sostituisci la sorgente. |
| `timeout` | La sorgente non risponde in tempo. | Riprova; se resta, considera la traccia instabile. |
| `missing-tool` | Mancano `mpv` o `yt-dlp`. | Ricostruisci il container con il Dockerfile aggiornato. |

## Note importanti

- Su cataloghi grandi il controllo completo puo' durare molto. Usa `--concurrency 2` sul Raspberry per non saturarlo.
- `probe` verifica l'avvio reale, non ascolta tutta la canzone fino alla fine. Se vuoi essere piu' severo aumenta `--sample-seconds`.
- Per Jamendo lo script prova a ottenere un link fresco quando `JAMENDO_CLIENT_ID` e' configurato.
- Il report non cancella automaticamente le tracce rotte: prima controlla gli errori, poi decidi cosa rimuovere o reimportare.
- Dal pannello admin puoi usare `Ricontrolla login YouTube`: legge gli ultimi report, ricontrolla solo le tracce `youtube-age-or-login` e aggiorna `data/audio-replacement-list.json` con le tracce da sostituire.
