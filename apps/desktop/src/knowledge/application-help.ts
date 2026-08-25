export interface ApplicationHelpArticle {
  id: string;
  title: string;
  modeIds: readonly string[];
  keywords: readonly string[];
  content: string;
}

export const applicationHelpKnowledgeBase: readonly ApplicationHelpArticle[] = [{
  id: "assistant-introduction",
  title: "Presentazione di Studio Bot",
  modeIds: [],
  keywords: ["ciao", "salve", "buongiorno", "presentati", "chi sei", "cosa fai", "cosa puoi fare", "aiuto", "help", "funzioni"],
  content: "Studio Bot è la guida locale di MLSM Studio (My Lonely Soul Music Studio). Può spiegare come iniziare un progetto, usare la modalità attiva e i suoi controlli, importare e analizzare audio, lavorare con timeline e sottotitoli, configurare scene e palette, risolvere problemi documentati ed esportare il risultato. Per ricevere una risposta precisa, indica cosa vuoi ottenere, la modalità che stai usando oppure il punto in cui sei bloccato. Studio Bot fornisce istruzioni ma non modifica direttamente il progetto."
}, {
  id: "quick-start",
  title: "Primo progetto: flusso consigliato",
  modeIds: [],
  keywords: ["inizio", "iniziare", "primo", "progetto", "workflow", "audio", "brano", "generare"],
  content: "1. Scegli la modalità dal menu Modalità animazione in alto nel pannello sinistro. 2. Importa il brano dalla barra superiore; in Pro Subtitles importa invece il video dal pannello sinistro. 3. Premi Analizza audio e attendi BPM, beat, energia e strumenti quando la modalità lo richiede. 4. Carica cover, poster o immagini richieste dalla modalità e regola la palette. 5. In Instrumental Falling premi Genera scena; le modalità narrative e i visualizer si aggiornano direttamente. 6. Controlla la preview con Play/Pausa o con la barra spaziatrice. 7. Modifica timeline e pannelli. 8. Salva il progetto, poi usa Esporta per creare il video finale."
}, {
  id: "interface",
  title: "Come è organizzata l’interfaccia",
  modeIds: [],
  keywords: ["interfaccia", "pannello", "sinistra", "destra", "timeline", "toolbar", "dove", "controlli", "larghezza", "ridimensiona", "tutto schermo", "fullscreen", "palette"],
  content: "La barra superiore gestisce progetto, audio, analisi, generazione ed export. Il pannello sinistro contiene la modalità e soltanto i controlli pertinenti a quella modalità. Il pannello destro modifica progetto, formato, sfondo e l’elemento selezionato. Trascina i separatori rosa fra pannelli e viewport per allargare o stringere i due menu; doppio clic ripristina la misura iniziale e la scelta viene salvata localmente. Nella barra centrale premi Tutto schermo per vedere soltanto l’animazione, poi Torna all’editor o Esc per uscire. La timeline in basso controlla playhead, beat, eventi, fonemi e sottotitoli. In 9:16 e 16:9 la cornice della preview cambia realmente. La barra spaziatrice alterna Play e Pausa, tranne quando si sta scrivendo in un campo. Giorno usa bianco, nero e rosa; Notte inverte bianco e nero mantenendo il rosa. Anche il pulsante AI segue questa palette."
}, {
  id: "intelligent-memory",
  title: "Memory: catalogo semantico locale dei file",
  modeIds: [],
  keywords: ["memory", "memoria", "catalogo", "catalogare", "ritrovare", "ricerca semantica", "vector database", "grafo", "relazioni", "anteprima", "copia file", "cartella"],
  content: "Il pulsante Memory nella barra superiore è disponibile dalla Home e da ogni area di lavoro. In Costruisci memoria seleziona uno o più file oppure una cartella: le cartelle vengono lette ricorsivamente, puoi aggiungere una descrizione comune, tag, categorie personalizzate e una descrizione specifica per ogni elemento. La cartella di appartenenza diventa automaticamente una categoria. MLSM salva nel database vettoriale locale percorso, metadati, descrizioni, categorie e un vettore semantico; i file originali non vengono caricati online né duplicati. In Trova memoria puoi cercare con una frase naturale, filtrare per tipo o categoria e ricevere risultati ordinati per pertinenza. Seleziona un risultato per vedere immagine, video, audio, PDF o testo; passa alla vista Grafo relazioni per esplorare categorie, cartelle e affinità, usando trascinamento e zoom. Seleziona uno o più risultati e premi Copia selezionati per scegliere una cartella di destinazione: i file esistenti non vengono sovrascritti. Se un file viene spostato o eliminato fuori da MLSM, il record resta ricercabile ma l’anteprima segnala che il percorso non è più disponibile.",
}, {
  id: "studio-assistant",
  title: "Assistente Studio e memoria locale",
  modeIds: [],
  keywords: ["assistente", "chat", "chatbot", "studio bot", "caricamento", "risponde", "memoria", "azzera", "smollm", "knowledge base"],
  content: "Apri Guida in basso a destra: l’apertura prepara subito Qwen2.5 0.5B e lo stato sotto Assistente Studio indica cache, backend WebGPU/WASM e disponibilità. Saluti, ringraziamenti e presentazione ricevono subito una risposta conversazionale locale e non vengono sottoposti al validatore tecnico. Per le domande sull’app, se Qwen è ancora in preparazione, supera il tempo limite, non è disponibile oppure produce una risposta non aderente ai fatti, Studio Bot usa la knowledge base senza restare bloccato; sotto ogni risposta viene mostrato il motivo preciso, non una generica etichetta fallback. La ricerca non seleziona la guida della modalità attiva se la domanda non contiene un argomento pertinente. Studio Bot può guidare avvio progetto, modalità attiva, audio, timeline, sottotitoli, problemi ed esportazione. Dopo ogni scambio il programma conserva sul dispositivo un riepilogo compatto delle richieste e delle indicazioni recenti, così comprende domande collegate senza accumulare tutta la cronologia. Il contatore Memoria indica i turni conservati. Premi Azzera memoria per cancellare riepilogo e messaggi visibili. Nessuna domanda viene inviata online."
}, {
  id: "audio-analysis",
  title: "Importazione e analisi del brano",
  modeIds: [],
  keywords: ["audio", "brano", "importa", "analizza", "bpm", "beat", "strumenti", "energia", "cache"],
  content: "Importa un file audio dalla barra superiore e premi Analizza audio. L’analisi locale calcola BPM, beat, energia e caratteristiche spettrali; Instrumental Falling usa anche gli indizi di grancassa, rullante, piatti, pianoforte, chitarra e archi. I risultati vengono memorizzati in cache per il file. Se cambi brano, esegui nuovamente l’analisi prima di generare la scena. Per Teddy Sing è consigliata una traccia vocale isolata perché migliora sensibilmente fonemi e labiale."
}, {
  id: "instrumental-falling",
  title: "Modalità Instrumental Falling",
  modeIds: ["instrumentalFalling"],
  keywords: ["instrumental", "falling", "biglia", "strumenti", "rimbalzo", "binari", "tamburo", "piano", "chitarra", "archi"],
  content: "Nel pannello sinistro scegli le famiglie di strumenti ammesse, importa e analizza il brano, quindi premi Genera scena. La biglia alterna rimbalzi, scorrimenti e cadute; i binari compaiono soltanto negli scorrimenti e mai nelle discese verticali. Seleziona un marker della timeline o un oggetto nella viewport per cambiare in tempo reale il tipo di strumento senza rigenerare e senza perdere i colori. Nel pannello destro puoi modificare sfera, materiali, colori per tipo o per singolo elemento, binari, sfondo e luce."
}, {
  id: "new-york-streets-legacy",
  title: "Modalità legacy New York Streets",
  modeIds: ["newYorkStreets"],
  keywords: ["new york", "streets", "legacy", "biglie", "gara", "tombino", "fogne", "volantini"],
  content: "New York Streets non compare più nel selettore per creare nuovi progetti, ma resta supportata quando si apre un progetto precedente. La camera segue la biglia principale, mentre le secondarie hanno corsie e ritmo indipendenti. Il percorso passa dalla strada al tombino e poi alla fognatura inferiore. Numero e colori delle biglie e immagini dei volantini restano modificabili dal pannello sinistro."
}, {
  id: "cover-sphere",
  title: "Modalità Cover Sphere Visualizer",
  modeIds: ["coverSphere"],
  keywords: ["cover", "sphere", "sfera", "visualizer", "48", "bande", "spettrogramma", "pioggia", "fumo", "foglie"],
  content: "Carica la cover dal pannello sinistro: viene incorporata nella sfera di vetro e genera la palette automatica. Le 48 bande reagiscono all’analisi del brano con movimento smussato. Puoi regolare colore, intensità e rotazione, oppure disattivare la palette automatica per scegliere manualmente. Gli effetti disponibili davanti allo sfondo includono fumo, particelle, vento e foglie, pioggia e volantini. Foto e video di sfondo si caricano dal pannello Scena a destra."
}, {
  id: "stereo-unfold",
  title: "Modalità Stereo Unfold",
  modeIds: ["stereoUnfold"],
  keywords: ["stereo", "unfold", "cover", "stropicciata", "spettro", "sinistra", "destra", "effetti"],
  content: "Carica la cover nel pannello sinistro e regola durata dell’apertura e pieghe residue. La cover entra come carta stropicciata e si dispiega conservando rilievi e ombre. Il campo audio usa informazioni separate dei canali sinistro e destro. Puoi scegliere Nastri luminosi, Prismi di frequenza o Aurora stereofonica, regolare profondità e intensità e attivare effetti in primo piano o a tutto schermo. La palette può seguire automaticamente la cover oppure essere impostata manualmente."
}, {
  id: "walking-cube",
  title: "Modalità Cube Animation",
  modeIds: ["walkingCube"],
  keywords: ["cube", "animation", "cubo", "vetro", "facce", "rotazione", "loop", "palette", "spettro", "sfondo", "fresnel"],
  content: "Carica l’immagine principale nel pannello sinistro: viene adattata senza tagli a tutte le sei facce del cubo. La cover mantiene luminosità e saturazione originali perché è separata dal materiale del vetro. Puoi anche caricare una fotografia di sfondo, adattata in modalità cover, e regolarne l’oscuramento. Il cubo rimane sospeso al centro, senza piano d’appoggio, spostamenti, split o rimbalzi, e compie rotazioni morbide su assi combinati X/Y/Z seguendo i beat analizzati. Il vetro usa trasmissione PBR, riflessi ambientali, bordo Fresnel e tre luci dedicate senza coprire la cover. In basso, 48 bande spettrali con indicatori di picco seguono realmente il brano. Increspature d’acqua concentriche si propagano sui beat con intensità regolabile; alone, anelli orbitali, particelle profonde e light sweep sono attivabili singolarmente. La palette automatica ricava dalla cover corrente i colori di ogni elemento audiovisivo. Orientamento ed effetti tornano allo stato iniziale sul frame finale per produrre un loop chiuso."
}, {
  id: "portrait-landscape",
  title: "Modalità From 9:16 to 16:9",
  modeIds: ["portraitLandscape"],
  keywords: ["9:16", "16:9", "verticale", "orizzontale", "specchiata", "cubo", "bande", "pioggia", "fulmini", "piume", "livelli", "120 fps"],
  content: "Carica dal pannello sinistro il video verticale, un’immagine 9:16 per i lati e la cover destinata al cubo. Il video resta intero al centro; scegli se l’immagine originale sta a sinistra o a destra e l’altro lato viene specchiato. Il pulsante Modifica immagine specchiata apre un editor a schermo ampio per luminosità, esposizione, contrasto, saturazione, temperatura e sfocatura. Analizza l’audio del video dalla barra superiore per pilotare 48 bande stereo, urti sui margini e rotazione lenta del cubo. Pioggia, fulmini, piume e particelle si attivano e si personalizzano nel pannello sinistro; la loro profondità si cambia nella pila di tracce della timeline usando i comandi sopra/sotto. Tutti gli effetti attivi vengono composti nello stesso frame secondo quell’ordine, sia in preview sia nell’export. L’export usa una pipeline offline frame-per-frame, non registra la preview, verifica il numero di frame e conserva l’audio senza riprodurlo. Per una sorgente 1080 × 1920 è consigliato 4K 3840 × 2160; sono disponibili Full HD, QHD/2K, 5K e 8K fino a 120 fps."
}, {
  id: "teddy-walk",
  title: "Modalità Teddy Walk",
  modeIds: ["teddyWalk"],
  keywords: ["teddy", "walk", "orso", "orsacchiotto", "cammina", "balla", "cover", "petto", "mocap", "mixamo"],
  content: "Carica la cover per inserirla nello squarcio sul petto e ricavare la palette. L’orso cammina lentamente di mezzo profilo su asfalto PBR; la strada scorre in direzione coerente col passo. Il flag Balla mentre cammina attiva una coreografia ritmica con braccia, giro e salto, usando clip Mixamo locali adattate alle proporzioni del peluche. Puoi regolare velocità, pulsazione della cover, colori di pelo, toppe e strada."
}, {
  id: "teddy-sing",
  title: "Modalità Teddy Sing",
  modeIds: ["teddySing"],
  keywords: ["teddy", "sing", "orso", "canta", "lipsync", "labiale", "fonemi", "poster", "voce", "particelle"],
  content: "Carica la cover come poster e, preferibilmente, importa una traccia vocale isolata. Dopo Analizza audio il labiale 3D usa fonemi e formanti per controllare mandibola, labbra, denti e lingua. La corsia Fonemi appare nella timeline: seleziona un blocco per dividerlo o eliminarlo; fuori dai fonemi la bocca torna chiusa. Nel pannello sinistro puoi regolare sensibilità, intensità del labiale, palette della stanza, LED e particelle atmosferiche."
}, {
  id: "static-watermark-remover",
  title: "Modalità Static Watermark Remover",
  modeIds: ["staticWatermark"],
  keywords: ["watermark", "filigrana", "logo", "rimuovi", "rimozione", "foto pulita", "reference", "selezione", "patch"],
  content: "Apri Photo & Video Studio e scegli Static Watermark Remover. Carica il video con il watermark e poi la fotografia originale pulita della stessa inquadratura. Trascina sulla preview per racchiudere soltanto il watermark; la cornice rosa è una guida e non entra nel file. Se fotografia e video non coincidono perfettamente, regola adattamento, scala e spostamento X/Y. Sfumatura esterna parte da 0 px: valori da 1 a 24 fondono soltanto la piccola fascia di video fuori dalla selezione, senza rendere trasparente la zona corretta. Uniforma luminosità parte da un’intensità prudente del 5%. Premi Anteprima zona rimozione per vedere la regione corretta al centro insieme a un’ampia porzione del video circostante, ingrandita e senza bordo; i controlli replicati sotto restano live. Usa questa funzione soltanto su contenuti tuoi o per i quali hai autorizzazione. L’export mantiene risoluzione, ordine, timestamp e durata dei frame sorgente, processa l’audio senza riprodurlo e rifiuta il file se il controllo finale rileva frame mancanti."
}, {
  id: "upscaler",
  title: "Modalità Upscaler",
  modeIds: ["upscaler"],
  keywords: ["upscaler", "real esrgan", "risoluzione", "4k", "8k", "cuda", "metal", "webgpu", "foto", "video", "nitidezza"],
  content: "Apri Photo & Video Studio e scegli Upscaler. Carica una foto o un video, quindi seleziona il modello: x4plus per scene reali e massimo dettaglio, x2plus per un aumento naturale 2×, RealESRNet per un risultato conservativo, Anime 6B per illustrazioni, General x4v3 per velocità e poca memoria oppure AnimeVideo v3 per animazione 2D. I checkpoint PyTorch funzionano anche nella web app mediante il servizio locale: esegui una sola volta npm run upscaler:setup e, quando serve, npm run upscaler:server in un terminale separato. Automatico usa prima MPS/Metal su Apple Silicon, CUDA su NVIDIA, poi WebGPU o CPU; puoi forzare il motore e regolare tile e TTA. Imposta liberamente la risoluzione finale o usa Full HD, QHD, 4K e 8K. Prima/dopo, vista singola e fusione confrontano sempre originale e migliorato alla stessa dimensione. Sono disponibili esposizione, contrasto, luci, ombre, bianchi, neri, saturazione, vividezza, temperatura, tinta, nitidezza e denoise. Le immagini escono in PNG; i video vengono elaborati offline conservando timestamp, VFR e audio e vengono consegnati soltanto dopo il controllo anti-frame-drop."
}, {
  id: "video-editor",
  title: "Area Video Editor · montaggio professionale",
  modeIds: ["videoEditor"],
  keywords: ["montaggio", "video editor", "capcut", "clip", "pool", "calamita", "magnete", "taglia", "inverti", "inversa", "contrario", "reverse", "sincronizza", "sincronizzazione", "fusione", "blend", "dissolvenza", "fade", "interpolazione", "ffmpeg", "battute"],
  content: "Scegli l’area Video Editor per un montaggio multitraccia con clock indipendente dal brano dello studio. Nel Pool media carica video, immagini e audio: le miniature rendono riconoscibili i contenuti. Per ogni media scegli il livello di destinazione, poi inseriscilo al playhead, aggiungilo in coda oppure trascinalo direttamente sul livello e sul tempo desiderati. Tutti i livelli video sono equivalenti: non esistono ruoli principale o overlay; quello più in alto viene composto sopra quelli inferiori e può essere riordinato liberamente. Nell’Inspector puoi spostare una clip fra livelli e regolare posizione, scala, rotazione, opacità, fusione e colore su qualsiasi livello. Per invertirla, seleziona una clip video e premi ↶ Reverse nella barra superiore della timeline: il simbolo ↶ compare sulla clip e l’export inverte video e audio. In timeline trascina il corpo della clip per spostarla o cambiarle livello e i bordi per estenderla o accorciarla. Taglia con S, ✂ Taglia, doppio clic o menu contestuale. La calamita aggancia clip, playhead e battute. Per sincronizzare audio e video seleziona più clip con Shift o Cmd, poi fai clic destro sulla clip di riferimento e scegli Sincronizza audio e video. La Libreria effetti contiene 14 effetti reali nelle categorie Transizioni, Movimento, Colore, Distorsione e Luce: ogni effetto ha un’anteprima, può essere trascinato nella corsia rosa e diventa un blocco autonomo spostabile, rifilabile, selezionabile ed eliminabile. L’Inspector espone i parametri pertinenti, fra durata, intensità, curva, ampiezza, frequenza e diffusione. Durante Play lo stack nativo presenta tutti i video e le immagini attivi nell’ordine esatto della timeline; media cancellati, gap e seek non lasciano un vecchio fotogramma nel monitor. La timeline parte soltanto quando i decoder necessari hanno confermato la riproduzione e mostra gli eventuali errori. L’export è offline, da 24 a 120 fps, con verifica anti-frame-drop. Il frame rate avanzato arriva a 240 tramite ffmpeg minterpolate o RIFE nel servizio locale; per usare RIFE prepara il servizio una sola volta e avvialo con npm run upscaler:server."
}, {
  id: "pixels-sub",
  title: "Modalità Pixels Subtitles",
  modeIds: ["pixelsSub"],
  keywords: ["pixelssub", "pixel", "cornice", "cover", "palette", "tre colori", "ombra", "sottotitoli"],
  content: "Pixels Subtitles mantiene l’immagine intera, pulita e leggermente rientrata al centro, anche quando cover e video sono entrambi 9:16. Il margine crea un’area protetta che i pixel non possono invadere, ma la cornice raggiunge sempre esattamente il bordo della cover. Le celle, grandi 27 px per impostazione predefinita, sono prevalentemente nette e opache, usano tutti e tre i colori della palette e reagiscono alle frequenze modificando densità e distribuzione cromatica, non altezza o estensione. Dopo aver analizzato il brano, kick e snare riconosciuti dalla stessa pipeline usata dalla sfera fanno scambiare coppie deterministiche di pixel: più ampie sul kick, più strette sullo snare. Dimensione, velocità, reattività e scie sono regolabili. Le frasi usano veri font pixel locali: Pixelify Sans, Press Start 2P, Silkscreen, VT323, Tiny5 e Jersey 10. Puoi scegliere font, colore dalla palette, posizione verticale e un’ombra pixel con colore e distanza personalizzati. I sottotitoli possono essere importati da SRT/WebVTT, inseriti manualmente oppure generati con Whisper e revisionati dal consiglio LLM locale. Ogni frase resta modificabile nella timeline. L’export MP4 è offline: calcola e attende ogni frame, unisce l’audio senza riprodurlo e rifiuta il file se il controllo finale rileva un frame mancante."
}, {
  id: "pro-subtitles",
  title: "Modalità Pro Subtitles",
  modeIds: ["proSubtitles"],
  keywords: ["prosubtitles", "kinetic", "typography", "alpha", "trasparente", "capcut", "prores", "vp9", "palette", "ombra", "parola"],
  content: "Pro Subtitles crea un overlay tipografico separato. Carica prima il video guida, poi un file SRT o WebVTT e un’immagine per estrarre tre colori. Il video e il suo audio servono alla preview e alla timeline ma sono esclusi dall’output. Ogni blocco può essere spostato, rifilato con le maniglie, diviso e riscritto. La regia intelligente sceglie fra diciassette animazioni in base a durata, densità di lettura, punteggiatura, righe ed enfasi, evitando ripetizioni meccaniche; Orbita full-frame, Griglia editoriale e Parola protagonista occupano l’intero title-safe senza tagliare i caratteri. Font, dimensione, posizione X/Y e opacità sono modificabili globalmente; ogni frase può ereditarli o impostare un override locale e tornare in qualsiasi momento al valore globale. Nel pannello Stile per parola puoi modificare colore, scala e animazione di ogni parola; i tre colori hanno ombre attivabili e configurabili separatamente. Il title-safe e l’auto-fit mantengono il testo completo nei formati 9:16 e 16:9, mentre cue sovrapposte vengono composte in regioni distinte. Esporta WebM VP9 alpha per la trasparenza quando il browser lo supporta, oppure MP4 H.264 con un colore pieno. MOV ProRes 4444 richiede la futura build desktop/native e non viene simulato nel browser."
}, {
  id: "subtitles",
  title: "Sottotitoli automatici, Whisper e LLM locale",
  modeIds: [],
  keywords: ["sottotitoli", "whisper", "llm", "qwen", "agenti", "chat", "correggere", "istruzione", "testo", "lyrics", "parole", "frasi", "srt", "font"],
  content: "La sezione Sottotitoli globali è disponibile in tutte le modalità; in Pro Subtitles la generazione si trova accanto all’import SRT. Incolla anche il testo Suno completo con tag: la pipeline rimuove sezioni e indicazioni strumentali, poi allinea il testo alle parole e ai timestamp JSON di Whisper. Scegli lingua e Whisper Tiny, Base o Medium, quindi avvia la generazione. Al primo utilizzo il modello scelto viene scaricato mostrando l’avanzamento e conservato nella cache locale. Durante il lavoro si apre Smart Subtitles generation: trascina la barra superiore per spostarla, premi il trattino per ridurla e osserva stato Whisper, output trascritto, elapsed time, dialogo di Transcript Editor, Timing Director e Quality Supervisor e log tecnico. Nel riquadro Parla con gli agenti puoi scrivere una richiesta e indirizzarla ad A1 per testo e punteggiatura, A2 per divisioni, unioni e tempi, A3 per qualità, oppure a tutti e tre in sequenza. Le sole correzioni strutturate e validate vengono applicate direttamente ai blocchi della timeline; JSON errati, loop, sovrapposizioni e spostamenti temporali eccessivi sono rifiutati. Se segnali che manca la parte iniziale, il programma cerca l’apertura nel JSON Whisper e, quando necessario, rianalizza automaticamente fino ai primi 30 secondi dell’audio; inserisce nuovi blocchi soltanto in presenza di timestamp vocali reali. Se Whisper non rileva l’apertura, gli agenti spiegano che servono testo e riferimento temporale senza inventarli. Il pulsante Parla con gli agenti riapre la conversazione dopo la chiusura. Il numero di parole è un obiettivo morbido: pause, punteggiatura, durata e leggibilità decidono i tagli. La redazione Qwen2.5 locale usa da uno a dieci passaggi, cinque per impostazione predefinita. I timestamp restano sotto il controllo del validatore deterministico. Ogni frase è un blocco modificabile, spostabile, divisibile o eliminabile. Puoi esportare SRT e JSON Whisper."
}, {
  id: "timeline",
  title: "Modifica della timeline",
  modeIds: [],
  keywords: ["timeline", "marker", "beat", "sposta", "taglia", "dividi", "elimina", "selezione", "multipla", "playhead"],
  content: "Clicca sulla timeline per spostare il playhead. I pulsanti + sui beat aggiungono eventi o elementi mancanti. Per selezionare più marker usa Shift, Cmd su macOS oppure Ctrl su Windows e Linux; quindi usa Elimina N, Backspace o Delete. I blocchi di sottotitoli e fonemi possono essere selezionati, trascinati, divisi al playhead ed eliminati. I cambiamenti della timeline vengono usati sia dalla preview sia dall’export."
}, {
  id: "scene-style",
  title: "Sfondo, palette, neon e luce",
  modeIds: [],
  keywords: ["sfondo", "foto", "video", "palette", "colori", "neon", "luce", "fascio", "origine", "destinazione", "usurata"],
  content: "Apri Scena nel pannello destro per caricare uno sfondo foto o video, scegliere finitura limpida o usurata e attivare effetti. La palette dominante dell’immagine può colorare automaticamente il progetto. Le frasi neon si inseriscono una per riga e hanno un colore configurabile. Per la luce personalizzata attiva Inserisci la luce nella scena, scegli Origine e Destinazione nella viewport oppure modifica le coordinate, quindi regola colore, intensità, dispersione, portata, ombre e fascio. Segui la biglia mantiene la luce lungo il percorso; Attiva per tutto il video evita che termini dopo i primi secondi."
}, {
  id: "sphere",
  title: "Sfera, immagine interna e finale",
  modeIds: ["instrumentalFalling", "coverSphere"],
  keywords: ["sfera", "biglia", "immagine", "interna", "vetro", "rottura", "finale", "zoom", "flip", "riflessi"],
  content: "Nel pannello Scena configura vetro, colore, emissione, contenuto interno e immagine. L’immagine è incorporata nella sfera, segue la rotazione e viene mostrata per intero nel finale usando contain. Attiva Rottura cinematografica per rompere la sfera alla fine del brano oppure a un secondo o beat preciso; puoi anche stabilire quanto resta visibile l’immagine dopo la musica. Luci e neon influenzano riflessi e scintillii senza dover alterare il colore base della sfera."
}, {
  id: "export",
  title: "Esportazione del video",
  modeIds: [],
  keywords: ["esporta", "export", "video", "qualità", "fps", "60", "mp4", "webm", "storage", "quota", "audio", "muto"],
  content: "Premi Esporta, scegli formato 9:16 o 16:9, risoluzione, FPS e qualità, quindi avvia Video finale. Tutte le modalità esportano offline: il numero del frame è il clock, l’encoder attende ogni immagine e un audit finale impedisce di consegnare un video congelato o con frame mancanti. L’audio viene letto dal file e non riprodotto nelle cuffie durante il rendering. Pro Subtitles può inoltre esportare un layer senza audio e senza video guida, in WebM VP9 alpha oppure MP4 H.264 con fondo pieno. Quando disponibile, il browser scrive direttamente nel file scelto per evitare errori di quota; altrimenti usa un fallback temporaneo progressivo. Non chiudere la pagina fino al completamento."
}, {
  id: "projects",
  title: "Salvare e riaprire un progetto",
  modeIds: [],
  keywords: ["salva", "aprire", "progetto", "file", "rbs", "json", "recuperare"],
  content: "Usa Salva nella barra superiore per conservare impostazioni, eventi, oggetti, colori, sfondo, luce e riferimenti ai media nel progetto .rbs.json. Apri ripristina la configurazione. Nella versione web può essere necessario reimportare l’audio perché gli URL temporanei del browser non sopravvivono alla chiusura; nell’app Tauri il percorso locale può essere riaperto direttamente."
}, {
  id: "ai-quantizer",
  title: "Music: AI Quantizer",
  modeIds: ["aiQuantizer"],
  keywords: ["music", "quantizer", "quantizza", "bpm", "warp", "stem", "pitch", "daw", "restoration", "mastering", "forensics"],
  content: "Apri Music e scegli AI Quantizer. Crea un progetto, carica il master e usa Analisi Smart per rilevare beat, downbeat e BPM; controlla i marker, imposta il BPM intero obiettivo e genera la warp map. Quantizza master e stem con la stessa mappa per evitare derive e preservare il pitch. I moduli successivi gestiscono allineamento alla griglia DAW, restauro, misura LUFS/True Peak, mastering ISP-aware e confronto AI Forensics. Il motore resta locale: richiede il progetto AI Quantizer configurato, Python, FFmpeg/FFprobe e Rubber Band."
}, {
  id: "troubleshooting",
  title: "Problemi comuni",
  modeIds: [],
  keywords: ["problema", "errore", "non funziona", "bloccato", "lento", "scatti", "nero", "quota", "modello"],
  content: "Se la preview scatta, interrompi la riproduzione, attendi la fine dell’analisi e riduci gli effetti più pesanti; l’export mantiene comunque la qualità scelta. Se una modifica di Instrumental Falling non compare, seleziona il marker o l’oggetto corretto: il cambio di tipo è live e non richiede Rigenera scena. Se un modello locale non parte al primo utilizzo, verifica la connessione e lo spazio disponibile; dopo il download viene letto dalla cache locale. Per errori di quota in export usa la selezione diretta del file, qualità Alta o una risoluzione minore. Se l’audio manca dopo aver riaperto un progetto web, reimporta il file originale."
}];

