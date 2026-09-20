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

## Flusso di lavoro

Il percorso è diviso in **Importa → Quantizza → Allinea → Restauro → Master → Esporta**.
Le azioni sono in fondo a ogni passaggio. Per avanzare occorre creare il risultato
oppure scegliere esplicitamente di saltare il trattamento; si può sempre tornare
indietro. Modificare BPM, marker o impostazioni richiede di applicare nuovamente
il passaggio prima di proseguire. Saltare quantizzazione/allineamento prepara
comunque i WAV necessari ai passaggi successivi, senza il trattamento escluso.

La timeline conserva il confronto **Prima / Dopo**: la vista finale mostra beat e
waveform rimappati tramite la mappa effettivamente applicata, anche dopo la
riapertura del progetto. L'ascolto parte solo premendo Play.

**Applica allineamento** non esegue nuovamente l'analisi o la quantizzazione. Il
motore conserva il WAV già quantizzato e applica soltanto spostamento e fade con
FFmpeg. Anche le modifiche successive ripartono dalla base quantizzata, così le
correzioni non si accumulano. I progetti creati con versioni precedenti vengono
gestiti applicando soltanto la differenza rispetto all'allineamento già presente.

Restauro e mastering sono facoltativi. La verifica AI è uno strumento separato
nell'esportazione ed è disattivata nei nuovi progetti. Lo ZIP include master e
stem quantizzati e, se creati, il master restaurato e quello finale. Durante la
preparazione appare un indicatore animato; durante il trasferimento viene mostrato
l'avanzamento reale quando la dimensione è disponibile. Gli errori consentono
di riprovare senza uscire dal progetto.
