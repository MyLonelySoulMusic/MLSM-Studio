# Export video web

## Pipeline scene 3D

L'export registra direttamente lo stesso canvas WebGL usato dalla preview. A ogni aggiornamento vengono applicati il tempo della traiettoria, la rotazione della biglia, la camera e la visibilità degli elementi; il canvas 3D viene poi composto con foto o video di sfondo, effetti e finale cinematografico.

```text
tempo export → stato React/Three.js → canvas WebGL preview ┐
                sfondo ed effetti → canvas composito       ├→ MediaRecorder → MP4/WebM finale
                     audio HTML → MediaStream audio ────────┘
```

Non esiste un secondo renderer semplificato. Geometrie, PBR, usura, neon, fisica, rotazione e camera sono quindi condivisi tra preview e file finale.

## Pixels Subtitles: export offline deterministico

**Pixels Subtitles** non usa `MediaRecorder`, `captureStream()`, il playhead della preview o `requestAnimationFrame`. Un canvas di export indipendente viene creato direttamente alla risoluzione scelta e la funzione di rendering della modalità riceve un tempo calcolato esclusivamente da indice e FPS.

```text
frameIndex / FPS ─→ cover + campo pixel + sottotitoli ─→ CanvasSource H.264 ┐
file audio originale ─→ demux + conversione AAC offline ───────────────────┴→ MP4
```

Ogni chiamata all’encoder viene attesa prima di produrre il frame successivo (`latencyMode: quality`). Se il computer è più lento del tempo reale, aumenta soltanto la durata dell’elaborazione: risoluzione, FPS e numero dei frame rimangono quelli selezionati. L’ultimo frame riceve una durata ridotta quando la durata del brano non è un multiplo esatto del frame interval, evitando code nere.

Al termine il contenitore viene riaperto e vengono verificate entrambe le tracce. Il numero dei pacchetti video deve coincidere con `ceil(durata × FPS)` e la traccia audio deve contenere pacchetti; in caso contrario l’operazione viene segnalata come fallita. L’audio viene letto dal file importato e non viene mai inviato al player o alle cuffie durante questa esportazione.

## From 9:16 to 16:9: compositing offline

La modalità verticale/orizzontale usa la stessa funzione di compositing in preview ed export, ma l’export non legge il canvas visibile e non dipende dal playhead. `CanvasSink` decodifica il fotogramma del video centrale corrispondente al centro temporale di ogni intervallo; immagini laterali, cubo, spettro ed effetti vengono poi ridisegnati alla risoluzione finale.

La pila visibile nella timeline è anche l’ordine effettivo del compositore: dal basso verso l’alto contiene immagini laterali, cubo, video, spettro e ogni effetto attivo. Gli effetti possono attraversare i livelli fissi e sovrapporsi; opacità e colore provengono dal pannello laterale. Le correzioni dell’immagine specchiata vengono applicate frame per frame prima della composizione.

```text
video 9:16 ─→ decode ai timestamp frameIndex/FPS ─┐
immagine laterale + cover + analisi audio ────────┼→ compositore 16:9 → H.264
audio del video ─→ conversione AAC offline ───────┴──────────────────→ MP4 verificato
```

La pipeline supporta 24, 25, 30, 50, 60 e 120 fps e aspetta la backpressure del `CanvasSource` a ogni frame. Dopo il mux, il contenitore viene riaperto e deve contenere esattamente `ceil(durata × FPS)` pacchetti video; se la sorgente possiede audio viene verificata anche la relativa traccia. Un errore o una differenza di conteggio elimina il parziale. I preset 16:9 sono Full HD, QHD/2K, 4K, 5K e 8K; 4K è la scelta raccomandata per una sorgente verticale 1080 × 1920.

## Layer ProSubtitles

**ProSubtitles** usa una pipeline distinta dall’export delle scene complete e offre due output. Il layer contiene soltanto la tipografia animata e non include audio: in CapCut deve essere allineato a `t=0` sopra il video originale. In alternativa, **Video originale + sottotitoli incorporati** produce direttamente un MP4 completo.

```text
video guida ───────────────→ preview e clock ─────────────────────────┐
SRT/VTT + stili per parola → renderer RGBA frame per frame ┬→ WebM VP9 alpha
                                                           ├→ riempimento colore → MP4 H.264
                                                           └→ compositing sui frame sorgente ─→ MP4 completo
```

