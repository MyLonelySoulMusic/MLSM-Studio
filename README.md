# MLSM Studio

![MLSM Studio](docs/screenshots/01-welcome.png)

**MLSM Studio — My Lonely Soul Music Studio** è una suite creativa locale per animazioni audio-reattive, sottotitoli, restauro di foto e video, montaggio multitraccia e lavorazione musicale assistita da AI.

I file dell’utente restano sul computer. Le esportazioni video sono offline e deterministiche: ogni frame viene calcolato e verificato prima della consegna, senza registrare la preview in tempo reale.

## Installazione rapida

### macOS

```bash
bash scripts/macos/install.sh
scripts/macos/launch.sh
```

### Windows

Dal Prompt dei comandi:

```bat
scripts\windows\install.bat
scripts\windows\launch.bat
```

Gli installer installano e verificano **Python 3.11** (non una versione generica), quindi creano automaticamente i quattro ambienti isolati `.venv`, `.venv-ai-quantizer`, `.venv-song-player` e `.venv-audio-tts`. Preparano inoltre Node.js, FFmpeg, Rust/Tauri e le dipendenze npm. Un ambiente esistente creato con una versione Python diversa viene rigenerato con Python 3.11. I modelli AI pesanti vengono scaricati soltanto quando richiesti dal relativo runtime e poi riusati dalla cache locale.

Per verificare una macchina senza aprire l’app:

```bash
npm run install:verify
```

## Avvio per sviluppatori

```bash
npm install
npm run dev
```

L’indirizzo predefinito è `http://localhost:1420`. L’avvio è sempre esplicito; build e test non lasciano server attivi.

## Struttura del repository

| Percorso | Responsabilità |
| --- | --- |
| `apps/desktop/` | Applicazione React/Vite e shell Tauri. |
| `packages/` | Librerie condivise del workspace. |
| `tools/` | Runtime Python, servizi locali e utility di sviluppo. |
| `scripts/macos/` | Installazione, avvio e packaging per macOS. |
| `scripts/windows/` | Installazione, avvio e packaging per Windows. |
| `docs/` | Manuali, architettura e requisiti storici. |
| `assets/`, `img/`, `mixamo/` | Risorse grafiche e modelli usati dall’app. |
| `tests/` | Test di integrazione trasversali. |

La root contiene soltanto i manifest e le configurazioni necessarie agli strumenti, oltre a questo README.

## Le quattro aree

![Home delle aree](docs/screenshots/02-home-areas.png)

| Area | Cosa contiene |
| --- | --- |
| **Sound Animation** | Undici modalità per scene 3D, visualizer, storie pixel, orsacchiotti e sottotitoli animati. |
| **Photo & Video Studio** | Rimozione di watermark statici e upscaling AI/Canvas di immagini e video. |
| **Video Editor** | Montaggio multitraccia con livelli equivalenti, effetti, correzione colore e export offline. |
| **Music** | AI Quantizer integrato per quantizzazione, allineamento stem, restauro e analisi forense. |

Il pulsante **Home** riporta sempre alla scelta delle aree. **Memory** apre l’archivio semantico locale; **Supportami** mostra i canali dell’artista; lingua e tema si cambiano dalla barra superiore.

## Flusso essenziale

1. Entra nello Studio e scegli un’area.
2. Seleziona una modalità dal pannello sinistro.
3. Importa i media richiesti dalla modalità.
4. Analizza l’audio quando servono beat, spettro, fonemi o sottotitoli.
5. Regola la scena nella viewport, nell’Inspector e nella timeline.
6. Apri **Esporta**, scegli rapporto, risoluzione e frame rate.
7. Attendi la verifica finale: un file con frame mancanti non viene consegnato.

## Documentazione

- [Indice della documentazione](docs/index.md)
- [Manuale utente](docs/user-guide.md)
- [Sound Animation](docs/sound-animation.md)
- [Photo & Video Studio](docs/photo-video-studio.md)
- [Video Editor](docs/video-editor.md)
- [Music · AI Quantizer](docs/music.md)
- [Memory](docs/memory.md)
- [Export offline](docs/export.md)
- [Installazione e sviluppo](docs/development.md)
- [Script per macOS e Windows](scripts/README.md)
- [Architettura](docs/architecture.md)

## Controlli di qualità

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Gli screenshot del manuale si rigenerano dal build statico, senza server:

```bash
npm run build
node tools/capture_documentation_screenshots.mjs
```

## Pacchetti desktop

```bash
npm run package:mac                 # DMG macOS
bash scripts/macos/build.sh --check # sola verifica
```

```bat
npm run package:windows             REM EXE NSIS e MSI
scripts\windows\build.bat --check   REM sola verifica
```

Gli artefatti vengono creati in `apps/desktop/src-tauri/target/release/bundle/`. La distribuzione pubblica richiede firma Apple Developer o Authenticode; senza firma il pacchetto è installabile, ma il sistema operativo può mostrare un avviso.

## Dati locali e Git

Modelli, database Memory, file temporanei, progetti AI Quantizer e credenziali sociali non appartengono al repository. Le directory runtime sono escluse da Git e possono essere rigenerate al primo utilizzo.
