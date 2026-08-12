# Assistente Studio

L’assistente in basso a destra risponde sull’uso di MLSM Studio con un modello locale e una knowledge base curata.

## Contesto

Il prompt riceve ruolo, lingua, modalità, formato, stato di audio/analisi/export e una sintesi della conversazione. Non deve inventare funzioni né rispondere con una guida casuale a saluti o domande generiche.

## Processo

1. Classifica saluto, conversazione o richiesta tecnica.
2. Recupera soltanto documenti realmente pertinenti.
3. Avvia Qwen locale dalla cache; WebGPU è preferito, WASM è fallback.
4. Valida utilità e coerenza della risposta.
5. In timeout usa una risposta mirata dalla knowledge base e dichiara il fallback.

## Memoria

Le domande precedenti vengono compattate in una sintesi limitata e persistente. **Azzera memoria** elimina conversazione e sommario. La memoria non contiene file catalogati da Memory e non viene inviata online.

## Manutenzione

Ogni nuova modalità deve aggiungere: scopo, input, flusso, errori comuni ed export. Le risposte di presentazione devono sempre spiegare cosa può fare il bot e chiedere quale obiettivo ha l’utente.
