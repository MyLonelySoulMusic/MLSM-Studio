# Script di piattaforma

Gli script nativi sono separati per sistema operativo e partono sempre dalla root del repository, anche quando vengono invocati da un’altra directory.

## Logo e launcher grafici

Le build desktop usano esplicitamente il logo originale MLSM: ICNS multirisoluzione fino a 1024px per Mac, ICO con livelli da 16 a 256px per Windows e PNG RGBA per Tauri. Anche installer e disinstaller NSIS Windows usano il logo. Prima del packaging, `tools/verify_brand_assets.cjs` verifica formati, risoluzioni e riferimenti della configurazione: un asset mancante o corrotto interrompe la build con un errore leggibile.

Install e launch creano/aggiornano questi avviatori con il logo:

- macOS: `scripts/macos/MLSM Studio.app` — doppio clic nel Finder; apre Terminale ed esegue il normale `launch.sh`.
- Windows: `scripts/windows/MLSM Studio.lnk` — doppio clic in Esplora file; esegue `launch.bat` con percorsi quotati e mantiene aperto il terminale per i log.

Per crearli o rigenerarli senza avviare l’app:

```bash
node tools/create_branded_launchers.cjs
```

Sono generati per la macchina corrente e ignorati da Git perché contengono il percorso del checkout. Non vengono creati collegamenti sul Desktop automaticamente. Puoi copiare l’avviatore sul Desktop; non spostare il repository dopo averlo creato, oppure rigeneralo. Gli script `.sh` e `.bat` originali rimangono disponibili: l’icona è sull’avviatore nativo, non un’associazione globale del tipo di file.

La generazione non richiede nuove dipendenze npm e non avvia Vite o backend. Gli aggiornamenti sono idempotenti e non sovrascrivono app o collegamenti omonimi non creati da MLSM. Un fallimento della generazione viene segnalato ma non blocca l’installazione o l’avvio tramite gli script. Il launcher di sviluppo con logo non sostituisce l’app Tauri installabile: DMG, NSIS e MSI continuano a essere prodotti dai build script.

Configurazione dei formati nativi: [Tauri App Icons](https://v2.tauri.app/develop/icons/).

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

I launcher macOS e Windows eseguono `tools/prepare_node_workspace.cjs` prima di Vite. Il controllo usa impronte dei manifest/lockfile e dei sorgenti: lancia `npm ci --include=dev` solo dopo modifiche alle dipendenze e `npm run build` solo quando la build locale è assente o superata. Se il marker non esiste, come al primo avvio dopo l’aggiornamento che introduce questa funzione, vengono eseguiti entrambi. Il marker è locale in `node_modules/.cache/mlsm-studio/`. Con `--check` il launcher non modifica nulla e restituisce errore se sarebbe necessaria una preparazione.

Gli installer preparano Node.js con tutte le dipendenze npm bloccate dal lockfile, Python 3.11, i quattro virtualenv Python, FFmpeg, Rubber Band e Rust/Tauri. L’installazione termina con errore se anche un solo componente o import Python richiesto non è disponibile; il messaggio “pronto” viene mostrato soltanto dopo la verifica completa. `build.sh` produce il DMG macOS; `build.bat` produce gli installer NSIS e MSI Windows.

Su Windows Rubber Band viene installato tramite MSYS2 in `C:\msys64\ucrt64\bin`. L’installer aggiunge la directory al PATH utente senza usare `setx` e l’app dispone anche di un resolver interno per i percorsi noti: non è necessario configurare manualmente `C:\Tools` o riavviare il terminale per il primo avvio tramite gli script MLSM.

I requisiti dell’Upscaler si trovano in `tools/upscaler/requirements.txt`, accanto al relativo runtime. I requisiti degli altri servizi seguono la stessa convenzione nelle rispettive cartelle sotto `tools/`.
