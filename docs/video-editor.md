# Video Editor

![Video Editor](screenshots/05-video-editor.png)

Il montaggio usa livelli equivalenti: non esiste una distinzione artificiale fra “principale” e “overlay”. La posizione verticale della traccia stabilisce soltanto l’ordine di compositing.

## Workspace professionale

La barra superiore organizza il lavoro nelle schede **Media**, **Audio**, **Text**, **Effects**, **Transitions**, **Adjust** e **AI Tools**. Il dock sinistro parte da 360 px ed è ridimensionabile tra 280 e 600 px; la larghezza preferita resta memorizzata. Nei layout compatti il dock diventa un drawer esplicito e l’Inspector si sovrappone alla preview, così nessuno dei due riduce permanentemente l'area di montaggio. Il ridimensionamento non rimonta la preview. Gli strumenti AI registrati possono elaborare il frammento selezionato e reinserire il risultato come nuovo clip/traccia. Upscaler, Static Watermark Remover e Pro Subs mantengono un artefatto auditabile; annullamento o errore non modificano il progetto.

## Media bin

La scheda **Media** è un bin essenziale in stile CapCut: importa video, immagini e audio con il pulsante di importazione oppure trascinali direttamente nell’area del bin. Sono supportati PNG, WebP e JPG; per PNG/WebP l’eventuale canale alpha originale viene mantenuto e mostrato su una scacchiera nella preview. Ogni media appare come una tessera con anteprima e metadati essenziali (formato, dimensioni e durata). Trascina una tessera nella timeline per creare il clip nel punto e nella traccia di rilascio; non è necessario passare da un pannello di inserimento o da una serie di azioni intermedie. La stessa operazione supporta il drop sulla traccia esistente o nello spazio vuoto per aggiungere un nuovo livello. Un’immagine crea un clip statico di 4 secondi, con `sourceIn` a 0; puoi poi allungarlo o accorciarlo trascinando i bordi nella timeline (fino a 3600 secondi per motivi di sicurezza).

Gli effetti non fanno parte del Media bin: sono disponibili esclusivamente nella scheda **Effects**, dove possono essere trascinati sulla clip o sulla corsia effetti.

## Timeline

La timeline è il punto centrale dell’editor. Il separatore superiore è trascinabile e consente di ridurla fino alla sua altezza minima, lasciando più spazio alla preview; quando la timeline viene ridotta la preview cresce senza rimontare il video né introdurre sfarfallii. L’altezza scelta resta memorizzata nel workspace.

- Trascina il corpo per spostare una clip, anche su un altro livello compatibile.
- Trascina i bordi per rifilare; l’in-point della sorgente segue il bordo iniziale.
- Per i clip immagine, trascina il bordo iniziale o finale per modificarne direttamente la durata, senza cambiare la sorgente.
- Premi `S` o usa **Taglia** per dividere al playhead.
- Attiva **Calamita** per agganciare clip, playhead e beat.
- Usa **Chiudi i vuoti** per ricompattare una traccia.
- Blocca una traccia per impedire trasformazioni, tagli e cancellazioni.
- Riordina i livelli: quello più in alto viene composto sopra gli altri.

Video sequenziali usano intervalli temporali `[inizio, fine)`: al taglio esatto non appaiono due frame contemporaneamente. Tutti i media visibili vengono presentati durante Play; seek, gap o rimozioni non devono lasciare un vecchio video bloccato nel monitor.

Il progetto conserva una base temporale razionale e i metadati di frame. L’allineamento esatto può essere richiesto dal menu contestuale, usando lo stesso numero di frame o l’identità di frame; la conversione evita accumuli da arrotondamento.

## Libreria effetti

La scheda **Effects** contiene la libreria divisa in categorie; ogni effetto mostra una preview parametrica. La libreria non viene duplicata nella scheda Media.

