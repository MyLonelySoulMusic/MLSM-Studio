# Analisi audio

## Contratto del sidecar

Il processo riceve una richiesta JSON per riga su stdin e produce messaggi JSON per riga su stdout. `stderr` è riservato ai log. Ogni messaggio contiene `protocolVersion`, `requestId` e un tipo (`progress`, `result`, `error`, `cancelled`). Nessun log non strutturato può contaminare stdout.

Input: path validato dal processo Rust, sensibilità, intervallo opzionale, hop lengths, offset e versione parametri. Output: metadati, waveform ridotta, RMS/loudness relativo, onset envelope, spectral flux, tempo globale/locale, beat/downbeat, sezioni ed eventi con confidence.

## Pipeline

1. FFprobe legge durata, codec, canali e sample rate.
2. Se necessario FFmpeg decodifica una sola volta in WAV PCM float32 temporaneo, preservando l'originale.
3. Soundfile legge a chunk; per analisi si produce mono mantenendo metadati canale e waveform stereo quando utile.
4. Una passata economica genera waveform/RMS/struttura; passate a hop multipli rilevano onset e transitori.
5. Bande low/mid/high e full-spectrum generano candidati, poi clustering temporale evita duplicati.
6. Beat tracking valuta tempo normale, half-time e double-time con uno score di allineamento agli onset.
7. Classificazione euristica iniziale: low→kick, mid→snare/percussione, high→hi-hat; la confidence riflette separazione di banda, prominenza e allineamento metrico.

## Precisione e latenza

Le feature basate su finestre vengono inizialmente timestampate al centro finestra. La compensazione sottrae il group delay noto; un raffinamento locale cerca il massimo transiente sui campioni ad alta risoluzione. Il risultato è convertito prima in sample index e poi in secondi. L'offset globale dell'utente è applicato a valle e non entra nella cache dell'analisi grezza.

## Cache

Chiave:

```text
SHA-256(audio bytes + analyzerVersion + canonicalAnalysisParameters)
```

Il JSON dei parametri è canonicalizzato con chiavi ordinate. La cache include protocol/version schema, hash sorgente, dimensione e risultato. Un cambio di byte, versione o parametro invalida la voce. Scrittura atomica, lock per chiave e cleanup LRU impediscono risultati parziali o crescita illimitata.

## Errori e cancellazione

File non leggibile, codec non supportato, dati corrotti e memoria insufficiente producono codici stabili e messaggi utente separati dai dettagli diagnostici. Il processo Rust può inviare cancellazione cooperativa e, dopo timeout, terminare il sidecar. I file temporanei sono registrati da un guard e rimossi su successo, errore o cancellazione.

## Validazione

- click track a BPM costante con precision/recall e errore temporale;
- tempo variabile e half/double-time;
- silenzio iniziale, stereo, Unicode e spazi nel path;
- cache hit e invalidazione per contenuto/parametri/versione;
- file corrotto e cancellazione;
- fixture corte redistribuibili, con hash e provenienza documentata.
