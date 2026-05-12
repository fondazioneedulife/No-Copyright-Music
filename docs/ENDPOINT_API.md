# Endpoint API locali

Base URL:

```text
http://localhost:3000
```

Formato risposte:

- le API JSON rispondono con `Content-Type: application/json`;
- gli errori usano in genere `{ "error": "messaggio" }`;
- le API protette richiedono `Authorization: Bearer <token>`;
- le API admin richiedono un token di utente con ruolo `admin`.

## Health

### `GET /api/health`

Controlla se il backend e' attivo.

Risposta:

```json
{ "ok": true }
```

## Autenticazione

### `POST /api/auth/login`

Body:

```json
{
  "username": "admin",
  "password": "password"
}
```

Risposta:

```json
{
  "token": "...",
  "user": {
    "id": "admin",
    "username": "admin",
    "name": "Amministratore",
    "role": "admin",
    "mustChangePassword": true,
    "createdAt": "2026-04-22T00:00:00.000Z",
    "updatedAt": "2026-04-22T00:00:00.000Z"
  }
}
```

### `GET /api/auth/me`

Restituisce l'utente associato al token.

Header:

```text
Authorization: Bearer <token>
```

Risposta con sessione valida:

```json
{ "user": { "username": "admin", "role": "admin" } }
```

Risposta senza sessione:

```json
{ "user": null }
```

### `POST /api/auth/logout`

Elimina il token dalla mappa sessioni in memoria.

Header:

```text
Authorization: Bearer <token>
```

Risposta:

```json
{ "ok": true }
```

### `POST /api/auth/change-password`

Cambia password dell'utente loggato.

Header:

```text
Authorization: Bearer <token>
```

Body:

```json
{
  "currentPassword": "vecchia-password",
  "newPassword": "nuova-password"
}
```

Regole:

- `newPassword` deve avere almeno 6 caratteri;
- la password attuale deve essere valida;
- dopo il cambio `mustChangePassword` diventa `false`.

## Player Raspberry

Questi endpoint richiedono login. Servono a far uscire la musica dal backend/Raspberry invece che dal browser.

### `GET /api/server-player/status`

Restituisce stato del player server-side.

Risposta:

```json
{
  "player": {
    "available": true,
    "command": "mpv",
    "isPlaying": false,
    "isPaused": false,
    "position": 0,
    "duration": 0,
    "volume": 75,
    "outputVolume": 86,
    "volumeGain": 1.15,
    "volumeMax": 130,
    "audioOutput": "alsa",
    "audioPreflight": true,
    "lastExitCode": null,
    "lastFailedTrack": null,
    "ytdlPath": "/usr/bin/yt-dlp",
    "ytdlCookiesConfigured": false,
    "ytdlCookiesAvailable": false,
    "mpvMsgLevel": "all=warn,ytdl_hook=info"
  }
}
```

### `POST /api/server-player/play`

Avvia una traccia su `mpv` lato server.

Gli avvii sono serializzati: se il browser invia piu' richieste `play` ravvicinate, il backend lascia vincere il comando piu' recente e non mantiene processi `mpv` sovrapposti.
Quando React invia `serverContext`, il backend conserva anche la lista di riproduzione e puo' continuare alla traccia successiva anche se la pagina web viene chiusa.

Body:

```json
{
  "trackId": "track-id",
  "track": {},
  "startAt": 0,
  "volume": 0.75,
  "volumePercent": 75,
  "serverContext": {
    "trackIds": ["track-id-1", "track-id-2"],
    "repeatMode": "off",
    "shuffleEnabled": false
  }
}
```

Note:

- `trackId` usa una traccia del catalogo permanente;
- `track` serve per tracce temporanee e viene accettato solo da admin;
- su Raspberry/Docker il comando consigliato e' `mpv` con `yt-dlp`.
- se YouTube richiede login o conferma eta, il backend marca la traccia come non riproducibile e prova la successiva nella coda server.

### `POST /api/server-player/pause`

Body:

```json
{ "paused": true }
```

Con `paused: false` riprende la traccia.

### `POST /api/server-player/seek`

Body:

```json
{ "seconds": 42 }
```

### `POST /api/server-player/volume`

Body:

```json
{ "volume": 0.6, "volumePercent": 60 }
```

