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

I file binari non vengono incorporati automaticamente. Nel desktop si conservano percorsi reali quando consentito; nel browser i Blob URL valgono soltanto per la sessione e devono essere ricollegati dopo un riavvio.

## Invarianti

- Gli ID sono unici.
- Durate e tempi sono finiti e non negativi.
- Le clip restano entro la sorgente, salvo immagini statiche.
- Le impostazioni di una modalità non cancellano quelle delle altre.
- Cover e sfondo restano asset distinti.
- `animation.backgroundAuto` conserva `sourceWidth` e `sourceHeight` dell’immagine caricata, che determinano il rapporto usato da preview ed export. L’immagine viene contenuta senza crop; i preset possono avere qualsiasi rapporto proporzionale.
- `animation.backgroundAuto.detections` contiene lo snapshot normalizzato dei riquadri rilevati, con etichetta del modello, `score`, `isPerson` e `alias` modificabile dall’utente; l’export non dipende dalla disponibilità del modello locale.
- `animation.backgroundAuto.effects` contiene fino a 16 istanze `Circular Spectrum`: ciascuna può riferirsi a una detection, scegliere palette `auto` o `manual`, e salvare intensità, scala, opacità (0–100% nell’editor, predefinita 90%) e collision particles.
- Ogni effetto salva anche la velocità di rotazione in rev/s (0–1, predefinita 0,08; 0 significa fermo) e tre colori di palette, indipendenti per oggetto e modificabili in modalità automatica o manuale; il compositing usa `source-over`.
- Ogni effetto salva inoltre i toggle per spettro centrale orizzontale, animazione stereo laterale sinistra/destra e Pro Subtitles circolari. I sottotitoli riusano le cue e le impostazioni Pro Subtitles del progetto; il testo entra dal basso del cerchio, ruota verso l’alto e svanisce con i colori della palette.
- `animation.backgroundAuto.personAnimationEnabled` abilita la validazione dedicata alla presenza di una persona; l’assenza di una detection `isPerson` produce un avviso in UI senza invalidare il progetto né bloccare automaticamente l’export. Un effetto viene applicato solo quando l’utente lo seleziona esplicitamente con **Animate**.
- Gli overlay diagnostici della preview non fanno parte dei dati renderizzati nell’export.
- Il toggle **Show/Hide detected areas** è solo una preferenza dell’editor e non viene esportato né altera il canvas; la sorgente resta priva di velo scuro o vignettatura automatica.
- Le tracce bloccate non sono modificabili.

## Migrazioni

Ogni nuova versione aggiunge un migratore dal formato precedente e preserva i dati non più visibili nella UI quando possono ancora servire a progetti storici. Un progetto non valido viene rifiutato con un errore leggibile, non corretto silenziosamente.
