# Manuale utente

## Accesso e Home

L’introduzione resta aperta finché non premi **Entra in MLSM Studio**. I pulsanti sociali aprono i canali ufficiali dell’artista; lingua e tema sono disponibili prima dell’ingresso.

![Schermata di benvenuto](screenshots/01-welcome.png)

La Home mostra soltanto le aree di lavoro. Ogni card indica quante modalità contiene; il pulsante **Home** dell’editor riporta qui senza cambiare area in modo implicito.

![Home con le aree](screenshots/02-home-areas.png)

## Layout dell’editor

![Editor Sound Animation](screenshots/03-sound-animation.png)

- **Barra superiore:** progetto nuovo/apri/salva, import, analisi, generazione, lingua, tema, Memory, supporto ed export.
- **Pannello sinistro:** modalità e soli controlli pertinenti al tool attivo.
- **Viewport centrale:** preview nel rapporto reale 9:16 o 16:9; il pulsante **Tutto schermo** conserva i controlli di trasporto.
- **Inspector destro:** formato, proprietà globali e parametri dell’elemento selezionato.
- **Timeline:** audio, beat, eventi, fonemi, sottotitoli, livelli o clip in base alla modalità.

I separatori laterali e la maniglia superiore della timeline sono trascinabili. Quando la timeline cresce, la preview si ridimensiona e resta interamente visibile.

## Import e analisi

1. Importa audio, video o immagini dal controllo indicato dalla modalità.
2. Premi **Analizza** quando il tool usa beat, energia, spettro, stereo, fonemi o Whisper.
3. Controlla l’avanzamento nelle finestre di processo: l’interfaccia non deve lasciare operazioni lunghe senza stato.
4. I risultati ripetibili vengono memorizzati localmente e riusati quando file e impostazioni non cambiano.

## Preview e trasporto

- `Spazio`: Play/Pausa, salvo mentre scrivi in un campo.
- `S`: taglia la clip selezionata nel Video Editor.
- `←` / `→`: un frame; con `Shift`, un secondo.
- `Delete` o `Backspace`: elimina la selezione modificabile.
- `Shift`, `Cmd` o `Ctrl`: selezione multipla.

La preview può usare un profilo più leggero dell’export, ma timing, ordine dei livelli e contenuti devono restare equivalenti.

## Timeline

Gli elementi sono blocchi indipendenti. Puoi spostarli, rifilarli dai bordi, selezionarne più di uno e cancellarli insieme. Le tracce bloccate rifiutano modifiche; quelle nascoste o mute non partecipano alla relativa composizione.

## Palette e media

Le modalità che accettano cover o sfondi estraggono fino a tre colori. La palette automatica è sempre modificabile. Cover e sfondo sono sorgenti distinte: caricare uno sfondo non sostituisce mai l’immagine incorporata in sfera, cubo o personaggio.

## Esportazione

L’export è offline. Non riproduce l’audio in cuffia, non cattura la viewport e non dipende dalla fluidità della preview. Alla fine verifica contenitore, durata, traccia audio e numero di frame. Consulta [Export](export.md) per codec e limiti.
