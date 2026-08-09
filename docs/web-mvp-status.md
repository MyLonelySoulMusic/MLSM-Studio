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
- export offline MP4 H.264/AAC con audio, progress, cancel, backpressure e verifica anti-drop, valutando lo stesso renderer WebGL della preview a timestamp deterministici;
- cache temporanea privata OPFS eliminata al termine e consegna del solo video finale;
- insegne neon 3D ripetute lungo il percorso, con frasi e colore modificabili.

## Adapter professionali ancora da valutare

L'app usa già WebCodecs e muxing offline per le esportazioni finali. Codec broadcast come ProRes e una verifica FFprobe nativa potranno richiedere Tauri/FFmpeg o VideoToolbox; i layer trasparenti Pro Subtitles usano WebM VP9 alpha quando supportato. Nessun bundle desktop deve essere generato fino a tale decisione.

## Verifica

`npm run typecheck`, `npm run lint`, `npm test` e `npm run build` sono i gate. Lo smoke test serve correttamente l'app da `http://127.0.0.1:1420/`.
