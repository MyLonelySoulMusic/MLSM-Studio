# Script di piattaforma

Gli script nativi sono separati per sistema operativo e partono sempre dalla root del repository, anche quando vengono invocati da un’altra directory.

```text
scripts/
├── macos/
│   ├── install.sh
│   ├── launch.sh
│   ├── build.sh
│   ├── setup-ai-quantizer.sh
│   └── setup-upscaler.sh
└── windows/
    ├── install.bat
    ├── launch.bat
    └── build.bat
```

## Comandi consigliati

| Operazione | macOS | Windows |
| --- | --- | --- |
| Installa | `bash scripts/macos/install.sh` | `scripts\windows\install.bat` |
| Avvia | `npm run launch:mac` | `npm run launch:windows` |
| Crea pacchetto | `npm run package:mac` | `npm run package:windows` |
| Verifica runtime | `npm run install:verify` | `npm run install:verify` |

L’installer iniziale viene eseguito direttamente perché su una macchina nuova Node/npm potrebbe non essere ancora disponibile. Gli alias `install:mac` e `install:windows` restano disponibili come scorciatoie sulle macchine già configurate.

Gli installer preparano Node.js, Python 3.11, i quattro virtualenv Python, FFmpeg, Rubber Band e Rust/Tauri. `build.sh` produce il DMG macOS; `build.bat` produce gli installer NSIS e MSI Windows.

I requisiti dell’Upscaler si trovano in `tools/upscaler/requirements.txt`, accanto al relativo runtime. I requisiti degli altri servizi seguono la stessa convenzione nelle rispettive cartelle sotto `tools/`.
