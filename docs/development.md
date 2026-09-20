# Installazione e sviluppo

## Requisiti

- Node.js `>= 22.12`
- npm
- Python 3.11 esatto, installato automaticamente da Homebrew su macOS o Winget su Windows
- FFmpeg/FFprobe
- Rust/Cargo per i pacchetti Tauri
- Rubber Band per le funzioni audio che lo richiedono

Gli script di installazione rilevano il sistema operativo e installano o verificano questi componenti.

## Comandi principali

```bash
npm ci --include=dev     # dipendenze JavaScript esatte dal lockfile
npm run dev              # app e servizi locali integrati
npm run build            # build web, nessun server
npm run typecheck        # TypeScript
npm run lint             # ESLint
npm test                 # suite Vitest
npm run install:verify   # diagnosi macchina/runtime
npm run rife:verify      # verifica artifact, runtime e self-test reale RIFE
```

Il server si avvia soltanto con `npm run dev` o con i launcher. Test, verifica e build non lo avviano.

## Runtime Python

```bash
npm run upscaler:setup
npm run upscaler:server
npm run ai-quantizer:setup
npm run ai-quantizer:server
npm run song-player:setup
npm run audio-tts:setup
npm run setup:runtimes       # prepara tutti e quattro gli ambienti
```

Il comando manuale resta utile per diagnostica. In sviluppo Vite gestisce il
processo; nell'app desktop il client può richiamare il comando nativo
`ensure_upscaler_service`, che trova `.venv` e `tools/upscaler_server.py`, avvia
il servizio su `127.0.0.1:8765` e lo termina insieme all'app. Il processo espone
API 7, PID, processo padre e tipo di proprietario; Vite non adotta servizi
avviati da altre sessioni. Sia Vite sia Tauri inviano prima una terminazione
graceful e poi, entro un timeout, il kill forzato. Il backend osserva inoltre il
PID del processo padre e chiude/reap tutti i propri FFmpeg se l'app o Vite
terminano in modo anomalo. Anche il launcher CLI inoltra SIGINT/SIGTERM/SIGHUP,
quindi non lascia un servizio sulla porta 8765 dopo la propria chiusura.

Gli ambienti `.venv`, `.venv-ai-quantizer`, `.venv-song-player` e `.venv-audio-tts` sono separati, ignorati da Git e devono usare tutti Python 3.11. Gli installer li creano automaticamente e rigenerano quelli costruiti con una versione Python incompatibile. I checkpoint vengono conservati nelle cache locali e riutilizzati agli avvii successivi.

Il runtime RIFE viene preparato solo quando richiesto dall’interpolazione
opzionale del Video Editor. `npm run rife:verify` non scarica o simula un
risultato: restituisce esito positivo soltanto quando il runtime verificato è
presente e la mini inferenza reale passa sul dispositivo selezionato.

## Installer e launcher

| Sistema | Installa | Avvia | Compila |
| --- | --- | --- | --- |
| macOS | `bash scripts/macos/install.sh` | `scripts/macos/launch.sh` | `scripts/macos/build.sh` |
| Windows | `scripts\windows\install.bat` | `scripts\windows\launch.bat` | `scripts\windows\build.bat` |

Gli script nativi sono raccolti in `scripts/macos/` e `scripts/windows/`. Installazione, avvio e build possono essere richiamati direttamente anche su una macchina nuova; gli alias npm restano scorciatoie equivalenti dopo il setup. La struttura completa è descritta in [`scripts/README.md`](../scripts/README.md). Ogni script supporta `--check` dove documentato. La CI usa runner nativi macOS e Windows; Windows non viene simulato con Docker Linux.

## Screenshot del manuale

Dopo `npm run build`:

```bash
node tools/capture_documentation_screenshots.mjs
```

Lo script usa Chrome headless sul build statico e termina il processo alla fine; non apre un server. Gli screenshot sono in `docs/screenshots/`.

## Gate prima di una release

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. `npm run install:verify`
6. check degli script pacchetto sul sistema nativo

I warning di bundle vanno valutati separatamente dagli errori: Three.js e runtime AI producono chunk grandi, ma un warning non deve mascherare un test fallito.