function normalizedTokens(value: string): string[] {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter((token) => token.length > 2);
}

function normalizedIntent(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function conversationalApplicationHelpAnswer(query: string): string | null {
  const intent = normalizedIntent(query);
  const greeting = /^(?:ciao|ehi|hey|salve|buongiorno|buonasera)(?: (?:come va|come stai|tutto bene|ci sei))?$/.test(intent);
  const wellbeing = /^(?:come va|come stai|tutto bene|va tutto bene|ci sei)$/.test(intent);
  if (greeting || wellbeing) {
    const acknowledgement = /come va|come stai|tutto bene|va tutto bene/.test(intent) ? "Tutto bene, grazie! " : "";
    return `${acknowledgement}Sono qui e pronto ad aiutarti. Dimmi cosa vuoi creare oppure quale funzione dell’applicazione vuoi usare.`;
  }
  if (/^(?:grazie|grazie mille|perfetto grazie|ok grazie)$/.test(intent)) return "Prego! Quando vuoi, dimmi il prossimo risultato che vuoi ottenere nell’applicazione.";
  if (/^(?:ciao )?(?:chi sei(?: e cosa puoi fare)?|presentati(?: e dimmi in cosa puoi aiutarmi)?|cosa fai|cosa puoi fare|come puoi aiutarmi)$/.test(intent)) return applicationHelpKnowledgeBase[0]!.content;
  return null;
}

const synonymGroups: readonly (readonly string[])[] = [
  ["esporta", "export", "render", "video", "mp4", "webm"],
  ["audio", "brano", "musica", "traccia", "canzone"],
  ["sottotitoli", "subtitle", "testo", "frasi", "srt"],
  ["sfera", "biglia", "pallina", "marble"],
  ["orso", "orsacchiotto", "teddy", "peluche"],
  ["luce", "illuminazione", "fascio", "riflessi"],
  ["sfondo", "background", "foto", "video"],
  ["timeline", "marker", "blocco", "beat", "playhead"],
  ["pixel", "bar", "locale", "insegna", "led"],
  ["cubo", "cube", "vetro", "facce", "loop"],
  ["quantizer", "quantizza", "warp", "bpm", "stem", "daw", "mastering"],
  ["memory", "memoria", "catalogo", "catalogare", "ritrovare", "grafo", "relazioni"]
];

function expandedQueryTokens(query: string): Set<string> {
  const tokens = new Set(normalizedTokens(query));
  for (const group of synonymGroups) if (group.some((token) => tokens.has(token))) for (const token of group) tokens.add(token);
  return tokens;
}

export function retrieveApplicationHelp(query: string, modeId: string, limit = 3): ApplicationHelpArticle[] {
  if (conversationalApplicationHelpAnswer(query)) return [applicationHelpKnowledgeBase[0]!];
  const queryTokens = expandedQueryTokens(query); const normalizedQuery = normalizedTokens(query).join(" ");
  const contextualModeRequest = queryTokens.has("modalita") && (queryTokens.has("questa") || queryTokens.has("attiva") || queryTokens.has("corrente"));
  const ranked = applicationHelpKnowledgeBase.map((article, index) => {
    const titleTokens = new Set(normalizedTokens(article.title)); const keywordTokens = new Set(article.keywords.flatMap(normalizedTokens)); const contentTokens = new Set(normalizedTokens(article.content));
    let matchScore = 0;
    for (const token of queryTokens) { if (titleTokens.has(token)) matchScore += 8; if (keywordTokens.has(token)) matchScore += 6; if (contentTokens.has(token)) matchScore += 1; }
    if (normalizedQuery && normalizedTokens(article.title).join(" ").includes(normalizedQuery)) matchScore += 14;
    const modeContext = article.modeIds.includes(modeId) && (matchScore > 0 || contextualModeRequest);
    // When the question has at least one relevant term, keep the guide for the
    // active mode ahead of generic articles that happen to share broad words
    // such as "video" or "sfondo".
    return { article, score: matchScore + (modeContext ? 18 : 0), matchScore, modeContext, index };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const relevant = ranked.filter((item) => item.matchScore > 0 || item.modeContext).slice(0, Math.max(1, limit)).map((item) => item.article);
  return relevant.length ? relevant : [applicationHelpKnowledgeBase[0]!];
}

export function applicationHelpContext(query: string, modeId: string, limit = 3): string {
  return retrieveApplicationHelp(query, modeId, limit).map((article) => `## ${article.title}\n${article.content}`).join("\n\n");
}

export function fallbackApplicationHelpAnswer(query: string, modeId: string): string {
  const conversational = conversationalApplicationHelpAnswer(query);
  if (conversational) return conversational;
  const articles = retrieveApplicationHelp(query, modeId, 2); const primary = articles[0]!;
  if (primary.id === "assistant-introduction") return "Non ho trovato una guida abbastanza pertinente per rispondere con precisione. Indicami la modalità che stai usando e il risultato che vuoi ottenere, oppure il nome del controllo che non trovi.";
  const related = articles[1] && articles[1].id !== primary.id ? `\n\nPuò esserti utile anche “${articles[1].title}”.` : "";
  return `${primary.content}${related}`;
}
