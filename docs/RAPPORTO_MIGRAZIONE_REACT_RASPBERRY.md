# Rapporto Migrazione React e Raspberry

Questo documento riassume il lavoro fatto finora su ClearWave per:

- portare l'interfaccia principale dalla UI legacy a React;
- collegare la riproduzione audio al backend, in modo che il suono possa uscire dal Raspberry Pi;
- preparare una dockerizzazione piu' semplice da gestire.

Data riferimento: `2026-04-24`.

## Obiettivo del lavoro

L'obiettivo non era solo rifare la grafica, ma ottenere una nuova UI React che:

1. usi lo stesso backend locale gia' esistente;
2. mantenga catalogo, utenti, SQLite, import e upload;
3. sia piu' vicina possibile ai flussi della vecchia app;
4. possa pilotare il player dal browser mentre l'audio esce dal Raspberry Pi;
5. sia pronta per essere eseguita in Docker con una configurazione semplice.

## Stato generale

Al momento ClearWave ha:

- UI React principale servita da `/`;
- UI legacy tenuta come fallback su `/legacy`;
- backend Node unico in `server.js`;
- player React con controllo `PC` / `Pi`;
- player server-side con `mpv`;
- Docker semplificato in un solo `docker-compose.yml`.

## Lavoro fatto sulla UI React

### Struttura generale

La nuova app React e' diventata la UI principale del progetto.

File chiave:

- `frontend/src/App.jsx`
- `frontend/src/components/`
- `frontend/src/styles/app.css`
- `frontend/src/api/client.js`

### Interventi principali fatti

- topbar resa piu' stabile e bloccata in alto;
- sidebar resa fissa e piu' coerente con la vecchia app;
- rimozione di elementi che non servivano piu' nella nuova versione;
- player in basso ridisegnato con pulsanti piu' compatti;
- testo brano nel player reso piu' leggibile e con movimento controllato;
- aggiunta modalita' di uscita audio `PC` / `Pi`;
- gestione migliore della playlist temporanea;
- pulizia della sessione temporanea all'uscita;
- varie correzioni di layout per ridurre l'effetto troppo "zoomato".

### Verifica legacy -> React

E' stato fatto un confronto diretto tra i pannelli legacy in `partials/` e i componenti React in `frontend/src/components/`.

Pannelli verificati in particolare:

- `partials/discovery.html`
- `partials/playlists.html`
- `partials/player.html`
- `partials/sidebar.html`
- `partials/studio.html`

Elementi mantenuti o riportati in React:

- sezione import e playlist temporanea;
- mix automatici per genere;
- coda di ascolto;
- archivio licenze e upload;
- player fisso in basso;
- navigazione laterale coerente con i flussi principali.

Elementi legacy non riportati volutamente nella nuova UI:

- right rail con shortlist / pacchetto commerciale;
- blocco workspace laterale;
- sezione `In riproduzione / browse` nel pannello playlist.

Queste parti non sono state perse per errore: sono state escluse perche' richieste come rimozione durante il redesign React.

## Lavoro fatto sul backend

Il backend resta concentrato in `server.js`.

### Funzioni gia' presenti e mantenute

- autenticazione locale con SQLite;
- gestione utenti admin/user;
- catalogo permanente in JSON;
- upload audio e allegati licenza;
- import discovery;
- routing legacy e React;
- preview WAV di fallback.

### Nuovo player server-side

E' stato aggiunto un ramo API per comandare il player sul server:

- `GET /api/server-player/status`
- `POST /api/server-player/play`
- `POST /api/server-player/pause`
- `POST /api/server-player/seek`
- `POST /api/server-player/volume`
- `POST /api/server-player/stop`

Il frontend React usa questi endpoint quando l'uscita audio selezionata e' `Pi`.

### Logica audio lato server

Il backend:

1. riceve la traccia dal frontend;
2. risolve la sorgente corretta;
3. avvia `mpv`;
4. tiene uno stato player in memoria;
5. espone stato, volume, seek, pausa e stop al frontend.

Sono stati aggiunti anche:

