# Memory

![Memory](screenshots/07-memory.png)

Memory è un catalogo semantico locale per ritrovare file tramite descrizioni naturali. Salva metadati, categorie, embedding e percorso reale; non duplica né carica online gli originali.

## Costruisci memoria

1. Apri **Memory** e scegli **Costruisci memoria**.
2. Seleziona file o una cartella dal sistema operativo.
3. Prima del salvataggio seleziona un elemento per vederne l’anteprima.
4. Indica tipo, descrizione generale, descrizioni specifiche e categorie.
5. Crea categorie personalizzate quando quelle automatiche non bastano.
6. Salva: il database genera i vettori e conserva il percorso assoluto del PC.

Foto, video, audio, testo e PDF mostrano l’anteprima compatibile. Le cartelle generano una categoria di origine e mantengono la relazione con i file contenuti.

## Trova memoria

Scrivi una frase come “cover rosa con strada di notte”. I risultati vengono ordinati per pertinenza e filtrati per tipo o categoria. Selezionando un risultato ottieni anteprima, descrizione, percorso reale e azioni:

- **Copia percorso** negli appunti;
- **Copia questo** verso una cartella scelta;
- selezione multipla e **Copia selezionati**;
- **Copia tutti i risultati** senza sovrascrivere file omonimi.

## Grafo relazioni

La vista grafo collega file, cartelle e categorie. Zoom e trascinamento sono interattivi; hover o focus mostrano contenuto e percorso, clic apre l’anteprima.

## Persistenza e privacy

Il database vive nei dati applicativi locali di macOS o Windows ed è escluso dal repository. Gli originali restano nel percorso scelto; se vengono spostati, il record conserva il vecchio riferimento finché non viene aggiornato o rimosso.
