# Memory

**Memory** è il catalogo semantico locale di MLSM Studio. Indicizza riferimenti a file e cartelle senza caricare i contenuti su servizi cloud e consente di ritrovarli con descrizioni naturali.

## Costruire la memoria

1. Premi **Memory** nella barra superiore e apri **Costruisci memoria**.
2. Scegli uno o più file oppure una cartella. Una cartella viene letta ricorsivamente; collegamenti simbolici ed elementi nascosti vengono ignorati per sicurezza.
3. Seleziona un elemento nell'elenco per controllarne subito contenuto e percorso assoluto nel pannello **Anteprima prima del salvataggio**. L'anteprima è disponibile prima che il record entri nel database.
4. Inserisci una descrizione comune, eventuali tag e categorie personalizzate. Puoi selezionare un singolo elemento per correggerne il tipo o aggiungere una descrizione specifica.
5. Premi **Salva nella memoria**. La percentuale indica quanti elementi sono stati vettorizzati e registrati.

Per ogni elemento vengono conservati percorso, nome, tipo, MIME, dimensione, data, descrizione, tag, categorie e vettore semantico 384D. La cartella di appartenenza viene aggiunta automaticamente come categoria. I file originali non vengono copiati nel database.

## Cercare e utilizzare i risultati

In **Trova memoria** scrivi una frase come `cover rosa con strada di notte`. La ricerca ibrida combina similarità vettoriale, nome, descrizione, tag, categorie e percorso; i risultati sono ordinati per pertinenza e possono essere filtrati per tipo o categoria.

Il primo risultato apre automaticamente l'anteprima di immagini, video, audio, PDF e testo; puoi poi selezionarne un altro. Il pannello mostra sempre il percorso assoluto reale e offre **Copia percorso** e **Copia file in…**. La vista **Grafo relazioni** collega file, cartelle, categorie e affinità semantiche: trascina lo sfondo per spostarti, usa la rotella per lo zoom e passa sui nodi per vedere i dettagli.

Spunta più risultati e premi **Copia selezionati**, oppure copia l'intero insieme trovato. MLSM chiede la cartella di destinazione, non sovrascrive file esistenti e assegna un suffisso progressivo in caso di conflitto.

## Persistenza e privacy

Il catalogo vettoriale vive in IndexedDB nei dati locali del browser/WebView, fuori dalla cartella del progetto e quindi fuori dal repository Git. Nella build desktop, scansione, anteprima e copia passano attraverso comandi Rust che accettano soltanto percorsi assoluti esistenti e applicano limiti espliciti a profondità, quantità e dimensione delle anteprime. Durante lo sviluppo web locale le stesse operazioni passano attraverso il servizio filesystem integrato nel dev server: il selettore è quello del sistema operativo e nel database entra il percorso assoluto reale. MLSM non genera più riferimenti virtuali `browser://`, perché non sarebbero riutilizzabili dopo il riavvio.

I file originali scelti dall'utente non vengono copiati in MLSM Studio: Memory salva soltanto percorso, metadati, descrizioni, categorie e vettori. Anche l'eventuale directory locale di fallback `.mlsm-memory/` è esclusa esplicitamente da Git.

Se un file viene spostato o cancellato fuori dall'app, Memory non elimina silenziosamente la scheda: la ricerca continua a mostrarla e l'anteprima segnala il percorso non disponibile. La rimozione dalla memoria elimina soltanto il record, mai il file originale.
