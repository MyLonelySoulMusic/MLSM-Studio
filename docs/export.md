# Export offline

Tutte le esportazioni video usano una pipeline offline: la preview non viene registrata e la velocità della GPU durante la riproduzione non può causare frame persi.

## Pipeline comune

1. Congela una copia del progetto e delle impostazioni.
2. Calcola durata, risoluzione, rapporto e frame rate.
3. Decodifica i media al timestamp `frameIndex / fps`.
4. Renderizza e compone il frame completo.
5. Attende che l’encoder acquisisca il frame prima di avanzare.
6. Elabora o mixa l’audio senza riprodurlo.
7. Muxa audio e video.
8. Riapre il contenitore e verifica durata, tracce e frame attesi.
9. Consegna il file soltanto dopo il controllo.

L’export può richiedere più della durata del brano: è il comportamento previsto per mantenere qualità e continuità.

## Rapporti e risoluzioni

Ogni preset indica il rapporto, per esempio `1080 × 1920 (9:16)` o `3840 × 2160 (16:9)`. I preset rispettano l’orientamento del progetto; non scambiano larghezza e altezza su un video verticale.

Nel pannello Upscaler, quando **Mantieni proporzioni** è attivo, importazione ed esportazione usano il rapporto reale della sorgente e adattano i preset di conseguenza. Sono accettati anche rapporti proporzionali arbitrari, non solo quelli elencati. Per **Circular Spectrum Auto Detector**, l’immagine caricata resta la fonte di verità: preview ed export usano `contain` e non ritagliano l’immagine. Se una dimensione sorgente è dispari, il preset nativo applica esclusivamente l’arrotondamento al pixel pari richiesto dall’encoder (per esempio `941 × 1672` diventa `942 × 1672`) e la validazione accetta questa tolleranza senza ammettere rapporti realmente diversi.

## Modalità speciali

