# Modelli AI locali

I modelli vengono inizializzati su richiesta. Il primo uso può richiedere un download; quelli successivi usano cache persistente.

| Funzione | Modello/runtime | Cache | Fallback |
| --- | --- | --- | --- |
| Sottotitoli | Whisper selezionabile | cache modelli locale | modello più piccolo/CPU |
| Revisione e assistente | Qwen locale | cache Transformers | WebGPU → WASM → knowledge base |
| Upscaling | Real-ESRGAN/RealESRNet | `.upscaler-cache` | CUDA/MPS → CPU; Canvas Enhanced |
| Frame Booster standalone | FFmpeg minterpolate (**Motion AOBMC**, **Motion OBMC bidirezionale** o **Blend**) | runtime FFmpeg locale | nessun fallback silenzioso; il file base verificato resta disponibile se il job fallisce |
| Interpolazione Video Editor | FFmpeg minterpolate o Practical-RIFE v4.26 | cache runtime/pesi verificata | RIFE resta una scelta separata del Video Editor |
| Circular Spectrum Auto Detector | `Xenova/detr-resnet-50` (Transformers.js), classi COCO | cache lazy del modello | WebGPU → WASM |
| Cassette Desk · voce | Demucs `htdemucs` + pYIN | runtime isolato dell’app desktop o del servizio browser locale + cache pesi | nessun fallback dal mix; installazione automatica al primo uso |

## Regole

- Nessun checkpoint entra in Git.
- Un download incompleto non viene marcato come pronto.
- L’interfaccia mostra modello, fase, percentuale e messaggio d’errore.
- Cassette Desk crea e verifica automaticamente il runtime vocale al primo utilizzo sia nella shell desktop sia nel browser locale integrato; l’utente non deve eseguire comandi né riavviare l’app.
- Un errore azzera la promise di bootstrap, così il nuovo tentativo può ripartire.
- Su Apple Silicon il backend preferito è Metal/MPS quando il modello lo supporta; su NVIDIA è CUDA.

### RIFE verificato

Il runtime RIFE standalone usa l’upstream ufficiale `hzwer/Practical-RIFE`,
modello v4.26. Il manifest fissa e verifica separatamente sia l’archivio dei
pesi sia il sorgente compatibile del package `model`; un trasferimento troncato
viene eliminato e ritentato fino a tre volte, senza modificare o aggirare gli
SHA-256 attesi. La preparazione è on demand. Il self-test
esegue una mini inferenza reale e una capability non viene considerata pronta se
questa verifica fallisce.

La selezione automatica usa CUDA su NVIDIA e MPS su Apple Silicon; su MPS la
precisione è FP32, mentre CUDA supporta FP16 o FP32. CPU è disponibile quando
viene selezionata esplicitamente. Il runtime RIFE è richiamabile dal Video
Editor. Frame Booster standalone usa esclusivamente FFmpeg Motion AOBMC, Motion
OBMC bidirezionale o Blend e il
suo health check resta indipendente da download, checksum e inizializzazione RIFE.

Per controllare una macchina senza avviare l’interfaccia:

```bash
npm run rife:verify
```

Il comando termina con codice diverso da zero se artifact, runtime o self-test
non sono pronti. La verifica hardware effettiva dipende dal dispositivo su cui
viene eseguito il comando.

In sviluppo, la cache del modello DETR è consentita per `Xenova/detr-resnet-50`. Dopo aver modificato la whitelist della cache del dev server, riavvia il dev server prima di riprovare il download o l’analisi. Se il download della cache su disco fallisce per un errore di trasporto, il middleware risponde come cache miss e Transformers.js ritenta direttamente dal repository remoto, senza interpretare il testo dell’errore come JSON.

Circular Spectrum Auto Detector usa una soglia di sensibilità regolabile, predefinita a 0,15. L’analisi viene ripetuta solo con **Detect again**; i duplicati sono filtrati per classe e il risultato è limitato a 256 oggetti. I cerchi manuali non richiedono detection.