| Categoria | Effetti inclusi |
| --- | --- |
| **Transizioni** | Fade In, Fade Out, Push In, Pull Back, Slide Up, Slide Right |
| **Movimento** | Camera Shake |
| **Colore** | Film Flicker, Modern Noir |
| **Distorsione** | RGB Split, Digital Glitch |
| **Luce** | Dream Bloom, Light Leak, Cinematic Vignette |

Trascina un effetto nella corsia rosa o applicalo alla clip selezionata. Ogni istanza può essere spostata, rifilata, disattivata o eliminata; istanze sovrapposte occupano sottocorsie separate. L’Inspector espone durata, intensità, curva e i parametri specifici come frequenza, ampiezza, blur o diffusione.

## Inspector

Ogni clip visiva offre posizione, scala, rotazione, opacità, `cover/contain/fill`, 16 modalità di fusione e intensità della fusione. Per i clip immagine sono disponibili inoltre durata e posizione; non vengono mostrati controlli di velocità o pitch, perché un’immagine statica non ha una sorgente temporale o audio da rimappare. La correzione include esposizione, contrasto, luci, ombre, bianchi, neri, saturazione, vividezza, temperatura, tinta, tonalità, nitidezza e riduzione rumore.

Per immagini PNG/WebP (o qualunque immagine con alpha) l’Inspector offre **Ombra immagine**. L’opzione è disattivata per i progetti esistenti e, quando attivata, usa la silhouette del canale alpha come caster: puoi scegliere **Ombra morbida**, **Bagliore** o **Ombra lunga**, quindi regolare colore, intensità/opacità e diffusione. Ombra morbida e ombra lunga espongono anche distanza/lunghezza e direzione; il bagliore resta centrato e non mostra quei controlli. L’effetto segue trasformazione, opacità e fade della clip e rispetta l’ordine delle tracce; preview ed export usano la stessa geometria, così il risultato resta coerente anche quando l’ombra esce dai bordi dell’immagine.

Audio di clip e traccia hanno muto e volume indipendenti; il guadagno finale è il prodotto dei due.

I parametri di regolazione, trasformazione, opacità, volume, blend ed effetti possono essere automatizzati. Le curve disponibili sono lineare, esponenziale, logaritmica e Bézier personalizzata. La velocità supporta valore costante e rampe; la mappatura canonica half-open resta locale alla clip e viene condivisa da preview, export, audio e strumenti, inclusi i tagli frazionari. Il comportamento del pitch segue questa mappatura: il preserva-pitch DSP professionale non è disponibile per velocità diverse da 1× o per rampe (l’interfaccia lo disabilita quando necessario).

La preview usa un backing stabile per evitare sfarfallii durante seek, gap, sostituzioni e ridimensionamento dei pannelli. Il ridimensionamento modifica solo il layout disponibile: il video mantiene il proprio rapporto reale e non viene rimontato.

## Export

Il montaggio viene ricostruito offline. Ogni frame usa il timestamp esatto, gli effetti risolti dalla timeline e la composizione dei livelli; il canale alpha delle immagini viene preservato durante effetti e compositing come livello trasparente. L’audio viene mixato separatamente. **Frame interpolation (optional)** produce sempre prima il file alla frequenza base dell’edit (normalmente 30 fps), lo verifica e solo dopo, se attivata, aumenta i fotogrammi al target scelto. Il dialogo espone la fase corrente (render, verifica, upload/coda, interpolazione, verifica, download o consegna) e una barra reale per FFmpeg; RIFE è mostrato come indeterminato ma può essere annullato. Un errore, una verifica non valida o l’indisponibilità del servizio restituiscono il file base verificato e un avviso non bloccante; senza interpolazione il file conserva esattamente gli FPS renderizzati. I comandi tecnici sono raccolti in **Setup del servizio**. Il contenitore MP4 finale resta comunque una composizione opaca: la trasparenza è visibile nella preview e nel compositing, non come alpha esportato in MP4.
