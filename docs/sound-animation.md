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
| **Cassette Desk** | Brano completo e immagine 3:4 | Musicassetta su scrivania indie disordinata: apertura, inserimento nello stereo, chiusura sportello e pressione PLAY precedono realmente il brano. Mostra onda, BPM, tonalità e una tastiera guidata esclusivamente dallo stem vocale separato; palette automatica e colori indipendenti manuali. |

Il rilevamento usa `Xenova/detr-resnet-50` con cache lazy WebGPU→WASM. I risultati vengono persistiti: preview ed export offline non rieseguono l’AI.

DETR riconosce le classi del vocabolario COCO. La sensibilità è regolabile (soglia predefinita 0,15); **Detect again** avvia esplicitamente una nuova analisi. I duplicati vengono soppressi tenendo conto della classe, con un massimo di 256 rilevamenti salvati.

L’immagine caricata è la fonte di verità per il rapporto: preview ed export la mostrano in modalità `contain`, senza crop. Sono validi preset proporzionali arbitrari, anche se non appartengono all’elenco predefinito. Gli overlay diagnostici della preview mostrano riquadro, alias, etichetta del modello e confidence, ma non vengono inclusi nell’export. Non è richiesta la presenza di una persona: i cerchi manuali restano disponibili anche con zero detection.

La sorgente viene resa fedelmente, senza velo scuro o vignettatura automatica. Il pulsante **Show/Hide detected areas** controlla solo gli overlay dell’editor: nasconderli non modifica il canvas né l’export. La sidebar dei controlli si adatta alle larghezze ridotte della finestra.

### Cassette Desk: audio e riuso

L’intro è una timeline riutilizzabile e deterministica. Preview ed export usano gli stessi istanti per movimento e tre effetti meccanici; il brano completo inizia soltanto dopo il tasto PLAY. Nell’MP4 finale l’audio viene traslato e gli effetti di inserimento, sportello e pulsante sono sintetizzati localmente prima della traccia, senza dipendenze da campioni esterni. Lo stereo è selezionabile tra la versione classica scura e una seconda versione Hi-Fi chiara, verticale, con display nero, accenti della palette, vano centrale e pulsante PLAY circolare. La scocca Hi-Fi ha un controllo colore indipendente: può seguire automaticamente la palette estratta dalla cover oppure usare un colore manuale, conservando ombre e riflessi coerenti.

L’analisi musicale calcola il BPM dal beat tracking e la tonalità da un cromagramma armonico CQT del mix completo, invece di dedurla dalle bande generiche dello spettro. Le tonalità sono sempre indicate con notazione inglese (`A major`, `F minor`). Il pannello consente di attivare **Half Time**, impostare un BPM preciso e sostituire manualmente tonica e modo (per esempio A major); questi override sono persistiti e diventano l’autorità usata anche per verificare le note. Per la tastiera, sia l’app desktop sia il browser locale integrato eseguono **Demucs htdemucs** in modalità two-stem ed eseguono **pYIN** soltanto su `vocals.wav`. L’eventuale errore nei metadati BPM/Key non invalida più uno stem vocale correttamente separato. Non esiste fallback dal mix per le note: se Demucs/pYIN falliscono o pYIN considera un tratto non intonato, nessun tasto viene illuminato. La tastiera non stampa messaggi diagnostici, percentuali o testi sostitutivi sopra i tasti: comunica l’analisi esclusivamente tramite l’illuminazione delle note. La tastiera compatta rappresenta una sola ottava corretta (sette tasti bianchi e cinque neri): Do2, Do4 e Do6 illuminano quindi lo stesso Do. Ogni rilevazione viene confrontata con la tonalità risolta del brano; le note cromatiche ad alta confidenza vengono conservate, mentre quelle fuori scala e meno affidabili vengono corrette alla nota di scala più vicina soltanto quando lo scarto rientra nella tolleranza configurata. Al primo utilizzo MLSM Studio crea automaticamente un ambiente isolato, installa le dipendenze, scarica e verifica i pesi `htdemucs`, mostrando avanzamento e stato nell’anteprima; gli utilizzi successivi riusano la cache. La verifica del runtime forza il caricamento reale delle funzioni lazy di librosa/pYIN e ignora cartelle di report HTML `coverage/` che altrimenti possono mascherare il pacchetto Python omonimo usato da numba. Non sono richiesti terminale o comandi manuali. Il pannello permette di riprovare l’installazione senza reimportare il brano. La cover 3:4 viene mantenuta senza deformazioni sia nella custodia sia nell’etichetta più piccola della cassetta: a custodia chiusa la cover opaca nasconde completamente la cassetta verticale, poi il coperchio si apre attorno alla cerniera laterale e la cassetta ruota soltanto durante il trasferimento verso lo stereo. Titolo e artista sono mostrati nel display superiore dello stereo, insieme a uno spettro reale di 12 barre ricavato dalle 48 bande dell’analisi; il suo colore parte dalla palette e può essere reso manuale in modo indipendente. BPM e tonalità usano testo bianco o nero scelto automaticamente per garantire contrasto con il relativo colore di sfondo. Il renderer Canvas è esposto come servizio puro e può essere richiamato da altri flussi passando impostazioni, analisi, tempo assoluto e durata del brano.

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
