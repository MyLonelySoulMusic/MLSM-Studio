# LongCat Video

L’area **LongCat Video** integra la pipeline foundation ufficiale
`meituan-longcat/LongCat-Video` senza copiare codice o pesi nel repository MLSM.
Supporta tre flussi:

- **Text to Video:** prompt, negative prompt e rapporto 16:9, 9:16 o 1:1.
- **Image to Video:** immagine PNG/JPEG/WebP e risoluzione 480p o 720p.
- **Video Continuation:** video MP4/MOV/WebM/MKV e prosecuzione coerente a
  partire dai frame condizionanti.

Per ogni flusso si possono scegliere seed, durata, profilo distilled da 16 step
o profilo qualità da 50 step e `torch.compile`. Il risultato viene codificato
in MP4 H.264 nella cartella scelta e visualizzato direttamente nel workspace.
I job sono singoli, mostrano l’avanzamento e possono essere annullati; la
cancellazione termina anche i processi CUDA discendenti.

Nel launcher web il bridge locale avviato insieme a Vite riceve i media,
esegue lo stesso worker e presenta **Scarica MP4**. Nel pacchetto Tauri i
percorsi sono gestiti direttamente dai comandi nativi.

## Preparazione

La pipeline ufficiale richiede Linux, Python 3.10 e una GPU NVIDIA CUDA. Il
modello foundation ha 13,6 miliardi di parametri, quindi download, VRAM e tempo
di inferenza sono sostanziali. macOS/Metal e CPU non sono presentati come
fallback perché non sono backend supportati dal codice ufficiale. Il workspace
browser funziona comunque collegandosi al bridge locale su Linux: non tenta di
eseguire il modello dentro JavaScript.

```bash
npm run longcat-video:setup
npm run longcat-video:check
```

Il setup:

1. verifica Linux, driver NVIDIA e Python 3.10;
2. installa in `.longcat-video/repository` la revisione ufficiale fissata
   `6b3f4b8582a8bc3f20f795735f5383716c4ba794`;
3. crea `.venv-longcat-video` con PyTorch 2.6 / CUDA 12.4 e Flash Attention;
4. scarica `meituan-longcat/LongCat-Video` in `.longcat-video/weights`;
5. esegue un capability check reale prima di dichiarare il runtime pronto.

Per preparare soltanto codice e dipendenze:

```bash
npm run longcat-video:setup:runtime
```

Repository, ambiente e checkpoint sono ignorati da Git. Installazioni esterne
possono essere indicate con `MLSM_LONGCAT_PYTHON`,
`MLSM_LONGCAT_TORCHRUN`, `MLSM_LONGCAT_REPOSITORY` e
`MLSM_LONGCAT_CHECKPOINT`.

## Sicurezza del job

Il frontend invia un contratto discriminato per modalità. Il backend rifiuta
campi inattesi, percorsi relativi, symlink, formati non supportati, sorgenti
oltre 4 GiB, dimensioni non multiple di 16 e file di output esistenti. Il worker
usa solo argomenti strutturati, carica il checkpoint in modalità locale e non
invoca comandi shell costruiti dal prompt.

LongCat-Video è distribuito da Meituan con licenza MIT. Codice, istruzioni e
checkpoint originali restano disponibili nel
[repository ufficiale](https://github.com/meituan-longcat/LongCat-Video) e nella
[pagina Hugging Face](https://huggingface.co/meituan-longcat/LongCat-Video).
