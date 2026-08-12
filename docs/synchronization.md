# Sincronizzazione

## Clock

- In preview l’audio o il trasporto del montaggio è il clock autorevole.
- In export il tempo è sempre `frameIndex / fps`.
- Seek e pausa rendono esattamente lo stato del playhead.
- Le clip occupano intervalli `[start, end)`; soltanto il termine finale del progetto può mostrare l’ultimo frame.

## Frame rate

La durata non viene ricavata dal numero di callback del browser. Per una durata `D` e frame rate `F`, l’export calcola il numero atteso di frame e lo confronta con i pacchetti codificati.

## Eventi musicali

Beat e onset restano timestamp assoluti. Smoothing visivo, rimbalzi e animazioni leggono gli stessi eventi ma possono usare curve diverse. Cambiare qualità della preview non può cambiare il percorso o la sequenza degli eventi.

## Test essenziali

- seek su un taglio fra due clip;
- partenza da un gap e ingresso nella clip successiva;
- pausa/play senza frame nero o congelato;
- durata non multipla del frame;
- export a 24/30/60/120 fps;
- audio e video con durata diversa;
- verifica del numero di frame finale.
