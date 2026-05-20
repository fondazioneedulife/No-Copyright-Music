# Flussi operativi

Questa guida spiega come usare ClearWave nelle operazioni piu' comuni.

## Avvio locale

1. Apri PowerShell nella cartella del progetto.
2. Avvia backend e UI React principale:

```powershell
npm start
```

3. Apri `http://localhost:3000`.

Per lavorare sulla UI React:

```powershell
npm run dev
```

Poi apri `http://localhost:5173`.

`npm run dev` avvia prima il backend su `3000` e poi React su `5173`. In questo modo login, catalogo e import funzionano da `5173` perche' Vite inoltra `/api`, `/assets` e `/uploads` al backend.

Per generare la build React servita dal backend:

```powershell
npm run build:react
npm start
```

Poi apri `http://localhost:3000` oppure `http://localhost:3000/react/`.

## Avvio su Raspberry Pi

Per far uscire la musica dal Raspberry e non dal PC, usa il file Docker unico del progetto:

```bash
docker compose up -d --build
```

Nel `.env` del Raspberry imposta `CLEARWAVE_DOCKER_PRIVILEGED=true`, poi apri l'app da browser con l'IP del Raspberry e nel player lascia selezionato `Pi`.

Se devi aggiornare il progetto, ricreare il container o leggere errori audio, segui `docs/GUIDA_RASPBERRY_DOCKER_AUDIO.md`. Quella guida separa bene host Raspberry, container Docker, Git, ALSA e yt-dlp.

## Primo accesso

Al primo avvio, se `data/clearwave-auth.sqlite` non esiste, il backend crea un admin.

- Username: `admin`
- Password iniziale: valore di `CLEARWAVE_ADMIN_PASSWORD`, oppure `admin123` in sviluppo locale
- Stato: `mustChangePassword=true`

Dopo il login, cambia subito la password da Impostazioni.

## Gestione utenti in React

La sezione Admin e' visibile solo agli utenti con ruolo `admin`.

Azioni disponibili:

- `Crea utente`: crea un account con ruolo `user` o `admin` e mostra una password temporanea.
- `Reset`: rigenera una password temporanea per un altro utente e forza il cambio al prossimo login.
- `Elimina`: cancella un utente, dopo conferma.

Protezione lato backend:

- un admin non puo' eliminare se stesso;
- non si puo' eliminare l'ultimo admin rimasto;
- un admin non puo' resettare la propria password da Admin, deve usare Impostazioni;
- i token dell'utente eliminato o resettato vengono invalidati.

## Cambio password

Da Impostazioni l'utente inserisce password attuale e nuova password.

Regole:

- la nuova password deve avere almeno 6 caratteri;
- il backend verifica la password attuale contro l'hash SQLite;
- dopo il cambio `mustChangePassword` diventa `false`.

## Catalogo

Il catalogo permanente vive in `data/library.json`.

La UI chiama `GET /api/tracks`; il backend:

1. legge il file JSON;
2. normalizza ogni traccia;
3. aggiunge campi come `previewPath`, `downloadPath`, `coverPath`;
4. restituisce la lista al frontend.

La UI React permette:

- ricerca globale dalla topbar;
- filtro per genere;
- filtro per sorgente;
- paginazione;
- play diretto;
- coda con click destro sulla card.

La UI React include anche playlist automatiche, archivio, discovery/import admin, sessione temporanea e upload.

## Player

ClearWave puo' riprodurre dal browser (`PC`) oppure dal backend/Raspberry (`Pi`).

In modalita' `Pi`, React invia comandi a `/api/server-player/...`; il backend avvia `mpv` sul server e quindi l'audio esce fisicamente dal Raspberry.

Sorgenti supportate:

| Tipo | Come viene riprodotto |
| --- | --- |
| Audio locale/upload | `mpv` sul server in modalita' `Pi`, tag audio HTML in modalita' `PC`. |
| Jamendo o provider con stream diretto | `mpv` o tag audio HTML, secondo uscita selezionata. |
| YouTube | `mpv` + `yt-dlp` in modalita' `Pi`, iframe embed interno in modalita' `PC`. |
| Nessuna sorgente diretta | Preview WAV generata dal backend. |

Il player React gestisce play/pausa, precedente, successivo, seek, volume, shuffle e repeat.
In modalita' `Pi`, quando una traccia viene avviata React invia anche contesto di coda, shuffle e repeat al backend. Se la pagina web viene chiusa, la musica continua sul Raspberry e il server puo' passare alla traccia successiva senza dipendere dal browser.

## Import da provider

Gli import protetti richiedono ruolo admin.

Flusso generale:

1. La UI chiede provider disponibili con `GET /api/discovery/providers`.
2. L'admin cerca con `GET /api/discovery/search`.
3. Il backend interroga i provider configurati.
4. I risultati vengono mappati nel formato interno.
5. L'admin importa con `POST /api/discovery/import`.
6. Il backend salva solo risultati riproducibili nel catalogo permanente.

Provider principali:

- Jamendo: preferito per audio commerciale con stream diretto.
- YouTube whitelist: usa embed, non download, e accetta solo canali/playlist consentiti.
- Audius: disponibile ma richiede verifica licenza del creator.
- TheAudioDB: utile per metadata, non per audio commercial-safe.

