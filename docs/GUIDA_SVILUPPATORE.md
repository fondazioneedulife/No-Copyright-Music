# Guida sviluppatore ClearWave

Questa guida spiega come modificare il progetto senza rompere flussi esistenti.

## Lettura consigliata

1. `README.md`: panoramica e comandi base.
2. `docs/MAPPA_PROGETTO.md`: cosa contiene ogni file/cartella.
3. `docs/ARCHITETTURA.md`: come comunicano backend, UI, storage e provider.
4. `docs/FLUSSI_OPERATIVI.md`: come usare e testare i flussi reali.
5. `docs/ENDPOINT_API.md`: contratto API.
6. `docs/CONFIGURAZIONE_API.md`: chiavi e variabili ambiente.

## Comandi principali

Backend:

```powershell
npm start
```

Backend senza script locale:

```powershell
node server.js
```

React dev server:

```powershell
npm run dev
```

Questo comando avvia anche il backend. Usa `npm run dev:react` solo se hai gia' `server.js` attivo su `3000`.

Build React:

```powershell
npm run build:react
```

Controllo sintassi backend:

```powershell
node --check server.js
```

## Dove modificare

| Obiettivo | File principali |
| --- | --- |
| Aggiungere endpoint API | `server.js`, `docs/ENDPOINT_API.md` |
| Modificare login/utenti | `server.js`, `src/auth.js`, `frontend/src/App.jsx`, `frontend/src/components/AdminPanel.jsx`, `frontend/src/components/SettingsPanel.jsx` |
| Modificare catalogo legacy | `partials/catalog.html`, `src/catalog.js`, `src/render.js`, CSS in `styles/` |
| Modificare catalogo React | `frontend/src/App.jsx`, `frontend/src/components/Catalog.jsx`, `frontend/src/utils.js`, `frontend/src/styles/app.css` |
| Modificare player legacy | `src/player-core.js`, `src/player-playback.js`, `src/player-controls.js`, `src/player-render.js`, `partials/player.html` |
| Modificare player React | `frontend/src/App.jsx`, `frontend/src/components/PlayerDock.jsx`, `frontend/src/utils.js` |
| Modificare diagnostica, cookie o audit audio | `server.js`, `lib/audio-replacement-service.js`, `tools/check-library-audio.js`, `frontend/src/components/AdminPanel.jsx`, `docs/VERIFICA_CATALOGO_AUDIO.md` |
| Aggiungere provider | `server.js`, `docs/CONFIGURAZIONE_API.md`, `docs/ENDPOINT_API.md` |
| Cambiare stile legacy | `styles.css`, `styles/`, `partials/` |
| Cambiare stile React | `frontend/src/styles/app.css` |
| Cambiare documentazione | `README.md`, `docs/*.md` |

## Regole backend

`server.js` non usa framework. Prima di aggiungere codice cerca una funzione simile e segui lo stesso stile.

Regole pratiche:

- usa `httpError(status, message)` per errori previsti;
- usa `json(res, statusCode, payload)` per risposte JSON;
- usa `readJsonBody(req)` per leggere body JSON;
- valida sempre input proveniente da URL/body;
- per endpoint admin chiama `requireAdminRequest(req)`;
- per endpoint utente loggato chiama `requireAuthRequest(req)`;
- quando servi file, passa da resolver controllati e `isPathInsideDirectory()`;
- non restituire mai hash password, chiavi API o percorsi locali sensibili.

## Regole autenticazione

La sessione e' un token in memoria. Non e' persistente e non sopravvive al riavvio del server.

Quando tocchi auth:

- verifica `POST /api/auth/login`;
- verifica `GET /api/auth/me`;
- verifica `POST /api/auth/change-password`;
- prova un endpoint admin con token admin;
- prova lo stesso endpoint senza token o con utente normale;
- controlla che `publicUser()` non esponga campi sensibili.

## Regole catalogo

Il backend deve restituire tracce gia' normalizzate. Il frontend non dovrebbe duplicare logica di fallback complessa.

