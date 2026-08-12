# Analisi audio

L’analisi è condivisa da traiettorie, visualizer, sottotitoli, lip sync e montaggio.

## Output

- BPM e confidenza;
- beat, downbeat e onset;
- energia e andamento dinamico;
- kick, snare e transienti;
- 48 bande spettrali;
- bande stereo sinistra/destra e ampiezza stereo;
- indizi di piano, chitarra e archi quando chiaramente presenti;
- segmenti/parole Whisper e fonemi nelle modalità abilitate.

## Pipeline

1. Decodifica e normalizzazione controllata.
2. Estrazione di energia e transienti.
3. Stima del tempo e griglia dei beat.
4. Spettro/stereo e classificatori richiesti.
5. Smoothing specifico del consumer: le barre, per esempio, hanno attacco e rilascio più morbidi dei marker.
6. Cache tramite hash del file e versione dell’analizzatore.

## Requisiti

L’analisi gira in Worker quando possibile e pubblica avanzamento/cancellazione. Un risultato dalla cache deve essere semanticamente identico a quello appena calcolato. Errori di codec non devono bloccare l’interfaccia né creare una scena con dati parziali non dichiarati.
