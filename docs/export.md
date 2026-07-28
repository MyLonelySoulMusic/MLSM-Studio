# Export video web

## Pipeline attuale

L'export registra direttamente lo stesso canvas WebGL usato dalla preview. A ogni aggiornamento vengono applicati il tempo della traiettoria, la rotazione della biglia, la camera e la visibilità degli elementi; il canvas 3D viene poi composto con foto o video di sfondo, effetti e finale cinematografico.

```text
tempo export → stato React/Three.js → canvas WebGL preview ┐
                sfondo ed effetti → canvas composito       ├→ MediaRecorder → MP4/WebM finale
                     audio HTML → MediaStream audio ────────┘
```

Non esiste un secondo renderer semplificato. Geometrie, PBR, usura, neon, fisica, rotazione e camera sono quindi condivisi tra preview e file finale.

## File temporanei e destinazione

Il browser prova a scrivere progressivamente i chunk codificati in `dynamic-sound-animation-studio-temp`, una directory privata OPFS del progetto. Al termine crea il file scelto dall'utente e rimuove il temporaneo. Lo stesso cleanup viene eseguito dopo annullamento o errore, includendo anche l'eventuale cartella legacy `rhythm-ball-studio-temp`. Se OPFS non è disponibile, i chunk rimangono in memoria fino al download; non viene mai esposta una cartella di frame PNG.

La File System Access API viene usata quando disponibile per scegliere nome e destinazione prima di iniziare. Negli altri browser viene avviato un download standard.

## Codec e qualità

La selezione segue le capacità dichiarate da `MediaRecorder`: MP4 H.264/AAC ha precedenza, seguito da WebM VP9/Opus e WebM VP8/Opus. Sono disponibili i profili `Alta` e `Massima`, con `Massima` predefinito. Il bitrate cresce con risoluzione e frame rate usando rispettivamente 0,14 e 0,24 bit per pixel/frame; i limiti sono 8–100 Mbit/s e 12–160 Mbit/s. L'audio è richiesto a 320 kbit/s e il canvas composito abilita image smoothing di qualità alta.

Il bitrate richiesto è un obiettivo: l'encoder hardware del browser può applicare un limite proprio. Per minimizzare artefatti su vetro, neon, graffi e movimenti veloci è consigliato `Massima`; `Alta` è destinato a bozze o condivisioni più leggere.

La registrazione avviene in tempo reale. Preset 4K o 120 fps richiedono una GPU e un encoder browser sufficientemente veloci. I formati professionali non esposti da MediaRecorder, come ProRes, restano candidati per un eventuale adapter desktop FFmpeg da valutare alla fine dello sviluppo web.

## Audio e durata

L'audio parte da zero insieme al recorder ed è collegato tramite `captureStream()` o, come fallback, un nodo Web Audio. Se il finale mantiene l'immagine dopo la musica, il video continua per la durata configurata mentre la traccia audio è terminata.

## Progress e cancellazione

La UI mostra frame logico corrente, totale e avanzamento. Cancel ferma l'animazione e il recorder, chiude o annulla lo stream temporaneo, elimina il file parziale, ripristina dimensioni e tempo della preview e riporta il player alla posizione precedente.

## Verifica

I test coprono scelta del codec, fallback e limiti del bitrate. Typecheck, lint e build verificano l'integrazione fra renderer condiviso, schema progetto e File System Access API. La parità visuale completa deve essere verificata in browser con una breve esportazione di confronto, perché jsdom non implementa WebGL né MediaRecorder.