Campi importanti:

- `id`;
- `title`;
- `creatorName`;
- `genre`;
- `license`;
- `externalProvider`;
- `audioPath`;
- `playbackPath`;
- `embedPath`;
- `youtubeVideoId`;
- `coverPath`;
- `previewPath`;
- `downloadPath`;
- `durationSeconds`.

Quando aggiungi un campo:

1. normalizzalo in `normalizeTrack()`;
2. aggiungi eventuale fallback in `attachComputedFields()`;
3. aggiorna UI legacy se lo mostra;
4. aggiorna React se lo mostra;
5. documentalo se cambia API.

## Regole import provider

Per aggiungere un provider:

1. aggiungi variabile ambiente all'inizio di `server.js`;
2. aggiungi il provider in `buildDiscoveryProviders()`;
3. crea una funzione `searchNomeProvider(query, limit)`;
4. crea una funzione `mapNomeProviderTrack(item)`;
5. restituisci risultati nel formato discovery comune;
6. inserisci il provider in `searchDiscoveryProviders()`;
7. decidi se e' importabile in modo permanente o solo temporaneo;
8. aggiorna `docs/CONFIGURAZIONE_API.md`;
9. aggiorna `docs/ENDPOINT_API.md` se cambia il contratto.

## Regole React

`frontend/src/App.jsx` e' il punto di orchestrazione. Evita di spostare dentro i componenti logica globale come auth, coda o player se deve essere condivisa.

Pattern attuale:

- API in `frontend/src/api/client.js`;
- helper puri in `frontend/src/utils.js`;
- componenti UI sotto `frontend/src/components/`;
- stile unico in `frontend/src/styles/app.css`.

Quando modifichi React:

```powershell
npm --prefix frontend run build
```

Poi prova almeno:

- login;
- catalogo;
- ricerca;
- cambio sezione;
- player;
- sezione Admin se hai toccato utenti.

## Regole UI legacy

La UI legacy usa variabili globali tra i file JS, quindi l'ordine in `partials/scripts.html` e' importante.

Quando aggiungi un controllo:

1. aggiungi markup nel partial corretto;
2. aggiungi riferimento DOM in `src/config.js` se serve;
3. collega evento in `src/events.js`;
4. implementa logica nel modulo giusto;
5. aggiorna `renderAll()` o rendering specifico se lo stato cambia;
6. testa su `http://localhost:3000`.

## Regole CSS

Legacy e React hanno CSS separati.

- Non modificare `frontend/src/styles/app.css` aspettandoti effetti sulla UI legacy.
- Non modificare `styles/` aspettandoti effetti sulla UI React.
- Mantieni dimensioni responsive per player, topbar, sidebar e griglie.
- Dopo cambi layout, prova desktop e mobile stretto.

## Dati runtime

Non modificare o committare questi file come codice:

- `data/library.json`;
- `data/youtube-import-state.json`;
- `data/youtube-cookies.txt`;
- `data/audio-replacement-list.json`;
- `data/reports/*`;
- `data/*.sqlite`;
- `uploads/audio/*`;
- `uploads/licenses/*`;
- `frontend/dist/`;
- `.tmp-*`;
- `start-local.ps1`.

Se devi fare test distruttivi su dati runtime, crea prima una copia.

## Checklist prima di chiudere una modifica

Per modifiche backend:

- `node --check server.js`;
- `GET /api/health`;
- endpoint toccato con caso positivo;
- endpoint toccato con caso errore;
- docs aggiornate se cambia API.

Per modifiche React:

- `npm --prefix frontend run build`;
- prova manuale su `http://localhost:5173` o `/react/`;
- verifica login/logout;
- verifica che il layout non copra il player.

Per modifiche legacy:

- avvio su `http://localhost:3000`;
- prova flusso principale toccato;
- controllo console browser se possibile.

Per modifiche documentazione:

- link file coerenti;
- niente chiavi reali;
- comandi testati o chiaramente indicati come esempi.
