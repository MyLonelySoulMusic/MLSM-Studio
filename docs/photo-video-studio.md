# Photo & Video Studio

![Photo & Video Studio](screenshots/04-photo-video-studio.png)

## Static Watermark Remover

Rimuove un watermark fermo da un video di cui possiedi o sei autorizzato a modificare il contenuto.

1. Carica il video con watermark.
2. Scegli come riferimento una fotografia pulita oppure il video originale pulito della stessa sequenza.
3. Disegna la regione nella preview.
4. Apri **Anteprima zona rimozione** per vedere anche i pixel confinanti, non soltanto il rettangolo sostituito.
5. Regola correzione e fusione; i valori iniziali sono conservativi.
6. Esporta: tutti i frame vengono decodificati, corretti e ricodificati offline.

Con un **video pulito**, MLSM cerca automaticamente l’offset temporale confrontando fotogrammi esterni alla zona del watermark. Durante preview ed export esegue inoltre un riallineamento spaziale per frame, smussando gli spostamenti per evitare tremolii. È possibile disattivare la sincronizzazione automatica, regolare l’offset al millisecondo e definire intervallo di ricerca, spostamento massimo e stabilizzazione.

Se il video con watermark è più lungo del riferimento pulito, i due video vengono ancorati alla partenza a velocità originale: il secondo 10 della sorgente usa il secondo 10 del riferimento, anche con FPS diversi. La durata del riferimento non viene dilatata. Quando manca un fotogramma pulito, la parte corrispondente del video resta originale (watermark incluso); il pannello segnala questo limite. L’offset manuale resta modificabile anche con un riferimento più corto.

Se i frame rate reali sono differenti, prima dell’export una finestra chiede quale cadenza mantenere: quella del video con watermark oppure quella del video pulito. Il video non scelto viene ricampionato sulla timeline scelta. Differenze puramente nominali come 29,97/30 fps vengono considerate compatibili.

Se troppi fotogrammi richiedono un ripiego di allineamento, l’elaborazione viene sospesa e mostra un avviso professionale. L’utente può interrompere oppure continuare dallo stesso punto e ottenere comunque il risultato per valutarlo. L’audio resta quello del video con watermark.

**Sfumatura bordo** parte da `0%`: un valore maggiore interviene esclusivamente sulla stretta fascia esterna della zona trattata. **Intensità correzione** parte circa dal `5%` e armonizza luminosità/colore con il video senza sfocare i pixel puliti inseriti.

## Upscaler

Accetta fotografie e video. Per i video mostra avanzamento per frame e tile. I job
locali eliminano i frame temporanei allo scadere della finestra di consegna; i job remoti conservano i
checkpoint per poter riprendere un’elaborazione interrotta.

### Motori

| Modello | Ideale per | Limite principale |
| --- | --- | --- |
| **Canvas Enhanced** | Anteprima rapida e macchine senza backend AI | Non ricostruisce dettagli neurali. |
| **RealESRGAN x2plus** | Foto/video reali con ingrandimento moderato | Meno dettaglio del modello x4. |
| **RealESRGAN x4plus** | Scene reali, texture e dettagli generali | Più lento e più esigente. |
| **RealESRNet x4plus** | Restauro fedele e intervento meno aggressivo | Richiede servizio PyTorch locale. |
| **RealESRGAN x4plus anime 6B** | Anime, illustrazioni e cartoon | Non indicato per pelle/fotografia reale. |

Il dispositivo viene scelto automaticamente: CUDA su GPU NVIDIA, Metal/MPS su Apple Silicon, WebGPU nelle build browser e infine CPU/WASM. L’utente può forzare un motore diverso; i modelli che richiedono il servizio PyTorch locale restano disponibili solo quando quel servizio è raggiungibile.

Il selettore **Locale | Gradio / Colab** rende i due percorsi mutuamente
esclusivi: in locale non compaiono né vengono contattati endpoint remoti; in
remoto i motori locali restano nascosti e non vengono usati come fallback.
**Canvas Enhanced** elabora l'intero video in un solo flusso FFmpeg, mantiene
audio e FPS e non crea directory o sequenze PNG per fotogramma. Il client
accetta per i video soltanto il contratto backend API 7 con
`canvasVideoStreaming`, impedendo che un vecchio servizio rimasto in ascolto
riattivi per errore il percorso frame-per-frame.

