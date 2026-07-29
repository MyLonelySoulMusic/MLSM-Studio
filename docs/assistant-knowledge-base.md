# Knowledge base dell’assistente locale

La chat **Assistente Studio** usa SmolLM2 135M Instruct. I pesi non sono
distribuiti con il repository: al primo utilizzo il runtime li scarica dal
repository ONNX dichiarato in `local-model-runtime.ts` e li conserva nella
Cache Storage persistente. Dopo il download, domande, stato del progetto e
inferenza restano sul dispositivo.

La fonte operativa letta dal bot è:

```text
apps/desktop/src/knowledge/application-help.ts
```

Ogni articolo contiene:

- un identificativo stabile;
- un titolo;
- le modalità alle quali è particolarmente pertinente;
- parole chiave italiane e inglesi;
- istruzioni verificate rispetto ai controlli realmente presenti nella UI.

## Processo di risposta

1. La domanda viene normalizzata e ampliata con sinonimi applicativi.
2. Il retriever assegna priorità a titolo, parole chiave e modalità attiva.
3. Soltanto i tre articoli più pertinenti entrano nel contesto di SmolLM2.
4. Il prompt di sistema definito in `application-assistant.ts` include formato,
   presenza dell’audio, stato dell’analisi e memoria riassunta.
5. Il modello deve rispondere in italiano e non può inventare funzioni assenti
   dalla knowledge base.
6. Se il modello non è ancora pronto, la prima risposta viene restituita subito
   dalla knowledge base e il download prosegue in background.
7. Caricamento e generazione hanno timeout separati; se WebGPU/WASM o il modello
   non sono disponibili, il retriever restituisce
   direttamente una risposta deterministica dagli stessi articoli.

## Memoria della conversazione

La memoria non conserva un prompt illimitato. Dopo ogni risposta registra una
versione compatta della domanda e dell’indicazione fornita, mantiene i turni più
recenti entro un limite fisso e salva soltanto quel riepilogo in `localStorage`.
SmolLM2 riceve il riepilogo insieme agli ultimi messaggi visibili, così può
comprendere riferimenti come “e lo sfondo?” senza rallentare progressivamente.
Il comando **Azzera memoria** cancella riepilogo e cronologia visibile.

Per aggiungere una modalità, creare nello stesso file almeno un articolo con il
nuovo `modeId`, i nomi dei controlli visibili e la procedura completa. Aggiornare
anche gli articoli trasversali se la modalità modifica importazione, timeline,
sottotitoli o export. I test di retrieval sono in
`apps/desktop/src/knowledge/application-help.test.ts`.
