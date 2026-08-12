# Video Editor

![Video Editor](screenshots/05-video-editor.png)

Il montaggio usa livelli equivalenti: non esiste una distinzione artificiale fra “principale” e “overlay”. La posizione verticale della traccia stabilisce soltanto l’ordine di compositing.

## Pool media

Importa video, immagini e audio. Ogni elemento mostra formato, dimensioni, durata e analisi ritmica disponibile. Seleziona il livello di destinazione, quindi inserisci al playhead, in coda o trascina direttamente in timeline.

## Timeline

- Trascina il corpo per spostare una clip, anche su un altro livello compatibile.
- Trascina i bordi per rifilare; l’in-point della sorgente segue il bordo iniziale.
- Premi `S` o usa **Taglia** per dividere al playhead.
- Attiva **Calamita** per agganciare clip, playhead e beat.
- Usa **Chiudi i vuoti** per ricompattare una traccia.
- Blocca una traccia per impedire trasformazioni, tagli e cancellazioni.
- Riordina i livelli: quello più in alto viene composto sopra gli altri.

Video sequenziali usano intervalli temporali `[inizio, fine)`: al taglio esatto non appaiono due frame contemporaneamente. Tutti i media visibili vengono presentati durante Play; seek, gap o rimozioni non devono lasciare un vecchio video bloccato nel monitor.

## Libreria effetti

La libreria è divisa in categorie e ogni effetto mostra una preview parametrica.

| Categoria | Effetti inclusi |
| --- | --- |
| **Transizioni** | Fade In, Fade Out, Push In, Pull Back, Slide Up, Slide Right |
| **Movimento** | Camera Shake |
| **Colore** | Film Flicker, Modern Noir |
| **Distorsione** | RGB Split, Digital Glitch |
| **Luce** | Dream Bloom, Light Leak, Cinematic Vignette |

Trascina un effetto nella corsia rosa o applicalo alla clip selezionata. Ogni istanza può essere spostata, rifilata, disattivata o eliminata; istanze sovrapposte occupano sottocorsie separate. L’Inspector espone durata, intensità, curva e i parametri specifici come frequenza, ampiezza, blur o diffusione.

## Inspector

Ogni clip visiva offre posizione, scala, rotazione, opacità, `cover/contain/fill`, 16 modalità di fusione e intensità della fusione. La correzione include esposizione, contrasto, luci, ombre, bianchi, neri, saturazione, vividezza, temperatura, tinta, tonalità, nitidezza e riduzione rumore.

Audio di clip e traccia hanno muto e volume indipendenti; il guadagno finale è il prodotto dei due.

## Export

Il montaggio viene ricostruito offline. Ogni frame usa il timestamp esatto, gli effetti risolti dalla timeline e la composizione dei livelli; l’audio viene mixato separatamente. L’interpolazione opzionale può usare `ffmpeg minterpolate` o RIFE locale dopo la verifica anti-drop del render nativo.
