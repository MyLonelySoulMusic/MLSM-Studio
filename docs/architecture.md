# Architettura

MLSM Studio è web-first con shell desktop Tauri. L’interfaccia React condivide schema, clock, analisi ed export; i servizi nativi/Python intervengono soltanto dove browser e WebAssembly non bastano.

## Processi

| Processo | Responsabilità |
| --- | --- |
| **React/Vite** | UI, stato progetto, timeline, preview, WebAudio, WebCodecs e modelli web locali. |
| **Tauri** | Dialog nativi, percorsi reali, lettura/anteprima/copia Memory e pacchetti desktop. |
| **Upscaler Python** | Real-ESRGAN/RealESRNet, frame video e interpolazione. |
| **AI Quantizer** | Pipeline musicale, FFmpeg e Rubber Band. |
| **Worker** | Analisi audio senza bloccare l’interfaccia. |

## Package

- `apps/desktop`: applicazione React/Tauri e servizi Vite.
- `packages/project-schema`: tipi, default, validazione e migrazioni.
- `packages/audio-analysis`: contratti e funzioni di analisi.
- `packages/trajectory`: traiettorie deterministiche.
- `packages/export`: contratti dell’export.
- `tools`: runtime Python/Node, installer, verifiche e screenshot.

## Stato

Zustand separa progetto, audio, analisi, scena, export e playback del Video Editor. I media binari restano fuori dal JSON; il progetto conserva metadati, impostazioni, timeline e riferimenti ricollegabili.

## Modalità estendibili

`animation-modes.ts` descrive categoria, gruppo, pannello e generatore. Home e pannello sinistro leggono lo stesso registro; aggiungere una modalità non richiede di ridisegnare il layout globale.

## Flussi

### Audio-reattivo

Import → hash/cache → analisi → progetto → generatore → preview → export offline.

### Video Editor

Pool media → livelli/clip → compositor preview → renderer deterministico → mix audio → verifica.

### AI locale

Selezione modello → controllo cache → download una tantum → GPU/Metal/CUDA o fallback → risultato locale.

## Affidabilità

- Il clock di export deriva dall’indice del frame.
- Le operazioni lunghe espongono stato, percentuale e log.
- I temporanei hanno lifecycle esplicito.
- I modelli e i database utente sono esclusi dal repository.
- Preview ed export condividono resolver temporali e impostazioni, pur potendo usare qualità di visualizzazione diversa.
