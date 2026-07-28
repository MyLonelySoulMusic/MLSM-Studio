# Roadmap

Ogni fase termina con test verdi, documentazione aggiornata, elenco file modificati e comandi di avvio. Il passaggio di fase richiede revisione; la Fase 0 non autorizza implementazione grafica.

| Fase | Risultato | Gate di uscita |
|---|---|---|
| 0 ✅ | architettura, contratti, schema e rischi | completata e approvata |
| 1 ✅ | monorepo Tauri/React TS strict, layout, project I/O | bundle `.app`, build/lint/typecheck/test verdi; round-trip progetto |
| 2 ✅ | import MP3/WAV, probe, player, waveform e timeline base | FFmpeg integration test; play/pause/stop/seek; errori file gestiti |
| 3 ✅ | analyzer TypeScript Web Worker, cache, beat/onset/energia | click-track golden, determinismo e invalidazione cache |
| 4 ✅ | scena Three.js, camera, luci, sfera e oggetti MVP | selezione/inspector; build WebGL2 |
| 5 ✅ | marker, snapping, loop, undo/redo e zoom | editing e command history testati |
| 6 ✅ | planner/evaluator deterministico | impatti esatti, indipendenza FPS e test 10 minuti |
| 7 ✅ | generatore seeded e auto-camera | rigenerazione identica e no overlap critici |
| 8 ✅ | preview audio-master e diagnostica drift | clock audio, frame step, FPS/drop/drift |
| 9 ✅ web | export video finale, progress/cancel | renderer WebGL condiviso, audio, MP4/WebM e temporanei OPFS automatici |
| 10 ✅ web | 4K e 120 fps, streaming/capability | scheduler 4K120 a memoria costante e stime risorse |
| 11 ✅ web | materiali, preset e polish | sfera/sfondo/oggetti editabili, persistenza e code splitting |

## Dipendenze critiche

- Fase 1: Node LTS, Rust stable e toolchain Tauri 2.
- Fasi 2–3: FFmpeg/FFprobe e Python 3.12; strategia di packaging provata su tre OS.
- Fase 4: GPU WebGL2 o fallback con messaggio chiaro.
- Fase 9: encoder H.264 disponibile; gli altri codec non bloccano il baseline.

## Prove anticipate

Prima di investire nel polish, eseguire tre spike con criteri misurabili: precisione clock Web Audio su 10 minuti (Fase 2), package sidecar sulle tre piattaforme (Fase 3), throughput/readback 4K e memoria della pipe (entro Fase 9). Se uno spike fallisce, si aggiorna l'ADR interessata prima di proseguire.

## Milestone MVP

- **M1 Editing audio** (Fasi 1–3): import, waveform, detection e correzione marker.
- **M2 Animazione sincronizzata** (Fasi 4–8): scena editabile, generator, planner e preview.
- **M3 Consegna video** (Fasi 9–10): export con audio, progress, cancel e preset 4K.
- **M4 Release candidate** (Fase 11): robustezza, accessibilità, preset e documentazione.

## Fuori scope iniziale

Cloud, account, collaborazione, marketplace, mobile, pagamenti, HDR affidabile, EXR e plugin di terze parti. WebGPU resta un adapter futuro: il dominio non deve dipenderne.