L’export completo non usa `MediaRecorder`, playback in tempo reale o seek approssimativi. Il demuxer legge la traccia sorgente e il decoder consegna ogni frame in ordine di presentazione con il proprio timestamp e la propria durata. Il compositore disegna quel frame una sola volta, applica i sottotitoli al tempo centrale del frame e alimenta direttamente l’encoder. Non viene impostato un frame rate di destinazione: un sorgente VFR resta VFR e non vengono inventati, scartati o duplicati frame. Prima di salvare, un controllo confronta il numero di frame sorgente con quello dei frame composti; anche una sola differenza annulla il file parziale.

Risoluzione, rapporto e durata provengono dal video caricato, senza crop o resize. La traccia audio non passa dal decoder: i pacchetti compressi presentabili vengono copiati direttamente con i timestamp originali; gli eventuali pacchetti AAC negativi marcati come priming/discard non fanno parte dell’audio riprodotto. Dopo il mux vengono verificati sia il numero dei pacchetti audio sia i byte di payload. L’audio non viene riprodotto nelle cuffie durante l’export. Poiché inserire testo nei pixel richiede necessariamente la ricodifica della traccia video, il file non può essere identico byte per byte all’originale; il profilo `Massima` usa un bitrate almeno pari al profilo di qualità dell’app e maggiorato rispetto al bitrate sorgente per ridurre al minimo la perdita generazionale.

Il progetto può lavorare in `9:16` o `16:9`. L’importatore accetta SRT e WebVTT, conserva il testo multilinea e ordina i blocchi in base ai timestamp. Nella timeline ogni blocco può essere spostato, ridimensionato, diviso o eliminato; testo, inizio e fine restano modificabili anche numericamente. La regia automatica sceglie fra diciassette renderer di movimento in base a durata, velocità di lettura, punteggiatura, righe ed enfasi. Tre modalità full-frame distribuiscono glifi o parole nell’intera area sicura e applicano clamp geometrici prima del disegno. Lo stile risolto comprende animazione, font, dimensione, posizione percentuale X/Y, opacità, palette a tre colori e override per singola parola. Font, dimensione, posizione e opacità possono essere ereditati dal progetto oppure sostituiti per una singola cue. Ogni slot della palette ha un proprio flag e colore dell’ombra; una parola con colore personalizzato usa invece l’ombra della frase. Il renderer applica wrapping e auto-fit nel title-safe prima di produrre ogni frame e compone eventuali cue sovrapposte in regioni distinte.

La scelta dell’output non viene simulata con un codec diverso:

| Impostazione | Output web | Trasparenza | Comportamento |
| --- | --- | --- | --- |
| Trasparente + WebM VP9 | `.webm` VP9 | Sì | Disponibile soltanto se il probe dell’encoder conferma il supporto alpha. |
| Sfondo di un colore | `.mp4` H.264/AVC | No | Compone il colore scelto sotto la tipografia. |
| Sfondo di un colore, fallback esplicito | `.webm` VP9 opaco | No | Usato soltanto con consenso dell’utente quando H.264 non è disponibile. |
| Trasparente + MOV ProRes 4444 | Nessun file nella versione web | — | Richiede una build desktop/native con FFmpeg o VideoToolbox. |
| Video originale + sottotitoli | `.mp4` H.264 con audio originale | No | Conserva risoluzione e timing di ogni frame sorgente; verifica anti-drop prima del salvataggio. |

Se VP9 alpha non è disponibile, l’export trasparente si interrompe con un messaggio esplicito: non viene creato silenziosamente un WebM opaco. Analogamente, il selettore MOV ProRes 4444 descrive il formato professionale previsto ma ne impedisce l’avvio sul web. Una futura pipeline desktop/native potrà implementarlo; la versione corrente non dichiara questo supporto.

Il supporto di WebM VP9 con alpha dipende anche dalla versione e dalla piattaforma di CapCut. È consigliabile esportare prima pochi secondi, verificare trasparenza, bordi e sincronizzazione nel progetto di montaggio e usare MP4 con un colore pieno concordato quando il destinatario non gestisce l’alpha.

## Static Watermark Remover