`volume` va da `0` a `1`; `volumePercent` e' opzionale e va da `0` a `100`.
Il backend accetta entrambi per evitare errori tra slider percentuale e valore normalizzato.
Su Raspberry il backend puo' applicare `CLEARWAVE_SERVER_VOLUME_GAIN`: per esempio `volumePercent: 55` con gain `1.15` viene inviato a mpv come circa `63`, pur restando `55` nella UI.

### `POST /api/server-player/context`

Aggiorna la coda lato Raspberry senza riavviare il brano corrente.
La UI lo usa quando cambiano coda, shuffle o repeat, cosi' il backend mantiene la continuita' anche senza browser aperto.

Body:

```json
{
  "serverContext": {
    "trackIds": ["track-id-1", "track-id-2"],
    "repeatMode": "all",
    "shuffleEnabled": true
  }
}
```

### `POST /api/server-player/stop`

Ferma il processo `mpv` attivo e pulisce lo stato del player server-side.

## Utenti

Tutti gli endpoint di questa sezione sono solo admin.

### `GET /api/users`

Lista utenti.

Header:

```text
Authorization: Bearer <admin-token>
```

Risposta:

```json
{
  "users": [
    {
      "username": "admin",
      "name": "Amministratore",
      "role": "admin",
      "mustChangePassword": false
    }
  ]
}
```

### `POST /api/users`

Crea utente o admin e restituisce una password temporanea.

Header:

```text
Authorization: Bearer <admin-token>
```

Body:

```json
{
  "name": "Postazione 1",
  "username": "postazione-1",
  "role": "user"
}
```

Risposta:

```json
{
  "user": {
    "username": "postazione-1",
    "role": "user",
    "mustChangePassword": true
  },
  "tempPassword": "CW-..."
}
```

### `POST /api/users/:username/reset-password`

Rigenera una password temporanea per un altro utente e forza il cambio al prossimo login.

Non puo' essere usato sull'utente collegato.

Risposta:

```json
{
  "user": {
    "username": "postazione-1",
    "mustChangePassword": true
  },
  "tempPassword": "CW-..."
}
```

### `DELETE /api/users/:username`

Elimina un utente.

Regole:

- non puo' eliminare l'utente collegato;
- non puo' eliminare l'ultimo admin rimasto;
- invalida eventuali sessioni dell'utente eliminato.

Risposta:

```json
{
  "ok": true,
  "user": {
    "username": "postazione-1"
  }
}
```

## Catalogo

### `GET /api/tracks`

Restituisce il catalogo normalizzato.
Durante la normalizzazione il backend controlla anche il genere: se un titolo YouTube/NCS contiene un tag esplicito come `| DnB |`, `| Speed Garage |` o `| Future Bass |`, quel valore ha priorita' sulle regole testuali piu' generiche.
Se invece una traccia ha gia' un genere specifico salvato da Jamendo o inserito manualmente, il backend lo mantiene e usa le parole del titolo solo come supporto di audit.

Senza query ritorna tutto il catalogo, per compatibilita' con la UI legacy e con strumenti interni.
Con query usa filtri e paginazione lato server, quindi React riceve solo la pagina da renderizzare.

Query opzionali:

| Query | Valori |
| --- | --- |
| `page` | pagina richiesta, default `1` |
| `limit` | card per pagina, default `20`, massimo `80` |
| `q` / `search` | ricerca su titolo, autore, tag, licenza, genere e sorgente |
| `genre` | genere esatto oppure `all` |
| `source` | `youtube`, `jamendo`, `other` oppure `all` |

Risposta:

```json
{
  "tracks": [
    {
      "id": "track-id",
      "title": "Titolo",
      "creatorName": "Autore",
      "genre": "Electronic",
      "genreAudit": "Genere verificato da YouTube title/description (metadata testuali): Electronic",
      "genreConfidence": "alta",
      "coverPath": "/assets/covers/electronic.svg",
      "previewPath": "/api/tracks/track-id/preview.wav",
      "downloadPath": "/api/tracks/track-id/download"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 753,
    "totalPages": 38
  },
  "facets": {
    "genres": ["Electronic", "House"],
    "sources": ["youtube", "jamendo", "other"],
    "totalTracks": 753
  }
}
```

### `GET /api/tracks/:id/preview.wav`

Restituisce una preview WAV generata dal backend.

Uso: fallback quando una traccia non ha audio locale o stream diretto.

### `GET /api/tracks/:id/download`

Scarica il file audio locale, se presente, oppure una preview controllata.

### `POST /api/tracks`

