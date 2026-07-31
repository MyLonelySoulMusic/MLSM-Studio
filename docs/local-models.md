# Modelli AI locali

I pesi dei modelli non sono inclusi nel repository o nella build.
Durante lo sviluppo web, un middleware Vite scarica soltanto i file mancanti e
li conserva nella directory `.transformers-cache/` del progetto. La directory
è persistente, esclusa da Git e non dipende dalla quota Cache Storage del
browser. Refresh, riavvio del browser e riavvio di Vite leggono quindi i file
dal disco senza ripetere il download. La build desktop usa la cache persistente
del WebView fino al packaging nativo finale.

| ID applicazione | Repository | Formato |
| --- | --- | --- |
| `whisper-tiny_timestamped` | `onnx-community/whisper-tiny_timestamped` | ONNX Q4 |
| `whisper-base_timestamped` | `onnx-community/whisper-base_timestamped` | ONNX Q4 |
| `whisper-medium_timestamped` | `onnx-community/whisper-medium_timestamped` | ONNX Q4 |
| `qwen2.5-0.5b-instruct` | `onnx-community/Qwen2.5-0.5B-Instruct` | ONNX Q4 |

Il primo utilizzo richiede una connessione. Al termine del download il modello
lavora localmente tramite WebGPU, quando disponibile, oppure WASM.
Per Qwen il runtime usa `q4f16` su WebGPU (circa 483 MB, particolarmente adatto
ai Mac Apple Silicon) quando l’adapter espone `shader-f16`, altrimenti `q4`.
La presenza della sola proprietà `navigator.gpu` non viene considerata
sufficiente: il runtime richiede un adapter reale e, se la pipeline WebGPU
fallisce, riprova automaticamente con `q4` su WASM (circa 786 MB).

Qwen2.5 0.5B Instruct è il modello predefinito per la redazione dei
sottotitoli e per Assistente Studio. È stato scelto al posto del precedente
135M perché gestisce meglio italiano, istruzioni e JSON strutturato, pur
restando in una classe di dimensioni adatta a macchine modeste. I progetti
precedenti che indicavano SmolLM2 vengono migrati automaticamente a Qwen.
Gemma 3 270M non è il predefinito perché il download dei pesi su Hugging Face
richiede l'accettazione preventiva della licenza e quindi non garantisce un
primo utilizzo automatico senza account.