### Upscaling remoto · Gradio / Colab

Attiva **Upscaling remoto** e aggiungi uno o più URL pubblici, per esempio
`https://abc123.gradio.live`. Puoi incollare tutti gli URL in un unico blocco:
righe, spazi, virgole e punti e virgola vengono riconosciuti automaticamente e
i duplicati sono eliminati. MLSM interroga ogni endpoint tramite
`/gradio_api/api/upscale_models`, mostra lo stato di ciascun Colab e rende
selezionabili i modelli esposti da almeno un endpoint che risponde; il preflight
del job usa poi soltanto i Colab compatibili con il modello scelto. Anche queste chiamate di discovery partono in parallelo, senza
attendere la risposta del Colab precedente. Sono supportati anche endpoint HTTPS compatibili con le stesse API;
gli URL privati/locali sono bloccati salvo l’esplicita modalità di sviluppo.
Se il coordinatore locale non è ancora disponibile, catalogo e upscaling delle
foto passano direttamente dalle API HTTPS di Gradio: l'interfaccia lo segnala
esplicitamente invece di mostrare il generico errore `Failed to fetch`. Per i
video il coordinatore locale resta necessario perché gestisce estrazione,
checkpoint su disco, segmentazione, ricostruzione e mux dell'audio.
Nell'app desktop il coordinatore viene avviato automaticamente al primo controllo:
se non risponde, MLSM lancia il runtime Upscaler gestito dall'app e attende fino a
10 secondi il caricamento di Torch/OpenCV prima di iniziare l'upload. Non è più
necessario tenere aperto un terminale separato; richieste simultanee condividono
la stessa inizializzazione e non generano processi duplicati.

Per una foto, MLSM prova gli endpoint attivi in failover. Per un video controlla
prima, in parallelo, quali endpoint siano raggiungibili, espongano il modello
scelto e supportino l'API a segmenti. Se il controllo è solo parzialmente positivo,
prima dell'upload mostra gli endpoint falliti e chiede se escluderli dal solo job
corrente; la configurazione salvata non viene modificata. Con almeno un endpoint
approvato prosegue, mentre con zero endpoint validi non avvia il job. Poi FFmpeg
decodifica il sorgente una sola volta e scrive direttamente MP4 con il numero
configurato di fotogrammi (100 per default, fino a 5000), senza creare prima
migliaia di PNG intermedi; quindi avvia un worker
per endpoint: ogni Colab elabora un segmento,
mentre tutti gli endpoint lavorano realmente in contemporanea. La finestra di
progresso mostra frame, segmenti completati, segmento assegnato a ogni endpoint e
richieste simultanee. Con endpoint API v4/v5, ogni card riceve durante lo stesso stream
Gradio anche lo stato del segmento (`ricezione`, `caricamento modello`, `upscaling`,
`finalizzazione`), una barra indipendente, frame corrente/totale, secondi per frame
ed ETA. Un vecchio endpoint resta utilizzabile, ma la sua barra rimane indeterminata
e indica esplicitamente che deve essere aggiornato e riavviato per esporre la
telemetria frame. Il risultato di ogni chiamata
`/gradio_api/call/upscale_video_chunk` viene validato e scritto con rename atomico
in `.upscaler-cache/remote-video-jobs/<job>/upscaled-segments`. Un endpoint che
cade non annulla il lavoro degli altri; il segmento viene riassegnato entro il
limite di tentativi impostato.

Il catalogo mostra l'unione dei modelli disponibili: dopo la scelta, il preflight
esclude anche gli endpoint che non possiedono quel modello. L'attivazione remota
non degrada mai silenziosamente al profilo locale se il catalogo fallisce. Prima
di copiare il sorgente il client verifica inoltre che la coda sia libera. Annullare
un job remoto libera subito la coda e sgancia le richieste Gradio pendenti, mentre
i segmenti già completati restano disponibili per una ripresa esplicita.