Solo admin. Crea una traccia manuale.

Body tipico:

```json
{
  "title": "Titolo",
  "creatorName": "Autore",
  "genre": "Electronic",
  "license": "Licenza",
  "audioFile": {
    "name": "brano.mp3",
    "type": "audio/mpeg",
    "base64": "..."
  },
  "licenseFile": {
    "name": "licenza.pdf",
    "type": "application/pdf",
    "base64": "..."
  }
}
```

### `DELETE /api/tracks/:id`

Solo admin. Rimuove una traccia dal catalogo.

## Discovery e import

### `GET /api/discovery/providers`

Mostra provider disponibili e stato configurazione.

Query opzionale:

- `rights_mode`: modalita' licenza/diritti.

### `GET /api/discovery/search`

Solo admin. Cerca provider esterni.

Query principali:

| Query | Valori |
| --- | --- |
| `provider` | `jamendo`, `youtube_curated`, `youtube`, `audius`, `theaudiodb`, `all` |
| `q` | testo di ricerca |
| `limit` | numero massimo risultati |
| `rights_mode` | modalita' licenza |

Risposta:

```json
{
  "results": [],
  "providers": [],
  "skipped": []
}
```

### `POST /api/discovery/import`

Solo admin. Importa un risultato discovery selezionato nel catalogo permanente.

### `POST /api/discovery/bulk-import`

Solo admin. Importa lotti progressivi da provider primari, evitando duplicati.
Per YouTube usa solo i canali whitelist commerciali configurati nel backend e conserva lo stato pagina in `data/youtube-import-state.json`.
Se il cursore YouTube salvato non e' piu' valido, il backend riparte dall'inizio del canale invece di bloccare l'import.
L'import legge prima la playlist tecnica degli upload del canale, poi una selezione di playlist pubbliche dello stesso canale; i video di playlist vengono salvati nel catalogo permanente solo se il proprietario del video e' ancora uno dei canali whitelist.
Se gli upload risultano gia' completati nello stato locale, il backend li salta ma continua comunque a leggere le playlist pubbliche del canale.
La UI React invia `youtubeRestartCompleted: true`: in questo modo un canale marcato `completed` viene comunque risondato dagli upload, utile quando il catalogo locale non contiene ancora tutto o lo stato e' vecchio.
La scansione standard della UI e' pensata per canali grandi: legge fino a 20 pagine upload, 30 playlist pubbliche per canale e 80 elementi per playlist, fermandosi comunque quando ha raccolto abbastanza candidati per non saturare quota API e Raspberry.
L'amministratore puo' scegliere dalla UI una dimensione lotto da 120, 250 o 500 tracce; il valore finisce in `maxTracks` e decide quante nuove tracce provare a salvare in quel giro.

Body tipico:

```json
{
  "includeYouTubeChannels": true,
  "limitPerQuery": 10,
  "maxTracks": 120,
  "youtubeChannelMaxPages": 20,
  "youtubeResume": true,
  "youtubeRestartCompleted": true,
  "youtubeScanMultiplier": 8,
  "includeYouTubePlaylists": true,
  "youtubePlaylistScanLimit": 30,
  "youtubePlaylistItemsPerPlaylist": 80
}
```

La risposta include `youtubeProgress`, `skippedSummary` ed `errors`, cosi' la UI puo' spiegare se non sono entrati brani nuovi per duplicati, video troppo brevi, quota API o canali completati.

### `POST /api/admin/youtube-import-state/reset`

Solo admin. Azzera lo stato progressivo di `data/youtube-import-state.json` senza cancellare il catalogo.
Prima del reset, se il file esiste, il backend crea un backup `youtube-import-state.backup-*.json` nella cartella `data`.
Serve quando i cursori YouTube risultano vecchi, un canale e' stato segnato `completed` troppo presto o si vuole rileggere i canali whitelist dall'inizio.

Risposta:

```json
{
  "ok": true,
  "resetAt": "2026-05-05T10:00:00.000Z",
  "previousChannels": 3,
  "backupFile": "youtube-import-state.backup-2026-05-05T10-00-00-000Z.json"
}
```

### `GET /api/admin/diagnostics`

