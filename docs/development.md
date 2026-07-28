# Sviluppo

## Prerequisiti

- Node.js LTS e npm
- Rust stable con Cargo
- prerequisiti di sistema Tauri 2 per la piattaforma

## Comandi

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run tauri --workspace @rbs/desktop dev
```

La web preview funziona con `npm run dev`; salvataggio e dialoghi richiedono il runtime Tauri. FFmpeg e Python non sono ancora necessari nella Fase 1.

## Gate Fase 1

- build Vite, typecheck strict, lint e test verdi;
- layout editor accessibile e responsive;
- nuovo progetto, validazione runtime e round-trip save/load;
- scrittura atomica nel backend e conferma modifiche non salvate;
- shell Tauri configurato senza permessi filesystem generici.

## Esito Fase 1

Completata il 22 luglio 2026. Build, typecheck, lint e test web sono verdi. Gli artefatti `.app` e DMG generati durante la verifica iniziale sono stati rimossi su richiesta; non vengono più prodotti durante lo sviluppo web-first.

## Esito Fase 2

Completata il 22 luglio 2026. Supporta selezione MP3/WAV, capability detection, FFprobe, hash SHA-256, waveform downsampled tramite FFmpeg, player audio-master, play/pausa/stop/seek e ripristino dal progetto. FFmpeg/FFprobe sono cercati nel `PATH` e nelle posizioni comuni macOS. Un test Rust genera un WAV click-track e verifica metadati e waveform end-to-end.

## Modalità web-first

Il comando ordinario è `npm run dev`. Nel browser import, waveform e analisi usano File API, Web Audio API e Web Worker senza Rust o FFmpeg. Salvataggio e caricamento usano download/file picker JSON. L'export registra lo stesso renderer WebGL della preview con MediaRecorder, salva progressivamente i chunk in OPFS e consegna un MP4 o WebM con audio. Tauri, codec FFmpeg professionali e packaging saranno valutati solo dopo la conclusione dell'MVP web.

## Audit qualità

Audit aggiornato al 22 luglio 2026: 32 test in 13 file, typecheck strict, lint e build verdi. La copertura V8 è 72,97% delle istruzioni complessive; audio analysis, core, export, schema e trajectory raggiungono il 100% delle righe. `npm audit` non rileva vulnerabilità. Lo smoke test Vite verifica HTML e modulo React sulla porta 1420.
