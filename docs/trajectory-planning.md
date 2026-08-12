# Pianificazione della traiettoria

Instrumental Falling genera un viaggio deterministico guidato dall’analisi del brano.

## Segmenti

- **Scorrimento:** prevalentemente orizzontale, più rapido; la sfera poggia sopra il binario.
- **Rimbalzo:** contatto con lo strumento e piccolo slancio verso l’alto.
- **Caduta:** tratto verticale nel vuoto senza binario; la sfera resta davanti agli oggetti.
- **Profondità:** variazione avanti/indietro sull’asse Z senza attraversare geometrie.

## Regole

- La quota generale scende sempre, anche quando il percorso cambia direzione.
- I binari compaiono soltanto nei tratti di scorrimento e restano sollevati dagli strumenti.
- Non tutti i beat diventano impatti: alcune battute mantengono lo scorrimento.
- Sezioni più quiete rallentano e possono introdurre cadute nel vuoto.
- Gli impatti considerano dimensione, superficie e profondità degli oggetti.
- Rotazione e traslazione della sfera restano continue fra segmenti.

## Determinismo

Il planner produce segmenti ed eventi; l’evaluator restituisce posizione, rotazione e stato a qualsiasi timestamp. Preview ed export usano lo stesso evaluator, quindi saltare a metà brano non richiede simulare tutti i frame precedenti.