- **Scene 3D e visualizer:** ricostruzione della scena al tempo di render, stessa camera e stesso percorso della preview.
- **Circular Spectrum Auto Detector:** renderer Canvas2D canonico e deterministico condiviso con la preview; supporta cerchi associati a detection o posizionati manualmente, anche senza rilevamenti. Ricostruisce frame per frame anello radiale, spettro centrale, bande stereo L/R, Pro Subtitles clipped al cerchio e particelle secondo i toggle di ogni effetto, senza rieseguire il modello. Overlay diagnostici e il toggle **Show/Hide detected areas** restano esclusi dal file esportato.
- **From 9:16 to 16:9:** compositor a livelli con video centrale, immagini laterali, cubo, spettro ed effetti.
  L’audio AAC viene riutilizzato senza ricodifica quando possibile. Le tracce non AAC o con preroll negativo vengono convertite preservando canali e frequenza di campionamento; se il browser/WebView non offre AAC nativo viene caricato il worker software/WASM incluso nella build, senza backend o download da CDN. Il fallback è fornito da [`@mediabunny/aac-encoder`](https://mediabunny.dev/guide/extensions/aac-encoder), versione 1.51.0, MPL-2.0 ([sorgenti ufficiali](https://github.com/Vanilagy/mediabunny/tree/v1.51.0/packages/aac-encoder)). Le build desktop consentono WebAssembly tramite `wasm-unsafe-eval`, senza abilitare `unsafe-eval` JavaScript. La console indica `copy`, `native`, `software` oppure `silent`; l’audit finale resta obbligatorio e non consegna un file senza l’audio atteso.
- **Comments Invasion:** ricostruzione deterministica dei timbri alla cadenza scelta; permanenza e animazione d’uscita usano lo stesso clock della preview, mantiene al massimo il numero configurato di screenshot, usa una cache immagini limitata al gruppo visibile e preserva la traccia audio originale del video.
- **Pro Subtitles:** video completo oppure livello trasparente MOV ProRes 4444/WebM VP9 alpha quando il runtime lo supporta; sfondo pieno come fallback. Nel video completo risoluzione, rapporto e audio restano quelli della sorgente, mentre il frame rate è selezionabile (24, 25, 30, 50, 60 o 120 fps) e viene ricostruito offline. Un ultimo campione MP4 valido con durata dichiarata pari a zero viene mantenuto ricavandone la durata dalla cadenza reale. L'audit confronta poi i frame realmente composti con quelli riletti dal file finalizzato, senza contare un frame fantasma dovuto agli arrotondamenti della durata o a una coda audio AAC.
- **Static Watermark Remover:** decodifica e correzione frame per frame.
- **Upscaler video:** frame originali temporanei, elaborazione per frame/tile, ricostruzione audio/video. Nel percorso remoto la scelta tra ripresa dei checkpoint compatibili e ripartenza completa è esplicita per ogni job; il backend non riusa mai automaticamente la cache.
- **Frame Booster standalone:** la stessa pipeline di interpolazione è disponibile anche fuori dal Video Editor per video singoli. I tre metodi FFmpeg — Blend, Motion AOBMC e Motion OBMC bidirezionale — producono un job cancellabile con avanzamento; OBMC usa `minterpolate=fps=<target>:mi_mode=mci:mc_mode=obmc:me_mode=bidir`. Il risultato viene accettato soltanto dopo l’audit di FPS, durata, numero frame, DAR/rotazione, dimensioni e audio della sorgente. Non viene applicato alcun fallback silenzioso.
- **Video Editor:** livelli, blend, correzione, effetti e mix audio dalla timeline; le immagini PNG/WebP mantengono l’alpha durante la composizione dei livelli. Le ombre delle immagini usano la silhouette alpha e gli stili Ombra morbida, Bagliore o Ombra lunga con gli stessi parametri della preview (colore, opacità, diffusione e, quando applicabile, distanza/direzione). Trasformazioni, fade e ordine delle tracce vengono applicati prima della composizione dell’ombra; il file MP4 finale viene consegnato come composizione opaca.

Per il Video Editor l’export usa la stessa base temporale razionale e la stessa mappatura canonica half-open locale delle clip della preview, dell’audio e degli strumenti. Sono preservati i tagli frazionari e l’identità dei frame; automazioni e rampe di velocità vengono risolte offline con le curve salvate nel progetto. Il preserva-pitch DSP professionale non viene applicato a velocità diverse da 1× o a rampe: quando non è supportato il controllo viene disabilitato nell’interfaccia.

Se **Frame interpolation (optional)** è attivata, l’encoder crea e verifica prima il file alla frequenza base (per esempio 30 fps); l’aumento al target avviene soltanto dopo questa verifica. Il pannello mostra le fasi effettive **rendering → verifica del file base → upload → coda → interpolazione → verifica interpolata → download → consegna**. Durante il render e l’interpolazione FFmpeg la barra usa i frame elaborati, la percentuale e l’ETA (quando disponibili); upload e download mostrano invece i byte trasferiti. RIFE può non fornire una percentuale affidabile e viene quindi indicato come avanzamento indeterminato, ma resta annullabile.

L’interpolazione viene eseguita come job remoto cancellabile: annullando l’export il job viene terminato e i suoi temporanei vengono rimossi anche in caso di errore di rete o di download. Il file interpolato viene accettato solo se la verifica conferma durata, FPS target e numero di frame atteso; se il servizio non è disponibile, fallisce o la verifica non passa, viene consegnato il file base già verificato con un avviso non bloccante. Disattivando l’opzione, il file mantiene esattamente gli FPS renderizzati.

La modalità standalone Frame Booster usa lo stesso contratto con i soli metodi
FFmpeg Motion e Blend e conserva inoltre audio, rapporto di visualizzazione e
rotazione del video sorgente. Il
risultato scaricato dal backend rimane l'artifact canonico della sessione:
preview, **Salva video** ed Esporta lo riutilizzano senza lanciare un secondo
job. Una modifica alla sorgente o ai parametri invalida esplicitamente tale
artifact.

## Audio

### Upscaler remoto a segmenti

Per un video remoto MLSM non effettua più una richiesta Gradio per fotogramma.
Prima dell'upload controlla contemporaneamente tutti gli endpoint attivi. Se solo
alcuni non rispondono, mostra URL ed errore e chiede se continuare escludendoli
dal job corrente; gli endpoint restano configurati per i tentativi successivi.
Il job viene bloccato soltanto quando l'utente annulla oppure nessun endpoint è
utilizzabile. Il sorgente viene suddiviso in segmenti MP4 configurabili (100
frame per default, fino a 5000) con un solo passaggio FFmpeg in streaming, senza
la precedente estrazione PNG e ricodifica intermedia; tutti i frame e gli FPS originali vengono
mantenuti per default. Una conversione FPS viene effettuata e comunicata a
Gradio soltanto quando l'utente abilita esplicitamente **Modifica frame rate**;
ogni endpoint ne elabora uno alla volta, mentre gli endpoint lavorano in parallelo.
Gli endpoint Video Editor API v4/v5 inviano eventi SSE a ogni frame: MLSM mostra per
ciascun Colab segmento corrente, progresso, frame elaborati, velocità ed ETA senza
aprire ulteriori upload o serializzare i worker. Le vecchie sessioni Colab continuano
a funzionare con progresso indeterminato finché non vengono riavviate sul codice aggiornato.
La versione API v5 usa un encoder H.264 di trasporto a bassa latenza e con thread
CPU limitati, così la codifica del segmento non rallenta l'inferenza RealESRGAN.
Gli MP4 risultanti restano nella cache del job e permettono la ripresa dopo
un'interruzione. Solo dopo l'audit completo MLSM li ricostruisce nell'ordine
originale, applica le regolazioni comuni ed effettua il mux dell'audio sorgente.
Un annullamento rende immediatamente libero il coordinatore, sgancia le letture
Gradio ancora bloccate e impedisce alle risposte tardive di riattivare il job.
L'ammissione viene controllata prima della copia locale del sorgente.
Il coordinatore ammette un solo job video locale per volta e limita esplicitamente
i thread di estrazione/ricostruzione, evitando che due FFmpeg concorrenti saturino
la CPU. Il limite non serializza i Colab del job attivo e non elimina fotogrammi.

### Cassette Desk

La finestra di export permette di scegliere tra **Brano caricato + effetti meccanici** e **Solo effetti meccanici**. La seconda modalità non incorpora il brano, così il video può essere associato al suono ufficiale su TikTok o altri servizi, ma mantiene sempre nell’audio esportato lo scorrimento della cassetta, la chiusura dello sportello e la pressione del tasto PLAY. Entrambe le modalità vengono codificate e verificate come MP4 H.264/AAC.

L’export comprende l’intro oltre alla durata del brano. Il motore inserisce silenzio ed effetti meccanici all’inizio della traccia AAC, sposta il brano al tempo configurato e renderizza ogni frame con la stessa timeline della preview. Gli effetti usano lo stesso PCM della preview, ricavato dalla registrazione reale CC0 di azione della musicassetta e completato dal fallback deterministico soltanto quando necessario. Il controllo finale continua a richiedere frame video e pacchetti audio validi. Anche ambiente della finestra, meteo animato, materiali delle due scocche, tazza fumante, casse e pianoforte vengono renderizzati dal servizio Canvas canonico prima della codifica.

### Song Player

Song Player mantiene separati due ingressi espliciti: lo spezzone audio della
clip (`project.audio`) e la canzone completa, caricata come file oppure
scaricata da YouTube. Il matching cerca lo spezzone nella canzone completa.
La preview e l’export riproducono sempre lo spezzone; lo spettrogramma in basso
rappresenta invece l’intera canzone e mostra riquadro e playhead nella posizione
riconosciuta. Lo spettrogramma è pienamente opaco per impostazione predefinita;
la sua opacità resta regolabile. Barre animate e spettrogramma hanno due palette
indipendenti: entrambe seguono inizialmente la palette della cover, ma possono
essere sbloccate e modificate a tre colori separatamente. Cover flat/cube, sfondo
e rapporti 9:16, 16:9, 1:1 e 4:5 vengono renderizzati dallo stesso renderer
deterministico.

Il download YouTube richiede il runtime desktop Song Player, configurabile con
`npm run song-player:setup`, oltre a FFmpeg. Con due file locali, analisi FFT e
matching automatico funzionano anche nel browser tramite Web Audio; se il
worker desktop non è disponibile, l’app usa automaticamente questo percorso
senza generare dati audio sintetici.

L’audio non viene mandato alle cuffie durante l’export. Quando è possibile viene copiato o transcodificato in AAC/codec compatibile e muxato sul file finale; la durata viene verificata insieme al video.

## Temporanei e quota

I frame intermedi vengono scritti in una directory temporanea del progetto o del sistema, non in storage browser non controllato. Sono eliminati dopo download, refresh, riavvio o errore recuperabile. Questo evita l’errore “application storage quota”.

Per proteggere la memoria, l’export controlla la dimensione del frame prima di accodarlo all’encoder e interrompe in modo esplicito quando la risoluzione richiesta supera il budget disponibile; ridurre il preset di risoluzione consente di riprovare senza cambiare la scena.

## Errori

Un errore di codec, un frame mancante o una traccia non valida interrompe la consegna del file parziale. Ridurre risoluzione può abbreviare i tempi, ma non è necessario abbassare FPS per evitare drop: il clock offline resta deterministico.
