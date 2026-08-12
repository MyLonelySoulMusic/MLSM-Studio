# Music · AI Quantizer

![Preparazione AI Quantizer](screenshots/06-ai-quantizer.png)

AI Quantizer è incorporato in MLSM Studio: non richiede un progetto fratello. Interfaccia, backend Node e pipeline Python sono in `tools/ai-quantizer/`.

## Primo avvio

La modalità prepara `.venv-ai-quantizer`, verifica FFmpeg/Rubber Band e installa soltanto le dipendenze mancanti. La schermata mostra percentuale, fase e log; non deve generare errori proxy ripetuti mentre il runtime non è ancora pronto.

Per preparare esplicitamente l’ambiente:

```bash
npm run ai-quantizer:setup
```

Per avviare soltanto il servizio:

```bash
npm run ai-quantizer:server
```

## Tool

- **AI Quantizer:** stabilizza il tempo senza cambiare pitch.
- **Warp map condivisa:** applica gli stessi riferimenti a master e stem.
- **DAW Align:** allinea griglia, transienti e file destinati alla DAW.
- **Audio Restoration:** riduce problemi tecnici prima del mastering.
- **Mastering:** controlla loudness e true peak.
- **AI Forensics:** segnala anomalie e caratteristiche utili all’analisi.

Progetti e risultati sono in `.ai-quantizer-data/`; ambiente e dati sono esclusi da Git.
