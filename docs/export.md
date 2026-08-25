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
- **Pro Subtitles:** video completo oppure livello trasparente MOV ProRes 4444/WebM VP9 alpha quando il runtime lo supporta; sfondo pieno come fallback.
- **Static Watermark Remover:** decodifica e correzione frame per frame.
- **Upscaler video:** frame originali temporanei, elaborazione per frame/tile, ricostruzione audio/video. Nel percorso remoto la scelta tra ripresa dei checkpoint compatibili e ripartenza completa è esplicita per ogni job; il backend non riusa mai automaticamente la cache.
- **Frame Booster standalone:** la stessa pipeline di interpolazione è disponibile anche fuori dal Video Editor per video singoli. Blend, Motion e RIFE producono un job cancellabile con avanzamento; il risultato viene accettato soltanto dopo l’audit di FPS, durata, numero frame, DAR/rotazione, dimensioni e audio della sorgente. Non viene applicato alcun fallback silenzioso.
- **Video Editor:** livelli, blend, correzione, effetti e mix audio dalla timeline; le immagini PNG/WebP mantengono l’alpha durante la composizione dei livelli. Le ombre delle immagini usano la silhouette alpha e gli stili Ombra morbida, Bagliore o Ombra lunga con gli stessi parametri della preview (colore, opacità, diffusione e, quando applicabile, distanza/direzione). Trasformazioni, fade e ordine delle tracce vengono applicati prima della composizione dell’ombra; il file MP4 finale viene consegnato come composizione opaca.

Per il Video Editor l’export usa la stessa base temporale razionale e la stessa mappatura canonica half-open locale delle clip della preview, dell’audio e degli strumenti. Sono preservati i tagli frazionari e l’identità dei frame; automazioni e rampe di velocità vengono risolte offline con le curve salvate nel progetto. Il preserva-pitch DSP professionale non viene applicato a velocità diverse da 1× o a rampe: quando non è supportato il controllo viene disabilitato nell’interfaccia.

Se **Frame interpolation (optional)** è attivata, l’encoder crea e verifica prima il file alla frequenza base (per esempio 30 fps); l’aumento al target avviene soltanto dopo questa verifica. Il pannello mostra le fasi effettive **rendering → verifica del file base → upload → coda → interpolazione → verifica interpolata → download → consegna**. Durante il render e l’interpolazione FFmpeg la barra usa i frame elaborati, la percentuale e l’ETA (quando disponibili); upload e download mostrano invece i byte trasferiti. RIFE può non fornire una percentuale affidabile e viene quindi indicato come avanzamento indeterminato, ma resta annullabile.

L’interpolazione viene eseguita come job remoto cancellabile: annullando l’export il job viene terminato e i suoi temporanei vengono rimossi anche in caso di errore di rete o di download. Il file interpolato viene accettato solo se la verifica conferma durata, FPS target e numero di frame atteso; se il servizio non è disponibile, fallisce o la verifica non passa, viene consegnato il file base già verificato con un avviso non bloccante. Disattivando l’opzione, il file mantiene esattamente gli FPS renderizzati.

La modalità standalone Frame Booster usa lo stesso contratto e conserva inoltre
audio, rapporto di visualizzazione e rotazione del video sorgente. Per RIFE la
barra può essere indeterminata durante l’inferenza, perché il runtime non espone
un conteggio affidabile dei frame; l’annullamento resta comunque effettivo.

## Audio

### Cassette Desk

La finestra di export permette di scegliere tra **Brano caricato + effetti meccanici** e **Solo effetti meccanici**. La seconda modalità non incorpora il brano, così il video può essere associato al suono ufficiale su TikTok o altri servizi, ma mantiene sempre nell’audio esportato lo scorrimento della cassetta, la chiusura dello sportello e la pressione del tasto PLAY. Entrambe le modalità vengono codificate e verificate come MP4 H.264/AAC.

L’export comprende l’intro oltre alla durata del brano. Il motore inserisce silenzio ed effetti meccanici all’inizio della traccia AAC, sposta il brano al tempo configurato e renderizza ogni frame con la stessa timeline della preview. Il controllo finale continua a richiedere frame video e pacchetti audio validi.

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
