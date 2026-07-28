# Sincronizzazione

## Contratto temporale

Il tempo canonico è espresso in secondi dal tempo zero del progetto come `number` IEEE-754. Per gli eventi audio si conserva anche `timeSamples`, intero riferito al sample rate della sorgente. La conversione canonica è:

```text
timeSamples = round(timeSeconds * sampleRate)
timeSeconds = timeSamples / sampleRate
```

Se entrambi sono presenti, `timeSamples` è autorevole per gli eventi agganciati all'audio; la differenza ammessa è mezzo campione. Gli offset sono trasformazioni di presentazione/clock e non riscrivono l'analisi originale.

## Clock

- **Preview**: master clock del `AudioContext`. All'avvio si registra la coppia `(contextTimeStart, projectTimeStart)`. Il tempo scena è `projectTimeStart + context.currentTime - contextTimeStart + globalOffset`.
- **Pausa**: si congela il tempo progetto calcolato; alla ripresa si crea una nuova coppia di ancoraggio.
- **Seek**: si ricrea la source Web Audio dal punto richiesto e si reimposta l'ancora. Non si accumulano delta frame.
- **Export**: il frame `N` usa esattamente `N / fps`, anche per fps razionali come `30000/1001`.
- **Frame step**: usa la razionale del frame rate corrente, non millisecondi arrotondati.

Il renderer riceve sempre un tempo assoluto. Se la UI perde frame, valuta direttamente il tempo audio corrente; non tenta di recuperare rallentando l'audio.

## FPS razionali e durata

Il frame rate è persistito come numeratore e denominatore. Il valore decimale è solo UI.

```text
totalFrames = ceil(durationSeconds * fpsNumerator / fpsDenominator)
frameTime(N) = N * fpsDenominator / fpsNumerator
```

Gli indici validi sono `0..totalFrames-1`. Il video parte a PTS zero. L'ultimo frame può estendersi oltre la durata audio di meno di un frame; in mux si conserva l'audio originale e si imposta la durata finale secondo il preset, senza time-stretch. La verifica segnala una differenza A/V superiore a 5 ms e prova un remux con timestamp espliciti prima di fallire.

## Impatti

Un impatto programmato è valutato al tempo esatto dell'evento. L'evaluator sceglie segmenti con intervalli semiaperti `[start,end)`, tranne l'ultimo; a `endTime` restituisce esattamente il contatto e applica lo stato post-impatto al segmento successivo. Gli effetti visivi usano `time - impactTime`, quindi non spostano il contatto.

Tolleranze iniziali:

- modello matematico: errore temporale inferiore a 0,5 ms;
- coerenza sample/secondi: massimo mezzo campione;
- visuale: inferiore a mezzo frame;
- durata mux: 5 ms quando il container lo permette.

## Offset e latenza

- `audio.globalOffsetMs`: correzione utente tra -250 e +250 ms applicata al mapping audio↔progetto.
- `analysis.latencyCompensationMs`: correzione documentata dell'analyzer, già incorporata nei tempi degli eventi prodotti.
- Latenza dispositivo: mostrata come diagnostica, non usata per alterare l'export.

Il test di calibrazione riproduce click e flash sugli stessi marker, mostra audio time, animation time e drift, e salva solo la correzione esplicita dell'utente.

## Test richiesti

- confronto dello stesso timestamp a preview FPS diversi;
- impatti a 24, 25, 30000/1001, 30, 50, 60000/1001, 60 e 120 fps;
- seek, pausa/ripresa e loop senza accumulo;
- simulazione di 10 minuti confrontando clock assoluto e sample index;
- silenzio iniziale e durata non multipla di frame;
- confronto preview/export mediante hash dello stato di dominio, non dei pixel.
