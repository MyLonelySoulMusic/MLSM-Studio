# Sound Animation

L’area raccoglie visualizer, storie e tipografia sincronizzati all’audio.

![Sound Animation](screenshots/03-sound-animation.png)

## Visualizer

| Modalità | Input | Risultato e controlli chiave |
| --- | --- | --- |
| **Instrumental Falling** | Audio, cover interna opzionale, sfondo foto/video | Biglia di vetro su strumenti, cadute e binari; materiali, luci, traiettoria, oggetti e finale modificabili. |
| **Cover Sphere Visualizer** | Audio, cover, sfondo | Cover realmente incorporata nella sfera, rotazione fluida, 48 bande, pioggia, fumo, foglie, particelle e palette. |
| **Stereo Unfold** | Audio e cover | Cover stropicciata che si apre; barre stereo laterali ed effetti full-screen davanti alla cover. |
| **Cube Animation** | Audio, cover e sfondo separato | Cubo in vetro che ruota sui tre assi, spettrogramma e increspature d’acqua audio-reattive. |
| **From 9:16 to 16:9** | Video verticale, immagine laterale, cover | Video intero al centro; lati specchiati, 48 bande stereo, cubo, pioggia, fulmini, piume e particelle come livelli riordinabili. |
| **Circular Spectrum Auto Detector** | Immagine, audio | Il detector DETR locale elenca tutte le classi COCO, salva riquadri normalizzati e palette nel progetto e consente alias e animazione per oggetto. La chiave persistita resta `animation.backgroundAuto` per compatibilità. Ogni cerchio può essere associato a un oggetto rilevato oppure definito manualmente con centro e diametro, anche senza detection. I toggle indipendenti controllano anello radiale, spettro centrale, stereo L/R, Pro Subtitles e particelle. Lo spettro centrale è una barra orizzontale fissa; i canali sinistro/destro reagiscono ai rispettivi dati stereo leggermente sotto di essa. I Pro Subtitles riusano cue e stile condivisi, entrano dal basso del cerchio, ruotano verso l’alto e svaniscono con la palette automatica. Preview ed export condividono il renderer canonico con clipping al cerchio. |

Il rilevamento usa `Xenova/detr-resnet-50` con cache lazy WebGPU→WASM. I risultati vengono persistiti: preview ed export offline non rieseguono l’AI.

DETR riconosce le classi del vocabolario COCO. La sensibilità è regolabile (soglia predefinita 0,15); **Detect again** avvia esplicitamente una nuova analisi. I duplicati vengono soppressi tenendo conto della classe, con un massimo di 256 rilevamenti salvati.

L’immagine caricata è la fonte di verità per il rapporto: preview ed export la mostrano in modalità `contain`, senza crop. Sono validi preset proporzionali arbitrari, anche se non appartengono all’elenco predefinito. Gli overlay diagnostici della preview mostrano riquadro, alias, etichetta del modello e confidence, ma non vengono inclusi nell’export. Non è richiesta la presenza di una persona: i cerchi manuali restano disponibili anche con zero detection.

La sorgente viene resa fedelmente, senza velo scuro o vignettatura automatica. Il pulsante **Show/Hide detected areas** controlla solo gli overlay dell’editor: nasconderli non modifica il canvas né l’export. La sidebar dei controlli si adatta alle larghezze ridotte della finestra.

## Storie e personaggi

| Modalità | Input | Risultato e controlli chiave |
| --- | --- | --- |
| **Teddy Walk** | Audio e cover | Orsacchiotto usurato che cammina; cover pulsante nello squarcio sul petto e ballo opzionale. |
| **Teddy Sing** | Audio o voce isolata e poster | Primo piano dell’orso afflosciato al muro, lip sync 3D, fonemi editabili e particelle atmosferiche. |

## Testo e sottotitoli

| Modalità | Input | Risultato e controlli chiave |
| --- | --- | --- |
| **Pro Subtitles** | Video, SRT oppure audio+Whisper, immagine palette | Kinetic typography per parola; posizione, font, dimensione, opacità, ombra e animazione globali o locali; export trasparente o video completo. |
| **Pixels Subtitles** | Audio, cover e sottotitoli | Cover protetta al centro; pixel ritmici ai lati e tipografia pixel leggibile con palette/ombra configurabili. |

## Sottotitoli condivisi

Le modalità abilitate usano gli stessi blocchi della timeline. Puoi importare SRT/WebVTT, generare con Whisper, revisionare con agenti locali, modificare testo e timing, aggiungere blocchi manuali, salvare preset e riesportare SRT.
