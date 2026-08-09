# Formato progetto

Il file `.rbs.json` usa JSON Schema Draft 2020-12 e `schemaVersion: 1`. Lo schema normativo è `packages/project-schema/schema/project.schema.json`.

## Regole

- I tempi sono secondi da zero progetto; `timeSamples` è un intero non negativo.
- FPS è una frazione `{ numerator, denominator }` per rappresentare 29.97/59.94 senza ambiguità.
- Colori sono stringhe CSS validate più precisamente a livello applicativo.
- Vettori e trasformazioni sono dati semplici, mai istanze Three.js.
- ID sono stringhe non vuote e unici nelle rispettive collezioni; unicità e riferimenti incrociati sono invarianti applicative.
- Date sono ISO 8601 UTC. Asset copiati usano path relativi; quelli esterni dichiarano `storage: "external"`.
- Campi sconosciuti sono rifiutati nelle strutture principali per scoprire incompatibilità presto.

## Invarianti oltre JSON Schema

La validazione runtime deve verificare: `updatedAt >= createdAt`; rapporto canvas coerente o custom; sample/seconds entro mezzo campione; eventi ordinabili e ID unici; riferimenti evento/oggetto esistenti; segmenti non sovrapposti con `endTime > startTime`; endpoint dei segmenti coerenti con gli impatti; risoluzioni entro capability; offset tra -250 e 250 ms.

Il montaggio del **Video Editor** aggiunge le proprie invarianti: almeno una traccia; ID unici fra tracce, media del pool, clip e blocchi effetto; ogni clip riferita a un media presente nel pool e a una traccia esistente e compatibile (`video` per immagini/video, `audio` per sorgenti solo audio); fade in e fade out, sia video sia audio, che non superano insieme la durata della clip; ogni blocco effetto contenuto nei bordi della clip visiva di destinazione. I livelli video sono semanticamente equivalenti e il loro ordine determina esclusivamente il compositing. I progetti salvati prima dell’introduzione del montaggio ricevono pool vuoto, due livelli video e una traccia audio, calamita attiva con raggio di 80 ms e composizione 1920 × 1080; le sole etichette predefinite storiche “Video principale” e “Overlay” vengono migrate ai nomi neutrali senza cambiare gli ID o i nomi personalizzati.

## Migrazioni

Il loader legge solo JSON con versione intera, valida lo schema storico, applica funzioni pure `vN → vN+1`, poi valida lo schema corrente. Il salvataggio scrive sempre la versione corrente. Il file originale non viene sovrascritto durante una migrazione fallita.

## Evoluzione

Nuovi campi opzionali compatibili possono entrare nella versione corrente solo prima della prima release pubblica. Dopo la release, cambi semantici o campi obbligatori richiedono incremento di `schemaVersion` e fixture di migrazione.