## Import da link

Endpoint:

- `POST /api/discovery/import-link`: salva nel catalogo sicuro se il link e' accettato.
- `POST /api/session/import-link`: importa solo in sessione e non salva nel catalogo permanente.

Link supportati:

- video YouTube;
- playlist YouTube;
- canali YouTube whitelist;
- tracce Jamendo.

Nota: YouTube Data API non permette download audio. ClearWave usa embed e metadata.

## Import a lotti

`POST /api/discovery/bulk-import` importa piccoli lotti progressivi.

Il backend:

- evita duplicati;
- salva avanzamento in `data/youtube-import-state.json`;
- continua dalla pagina YouTube gia' raggiunta;
- limita quantita' e pagine per non saturare quota/API.

Se YouTube risponde `quotaExceeded`, aspetta il reset quota e rilancia `Importa lotto`.

## Diagnostica e controlli lunghi

La diagnostica admin serve per capire lo stato reale di Raspberry, `mpv`, `yt-dlp`, Deno, ALSA, cookie YouTube, player e check catalogo.

Usa `Test sorgenti` quando vuoi una risposta veloce prima di un controllo lungo: il backend prova YouTube con `yt-dlp`, apre lo stream firmato, controlla Jamendo e verifica un file locale. Se fallisce solo `YouTube stream`, il problema e' diverso dai cookie: `yt-dlp` ha trovato il link, ma Google Video lo rifiuta al momento dell'apertura.

Durante `Verifica tutto YouTube` o un check catalogo automatico:

- la UI mostra `Auto-refresh attivo`;
- il progresso YouTube viene aggiornato ogni pochi secondi;
- la diagnostica completa viene aggiornata a intervalli piu' larghi per non caricare troppo il Raspberry;
- non serve premere ripetutamente `Aggiorna diagnostica`.

Quando il check finisce, leggi prima il report:

- `youtube-age-or-login`: carica cookie nuovi e usa `Test cookie YouTube`;
- `youtube-stream-open-failed`: usa `Test sorgenti` per separare errore `yt-dlp` da errore di apertura stream;
- `timeout`: riprova con rete stabile o concorrenza piu' bassa;
- `youtube-error` o `exit-1`: leggi il messaggio breve nella diagnostica o nel report JSON; e' il caso generico di `yt-dlp`/`mpv`;
- `youtube-expired-url`: reimporta il video YouTube originale, perche' `googlevideo.com` e' solo uno stream temporaneo;
- `youtube-stream-open-failed`: riprova e controlla cookie/account se l'errore si ripete su tante tracce;
- `youtube-unavailable` o `missing-source`: usa `Archivia non disponibili`;
- tracce archiviate dopo cookie nuovi: usa `Riverifica archiviate`.

I cookie YouTube sono validi solo finche' la sessione esportata resta accettata da YouTube. Se stanno per scadere o mancano, gli admin vedono un popup ricorrente ogni 10 minuti.

## Upload manuale

La UI React consente upload manuale da area avanzata/studio.

Il backend salva:

- audio in `uploads/audio/`;
- licenze o prove diritti in `uploads/licenses/`;
- metadata nel catalogo JSON.

Prima di usare un brano in produzione, allega sempre prova licenza o fonte originale.

## Compliance e licenze

ClearWave aiuta a organizzare musica commercial-safe, ma non sostituisce una verifica legale.

Per ogni brano commerciale conserva:

- URL originale;
- provider;
- autore/canale;
- licenza dichiarata;
- data di verifica;
- screenshot o allegato della licenza quando disponibile;
- ricevuta o documento di acquisto se presente.

## Verifiche consigliate

Dopo modifiche backend:

```powershell
node --check server.js
npm start
```

Poi prova:

```text
GET http://localhost:3000/api/health
GET http://localhost:3000/api/tracks
```

Dopo modifiche React:

```powershell
npm --prefix frontend run build
```

Dopo modifiche API:

- aggiorna `docs/ENDPOINT_API.md`;
- prova endpoint con login admin;
- verifica che un utente normale riceva errore sugli endpoint admin.

## Problemi comuni

| Sintomo | Causa probabile | Soluzione |
| --- | --- | --- |
| `localhost:3000` non risponde | Backend non avviato o porta occupata | Esegui `npm start`. Lo script locale prova a chiudere server precedenti su porta 3000. |
| `localhost:5173` non risponde | Dev server React non avviato | Esegui `npm run dev:react`. |
| Login admin non funziona | Password cambiata o database gia' esistente | Usa la password attuale oppure rimuovi/ricrea il database solo se sei sicuro di voler perdere gli utenti. |
| Provider non disponibili | Chiavi API non configurate | Controlla `start-local.ps1` e `docs/CONFIGURAZIONE_API.md`. |
| YouTube non importa piu' | Quota esaurita o canale non whitelist | Attendi reset quota o usa link/canale consentito. |
| Traccia senza audio diretto | Provider non fornisce stream scaricabile | Usa preview backend o embed YouTube, secondo sorgente. |
