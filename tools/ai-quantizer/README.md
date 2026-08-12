# Runtime AI Quantizer

Questo runtime è parte di MLSM Studio e alimenta `Music → AI Quantizer`; non dipende da cartelle o progetti esterni.

| Percorso | Ruolo |
| --- | --- |
| `server.cjs` | API locale, progetti, upload/download e pipeline FFmpeg/Rubber Band. |
| `public/` | Interfaccia incorporata nella modalità Music. |
| `audio_engine/` | Beat This, analisi ritmica e AI Music Forensics. |
| `requirements.txt` | Dipendenze di `.venv-ai-quantizer`. |

Preparazione manuale:

```bash
npm run ai-quantizer:setup
npm run ai-quantizer:server
```

Il normale `npm run dev` prepara l’ambiente quando manca e inoltra i log alla schermata di bootstrap. I modelli vengono scaricati al primo uso in `tools/ai-quantizer/models/`; i progetti vivono in `.ai-quantizer-data/`. Entrambi sono esclusi da Git.

AI Music Forensics usa `lofcz/ai-music-detector` (licenza MIT), revisione fissata `6ba389e94a179ac90f3eb134b741ef37baa30434`.

Per il flusso utente consulta [Music · AI Quantizer](../../docs/music.md); per ambiente e test consulta [Installazione e sviluppo](../../docs/development.md).