La preparazione locale non può più avviare due estrazioni video pesanti nello
stesso momento: un secondo job viene rifiutato prima del caricamento finché il
primo non termina o viene annullato. FFmpeg, OpenCV e Torch condividono inoltre
un budget CPU conservativo (un quarto dei processori logici, massimo 4), così
l'estrazione continua a conservare tutti i frame senza saturare la macchina. Per
diagnostica il limite è pubblicato da `/health`; un'installazione dedicata può
sovrascriverlo con `MLSM_UPSCALER_CPU_THREADS`, fra 1 e 16. Questo limite riguarda
solo il lavoro locale: gli endpoint Colab attivi restano paralleli.

Se tutti gli endpoint diventano indisponibili, sorgente, frame originali e segmenti
già completati restano sul disco. Prima di un job remoto MLSM filtra i checkpoint
per dimensione del file, modello, segmentazione e FPS, quindi confronta SHA-256
solo quando esiste un candidato plausibile. La scelta tra **Riprendere la cache
compatibile**, **Ripartire da zero** o annullare appare quindi soltanto per lo
stesso video; un video nuovo parte automaticamente con policy `restart`. Nessun
client può riusare checkpoint in modo silenzioso. Scegliendo la ripresa, MLSM usa
i frame salvati soltanto quando SHA-256 dei byte e modello coincidono. La ripresa
continua dai soli segmenti mancanti anche
dopo il riavvio del servizio. Se tutti i segmenti o frame sono già presenti, la
ricostruzione continua anche quando gli URL temporanei Colab sono scaduti. I checkpoint AI sono identificati dai byte del video e dal modello:
cambiare risoluzione finale, qualità o regolazioni non rimanda a Colab i frame
già completati, ma ripete soltanto rendering e mux locali. Se esiste già un MP4
verificato con la stessa configurazione, **Esporta** lo riaggancia immediatamente
senza avviare alcuna elaborazione. Al termine verifica che non manchi alcun frame, applica a ogni risultato remoto lo stesso preset di
esposizione, contrasto, colore, nitidezza e denoise scelto nell’interfaccia,
ricompone esattamente la sequenza al frame rate originale e alla durata della
sorgente, poi rimuxa l’audio originale con FFmpeg. Per default non esiste alcun
limite o adattamento a 25 FPS: ogni frame decodificato viene conservato. Il
controllo **Modifica frame rate** abilita una conversione esplicita e invia il
valore scelto agli endpoint; lasciandolo disattivato il parametro FPS non viene
inviato. Dimensione dei segmenti e FPS fanno parte dell'identità dei checkpoint,
quindi una configurazione incompatibile non riusa segmenti precedenti. Conteggio frame, durata,
geometria, decodificabilità e presenza audio vengono verificati prima di
dichiarare il job pronto. L’MP4 verificato
diventa immediatamente la sorgente della preview centrale senza sostituire o
perdere l’originale; **Esporta / salva MP4** lo scrive nel percorso scelto senza
rieseguire l’upscaling. La destinazione viene creata o sovrascritta soltanto
dopo il completamento di questi controlli, quindi un job fallito non lascia un
falso MP4 vuoto. Nell’app desktop il backend copia atomicamente il file
locale già ricostruito, evitando di trasferire centinaia di MB tramite IPC.
Il pannello remoto include **Svuota tutta la cache video**, con conferma: elimina
sorgenti, frame e risultati persistenti soltanto quando non esistono job attivi;
la directory radice resta intatta e i percorsi esterni non vengono mai toccati.
Le immagini inviate a Colab lasciano il computer: usa esclusivamente
endpoint di cui conosci il gestore.

### Flusso

1. Carica il media e seleziona modello/dispositivo.
2. Scegli **Prova** per un campione oppure **Genera upscaling** per l’intero file.
3. Segui download del modello e avanzamento frame/tile.
4. Confronta prima/dopo con separatore, zoom e pan.
5. Miscela l’originale ridimensionato con il risultato.
6. Regola esposizione, contrasto, bianchi, neri, saturazione, nitidezza e risoluzione finale.
7. Esporta dallo stesso pannello.

#### Batch foto

La sezione **Batch foto** mantiene una coda runtime separata dal progetto. Puoi
aggiungere più immagini, selezionare quelle da elaborare e scegliere una volta
la cartella di destinazione; modello, tile/TTA e tutte le regolazioni vengono
congelati all'avvio del job. Le immagini vengono processate in sequenza, con
target proporzionale per ogni sorgente quando **Mantieni proporzioni** è attivo
e con larghezza/altezza condivise quando è disattivato. Un errore su una foto
non interrompe le altre; puoi annullare la coda o riprovare soltanto le fallite.
Video e sorgente singola restano nel flusso Upscaler normale.