- log piu' leggibili per `mpv`;
- gestione errori piu' chiara per ALSA e YouTube;
- pulizia migliore dello stato quando `mpv` termina.
- formato YouTube audio-only per evitare l'errore `Requested format is not available` sul Raspberry.

## Lavoro fatto sul player browser

Oltre al ramo Raspberry, e' stato corretto anche il fallback locale su PC:

- miglior controllo delle sorgenti browser;
- gestione migliore delle tracce YouTube embed;
- fallback alla preview backend quando uno stream diretto fallisce;
- messaggi di stato nel player per capire meglio cosa sta succedendo.

Questo era importante perche' il progetto deve restare usabile anche quando si prova dal PC.

### Rifiniture chiuse oggi

Nell'ultimo passaggio sono state chiuse alcune parti rimaste a meta':

- resume corretto del player Raspberry senza riavviare `mpv` quando il brano e' gia' caricato;
- sincronizzazione piu' robusta della UI React con lo stato del player server-side;
- pulizia completa del player locale/embed al logout;
- bug fix del pulsante `Play` nella coda playlist React;
- sessione temporanea admin resa piu' esplicita e piu' vicina al flusso legacy;
- messaggi sessione migliorati per distinguere nuove tracce e duplicati gia' presenti.

## Docker

### Situazione precedente

La configurazione Docker si stava dividendo in piu' file.

### Situazione attuale

Adesso l'obiettivo e' tenere una gestione piu' semplice:

- `Dockerfile`
- un solo `docker-compose.yml`

Il file compose unico contiene:

- build del servizio;
- porte;
- bind mount persistenti verso `./data` e `./uploads`;
- variabili ambiente;
- opzioni per il player server-side.

Per Raspberry Pi la parte audio si controlla con le variabili:

- `CLEARWAVE_DOCKER_PRIVILEGED`
- `CLEARWAVE_AUDIO_OUTPUT`
- `CLEARWAVE_AUDIO_DEVICE`
- `ALSA_CARD`
- `CLEARWAVE_YTDL_PATH`
- `CLEARWAVE_YTDL_FORMAT`

La parte YouTube usa `yt-dlp` scaricato nel Dockerfile in `/usr/local/bin/yt-dlp`, non il pacchetto Debian, per ridurre i blocchi causati da cambiamenti frequenti nei formati YouTube.

### Collaudo Docker consigliato

Su PC Windows:

```powershell
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f clearwave
```

Su Raspberry Pi:

```bash
docker compose up -d --build
docker compose logs -f clearwave
```

Endpoint minimi da controllare dopo l'avvio:

- `GET /api/health`
- `GET /api/tracks`
- `POST /api/auth/login`
- `GET /api/server-player/status`

Flusso manuale da provare nell'app:

1. login admin;
2. apertura catalogo React;
3. play di un brano con uscita `Pi`;
4. pausa/resume;
5. seek dalla barra;
6. modifica volume;
7. logout e verifica che audio e sessioni temporanee si puliscano.

Se sul PC Docker non ha accesso a un device audio ALSA, e' normale che il player server-side possa fallire: la prova audio reale va fatta sul Raspberry.

## Come leggere il progetto

Questa sezione serve come mappa rapida per chi deve rimettere mano al codice senza perdersi.

### Backend

- `server.js`: e' il cuore dell'app. Contiene routing HTTP, API, autenticazione, SQLite utenti, catalogo, import provider, upload, static serving e player server-side.
- `data/`: contiene dati runtime generati dall'app, come catalogo JSON, database utenti e stato import YouTube.
- `uploads/`: contiene file audio e documenti licenza caricati manualmente.
- `assets/`: contiene asset statici e copertine locali.

### UI React

- `frontend/src/App.jsx`: tiene lo stato globale, coordina login, catalogo, player, sessioni temporanee, import e pannelli.
- `frontend/src/api/client.js`: contiene tutte le chiamate fetch verso il backend.
- `frontend/src/components/`: contiene i blocchi UI React separati per responsabilita'.
- `frontend/src/styles/app.css`: contiene layout, tema, animazioni leggere, sidebar fissa, topbar fissa e player dock.