Solo admin. Restituisce diagnostica runtime per Raspberry/audio: versione Node, revisione runtime, configurazione player, stato mpv corrente, versioni `mpv`/`yt-dlp`, device ALSA, risultati del preflight audio e stato del check automatico catalogo.
Non espone valori segreti delle API: indica solo se le chiavi principali sono configurate.
La risposta include anche gli ultimi eventi del player, utili per capire se una traccia e' partita, e' stata sostituita da un comando nuovo o e' terminata correttamente.
Include anche `replacementList`, cioe' la lista runtime delle tracce da sostituire generata dai ricontrolli audio, e `youtubeAudit`, cioe' stato/progresso dell'eventuale verifica completa YouTube in background.

### `POST /api/admin/audio-check/youtube-login-recheck`

Solo admin. Legge gli ultimi report audio in `data/reports`, seleziona le tracce YouTube con errore `youtube-age-or-login`, le ricontrolla con `yt-dlp`/`mpv` e con `CLEARWAVE_YTDL_COOKIES_FILE` se configurato, poi aggiorna `data/audio-replacement-list.json`.

Risposta:

```json
{
  "ok": true,
  "message": "Ricontrollo completato: 2 tracce da sostituire.",
  "candidates": 5,
  "checked": 5,
  "reportJson": "library-audio-check-2026-05-11T10-00-00-000Z.json",
  "replacementList": {
    "summary": {
      "replaceCount": 2,
      "waitingForCookies": 0
    },
    "items": []
  }
}
```

### `POST /api/admin/audio-check/youtube-full-audit`

Solo admin. Avvia in background una verifica di tutte le tracce YouTube del catalogo usando `tools/check-library-audio.js`.
Serve quando il catalogo e' grande e il ricontrollo mirato da 80 tracce non basta: il backend continua a rispondere mentre lo scan procede, la UI legge l'avanzamento da `/api/admin/diagnostics` e alla fine viene aggiornato `data/audio-replacement-list.json`.

Body opzionale:

```json
{
  "mode": "metadata",
  "concurrency": 3,
  "timeoutMs": 25000,
  "sampleSeconds": 4,
  "limit": 0
}
```

Risposta immediata:

```json
{
  "ok": true,
  "message": "Verifica completa YouTube avviata in background: controllo cookie/yt-dlp su tutto il catalogo.",
  "audit": {
    "running": true,
    "checked": 0,
    "total": 0,
    "progress": 0,
    "config": {
      "mode": "metadata",
      "concurrency": 3
    }
  }
}
```

Quando termina, `diagnostics.youtubeAudit.summary` espone `ok`, `failed`, `replaceCount` e `waitingForCookies`.

### `GET /api/admin/audio-check/youtube-full-audit`

Solo admin. Restituisce solo stato del job `Verifica tutto YouTube` e `replacementList`, senza rieseguire la diagnostica completa Raspberry.
La UI lo usa per aggiornare il progresso ogni pochi secondi senza rilanciare i preflight ALSA.

### `POST /api/admin/audio-check/cleanup-broken`

Solo admin. Legge `data/audio-replacement-list.json`, crea un backup del catalogo in `data/library-before-audio-cleanup-*.json` e archivia le tracce confermate non riproducibili, per esempio `youtube-unavailable`, `youtube-format`, `stream-not-playable`, `missing-source` e `missing-file`. Le tracce non vengono cancellate: restano in `library.json` con `availabilityStatus: "unavailable"` e `hiddenFromCatalog: true`.

Risposta:

```json
{
  "ok": true,
  "archived": 42,
  "removed": 0,
  "backupFile": "library-before-audio-cleanup-2026-05-12T10-30-00-000Z.json"
}
```

### `POST /api/admin/audio-check/recheck-archived`

Solo admin. Ricontrolla le tracce YouTube archiviate con i cookie attuali. Se una traccia torna `ok`, il backend crea un backup del catalogo e la riattiva togliendo `hiddenFromCatalog`.

Risposta:

```json
{
  "ok": true,
  "checked": 120,
  "restored": 8,
  "backupFile": "library-before-audio-cleanup-2026-05-12T10-45-00-000Z.json"
}
```

### `POST /api/admin/youtube-cookies`

Solo admin. Riceve un file `cookies.txt` Netscape esportato da una sessione YouTube autorizzata e lo salva in `data/youtube-cookies.txt`, cioe' il percorso automatico usato dal player Docker/Raspberry. Il backend valida che il testo contenga cookie YouTube/Google e cookie di sessione login, ma non restituisce mai il contenuto del file.

Body:

```json
{
  "cookiesText": "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t..."
}
```

Risposta:

