# Knowledge base dell’assistente locale

La chat **Assistente Studio** usa Qwen2.5 0.5B Instruct. I pesi non sono
distribuiti con il repository: al primo utilizzo il runtime li scarica dal
repository ONNX dichiarato in `local-model-runtime.ts`. In sviluppo vengono
conservati nella cache persistente su disco `.transformers-cache/`; la build usa
la cache del WebView. Dopo il download, domande, stato del progetto e inferenza
restano sul dispositivo.

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
3. Soltanto i due articoli più pertinenti entrano nel contesto di Qwen2.5.
4. Il prompt di sistema definito in `application-assistant.ts` presenta ruolo e
   limiti di Studio Bot e distingue saluto, posizione di un controllo, workflow,
   diagnosi e richiesta ambigua. Formato, presenza dell’audio, stato
   dell’analisi e memoria riassunta entrano nel messaggio utente strutturato.
5. Il modello deve rispondere in italiano e non può inventare funzioni assenti
   dalla knowledge base.
6. Aprire la chat avvia il warm-up. Se il modello non è ancora pronto quando
   arriva una domanda, il programma lo attende al massimo otto secondi e poi usa
   la knowledge base.
7. Il runtime verifica un adapter WebGPU reale e il supporto `shader-f16`; se
   l’inizializzazione fallisce riprova automaticamente con WASM Q4.
8. La generazione usa uno stopping criterion interrompibile a venti secondi;
   se il modello non è disponibile, il retriever restituisce una risposta
   deterministica dagli stessi articoli.

## Memoria della conversazione

La memoria non conserva un prompt illimitato. Dopo ogni risposta registra una
versione compatta della domanda e dell’indicazione fornita, mantiene i turni più
recenti entro un limite fisso e salva soltanto quel riepilogo in `localStorage`.
Qwen2.5 riceve il riepilogo insieme agli ultimi messaggi visibili, così può
comprendere riferimenti come “e lo sfondo?” senza rallentare progressivamente.
Il comando **Azzera memoria** cancella riepilogo e cronologia visibile.

Per aggiungere una modalità, creare nello stesso file almeno un articolo con il
nuovo `modeId`, i nomi dei controlli visibili e la procedura completa. Aggiornare
anche gli articoli trasversali se la modalità modifica importazione, timeline,
sottotitoli o export. I test di retrieval sono in
`apps/desktop/src/knowledge/application-help.test.ts`.
