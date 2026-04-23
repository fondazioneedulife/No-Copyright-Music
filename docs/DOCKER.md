# Docker

Questa guida avvia ClearWave in un container Docker unico.

Il container contiene:

- backend Node `server.js`;
- UI React principale su `/`;
- UI legacy di fallback su `/legacy`;
- build React servita anche su `/react/` per compatibilita';
- asset, partial, script legacy e CSS;
- healthcheck su `/api/health`.

I dati runtime non vengono salvati nell'immagine: restano in volumi Docker.

## File Docker

| File | Ruolo |
| --- | --- |
| `Dockerfile` | Build multi-stage: compila React e prepara il runtime Node. |
| `docker-compose.yml` | Avvia il servizio con porte, variabili ambiente e volumi persistenti. |
| `.dockerignore` | Esclude segreti, dati runtime, upload e dipendenze locali dal contesto build. |
| `.env.example` | Template per variabili Docker Compose. |

## Primo avvio

Se vuoi usare solo il catalogo locale senza chiavi API:

```powershell
docker compose up --build
```

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
| `JAMENDO_CLIENT_ID` | Discovery/import Jamendo. |
| `YOUTUBE_API_KEY` | Discovery/import canali YouTube whitelist. |
| `AUDIUS_API_KEY` | Ricerca/stream Audius. |
| `THEAUDIODB_API_KEY` | Metadata TheAudioDB. |

Non inserire chiavi reali nel `Dockerfile` o nel codice.

## Volumi persistenti

`docker-compose.yml` crea due volumi:

| Volume | Montato su | Contiene |
| --- | --- | --- |
| `clearwave-data` | `/app/data` | `library.json`, SQLite utenti, stato import YouTube. |
| `clearwave-uploads` | `/app/uploads` | Audio caricati e documenti licenza. |

Questo significa che puoi ricreare il container senza perdere utenti, catalogo e upload.

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

Stop mantenendo i volumi:

```powershell
docker compose down
```

Stop cancellando anche i dati runtime Docker:

```powershell
docker compose down -v
```

Attenzione: `down -v` elimina catalogo, utenti SQLite e upload salvati nei volumi Docker.

## URL

| URL | Cosa apre |
| --- | --- |
| `http://localhost:3000` | UI React principale. |
| `http://localhost:3000/react/` | UI React buildata dentro l'immagine, alias compatibile. |
| `http://localhost:3000/legacy` | UI legacy di fallback. |
| `http://localhost:3000/api/health` | Healthcheck backend. |

## Note tecniche

- L'immagine usa `node:22-bookworm-slim`, coerente con l'uso di `node:sqlite`.
- React viene buildato in uno stage separato con `npm ci --prefix frontend`.
- Nel runtime finale non vengono installate dipendenze frontend.
- `CLEARWAVE_DATA_DIR` e `CLEARWAVE_UPLOADS_DIR` puntano a cartelle montate su volumi.
- Il backend ascolta sulla porta `3000` dentro il container.
