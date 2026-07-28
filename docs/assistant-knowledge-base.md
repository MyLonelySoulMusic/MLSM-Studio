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
4. Il prompt include formato, presenza dell’audio e stato dell’analisi.
5. Il modello deve rispondere in italiano e non può inventare funzioni assenti
   dalla knowledge base.
6. Se WebGPU/WASM o il modello non sono disponibili, il retriever restituisce
   direttamente una risposta deterministica dagli stessi articoli.

Per aggiungere una modalità, creare nello stesso file almeno un articolo con il
nuovo `modeId`, i nomi dei controlli visibili e la procedura completa. Aggiornare
anche gli articoli trasversali se la modalità modifica importazione, timeline,
sottotitoli o export. I test di retrieval sono in
`apps/desktop/src/knowledge/application-help.test.ts`.