La modalità di **Photo & Video Studio** usa il video stesso come timeline sorgente. Ogni frame decodificato viene disegnato su un canvas alla risoluzione nativa; sopra viene composta la regione selezionata della fotografia pulita, dopo adattamento, scala, offset e correzione di luminanza. La sfumatura predefinita è `0 px` e l’intensità iniziale della correzione di luminanza è `5%`. Quando la sfumatura viene aumentata, il canvas della patch si espande da 1 a 24 px oltre la selezione e applica l’alpha soltanto in questo anello esterno; tutta la regione selezionata resta opaca e completamente sostituita. La preview zoom dedicata ritaglia il risultato già composto includendo la regione corretta al centro e un ampio margine del video circostante, prima di disegnare la guida; mostra quindi la stessa correzione dell’export senza bordo di selezione.

```text
video originale ─→ demux + frame VFR ─→ patch fotografia pulita ─→ H.264 ┐
audio originale ─→ copia pacchetti compressi ─────────────────────────────┴→ MP4 verificato
```

Non viene imposto un FPS di destinazione: ordine, timestamp e durata di ciascun frame provengono dal sorgente. Il compositore conta i frame ricevuti e, dopo la finalizzazione, riapre l’MP4 e conta i pacchetti video codificati. Una differenza annulla il file parziale. Se il video contiene audio, i pacchetti compressi vengono copiati senza passare da `AudioEncoder` e il loro conteggio viene verificato dopo il mux. Il player viene messo in pausa prima dell’elaborazione, quindi l’audio non viene inviato alle cuffie. Per H.264 viene usata la selezione WebCodecs `no-preference`, che consente al browser di scegliere il backend hardware o software più stabile.

## File temporanei e destinazione

Quando la File System Access API è disponibile, il selettore di destinazione viene aperto nello stesso gesto del pulsante Export e i chunk vengono scritti progressivamente nel file scelto. Se il browser non espone quel flusso, l’export usa un temporaneo privato OPFS in `dynamic-sound-animation-studio-temp`, lo scarica soltanto dopo la finalizzazione e rimuove esclusivamente il file creato dalla sessione corrente. Annullamenti ed errori abortiscono il parziale; se un’operazione WebCodecs non è interrompibile, il cleanup viene differito finché termina, evitando corse con l’encoder.

Se né File System Access né OPFS sono disponibili, resta un ultimo fallback in memoria con preflight e limite rigido di 512 MiB. Gli export stimati oltre tale soglia vengono fermati prima di occupare la RAM e suggeriscono di ridurre durata, risoluzione, frame rate o qualità. Non viene mai esposta una cartella di frame PNG.

## Codec e qualità

La selezione segue le capacità dichiarate da `MediaRecorder`: MP4 H.264/AAC ha precedenza, seguito da WebM VP9/Opus e WebM VP8/Opus. Sono disponibili i profili `Alta` e `Massima`, con `Massima` predefinito. Il bitrate cresce con risoluzione e frame rate usando rispettivamente 0,14 e 0,24 bit per pixel/frame; i limiti sono 8–100 Mbit/s e 12–160 Mbit/s. L'audio è richiesto a 320 kbit/s e il canvas composito abilita image smoothing di qualità alta.

Il bitrate richiesto è un obiettivo: l'encoder hardware del browser può applicare un limite proprio. Per minimizzare artefatti su vetro, neon, graffi e movimenti veloci è consigliato `Massima`; `Alta` è destinato a bozze o condivisioni più leggere.

La registrazione avviene in tempo reale. Preset 4K o 120 fps richiedono una GPU e un encoder browser sufficientemente veloci. I formati professionali non esposti da MediaRecorder, come ProRes, restano candidati per un eventuale adapter desktop FFmpeg da valutare alla fine dello sviluppo web.

## Audio e durata

L'audio parte da zero insieme al recorder ed è collegato tramite `captureStream()` o, come fallback, un nodo Web Audio. Se il finale mantiene l'immagine dopo la musica, il video continua per la durata configurata mentre la traccia audio è terminata.

## Progress e cancellazione

La UI mostra frame logico corrente, totale e avanzamento. Cancel ferma l'animazione e il recorder, chiude o annulla lo stream temporaneo, elimina il file parziale, ripristina dimensioni e tempo della preview e riporta il player alla posizione precedente.

## Verifica

I test coprono scelta del codec, fallback e limiti del bitrate. Typecheck, lint e build verificano l'integrazione fra renderer condiviso, schema progetto e File System Access API. La parità visuale completa deve essere verificata in browser con una breve esportazione di confronto, perché jsdom non implementa WebGL né MediaRecorder.