```json
{
  "ok": true,
  "message": "Cookie YouTube installati. Il prossimo play usa la sessione autorizzata.",
  "cookies": {
    "configured": true,
    "available": true,
    "path": "/app/data/youtube-cookies.txt",
    "source": "default"
  }
}
```

### `POST /api/admin/youtube-cookies/probe`

Solo admin. Esegue un test singolo con `yt-dlp`, Deno e i cookie caricati per capire se YouTube accetta davvero la sessione dal Raspberry. Non stampa mai i valori dei cookie.

Risposta:

```json
{
  "ok": true,
  "reason": "ok",
  "message": "Me at the zoo | public",
  "probe": {
    "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "durationMs": 1200,
    "exitCode": 0,
    "title": "Me at the zoo | public"
  }
}
```

### `GET /api/admin/export/catalog.json`

Solo admin. Scarica un backup JSON del catalogo permanente.
Il file contiene `exportedAt`, revisione runtime, numero tracce e array `tracks` letto da `data/library.json`.
Non include password, token o segreti API.

### `POST /api/admin/import/catalog-backup`

Solo admin. Ripristina il catalogo da un backup JSON esportato da ClearWave.
Prima di sovrascrivere `data/library.json`, il backend crea automaticamente un file `library.backup-*.json` nella cartella `data`.

Body:

```json
{
  "tracks": []
}
```

Risposta:

```json
{
  "ok": true,
  "importedCount": 753,
  "backupFile": "library.backup-2026-05-05T10-00-00-000Z.json"
}
```

### `GET /api/admin/export/licenses.csv`

Solo admin. Scarica un CSV per controllo licenze e fonti.
Ogni riga contiene titolo, autore, provider, genere, licenza, dettaglio licenza, URL licenza, stato commerciale, note diritti, fonte e data import.
Serve come report operativo prima dell'uso commerciale: le licenze vanno comunque verificate e conservate quando richiesto dal provider.

### `GET /api/admin/export/licenses.html`

Solo admin. Scarica lo stesso report licenze in formato HTML, con riepiloghi per provider, licenza e stato commerciale.
Serve per leggere o stampare rapidamente il report senza passare da Excel.

### `POST /api/discovery/import-link`

Solo admin. Importa da link esterno nel catalogo permanente, quando il link e' accettato.

Body:

```json
{
  "url": "https://...",
  "maxTracks": 50
}
```

Supporta:

- video YouTube;
- playlist YouTube;
- canali YouTube whitelist;
- tracce Jamendo.

### `POST /api/session/import-link`

Solo admin. Importa link YouTube temporanei nella sessione, senza salvarli nel catalogo sicuro.

Uso: ascolto o prova rapida senza archiviazione permanente.

Per le playlist prova prima la YouTube Data API; se la playlist non e' leggibile dalla API, usa `yt-dlp`
come fallback server-side. Questo evita il caso in cui un link `watch?v=...&list=...` importi solo il
video corrente invece dell'intera playlist.

Se la Data API risponde ma restituisce un solo brano da una playlist normale, il backend prova comunque
`yt-dlp` per espandere la playlist temporanea. I link `start_radio=1` o con playlist `RD...` sono invece
mix/radio automatici di YouTube: in quel caso viene importato solo il video corrente perche' non sono
playlist API stabili.

## Media

### `GET /api/covers/jamendo/:trackId.jpg`

Proxy/redirect verso la copertina originale Jamendo.

### `GET /api/providers/audius/:id/stream`

Proxy stream Audius, solo se `AUDIUS_API_KEY` e' configurata.

### `GET /uploads/...`

Serve audio e licenze caricati localmente.

Il backend controlla che il percorso richiesto resti dentro `uploads/`.

### `GET /assets/...`

Serve asset statici, incluse copertine locali.

### `GET /styles/...`

Serve CSS legacy.

### `GET /src/...`

Serve moduli JavaScript legacy.

## React

### `GET /`

Serve la UI React principale buildata in `frontend/dist`.

### `GET /legacy`

Serve la UI legacy di fallback.

### `GET /react/`

Serve la stessa build React come alias compatibile se e' stata generata con:

```powershell
npm run build:react
```

### `GET /react/assets/...`

Serve asset generati da Vite dentro `frontend/dist/assets/`.

## Endpoint disattivati

### `POST /api/covers/generate`

Endpoint mantenuto solo per compatibilita'. Le copertine AI sono state rimosse.
