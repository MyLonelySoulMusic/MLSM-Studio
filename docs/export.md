# Export offline

Tutte le esportazioni video usano una pipeline offline: la preview non viene registrata e la velocità della GPU durante la riproduzione non può causare frame persi.

## Pipeline comune

1. Congela una copia del progetto e delle impostazioni.
2. Calcola durata, risoluzione, rapporto e frame rate.
3. Decodifica i media al timestamp `frameIndex / fps`.
4. Renderizza e compone il frame completo.
5. Attende che l’encoder acquisisca il frame prima di avanzare.
6. Elabora o mixa l’audio senza riprodurlo.
7. Muxa audio e video.
8. Riapre il contenitore e verifica durata, tracce e frame attesi.
9. Consegna il file soltanto dopo il controllo.

L’export può richiedere più della durata del brano: è il comportamento previsto per mantenere qualità e continuità.

## Rapporti e risoluzioni

Ogni preset indica il rapporto, per esempio `1080 × 1920 (9:16)` o `3840 × 2160 (16:9)`. I preset rispettano l’orientamento del progetto; non scambiano larghezza e altezza su un video verticale.

Nel pannello Upscaler, quando **Mantieni proporzioni** è attivo, importazione ed esportazione usano il rapporto reale della sorgente e adattano i preset di conseguenza. Sono accettati anche rapporti proporzionali arbitrari, non solo quelli elencati. Per **Background Auto Animation**, l’immagine caricata resta la fonte di verità: preview ed export usano `contain` e non ritagliano l’immagine. Se una dimensione sorgente è dispari, il preset nativo applica esclusivamente l’arrotondamento al pixel pari richiesto dall’encoder (per esempio `941 × 1672` diventa `942 × 1672`) e la validazione accetta questa tolleranza senza ammettere rapporti realmente diversi.

## Modalità speciali

- **Scene 3D e visualizer:** ricostruzione della scena al tempo di render, stessa camera e stesso percorso della preview.
- **Background Auto Animation:** renderer Canvas2D deterministico condiviso con la preview (stessa palette `source-over`, velocità di rotazione e stato fermo); immagine sorgente in modalità `contain`, senza velo scuro o vignettatura automatica, riquadri DETR già salvati, spettro centrale orizzontale, bande stereo L/R sotto il centro, Pro Subtitles circolari e particelle di collisione vengono ricostruiti frame per frame senza rieseguire il modello. I toggle dei singoli effetti sono rispettati; overlay di riquadri, alias, etichetta del modello, confidence e il toggle **Show/Hide detected areas** restano esclusi dal file esportato.
- **From 9:16 to 16:9:** compositor a livelli con video centrale, immagini laterali, cubo, spettro ed effetti.
- **Pro Subtitles:** video completo oppure livello trasparente MOV ProRes 4444/WebM VP9 alpha quando il runtime lo supporta; sfondo pieno come fallback.
- **Static Watermark Remover:** decodifica e correzione frame per frame.
- **Upscaler video:** frame originali temporanei, elaborazione per frame/tile, ricostruzione audio/video.
- **Video Editor:** livelli, blend, correzione, effetti e mix audio dalla timeline.

## Audio

L’audio non viene mandato alle cuffie durante l’export. Quando è possibile viene copiato o transcodificato in AAC/codec compatibile e muxato sul file finale; la durata viene verificata insieme al video.

## Temporanei e quota

I frame intermedi vengono scritti in una directory temporanea del progetto o del sistema, non in storage browser non controllato. Sono eliminati dopo download, refresh, riavvio o errore recuperabile. Questo evita l’errore “application storage quota”.

Per proteggere la memoria, l’export controlla la dimensione del frame prima di accodarlo all’encoder e interrompe in modo esplicito quando la risoluzione richiesta supera il budget disponibile; ridurre il preset di risoluzione consente di riprovare senza cambiare la scena.

## Errori

Un errore di codec, un frame mancante o una traccia non valida interrompe la consegna del file parziale. Ridurre risoluzione può abbreviare i tempi, ma non è necessario abbassare FPS per evitare drop: il clock offline resta deterministico.
