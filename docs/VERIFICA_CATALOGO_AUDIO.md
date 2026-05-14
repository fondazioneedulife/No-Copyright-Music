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
Durante un check attivo il pannello Admin usa l'auto-refresh: aggiorna periodicamente stato, percentuale, log e ultimo riepilogo senza premere ogni volta `Aggiorna diagnostica`. Il refresh completo e' volutamente piu' lento del refresh dell'audit YouTube, cosi' il Raspberry non perde tempo a rifare continuamente probe ALSA e comandi di diagnostica.

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

## Verifica completa YouTube dal pannello Admin

Quando il catalogo contiene migliaia di video YouTube, usa il pannello Admin:

1. apri `Impostazioni`;
2. controlla che `Cookie YouTube` sia `OK / Attivi`;
3. premi `Verifica tutto YouTube`;
4. lascia lavorare il backend: lo stato viene aggiornato nella diagnostica ogni pochi secondi.

Il pulsante avvia un job in background, quindi la web app resta usabile e il player Raspberry puo' continuare a suonare.
La modalita predefinita e' `metadata`: risolve ogni video con `yt-dlp` e cookie, segnando quelli ancora bloccati da login, bot, video rimossi o formato non disponibile.
Alla fine aggiorna `data/audio-replacement-list.json` con le tracce da sostituire e salva il report completo in `data/reports/`.
Il progresso puo' restare basso per qualche minuto all'inizio perche' il backend sta preparando il catalogo, caricando cookie e aprendo le prime richieste `yt-dlp`. Durante il giro puoi vedere righe `OK` e `KO`: non prendere ogni `KO timeout` come definitivo finche' il report finale non e' scritto. Su Raspberry i timeout possono dipendere da rete, quota, carico CPU o risposte lente di YouTube.
Quando il report conferma tracce `youtube-unavailable` o altri errori definitivi, il pannello Admin mostra `Archivia non disponibili`: il backend crea prima un backup del catalogo, poi marca quelle tracce come `availabilityStatus: "unavailable"` e le nasconde dalla libreria attiva senza cancellarle.
Dopo avere caricato cookie nuovi puoi usare `Riverifica archiviate`: ClearWave controlla solo le tracce YouTube nascoste e riattiva automaticamente quelle che `yt-dlp` riesce di nuovo a leggere.

Non sostituire migliaia di video a mano. Se l'audit mostra tantissimi KO YouTube:

1. controlla prima `Cookie YouTube`, `yt-dlp` e `Deno/JS` nella diagnostica;
2. usa `Test cookie YouTube`: fa una prova singola dal Raspberry con i cookie caricati;
3. ricostruisci il container se manca Deno o compare `No supported JavaScript runtime`;
4. rilancia `Verifica tutto YouTube`;
5. sostituisci in blocco solo i KO residui confermati dal report finale.

L'audit completo ha una protezione anti-report-sporco: se le prime tracce controllate sono tutte `youtube-age-or-login`, il backend ferma automaticamente il job. In quel caso il problema non sono migliaia di brani singoli, ma cookie YouTube non accettati o account bloccato da verifica anti-bot.
Il controllo cookie distingue tre livelli: file presente, cookie di sessione dentro al file, e prova reale `yt-dlp` accettata da YouTube. Solo il terzo conferma che il Raspberry puo' riprodurre YouTube in quel momento.

Quando il check finisce:

1. leggi il riepilogo `ok`, `failed`, `replaceCount` e i motivi errore;
2. se dominano `youtube-age-or-login`, rigenera/carica cookie e usa `Test cookie YouTube`;
3. se dominano `timeout`, rilancia un giro con concorrenza piu' bassa o in un momento di rete piu' stabile;
4. se dominano `youtube-unavailable`, usa `Archivia non disponibili` invece di cancellare a mano;
5. dopo nuovi cookie usa `Riverifica archiviate` per recuperare brani nascosti che tornano disponibili.

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
| `youtube-js-runtime` | `yt-dlp` non trova un runtime JavaScript per risolvere YouTube. | Ricostruisci Docker: l'immagine aggiornata installa Deno e usa `CLEARWAVE_YTDL_JS_RUNTIME`. |
| `forbidden` | Stream vietato o URL firmato non piu' valido. | Per Jamendo controlla `JAMENDO_CLIENT_ID`; per altri provider reimporta. |
| `missing-source` | La traccia non ha una sorgente audio reale. | Rimuovi o correggi la traccia. |
| `missing-file` | File locale caricato non trovato in `uploads/audio`. | Ripristina il file o rimuovi la traccia. |
| `stream-not-playable` | `mpv` non riesce a decodificare lo stream. | Reimporta o sostituisci la sorgente. |
| `timeout` | La sorgente non risponde in tempo. | Riprova con rete stabile o concorrenza piu' bassa; se resta in piu' report, considera la traccia instabile. |
| `missing-tool` | Mancano `mpv` o `yt-dlp`. | Ricostruisci il container con il Dockerfile aggiornato. |

## Note importanti

- Su cataloghi grandi il controllo completo puo' durare molto. Usa `--concurrency 2` sul Raspberry per non saturarlo.
- Se il pannello Admin mostra `Auto-refresh attivo`, lo stato si aggiorna da solo: non serve premere manualmente `Aggiorna diagnostica` mentre il job e' in corso.
- `probe` verifica l'avvio reale, non ascolta tutta la canzone fino alla fine. Se vuoi essere piu' severo aumenta `--sample-seconds`.
- Per Jamendo lo script prova a ottenere un link fresco quando `JAMENDO_CLIENT_ID` e' configurato.
- Il report non cancella automaticamente le tracce rotte: prima controlla gli errori, poi decidi cosa rimuovere o reimportare.
- Dal pannello admin puoi usare `Ricontrolla login YouTube`: legge gli ultimi report, ricontrolla solo le tracce `youtube-age-or-login` e aggiorna `data/audio-replacement-list.json` con le tracce da sostituire.
- Per controllare tutto YouTube, usa `Verifica tutto YouTube`: e' piu' lenta del ricontrollo mirato, ma copre anche tracce mai finite in un report precedente.
- `Archivia non disponibili` agisce solo su errori considerati definitivi, salva prima `data/library-before-audio-cleanup-*.json` e lascia le tracce in `library.json` per eventuale recupero.
- `Riverifica archiviate` usa i cookie attuali e riporta nel catalogo attivo le tracce archiviate che tornano OK.
