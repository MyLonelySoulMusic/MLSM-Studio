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
| Avvia | `scripts/macos/launch.sh` | `scripts\windows\launch.bat` |
| Crea pacchetto | `scripts/macos/build.sh` | `scripts\windows\build.bat` |
| Verifica runtime | `npm run install:verify` | `npm run install:verify` |

L’installer iniziale viene eseguito direttamente perché su una macchina nuova Node/npm potrebbe non essere ancora disponibile. Gli alias `install:mac` e `install:windows` restano disponibili come scorciatoie sulle macchine già configurate.

Anche launcher e build script macOS inizializzano autonomamente il percorso Homebrew di `node@22`, quindi funzionano su un’installazione nuova senza dipendere dal profilo della shell.

Gli installer preparano Node.js con tutte le dipendenze npm bloccate dal lockfile, Python 3.11, i quattro virtualenv Python, FFmpeg, Rubber Band e Rust/Tauri. L’installazione termina con errore se anche un solo componente o import Python richiesto non è disponibile; il messaggio “pronto” viene mostrato soltanto dopo la verifica completa. `build.sh` produce il DMG macOS; `build.bat` produce gli installer NSIS e MSI Windows.

Su Windows Rubber Band viene installato tramite MSYS2 in `C:\msys64\ucrt64\bin`. L’installer aggiunge la directory al PATH utente senza usare `setx` e l’app dispone anche di un resolver interno per i percorsi noti: non è necessario configurare manualmente `C:\Tools` o riavviare il terminale per il primo avvio tramite gli script MLSM.

I requisiti dell’Upscaler si trovano in `tools/upscaler/requirements.txt`, accanto al relativo runtime. I requisiti degli altri servizi seguono la stessa convenzione nelle rispettive cartelle sotto `tools/`.