Caricare una nuova sorgente interrompe e sgancia immediatamente qualsiasi
export della sorgente precedente. Progressi, errori e risultati tardivi del
vecchio job non possono essere mostrati né adottati dal nuovo video.

Ogni foto resta visibile come miniatura nella galleria: fai clic sulla tessera
per caricarla nella preview principale (che, quando disponibile, mostra il
risultato AI accurato di quella foto) e usa la casella separata per decidere se
elaborarla. Le miniature applicano in tempo reale le regolazioni condivise,
anche con **Canvas Enhanced**, senza avviare un’inferenza AI; la selezione della
miniatura è distinta dalla selezione di processing, resta solo runtime e non
modifica il progetto. La coda e le selezioni vengono azzerate quando crei un
progetto con **New** o ne apri uno con **Open**.

La preview video confronta i due risultati reali con le etichette **Originale** e
**Output**; non è una simulazione geometrica. Per i video il backend legge con
`ffprobe` il rapporto di visualizzazione (DAR), la rotazione e il pixel aspect
ratio (SAR), così l’orientamento e le proporzioni visibili restano coerenti anche
quando i metadati non coincidono con le dimensioni codificate.

I preset Full HD, QHD, 4K e 8K rispettano l’orientamento: un sorgente verticale resta verticale quando **Mantieni proporzioni** è attivo.

All’import, **Mantieni proporzioni** usa il rapporto reale della sorgente; i preset si adattano quindi a quel rapporto senza forzare 16:9 o 9:16. La stessa regola vale in esportazione. Disattivando il blocco puoi impostare liberamente larghezza e altezza personalizzate, anche con un rapporto diverso da quello originale.

L’output viene rasterizzato con pixel quadrati (`SAR 1:1`), mantenendo il DAR
corretto senza introdurre stretching nei player che ignorano i metadati SAR.

## Frame Booster standalone

**Frame Booster** è disponibile anche come modalità separata in Photo & Video
Studio (oltre che nell’export del Video Editor). Accetta esclusivamente video,
mantiene rapporto, orientamento/rotazione, durata e audio della sorgente e
consegna il risultato solo dopo un audit di FPS, durata, frame, DAR, dimensioni
e audio. Il file originale viene sempre preservato.

Puoi scegliere tre metodi FFmpeg e impostare un moltiplicatore oppure un FPS
target. **Motion AOBMC** ricostruisce il movimento ed è indicato per persone,
oggetti, sport, camera in movimento e slow motion; può introdurre artefatti con
tagli, flash, particelle o occlusioni molto rapide. **Motion OBMC bidirezionale**
usa il profilo `minterpolate=fps=<target>:mi_mode=mci:mc_mode=obmc:me_mode=bidir`:
gli FPS del filtro seguono il target scelto (per esempio 60), mentre OBMC compensa
i blocchi sovrapposti analizzando il moto in entrambe le direzioni. È adatto a
movimenti continui e panoramiche, ma resta oneroso sui video ad altissima
risoluzione. **Frame blend** fonde i frame
vicini, è più veloce ed è indicato per riprese quasi statiche o panoramiche lente,
ma sui movimenti rapidi può produrre scie e immagini doppie. La stessa guida è
mostrata direttamente sotto il selettore del metodo. Il job mostra l’avanzamento e può essere
annullato; un errore non viene convertito in un fallback silenzioso. Al termine
la preview passa al file verificato e **Salva video** (come il pulsante Esporta
della toolbar) scrive quello stesso risultato senza ripetere l'interpolazione.
Se cambiano video, metodo o target, il risultato precedente
viene invalidato e l'eventuale job della vecchia sorgente viene annullato. I
File e i blob della sessione vengono rilasciati con Nuovo/Apri progetto.
Il controllo runtime di Frame Booster verifica soltanto FFmpeg: errori o modelli
RIFE del Video Editor non possono bloccarne l'avvio. In sviluppo, se il servizio
locale termina inaspettatamente, viene riavviato automaticamente. La coda di
look-ahead di `minterpolate` viene completata prima dell'elaborazione, così
preview e file salvato mantengono l'intera durata del video e dell'audio.
