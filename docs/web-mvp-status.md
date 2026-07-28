# Stato MVP web

## Funzionalità operative

- import MP3/WAV, waveform e player audio-master;
- analyzer TypeScript in Web Worker con BPM, beat/downbeat, onset, bande ed eventi classificati;
- cache IndexedDB legata a hash audio, versione e parametri;
- marker selezionabili, trascinabili, aggiungibili, eliminabili e modificabili, con snapping e undo/redo;
- scena Three.js con sfera e cinque famiglie di oggetti editabili;
- generazione seeded, planner balistico ed evaluator deterministico;
- preview con frame step e diagnostica FPS/drop/drift;
- formati 9:16 e 16:9, preset, sfera, materiali e sfondo personalizzabili;
- progetto JSON salvabile e caricabile dal browser;
- export diretto MP4 H.264/AAC o WebM VP9/Opus, con audio, progress e cancel, registrando lo stesso renderer WebGL della preview;
- cache temporanea privata OPFS eliminata al termine e consegna del solo video finale;
- insegne neon 3D ripetute lungo il percorso, con frasi e colore modificabili.

## Adapter finale ancora da valutare

MediaRecorder espone codec diversi in base al browser: l'app preferisce MP4 e ripiega su WebM. Codec broadcast come ProRes, encoding offline più rapido del tempo reale e verifica FFprobe restano dietro i contratti già definiti e potranno richiedere Tauri/FFmpeg, WebCodecs più muxer oppure FFmpeg WebAssembly. Nessun bundle desktop deve essere generato fino a tale decisione.

## Verifica

`npm run typecheck`, `npm run lint`, `npm test` e `npm run build` sono i gate. Lo smoke test serve correttamente l'app da `http://127.0.0.1:1420/`.
