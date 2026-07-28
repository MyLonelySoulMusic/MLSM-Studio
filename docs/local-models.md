# Modelli AI locali

I pesi dei modelli non sono inclusi nel repository o nella build.
Transformers.js scarica soltanto il modello scelto quando viene utilizzato per
la prima volta e lo conserva nella Cache Storage persistente del WebView.
Gli utilizzi successivi leggono la cache e non ripetono il download.

| ID applicazione | Repository | Formato |
| --- | --- | --- |
| `whisper-tiny_timestamped` | `onnx-community/whisper-tiny_timestamped` | ONNX Q4 |
| `whisper-base_timestamped` | `onnx-community/whisper-base_timestamped` | ONNX Q4 |
| `whisper-medium_timestamped` | `onnx-community/whisper-medium_timestamped` | ONNX Q4 |
| `smollm2-135m-instruct` | `onnx-community/SmolLM2-135M-Instruct-ONNX` | ONNX Q4 |

Il primo utilizzo richiede una connessione. Al termine del download il modello
lavora localmente tramite WebGPU, quando disponibile, oppure WASM.
