# Photo & Video Studio

![Photo & Video Studio](screenshots/04-photo-video-studio.png)

## Static Watermark Remover

Rimuove un watermark fermo da un video di cui possiedi o sei autorizzato a modificare il contenuto.

1. Carica il video con watermark.
2. Carica una fotografia pulita della stessa inquadratura.
3. Disegna la regione nella preview.
4. Apri **Anteprima zona rimozione** per vedere anche i pixel confinanti, non soltanto il rettangolo sostituito.
5. Regola correzione e fusione; i valori iniziali sono conservativi.
6. Esporta: tutti i frame vengono decodificati, corretti e ricodificati offline.

**Sfumatura bordo** parte da `0%`: un valore maggiore interviene esclusivamente sulla stretta fascia esterna della zona trattata. **Intensità correzione** parte circa dal `5%` e armonizza luminosità/colore con il video senza sfocare i pixel puliti inseriti.

## Upscaler

Accetta fotografie e video. Per i video mostra avanzamento per frame e tile; i frame temporanei vengono rimossi dopo download, refresh o riavvio.

### Motori

| Modello | Ideale per | Limite principale |
| --- | --- | --- |
| **Canvas Enhanced** | Anteprima rapida e macchine senza backend AI | Non ricostruisce dettagli neurali. |
| **RealESRGAN x2plus** | Foto/video reali con ingrandimento moderato | Meno dettaglio del modello x4. |
| **RealESRGAN x4plus** | Scene reali, texture e dettagli generali | Più lento e più esigente. |
| **RealESRNet x4plus** | Restauro fedele e intervento meno aggressivo | Richiede servizio PyTorch locale. |
| **RealESRGAN x4plus anime 6B** | Anime, illustrazioni e cartoon | Non indicato per pelle/fotografia reale. |

Il dispositivo viene scelto automaticamente: CUDA su GPU NVIDIA, Metal/MPS su Apple Silicon, poi CPU. L’utente può forzare un motore diverso.

### Flusso

1. Carica il media e seleziona modello/dispositivo.
2. Scegli **Prova** per un campione oppure **Genera upscaling** per l’intero file.
3. Segui download del modello e avanzamento frame/tile.
4. Confronta prima/dopo con separatore, zoom e pan.
5. Miscela l’originale ridimensionato con il risultato.
6. Regola esposizione, contrasto, bianchi, neri, saturazione, nitidezza e risoluzione finale.
7. Esporta dallo stesso pannello.

La preview video confronta i due risultati reali con le etichette **Originale** e
**Output**; non è una simulazione geometrica. Per i video il backend legge con
`ffprobe` il rapporto di visualizzazione (DAR), la rotazione e il pixel aspect
ratio (SAR), così l’orientamento e le proporzioni visibili restano coerenti anche
quando i metadati non coincidono con le dimensioni codificate.

I preset Full HD, QHD, 4K e 8K rispettano l’orientamento: un sorgente verticale resta verticale quando **Mantieni proporzioni** è attivo.

All’import, **Mantieni proporzioni** usa il rapporto reale della sorgente; i preset si adattano quindi a quel rapporto senza forzare 16:9 o 9:16. La stessa regola vale in esportazione. Disattivando il blocco puoi impostare liberamente larghezza e altezza personalizzate, anche con un rapporto diverso da quello originale.

L’output viene rasterizzato con pixel quadrati (`SAR 1:1`), mantenendo il DAR
corretto senza introdurre stretching nei player che ignorano i metadati SAR.
