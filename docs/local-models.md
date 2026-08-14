# Modelli AI locali

I modelli vengono inizializzati su richiesta. Il primo uso può richiedere un download; quelli successivi usano cache persistente.

| Funzione | Modello/runtime | Cache | Fallback |
| --- | --- | --- | --- |
| Sottotitoli | Whisper selezionabile | cache modelli locale | modello più piccolo/CPU |
| Revisione e assistente | Qwen locale | cache Transformers | WebGPU → WASM → knowledge base |
| Upscaling | Real-ESRGAN/RealESRNet | `.upscaler-cache` | CUDA/MPS → CPU; Canvas Enhanced |
| Interpolazione | FFmpeg minterpolate o RIFE | cache runtime/pesi | render nativo senza interpolazione; job cancellabile con fallback al file base verificato |
| Circular Spectrum Auto Detector | `Xenova/detr-resnet-50` (Transformers.js), classi COCO | cache lazy del modello | WebGPU → WASM |

## Regole

- Nessun checkpoint entra in Git.
- Un download incompleto non viene marcato come pronto.
- L’interfaccia mostra modello, fase, percentuale e messaggio d’errore.
- Un errore azzera la promise di bootstrap, così il nuovo tentativo può ripartire.
- Su Apple Silicon il backend preferito è Metal/MPS quando il modello lo supporta; su NVIDIA è CUDA.

In sviluppo, la cache del modello DETR è consentita per `Xenova/detr-resnet-50`. Dopo aver modificato la whitelist della cache del dev server, riavvia il dev server prima di riprovare il download o l’analisi. Se il download della cache su disco fallisce per un errore di trasporto, il middleware risponde come cache miss e Transformers.js ritenta direttamente dal repository remoto, senza interpretare il testo dell’errore come JSON.

Circular Spectrum Auto Detector usa una soglia di sensibilità regolabile, predefinita a 0,15. L’analisi viene ripetuta solo con **Detect again**; i duplicati sono filtrati per classe e il risultato è limitato a 256 oggetti. I cerchi manuali non richiedono detection.
