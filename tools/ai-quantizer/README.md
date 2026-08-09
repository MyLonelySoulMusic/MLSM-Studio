# MLSM Studio · AI Quantizer runtime

Questo runtime appartiene al repository MLSM Studio e alimenta la modalità `Music → AI Quantizer`.

- `server.cjs`: API, upload/download, progetti e pipeline FFmpeg/Rubber Band.
- `public/`: interfaccia MLSM incorporata nella modalità Music.
- `audio_engine/`: analisi ritmica Beat This e AI Music Forensics.
- `requirements.txt`: dipendenze dell’ambiente isolato `.venv-ai-quantizer`.

`npm run dev --workspace @rbs/desktop -- --port 1421` prepara automaticamente l’ambiente al primo avvio. In alternativa: `npm run ai-quantizer:setup`.

I modelli non sono versionati: vengono scaricati al primo utilizzo e conservati in `tools/ai-quantizer/models/`. I progetti audio risiedono in `.ai-quantizer-data/`. Entrambi sono esclusi da Git.

AI Music Forensics usa il modello MIT `lofcz/ai-music-detector`, fissato alla revisione `6ba389e94a179ac90f3eb134b741ef37baa30434`.
