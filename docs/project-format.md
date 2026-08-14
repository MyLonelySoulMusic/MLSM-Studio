# Formato progetto

Il progetto `.rbs.json` è versionato e validato da `@rbs/project-schema`.

## Contenuto

- identità e versione;
- formato, risoluzione e FPS;
- riferimenti e metadati audio;
- risultato dell’analisi necessario alla rigenerazione;
- modalità e impostazioni specifiche;
- oggetti/scena, sfera, sfondo e luce;
- beat, eventi, fonemi e sottotitoli;
- timeline Video Editor e riferimenti media.
- base temporale razionale, metadati di frame e mappatura half-open locale delle clip, condivisa da preview, export, audio e strumenti;
- automazioni per regolazioni, trasformazione, opacità, volume, blend ed effetti, con curve lineari, esponenziali, logaritmiche o Bézier personalizzate;
- velocità costante o a rampa e impostazioni dei tool AI, con artefatti reinseriti come nuovi clip/tracce quando l’operazione termina.

I file binari non vengono incorporati automaticamente. Nel desktop si conservano percorsi reali quando consentito; nel browser i Blob URL valgono soltanto per la sessione e devono essere ricollegati dopo un riavvio.

## Invarianti

- Gli ID sono unici.
- Durate e tempi sono finiti e non negativi.
- Le clip restano entro la sorgente, salvo immagini statiche.
- Le impostazioni di una modalità non cancellano quelle delle altre.
- Cover e sfondo restano asset distinti.
- `animation.backgroundAuto` conserva `sourceWidth` e `sourceHeight` dell’immagine caricata, che determinano il rapporto usato da preview ed export. L’immagine viene contenuta senza crop; i preset possono avere qualsiasi rapporto proporzionale.
- `animation.backgroundAuto.detections` contiene lo snapshot normalizzato dei riquadri rilevati per tutte le classi COCO, con etichetta del modello, `score` e alias modificabile dall’utente; l’export non dipende dalla disponibilità del modello locale.
- `animation.backgroundAuto.effects` contiene fino a 16 istanze `Circular Spectrum Auto Detector`: ciascuna può riferirsi a una detection o salvare centro/diametro manuali, scegliere palette `auto` o `manual`, e salvare intensità, scala, opacità (0–100% nell’editor, predefinita 90%) e collision particles.
- Ogni effetto salva anche la velocità di rotazione in rev/s (0–1, predefinita 0,08; 0 significa fermo) e tre colori di palette, indipendenti per oggetto e modificabili in modalità automatica o manuale; il compositing usa `source-over`.
- Ogni effetto salva inoltre i toggle per spettro centrale orizzontale, animazione stereo laterale sinistra/destra e Pro Subtitles circolari. I sottotitoli riusano le cue e le impostazioni Pro Subtitles del progetto; il testo entra dal basso del cerchio, ruota verso l’alto e svanisce con i colori della palette.
- Ogni effetto salva toggle indipendenti per anello radiale, spettro centrale, stereo L/R, Pro Subtitles e particelle; non esiste un requisito di detection persona per validare o esportare il progetto.
- Gli overlay diagnostici della preview non fanno parte dei dati renderizzati nell’export.
- Il toggle **Show/Hide detected areas** è solo una preferenza dell’editor e non viene esportato né altera il canvas; la sorgente resta priva di velo scuro o vignettatura automatica.
- Le tracce bloccate non sono modificabili.
- I tagli e gli intervalli temporali sono half-open; i frammenti frazionari mantengono la mappatura locale della sorgente senza sovrapporre il frame di confine.
- Un’operazione AI annullata o fallita non muta la timeline; un risultato completato viene aggiunto come nuovo artefatto verificabile.

## Migrazioni

Ogni nuova versione aggiunge un migratore dal formato precedente e preserva i dati non più visibili nella UI quando possono ancora servire a progetti storici. Un progetto non valido viene rifiutato con un errore leggibile, non corretto silenziosamente.
