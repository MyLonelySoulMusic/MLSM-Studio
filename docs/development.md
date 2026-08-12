# Installazione e sviluppo

## Requisiti

- Node.js `>= 22.12`
- npm
- Python 3.11 gestito tramite `pyenv` o installazione compatibile
- FFmpeg/FFprobe
- Rust/Cargo per i pacchetti Tauri
- Rubber Band per le funzioni audio che lo richiedono

Gli script di installazione rilevano il sistema operativo e installano o verificano questi componenti.

## Comandi principali

```bash
npm install              # dipendenze JavaScript
npm run dev              # app e servizi locali integrati
npm run build            # build web, nessun server
npm run typecheck        # TypeScript
npm run lint             # ESLint
npm test                 # suite Vitest
npm run install:verify   # diagnosi macchina/runtime
```

Il server si avvia soltanto con `npm run dev` o con i launcher. Test, verifica e build non lo avviano.

## Runtime Python

```bash
npm run upscaler:setup
npm run upscaler:server
npm run ai-quantizer:setup
npm run ai-quantizer:server
```

Gli ambienti `.venv-upscaler` e `.venv-ai-quantizer` sono separati e ignorati da Git. I checkpoint vengono scaricati al primo uso del modello, non durante ogni avvio.

## Installer e launcher

| Sistema | Installa | Avvia | Compila |
| --- | --- | --- | --- |
| macOS | `./install.sh` | `./launch-mlsm.sh` | `./build-macos.sh` |
| Windows | `install.bat` | `launch-mlsm.bat` | `build-windows.bat` |

Ogni script supporta `--check` dove documentato. La CI usa runner nativi macOS e Windows; Windows non viene simulato con Docker Linux.

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