Componenti principali:

- `AuthGate.jsx`: schermata di login React.
- `Sidebar.jsx`: navigazione laterale persistente.
- `Topbar.jsx`: ricerca globale, stato admin, tema e logout.
- `Hero.jsx`: riepilogo catalogo e call-to-action principali.
- `Catalog.jsx`: griglia brani, filtri, paginazione e coda con click destro.
- `DiscoveryPanel.jsx`: import admin, ricerca provider e playlist YouTube temporanea.
- `PlaylistPanel.jsx`: mix automatici per genere e coda di ascolto.
- `AdminPanel.jsx`: creazione, reset password ed eliminazione utenti.
- `SettingsPanel.jsx`: cambio password account corrente.
- `StudioPanel.jsx`: archivio licenze e upload manuale.
- `PlayerDock.jsx`: player fisso in basso con uscita `PC` / `Pi`, shuffle, repeat, volume e seek.

### UI legacy

- `index.html`: template base legacy.
- `partials/`: sezioni HTML della vecchia UI.
- `src/`: logica browser della vecchia UI.
- `styles/`: CSS e temi legacy.

La legacy resta disponibile su `/legacy` come riferimento e fallback, ma la UI da portare avanti e dockerizzare e' React.

### Docker

- `Dockerfile`: costruisce React e prepara il runtime Node con `mpv` e `yt-dlp`.
- `docker-compose.yml`: unico compose del progetto. Gestisce porta, bind mount dati/upload, variabili e opzioni audio Raspberry.
- `.env.example`: template delle variabili da copiare in `.env`.

## File toccati in questa fase

I file principali modificati durante questa fase di lavoro sono:

- `server.js`
- `frontend/src/App.jsx`
- `frontend/src/api/client.js`
- `frontend/src/components/PlayerDock.jsx`
- `frontend/src/styles/app.css`
- `docker-compose.yml`
- `.env.example`
- `README.md`
- `docs/DOCKER.md`
- `docs/CONFIGURAZIONE_API.md`
- `docs/ARCHITETTURA.md`
- `docs/ENDPOINT_API.md`
- `docs/FLUSSI_OPERATIVI.md`
- `docs/MAPPA_PROGETTO.md`

## Cosa e' gia' stato verificato

Sono gia' stati eseguiti controlli tecnici su:

- sintassi backend con `node --check server.js`;
- build React con `npm --prefix frontend run build`;
- build Docker con `docker compose build`;
- avvio container;
- risposta delle API base;
- risposta degli endpoint del player server-side.

## Stato del Raspberry Pi

La parte player Raspberry e' stata impostata per funzionare in modo piu' robusto rispetto a prima:

- non viene piu' forzato automaticamente un device ALSA fragile;
- si prova prima il default ALSA;
- se serve si puo' impostare il device in modo esplicito;
- gli errori sono piu' facili da leggere dai log.

Configurazione consigliata iniziale sul Raspberry:

```env
CLEARWAVE_DOCKER_PRIVILEGED=true
CLEARWAVE_AUDIO_OUTPUT=alsa
ALSA_CARD=
```

Se il default ALSA non basta, il passo successivo e':

- controllare `aplay -l`;
- poi impostare `ALSA_CARD` oppure `CLEARWAVE_AUDIO_DEVICE`.

## Problemi che restano da rifinire

Le aree ancora da rifinire o verificare meglio sono:

- conferma finale dell'uscita audio reale sul Raspberry con il device corretto;
- ultima verifica pratica di seek/pausa/volume server-side su hardware reale;
- rifinitura finale di alcuni comportamenti player lato browser;
- commentatura finale piu' estesa di tutto il progetto a lavoro concluso.

## Prossimo passo consigliato

Ordine consigliato:

1. avvio del Raspberry con il `docker-compose.yml` unico;
2. test audio reale;
3. scelta definitiva del device ALSA se necessario;
4. ultimo giro di fix;
5. dockerizzazione finale stabile;
6. documentazione conclusiva completa file-per-file.
