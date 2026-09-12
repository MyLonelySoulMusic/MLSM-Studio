Agisci come un senior software architect, sviluppatore desktop, graphics programmer,
audio DSP engineer e video rendering engineer.

Devi progettare e implementare un’applicazione web completa chiamata
“MLSM Studio” (My Lonely Soul Music Studio). L'eventuale compilazione desktop verrà valutata solo alla fine.

L’applicazione deve importare un brano MP3 o WAV e generare automaticamente
un’animazione musicale in cui una sfera cade e rimbalza sopra tamburi, piatti,
paletti, piattaforme, molle e altri oggetti.

Direzione artistica corrente obbligatoria:
- il percorso complessivo deve procedere sempre verso il basso, mentre ogni collisione deve produrre un arco di rimbalzo chiaramente ascendente prima della discesa successiva;
- gli strumenti devono essere riconoscibili, modellati di profilo e leggermente inclinati, mai presentati come semplici primitive viste dall'alto;
- l'analisi deve classificare, con confidence e correzione manuale, almeno grancassa, rullante, piatti, pianoforte, chitarra e strings;
- ogni famiglia strumentale deve generare un oggetto coerente su cui la sfera urta o viaggia;
- la sfera deve essere una biglia in vetro trasparente con tinta, forma, colore e immagine interna personalizzabili;
- sfera, sfondo, singoli strumenti e collegamenti devono avere colori modificabili;
- i collegamenti devono supportare guide metalliche da flipper, tubi in vetro e percorsi di mattoncini, applicabili globalmente o combinabili tratto per tratto;
- lo sfondo deve offrire preset professionali di muri, ambienti astratti e studi, oltre al caricamento di immagini personali;
- glow, particelle e vignettatura devono funzionare sia sui preset sia sopra uno sfondo caricato;
- quando viene caricato uno sfondo, il software deve estrarne i colori dominanti e applicarli automaticamente alla palette del progetto;
- i controlli di sfondo e direzione artistica devono rimanere sempre reperibili in una sezione esplicita dell'Inspector.
- le pelli di tamburi, grancassa e rullante devono essere superfici orizzontali rivolte verso l'alto: la sfera deve colpire la pelle, mai il fianco o una faccia verticale rivolta verso la camera;
- la generazione automatica deve usare il beat principale come griglia degli impatti e non trasformare ogni onset in una collisione;
- interpretare in half-time beat grid eccessivamente veloci per mantenere leggibile il movimento;
- pianoforte, chitarra e violini/strings devono essere assegnati automaticamente solo quando confidence e intensità rendono il riconoscimento chiaramente affidabile;
- la preview deve mostrare una cornice realmente diversa tra 9:16 e 16:9 e ridimensionare il renderer nel formato selezionato;
- ogni preset o sfondo personale deve poter essere mostrato con finitura limpida oppure usurata, mantenendo questa scelta anche nel salvataggio e nell'export.

Le collisioni principali della sfera devono avvenire esattamente in corrispondenza
dei beat, degli onset e degli eventi musicali selezionati.

Non creare una semplice demo.
Crea un progetto software modulare, funzionante, testabile, documentato e predisposto
per essere distribuito come applicazione desktop.

==================================================
1. OBIETTIVO PRINCIPALE
==================================================

Il flusso dell’applicazione deve essere:

1. L’utente crea un nuovo progetto.
2. L’utente importa un file MP3 o WAV.
3. Il software analizza il file.
4. Il software rileva:
   - durata;
   - sample rate;
   - BPM globale;
   - BPM locale o variabile;
   - beat;
   - downbeat;
   - onset;
   - transitori;
   - intensità degli eventi;
   - pause e sezioni a bassa energia;
   - energia per bande di frequenza;
   - possibili colpi di kick, snare, hi-hat e percussioni.
5. Il software mostra una timeline musicale editabile.
6. L’utente può correggere, aggiungere, spostare o eliminare gli eventi.
7. Il software genera automaticamente una scena.
8. Una sfera percorre la scena e colpisce gli oggetti esattamente sugli eventi musicali.
9. L’utente può modificare scena, oggetti, materiali, colori, sfondo, camera e fisica.
10. L’utente visualizza una preview leggera.
11. L’utente esporta il video finale con audio originale in una risoluzione e frame rate scelti.

La sincronizzazione temporale deve essere una priorità assoluta.

==================================================
2. STACK TECNOLOGICO
==================================================

Utilizza questa architettura salvo impedimenti tecnici documentati:

Modalità di sviluppo:
- sviluppare e verificare l'applicazione innanzitutto come applicazione web locale;
- usare React, TypeScript, Vite, Web Audio API, Web Workers e API browser durante tutte le fasi di sviluppo;
- non compilare o generare bundle desktop durante le singole fasi;
- valutare Tauri e la compilazione desktop esclusivamente al termine dello sviluppo web;
- mantenere adapter e confini architetturali che consentano l'integrazione desktop futura senza bloccare lo sviluppo web.

Desktop shell futura, da valutare alla fine:
- Tauri 2;
- Rust per comandi desktop, gestione file, processi ed esportazione solo dove le API web non sono sufficienti;
- React;
- TypeScript;
- Vite.

Interfaccia:
- React;
- TypeScript strict;
- Zustand o Redux Toolkit per lo stato;
- CSS Modules, Tailwind oppure una soluzione coerente e centralizzata;
- componenti accessibili e responsive.

Rendering:
- Three.js;
- WebGL 2 come renderer principale;
- architettura predisposta per un futuro renderer WebGPU;
- rendering offscreen per esportazione;
- post-processing opzionale.

Fisica:
- implementare un modulo fisico deterministico personalizzato per la traiettoria principale;
- è possibile usare Rapier o Matter.js per collisioni secondarie, particelle o oggetti decorativi;
- non delegare la sincronizzazione principale a una simulazione fisica libera e non deterministica.

Analisi audio:
- sidecar Python;
- Python 3.12 o versione stabile compatibile;
- librosa;
- numpy;
- scipy;
- soundfile;
- eventuale utilizzo opzionale di madmom, aubio o Essentia solo dietro un adapter;
- FFmpeg/FFprobe per decodifica, metadati e normalizzazione temporanea.

Video export:
- FFmpeg incluso o rilevato come sidecar;
- supporto H.264, H.265 e ProRes quando disponibile;
- sequenza PNG oppure raw video pipe;
- audio originale muxato senza alterare la durata;
- log e percentuale di avanzamento;
- possibilità di annullare l’esportazione.

Persistenza:
- formato progetto JSON versionato;
- asset copiati o referenziati in una cartella di progetto;
- autosave;
- recupero da crash;
- migrazioni per versioni future del formato progetto.

==================================================
3. PRINCIPIO DI SINCRONIZZAZIONE
==================================================

La sfera non deve rimbalzare liberamente sperando che gli impatti coincidano con il brano.

Implementa una pipeline “music events first”.

La timeline musicale deve essere la sorgente della verità.

Ogni collisione programmata deve avere almeno:

- id;
- timeSeconds;
- timeSamples;
- eventType;
- confidence;
- strength;
- frequencyBand;
- assignedObjectType;
- enabled;
- accent;
- manualOverride;
- expectedBallPosition;
- expectedBallVelocity;
- expectedImpactNormal.

Usare il tempo espresso in secondi double precision e, dove possibile,
anche l’indice esatto del campione audio.

La posizione al frame N deve essere calcolata usando:

frameTime = frameIndex / exportFps

Non usare delta time derivato dalla velocità reale del computer durante l’export.

Non usare Date.now(), requestAnimationFrame delta o timer di sistema
come sorgente temporale durante il rendering finale.

Durante la preview, l’audio clock deve essere il master clock.

Durante l’export, il numero del frame deve essere il master clock.

==================================================
4. ANALISI AUDIO
==================================================

Crea un modulo Python separato con API JSON.

Input:
- percorso del file;
- parametri di analisi;
- sensibilità;
- eventuale intervallo temporale.

Output:
- durata;
- sample rate;
- numero di canali;
- waveform semplificata;
- RMS;
- loudness relativo;
- onset envelope;
- spectral flux;
- beat;
- downbeat stimati;
- tempo globale;
- curva del tempo locale;
- segmenti musicali;
- eventi classificati;
- confidence score.

Implementare almeno:

A. Decodifica
- convertire temporaneamente l’audio in WAV PCM float o PCM 24 bit;
- mantenere il file originale per l’export;
- evitare conversioni multiple non necessarie.

B. Analisi multirisoluzione
- onset detection con più hop length;
- una risoluzione più precisa per i transitori;
- una risoluzione più economica per waveform e struttura generale.

C. Beat tracking
- beat globale;
- beat locale;
- gestione di tempo variabile;
- possibilità di rilevare half-time e double-time;
- scelta automatica dell’interpretazione più plausibile.

D. Eventi per banda
- low band per kick e colpi bassi;
- mid band per snare e strumenti medi;
- high band per hi-hat e transitori acuti;
- full spectrum onset.

E. Correzione latenza
- documentare eventuale ritardo introdotto dalle finestre FFT;
- riportare gli eventi al tempo reale del transitorio;
- consentire un offset globale in millisecondi.

F. Confidence
Ogni evento automatico deve avere una confidence tra 0 e 1.

G. Cache
Salvare l’analisi in un file cache collegato all’hash dell’audio e ai parametri.

==================================================
5. EDITOR DELLA TIMELINE
==================================================

Creare una timeline simile a un editor audio/video.

Deve mostrare:

- waveform stereo o mono;
- righello temporale;
- beat grid;
- marker degli onset;
- marker delle collisioni;
- colori diversi per kick, snare, hi-hat, beat e marker manuali;
- playhead;
- zoom orizzontale;
- scroll;
- selezione multipla;
- snapping;
- loop region;
- metronomo opzionale.

Funzioni:

- play;
- pause;
- stop;
- seek;
- frame step;
- salto al marker precedente o successivo;
- aggiunta marker;
- eliminazione marker;
- drag del marker;
- quantizzazione;
- disattivazione del singolo evento;
- scelta dell’oggetto associato;
- modifica dell’intensità;
- modifica dell’offset in millisecondi;
- selezione di tutti gli eventi di una categoria;
- filtro per confidence;
- rigenerazione solo di un intervallo.

Quando un marker viene trascinato, aggiornare automaticamente la traiettoria locale
senza rigenerare necessariamente l’intero progetto.

==================================================
6. GENERAZIONE DELLA TRAIETTORIA
==================================================

Implementa un trajectory planner deterministico.

Ogni coppia di collisioni consecutive definisce un arco:

evento A:
- tempo t0;
- posizione p0;
- velocità iniziale v0.

evento B:
- tempo t1;
- posizione target p1;
- normale di impatto n1.

La durata del volo è:

T = t1 - t0

Per moto balistico con gravità costante:

p(t) = p0 + v0 * t + 0.5 * g * t^2

Calcolare la velocità iniziale necessaria:

v0 = (p1 - p0 - 0.5 * g * T^2) / T

Usare questa relazione per costruire un arco che termini esattamente
nella posizione dell’oggetto al tempo dell’evento successivo.

La collisione visiva deve verificarsi esattamente a t1.

Dopo l’impatto:

- applicare restituzione;
- riflettere la componente normale della velocità;
- conservare o attenuare la componente tangenziale;
- aggiungere un eventuale impulso controllato;
- risolvere l’arco successivo.

Quando la fisica naturale non permette di raggiungere l’evento seguente:

1. modificare automaticamente la posizione del prossimo oggetto;
2. modificare la gravità locale entro limiti accettabili;
3. usare un oggetto con impulso, come molla o trampolino;
4. inserire una guida invisibile;
5. modificare la scala spaziale;
6. segnalare il segmento come “assisted trajectory”.

L’assistenza non deve produrre teletrasporti o cambi improvvisi di velocità.

Aggiungere limiti configurabili:

- gravità minima e massima;
- velocità massima della sfera;
- altezza massima dell’arco;
- distanza orizzontale massima;
- coefficiente di restituzione;
- energia minima dopo un impatto;
- accelerazione massima percepita;
- rotazione massima.

La traiettoria deve essere:
- continua in posizione;
- preferibilmente continua in velocità;
- visivamente plausibile;
- deterministica;
- identica tra preview ed export.

==================================================
7. RISOLUZIONE DELLE COLLISIONI
==================================================

Separare:

A. Scheduled collisions
Collisioni principali programmate sulla timeline.
Devono avvenire al tempo esatto.

B. Decorative collisions
Piccoli contatti, particelle o oggetti secondari.
Possono essere simulati liberamente purché non alterino la traiettoria master.

C. Accidental collisions
Devono essere evitate tramite collision layer o corrette dal planner.

Per ogni collisione programmata:

- evidenziare brevemente l’oggetto;
- deformare leggermente la superficie;
- generare particelle opzionali;
- applicare squash and stretch alla sfera;
- aggiungere vibrazione locale;
- aggiungere una luce impulsiva;
- sincronizzare l’intensità dell’effetto alla strength musicale.

La deformazione non deve cambiare il punto temporale della collisione.

==================================================
8. OGGETTI DISPONIBILI
==================================================

Creare una libreria iniziale con:

- tamburo;
- rullante;
- tom;
- cassa;
- piatto;
- triangolo;
- blocco;
- paletto;
- piattaforma;
- piattaforma inclinata;
- molla;
- trampolino;
- campana;
- corda;
- tubo;
- anello;
- lama decorativa non violenta;
- cristallo;
- tasto;
- pad elettronico;
- oggetto personalizzato importato come GLB o GLTF.

Ogni oggetto deve avere proprietà modificabili:

- nome;
- posizione;
- rotazione;
- scala;
- colore singolo;
- gradiente;
- palette multicolore;
- materiale;
- roughness;
- metalness;
- emission;
- trasparenza;
- texture;
- collision shape;
- restitution;
- friction;
- hit animation;
- particle preset;
- visibility;
- cast shadow;
- receive shadow.

Prevedere preset di colori, ma tutti i colori devono essere modificabili.

Consentire la modifica:
- di un singolo oggetto;
- di tutti gli oggetti dello stesso tipo;
- di una selezione;
- dell’intera palette della scena.

==================================================
9. PERSONALIZZAZIONE DELLA SFERA
==================================================

La sfera deve avere:

- dimensione;
- massa visuale;
- colore singolo;
- due o più colori;
- gradiente;
- texture;
- materiale lucido;
- materiale opaco;
- materiale metallico;
- materiale trasparente;
- emissione;
- scia;
- motion trail;
- rotazione;
- velocità di rotazione;
- deformazione all’impatto;
- alone luminoso;
- simbolo o logo opzionale;
- preset salvabili.

La sfera può essere:
- piena;
- bicolore;
- a spirale;
- con bande;
- marmorizzata;
- luminosa;
- personalizzata con texture.

Tutti i valori devono essere editabili.

==================================================
10. SFONDO
==================================================

Lo sfondo deve supportare:

- colore pieno;
- gradiente lineare;
- gradiente radiale;
- due o più colori;
- immagine JPG, PNG o WebP;
- video opzionale;
- texture ripetuta;
- parete tridimensionale;
- ambiente astratto;
- trasparenza, se il codec scelto lo supporta.

Proprietà:

- fill;
- fit;
- cover;
- contain;
- crop;
- zoom;
- offset X/Y;
- blur;
- luminosità;
- contrasto;
- saturazione;
- opacità;
- vignettatura;
- parallax;
- profondità;
- velocità di movimento.

Aggiungere una safe area per:
- 9:16;
- 16:9;
- 1:1;
- 4:5;
- formati personalizzati.

==================================================
11. FORMATO DEL VIDEO
==================================================

All’avvio del progetto, chiedere o permettere di scegliere:

Preset:
- verticale 9:16;
- orizzontale 16:9;
- quadrato 1:1;
- social 4:5;
- personalizzato.

Risoluzioni iniziali:

9:16:
- 540 × 960;
- 720 × 1280;
- 1080 × 1920;
- 1440 × 2560;
- 2160 × 3840.

16:9:
- 960 × 540;
- 1280 × 720;
- 1920 × 1080;
- 2560 × 1440;
- 3840 × 2160.

Consentire qualsiasi risoluzione personalizzata entro limiti ragionevoli.

Frame rate:
- 24;
- 25;
- 30;
- 48;
- 50;
- 60;
- 90;
- 100;
- 120;
- valore personalizzato.

Il progetto deve separare:
- aspect ratio della scena;
- risoluzione preview;
- frame rate preview;
- risoluzione export;
- frame rate export.

==================================================
12. PREVIEW
==================================================

La preview deve essere ottimizzata.

Preset predefinito:
- 540p o 720p;
- 30 fps;
- ombre semplificate;
- antialiasing moderato;
- particelle ridotte;
- risoluzione dinamica opzionale.

Aggiungere:
- qualità draft;
- qualità medium;
- qualità high;
- risoluzione custom;
- FPS custom;
- indicatore FPS;
- indicatore dropped frame;
- disattivazione temporanea di motion blur, bloom e profondità di campo.

La qualità della preview non deve modificare:
- tempi degli impatti;
- traiettoria;
- posizione degli oggetti;
- durata;
- sincronizzazione audio.

Quando la preview non riesce a essere fluida:
- saltare frame visivi;
- non rallentare l’audio;
- riallineare la scena all’audio clock.

==================================================
13. CAMERA
==================================================

Creare modalità camera:

- fissa;
- tracking verticale;
- tracking completo della sfera;
- smooth follow;
- camera cinematografica;
- keyframe manuali;
- auto framing;
- percorso spline.

Parametri:

- posizione;
- target;
- focal length;
- field of view;
- roll;
- damping;
- look-ahead;
- dead zone;
- zoom;
- shake;
- collision shake;
- safe margins.

La camera automatica deve mantenere la sfera e l’oggetto successivo nell’inquadratura.

Per video verticali:
- privilegiare movimento verticale;
- evitare che la sfera esca dalla safe area;
- mantenere visibile una porzione del percorso successivo.

Per video orizzontali:
- usare più movimento laterale;
- sfruttare maggiormente la profondità.

==================================================
14. EDITOR DELLA SCENA
==================================================

L’interfaccia principale deve comprendere:

A sinistra:
- libreria oggetti;
- preset;
- asset;
- sfondi;
- materiali.

Al centro:
- viewport 3D;
- safe area;
- gizmo di trasformazione;
- griglia;
- guide;
- anteprima camera.

A destra:
- inspector dell’elemento selezionato;
- trasformazioni;
- materiale;
- fisica;
- collisione;
- animazione;
- associazione all’evento musicale.

In basso:
- timeline;
- waveform;
- marker;
- controlli di riproduzione.

In alto:
- progetto;
- import;
- undo;
- redo;
- salva;
- analizza;
- genera scena;
- preview;
- export;
- impostazioni.

Supportare:
- undo/redo;
- copia/incolla;
- duplica;
- raggruppa;
- blocca;
- nascondi;
- multiselezione;
- scorciatoie da tastiera;
- pannelli ridimensionabili.

==================================================
15. GENERAZIONE AUTOMATICA DELLA SCENA
==================================================

Creare un generatore procedurale con seed.

Input:
- eventi musicali;
- aspect ratio;
- stile;
- densità;
- gravità;
- varietà degli oggetti;
- palette;
- intensità;
- direzione prevalente;
- seed.

Preset di stile:
- minimal;
- neon;
- industrial;
- cartoon;
- dark;
- futuristic;
- realistic percussion;
- abstract;
- glass;
- metallic;
- lo-fi.

Mapping automatico suggerito:

- kick forte → grande tamburo o piattaforma;
- snare → rullante o pad medio;
- hi-hat → piccolo paletto, triangolo o piatto;
- downbeat → oggetto grande;
- evento molto intenso → impatto con particelle;
- pausa → volo lungo o slow visual motion;
- crescendo → oggetti progressivamente più grandi;
- sezione densa → sequenza di piccoli rimbalzi;
- cambio sezione → cambio camera, sfondo o palette.

Evitare:
- sovrapposizioni;
- oggetti fuori camera;
- traiettorie impossibili;
- ripetizioni eccessive;
- rumore visivo;
- collisioni non programmate.

Il seed deve permettere di rigenerare esattamente la stessa scena.

==================================================
16. EDITOR DEGLI EVENTI
==================================================

Ogni marker musicale deve permettere di scegliere:

- nessuna collisione;
- collisione normale;
- collisione accentata;
- passaggio vicino senza collisione;
- cambio camera;
- cambio luce;
- cambio colore;
- emissione particelle;
- cambio sfondo;
- evento personalizzato.

L’utente deve poter:
- associare manualmente un oggetto;
- scegliere un tipo di oggetto lasciando al software la posizione;
- bloccare posizione e tempo;
- rigenerare solo il tratto precedente;
- rigenerare solo il tratto successivo;
- bloccare un intero intervallo.

==================================================
17. AUDIO E SINCRONIZZAZIONE IN PREVIEW
==================================================

Utilizzare Web Audio API o un sistema equivalente.

Requisiti:

- l’audio è il master clock;
- compensazione della latenza;
- offset globale regolabile;
- calibrazione in millisecondi;
- seek accurato;
- nessuna deriva progressiva;
- pausa e ripresa precise;
- loop preciso;
- preroll configurabile.

Mostrare:
- tempo audio;
- tempo animazione;
- differenza in millisecondi;
- eventuale drift.

Aggiungere un test di sincronizzazione:
- generare flash visivi sui marker;
- confrontare marker e audio;
- permettere una correzione globale tra -250 ms e +250 ms.

==================================================
18. RENDERING OFFLINE
==================================================

Il rendering finale non deve registrare la viewport in tempo reale.

Implementare rendering offline frame-by-frame.

Questa regola è globale e obbligatoria per ogni modalità presente o futura: sono vietati `MediaRecorder`, `captureStream`, il playback del player e `requestAnimationFrame` come clock di esportazione. L'encoder deve applicare backpressure, il file finalizzato deve essere riaperto e il numero di pacchetti video deve coincidere con `ceil(durata × fps)`; una differenza anche di un solo frame annulla il file parziale. Una macchina lenta può aumentare il tempo di rendering, ma non può ridurre risoluzione, frame rate o numero dei fotogrammi scelti.

Per ogni frame:

1. calcolare il tempo:
   t = frameIndex / fps;

2. valutare:
   - traiettoria;
   - rotazione;
   - camera;
   - luci;
   - particelle deterministiche;
   - animazioni degli oggetti;
   - post-processing;

3. renderizzare esattamente alla risoluzione di export;

4. trasferire il frame al processo di codifica;

5. aggiornare avanzamento e tempo stimato.

Il risultato deve essere identico anche se il rendering avviene a:
- 3 fps reali;
- 20 fps reali;
- 120 fps reali.

La velocità di elaborazione non deve cambiare il contenuto temporale.

Usare un seed fisso anche per:
- particelle;
- rumore;
- variazioni;
- motion trail.

==================================================
19. MOTION BLUR
==================================================

Implementare motion blur opzionale tramite temporal supersampling.

Per ogni frame finale:
- calcolare più subframe;
- distribuire i subframe nell’intervallo dello shutter;
- accumulare i risultati;
- normalizzare.

Parametri:
- enabled;
- shutter angle;
- samples;
- quality.

Preset:
- off;
- low: 2 samples;
- medium: 4 samples;
- high: 8 samples;
- ultra: 16 samples.

Il motion blur non deve alterare il momento dell’impatto.

==================================================
20. EXPORT
==================================================

Creare una finestra export completa.

Impostazioni:

Formato:
- MP4;
- MOV;
- WebM;
- sequenza PNG;
- sequenza EXR opzionale.

Codec:
- H.264;
- H.265;
- ProRes 422;
- ProRes 4444;
- VP9;
- AV1 se disponibile.

Risoluzione:
- preset;
- personalizzata.

Frame rate:
- da 24 a 120 fps;
- valore personalizzato.

Bitrate:
- automatico;
- qualità alta;
- qualità massima;
- bitrate personalizzato;
- CRF personalizzato.

Audio:
- originale;
- AAC;
- PCM;
- sample rate originale;
- 48 kHz;
- bitrate selezionabile;
- normalizzazione opzionale disattivata di default.

Colore:
- SDR Rec.709;
- spazio colore configurabile;
- HDR lasciato come funzione futura se non implementabile correttamente.

Hardware encoding:
- VideoToolbox su macOS;
- NVENC su NVIDIA;
- Quick Sync su Intel;
- AMF su AMD;
- fallback software.

Aggiungere:
- verifica automatica encoder disponibili;
- stima dimensione file;
- stima memoria;
- spazio disco disponibile;
- progress bar;
- frame corrente;
- frame totali;
- tempo trascorso;
- tempo stimato;
- pausa se tecnicamente supportata;
- annulla;
- log dettagliato.

L’esportazione deve supportare almeno:
- 1080p 30 fps;
- 1080p 60 fps;
- 4K 30 fps;
- 4K 60 fps;
- 4K 120 fps.

Non promettere esportazione in tempo reale.
Il rendering 4K 120 fps può richiedere molto tempo.

In caso di memoria insufficiente:
- non conservare tutti i frame in RAM;
- inviare i frame progressivamente a FFmpeg;
- oppure usare una cartella temporanea;
- eliminare i file temporanei al termine.

==================================================
21. SINCRONIZZAZIONE AUDIO-VIDEO IN EXPORT
==================================================

Il video deve iniziare esattamente dal tempo zero del progetto.

Gestire:
- eventuale silenzio iniziale;
- offset audio;
- frame rate non intero;
- durata finale;
- ultimo frame;
- audio più lungo o più corto di una frazione di frame.

Calcolare:

totalFrames = ceil(audioDurationSeconds * fps)

Il timestamp del frame N è:

N / fps

Non affidarsi esclusivamente ai timestamp generati automaticamente dal container.

Dopo la codifica:
- controllare durata audio;
- controllare durata video;
- controllare differenza;
- segnalare differenze superiori a una soglia configurabile, default 5 ms;
- effettuare un remux o una correzione quando necessario.

Creare test automatici per:
- 24 fps;
- 25 fps;
- 29.97 fps;
- 30 fps;
- 50 fps;
- 59.94 fps;
- 60 fps;
- 120 fps.

==================================================
22. FORMATO DEL PROGETTO
==================================================

Creare uno schema JSON versionato.

Esempio concettuale:

{
  "schemaVersion": 1,
  "project": {
    "name": "",
    "createdAt": "",
    "updatedAt": "",
    "seed": 12345
  },
  "audio": {
    "sourcePath": "",
    "hash": "",
    "duration": 0,
    "sampleRate": 0,
    "globalOffsetMs": 0
  },
  "canvas": {
    "aspectRatio": "9:16",
    "previewWidth": 540,
    "previewHeight": 960,
    "previewFps": 30,
    "exportWidth": 2160,
    "exportHeight": 3840,
    "exportFps": 120
  },
  "analysis": {},
  "events": [],
  "ball": {},
  "objects": [],
  "trajectorySegments": [],
  "camera": {},
  "background": {},
  "lighting": {},
  "postProcessing": {},
  "exportPresets": []
}

Creare validazione runtime tramite Zod o soluzione equivalente.

==================================================
23. PRESET
==================================================

Creare preset salvabili per:

- progetto;
- palette;
- sfera;
- oggetti;
- sfondo;
- illuminazione;
- camera;
- analisi audio;
- generatore;
- export.

Preset iniziali:

A. Vertical Neon
- 9:16;
- sfondo blu scuro;
- oggetti rossi e viola;
- sfera verde acqua luminosa.

B. Minimal White
- sfondo bianco;
- oggetti neri e grigi;
- sfera bicolore.

C. Dark Percussion
- parete scura;
- tamburi rossi;
- luce fredda;
- sfera emissiva.

D. Social Preview
- 540 × 960;
- 30 fps;
- qualità ridotta.

E. 4K Vertical Master
- 2160 × 3840;
- 60 fps.

F. 4K Vertical 120
- 2160 × 3840;
- 120 fps;
- warning prestazioni.

G. 4K Horizontal 120
- 3840 × 2160;
- 120 fps;
- warning prestazioni.

==================================================
24. ARCHITETTURA DEL CODICE
==================================================

Organizzare il repository in modo simile:

/apps
  /desktop
    /src
    /src-tauri

/packages
  /core
  /audio-types
  /timeline
  /trajectory
  /physics
  /scene
  /renderer
  /export
  /project-schema
  /ui
  /shared

/sidecars
  /audio-analyzer
    /src
    /tests
    pyproject.toml

/tests
  /unit
  /integration
  /golden
  /sync

/docs
  architecture.md
  audio-analysis.md
  synchronization.md
  trajectory-planning.md
  export.md
  project-format.md
  development.md
  troubleshooting.md

Separare chiaramente:

- dominio;
- UI;
- rendering;
- analisi;
- serializzazione;
- esportazione;
- accesso al filesystem.

Evitare componenti React monolitici.

==================================================
25. API DEL MOTORE DI TRAIETTORIA
==================================================

Definire interfacce TypeScript chiare.

Esempio:

interface MusicEvent {
  id: string;
  timeSeconds: number;
  sampleIndex?: number;
  type: MusicEventType;
  strength: number;
  confidence: number;
  enabled: boolean;
  manualOverride: boolean;
}

interface ScheduledImpact {
  eventId: string;
  timeSeconds: number;
  objectId: string;
  contactPoint: Vector3Data;
  contactNormal: Vector3Data;
  impactStrength: number;
}

interface TrajectorySegment {
  id: string;
  startTime: number;
  endTime: number;
  startPosition: Vector3Data;
  endPosition: Vector3Data;
  initialVelocity: Vector3Data;
  gravity: Vector3Data;
  assisted: boolean;
}

interface TrajectoryEvaluator {
  evaluate(timeSeconds: number): BallState;
}

L’evaluator deve essere una funzione pura per quanto possibile.

==================================================
26. TEST
==================================================

Scrivere test unitari e di integrazione.

Test obbligatori:

1. La sfera raggiunge il punto target entro una tolleranza spaziale.
2. La sfera raggiunge il punto target entro una tolleranza temporale.
3. La stessa scena produce lo stesso stato allo stesso tempo.
4. Il risultato non dipende dal frame rate della preview.
5. L’export a 30, 60 e 120 fps conserva gli stessi tempi di impatto.
6. Nessuna deriva dopo almeno dieci minuti.
7. Salvataggio e caricamento mantengono il progetto.
8. Undo e redo funzionano.
9. L’analisi cache viene invalidata quando cambia il file.
10. Il rendering può essere annullato.
11. I file temporanei vengono rimossi.
12. L’audio finale coincide con l’originale entro la tolleranza definita.

Tolleranze iniziali:

- errore temporale scheduled impact: inferiore a 0,5 ms nel modello matematico;
- errore temporale visuale: inferiore a mezzo frame;
- errore di durata export: inferiore a 5 ms quando il container lo consente;
- errore spaziale: configurabile in base alla scala della scena.

Creare anche golden tests:
- progetto breve con click track;
- progetto a BPM costante;
- progetto con BPM variabile;
- progetto con silenzio iniziale;
- progetto a 120 fps.

==================================================
27. SICUREZZA E ROBUSTEZZA
==================================================

- Validare tutti i percorsi.
- Non eseguire stringhe shell non controllate.
- Passare gli argomenti a FFmpeg come array.
- Gestire file con caratteri Unicode.
- Gestire spazi nei percorsi.
- Gestire file corrotti.
- Gestire audio molto lunghi.
- Mostrare errori comprensibili.
- Salvare log diagnostici.
- Non bloccare il thread UI.
- Usare worker o processi separati.
- Gestire chiusura dell’app durante export.
- Chiedere conferma quando esistono modifiche non salvate.

==================================================
28. PRESTAZIONI
==================================================

Ottimizzare:

- geometrie condivise;
- instancing;
- texture compresse;
- livelli di dettaglio;
- culling;
- aggiornamenti parziali;
- memoizzazione;
- waveform downsampled;
- rendering tile-based se la GPU non supporta target 4K;
- streaming dei frame a FFmpeg;
- limitazione delle particelle in preview.

Aggiungere un pannello diagnostico con:
- FPS;
- draw call;
- triangoli;
- memoria stimata;
- tempo CPU;
- tempo GPU;
- tempo di analisi;
- tempo medio per frame durante export.

==================================================
29. ACCESSIBILITÀ E USABILITÀ
==================================================

- tooltip;
- etichette chiare;
- conferme solo per azioni distruttive;
- scorciatoie documentate;
- navigazione da tastiera;
- contrasto adeguato;
- ridimensionamento UI;
- dark mode;
- pannello “Getting Started”;
- progetto demo incluso;
- preset pronti all’uso.

==================================================
30. SVILUPPO PER FASI
==================================================

Non provare a implementare tutto in un unico passaggio.

Procedi nelle fasi seguenti.

FASE 0 — Analisi e specifica
- creare architecture.md;
- descrivere pipeline;
- elencare rischi tecnici;
- definire schema del progetto;
- definire milestone;
- non scrivere ancora tutte le funzioni.

FASE 1 — Skeleton
- inizializzare Tauri, React e TypeScript;
- creare layout editor;
- creare gestione progetto;
- implementare salvataggio e caricamento;
- configurare test e lint.

FASE 2 — Audio import
- import MP3/WAV;
- FFprobe;
- waveform;
- player;
- timeline;
- play, pause, seek.

FASE 3 — Audio analyzer
- sidecar Python;
- onset;
- beat;
- energy;
- output JSON;
- cache;
- visualizzazione marker.

FASE 4 — Scena base
- Three.js;
- camera;
- luce;
- sfera;
- tamburi;
- sfondo;
- selezione;
- inspector.

FASE 5 — Timeline editor
- marker editabili;
- snapping;
- categorie;
- undo/redo;
- offset;
- loop.

FASE 6 — Trajectory planner
- archi balistici;
- collisioni programmate;
- solver;
- continuità;
- test deterministici.

FASE 7 — Auto generator
- scelta oggetti;
- posizionamento;
- prevenzione sovrapposizioni;
- camera automatica;
- seed.

FASE 8 — Preview sincronizzata
- audio master clock;
- seek;
- frame step;
- debug drift;
- modalità qualità.

FASE 9 — Export offline
- frame-by-frame;
- FFmpeg;
- audio mux;
- progress;
- cancel;
- preset.

FASE 10 — 4K e 120 fps
- streaming frame;
- memoria;
- hardware encoder;
- test di durata;
- warning prestazioni.

FASE 11 — Rifinitura
- materiali;
- particelle;
- motion blur;
- preset;
- import GLTF;
- documentazione.

Al termine di ogni fase:
- eseguire test;
- correggere gli errori;
- aggiornare la documentazione;
- presentare i file modificati;
- indicare i comandi per avviare il progetto;
- non passare alla fase successiva con test falliti.

Procedere automaticamente da una fase alla successiva quando i relativi test sono verdi,
senza attendere approvazione intermedia. Fermarsi solo davanti a un blocco tecnico reale,
a una decisione irreversibile o a un'azione che richieda esplicita autorizzazione.

==================================================
31. MVP
==================================================

L’MVP deve includere:

- import MP3 e WAV;
- waveform;
- beat e onset detection;
- marker editabili;
- formato 9:16 e 16:9;
- sfera personalizzabile;
- almeno tamburo, paletto, piattaforma, molla e piatto;
- sfondo colore o immagine;
- generazione automatica del percorso;
- collisioni programmate;
- preview a 540p o 720p 30 fps;
- export 1080p 30/60 fps;
- export 4K 30/60/120 fps;
- audio originale;
- salvataggio progetto;
- undo/redo;
- progress export;
- test di sincronizzazione.

Non implementare inizialmente:
- marketplace;
- cloud;
- login;
- collaborazione;
- sistemi a pagamento;
- mobile;
- plugin di terze parti.

==================================================
32. CRITERI DI ACCETTAZIONE
==================================================

Il progetto è accettabile solo se:

1. Un file MP3 o WAV può essere importato.
2. La waveform viene mostrata.
3. I beat rilevati sono visibili e modificabili.
4. L’utente può scegliere 9:16 o 16:9.
5. L’utente può modificare lo sfondo.
6. L’utente può usare colori singoli o palette multiple.
7. La sfera è personalizzabile.
8. Ogni oggetto è modificabile singolarmente.
9. La sfera colpisce gli oggetti sui marker programmati.
10. Il risultato è deterministico.
11. Preview ed export utilizzano la stessa traiettoria.
12. La preview può avere qualità inferiore rispetto all’export.
13. Si può esportare almeno fino a 4K 120 fps.
14. L’audio è incluso nel video.
15. Non esiste deriva temporale evidente.
16. Il progetto può essere salvato e riaperto.
17. Gli errori vengono mostrati senza crash.
18. Esistono test automatici della sincronizzazione.

==================================================
33. MODALITÀ DI RISPOSTA E LAVORO
==================================================

Prima di scrivere codice:

1. analizza la richiesta;
2. produci l’architettura proposta;
3. indica i punti critici;
4. indica eventuali dipendenze;
5. crea il piano delle cartelle;
6. crea una roadmap;
7. identifica cosa sarà implementato nell’MVP.

Successivamente procedi una fase alla volta, passando automaticamente alla successiva
quando il gate della fase corrente è soddisfatto.

Quando scrivi codice:

- fornisci file completi;
- evita placeholder inutili;
- evita pseudocodice quando è possibile implementare realmente;
- usa TypeScript strict;
- aggiungi tipi espliciti;
- aggiungi gestione errori;
- aggiungi test;
- aggiungi commenti solo quando chiariscono una scelta non ovvia;
- non inserire segreti;
- non usare percorsi assoluti;
- non supporre che FFmpeg o Python siano installati senza verificarlo;
- prepara la distribuzione dei sidecar;
- mantieni Windows, macOS e Linux in considerazione.

Inizia ora esclusivamente con la FASE 0.

Genera:

- docs/architecture.md;
- docs/synchronization.md;
- docs/trajectory-planning.md;
- docs/audio-analysis.md;
- docs/export.md;
- docs/roadmap.md;
- schema iniziale del progetto;
- struttura delle cartelle;
- lista delle decisioni tecniche;
- lista dei rischi;
- criteri di completamento della FASE 0.

Non iniziare ancora l’implementazione grafica finché la FASE 0 non è stata
revisionata e approvata.

==================================================
34. DIREZIONE ARTISTICA E COMPORTAMENTO AGGIORNATI
==================================================

Questi requisiti aggiornano e prevalgono sulle indicazioni iniziali incompatibili:

- il viaggio è prevalentemente orizzontale, con lunghe sequenze laterali e cambi di direzione; mantiene comunque una lieve quota discendente tra gli step;
- i tratti laterali hanno velocità percepita superiore alla discesa verticale;
- il percorso alterna soprattutto archi di rimbalzo da un oggetto al successivo e, con frequenza minore, scorrimenti fluidi sui binari;
- i binari esistono esclusivamente nei segmenti di scorrimento: non devono comparire durante un rimbalzo e non devono mai accompagnare una discesa verticale o un salto nel vuoto;
- nei segmenti di scorrimento la sfera deve appoggiarsi e rotolare sopra le guide: il centro della sfera segue una curva distinta e più alta rispetto alla geometria del binario, con distanza di contatto calcolata usando raggio della sfera, larghezza delle guide e spessore del supporto;
- le guide devono essere sottili, scure e flottanti come nel riferimento: iniziano dopo il rebound sullo strumento e terminano prima dello strumento seguente, restando leggermente sollevate affinché l’ultimo tratto sia una caduta libera sulla pelle;
- ogni contatto con uno strumento deve produrre almeno un piccolo rebound chiaramente visibile, compreso l’ultimo oggetto del percorso e i contatti che precedono scorrimenti o cadute profonde;
- nei segmenti a bassa energia devono comparire anche salti nel vuoto, senza binario, in cui la sfera cade fino allo step successivo;
- il percorso occupa realmente i tre assi: oltre ai cambi laterali e di quota deve alternare movimenti in avanti e indietro sull’asse Z, con parallasse della camera e contatti fisici allineati alla stessa profondità;
- durante una discesa verticale la sfera non deve attraversare né passare dietro agli strumenti: deve curvare sempre sul lato anteriore verso la camera, superando in profondità entrambi gli oggetti e tornando con precisione sul contatto successivo;
- tempo locale, energia, accenti e pause del brano devono costruire un percorso emozionale, rallentando naturalmente nei momenti più quieti;
- il percorso automatico usa per impostazione predefinita parti realistiche di batteria: grancassa, rullante, tom/tamburi e piatti;
- gli elementi della batteria devono essere professionali, con ferramenta, pelli, martellatura e una leggera usura fisica credibile;
- usura, graffi, patina, colpi sulle pelli e segni radiali sui piatti devono essere chiaramente leggibili in primo piano, variare deterministicamente per oggetto e influenzare anche la risposta PBR della superficie;
- grancassa, rullante e tom mantengono la tinta scelta dall’utente sopra una base metallica sporca; le pelli presentano una zona centrale più scura, consumata e segnata dalle bacchette;
- i piatti sono dorati/bronzo per impostazione predefinita, ma restano modificabili dall’utente;
- il colore degli elementi è modificabile sia per tipo sia per singolo oggetto;
- l’immagine interna alla sfera deve essere visibile per intero e mantenere le proprie proporzioni;
- quando esiste un’immagine interna, l’utente può attivare un finale cinematografico: rottura della sfera, dispersione dei frammenti, zoom e flip dell’immagine;
- nel finale l’immagine usa un adattamento equivalente a `contain`: un’immagine quadrata deve essere mostrata interamente anche in un video 9:16;
- preview ed export devono condividere le stesse scelte di rimbalzo, scorrimento, caduta e finale.
- la scena non deve essere affollata: soltanto una parte dei beat produce elementi fisici, la camera segue lateralmente la sfera e mostra pochi step per volta;
- la timeline supporta selezione multipla persistente con `Shift`, `Cmd` o `Ctrl` e cancellazione collettiva; il percorso residuo resta collegato dai binari;
- ogni beat privo di un elemento presenta un piccolo pulsante `+` per trasformarlo in un nuovo rimbalzo;
- l’immagine interna è un inserto opaco a doppia faccia collocato esattamente al centro della sfera, solidale alla sua rotazione, visibile attraverso il vetro e anche dal lato posteriore; il suo materiale non deve usare una seconda trasparenza annidata che ne impedisca la resa attraverso la trasmissione del vetro;
- l’immagine interna deve rimanere nitida e riconoscibile: usare mipmap e filtraggio anisotropico, una superficie interna più ampia e un vetro localmente meno opaco e meno ruvido quando l’immagine è presente;
- lo sfondo personale può essere una foto oppure un video locale compatibile con il browser; il video è silenzioso, in loop, sincronizzato al playhead ed è incluso frame per frame nell’export, mentre il primo fotogramma fornisce la palette automatica;
- ogni preset di risoluzione mostrato nella finestra di esportazione deve indicare sempre tra parentesi il rapporto `(9:16)` oppure `(16:9)`;
- il finale può essere programmato alla fine del brano oppure a un secondo/beat preciso;
- nella modalità di fine brano l’utente sceglie per quanti secondi l’immagine resta visibile dopo la conclusione della musica;
- la rottura deve usare frammenti di vetro irregolari, dissolvenza, flash ottico, oscuramento cinematografico, flip e zoom progressivi.
- l'esportazione web deve consegnare direttamente un video finale con audio, senza chiedere all'utente di gestire o assemblare una sequenza di frame;
- eventuali chunk o frame intermedi devono essere scritti esclusivamente in una cartella temporanea privata del progetto e rimossi automaticamente al termine, anche in caso di annullamento o errore;
- quando il browser espone il salvataggio diretto su file, i chunk dell’encoder devono essere trasmessi progressivamente alla destinazione scelta senza creare prima una copia completa nello storage privato; la cartella temporanea è soltanto un fallback e gli export incompleti vengono rimossi prima di iniziare.
- preview ed export devono usare lo stesso renderer WebGL, le stesse geometrie, gli stessi materiali PBR, la stessa camera e lo stesso stato della sfera: è vietata una ricostruzione Canvas 2D semplificata che alteri oggetti, fisica o rotazione;
- nello sfondo l'utente può attivare insegne neon collocate nello spazio 3D lungo il percorso, inserire più frasi separate per riga e sceglierne il colore;
- le frasi neon vengono alternate e ripetute durante il viaggio, restano dietro agli elementi fisici e devono comparire identiche nella preview e nel video finale.
- quando la sfera colpisce grancassa, rullante o tom, il fusto deve vibrare leggermente e la pelle deve mostrare una compressione breve e smorzata;
- quando la sfera colpisce un piatto, il corpo metallico deve oscillare e inclinarsi sul supporto come dopo una bacchettata, con un decadimento più lungo rispetto ai tamburi;
- le risposte agli impatti devono derivare dal timestamp e dall'intensità dell'evento, senza delta time accumulato, per risultare identiche in preview ed export;
- dall'elenco degli elementi nel pannello destro l'utente può selezionare un oggetto e sostituirne il tipo dalla scheda `Selezione`, mantenendo posizione, scala e tipo di collegamento nel percorso.
- l'esperienza corrente è una modalità di animazione selezionabile chiamata `Instrumental Falling`, mostrata in alto nel pannello sinistro;
- il pannello sinistro è dipendente dalla modalità attiva: mostra le famiglie utilizzabili per costruire la scena base, non una libreria generica degli oggetti già istanziati;
- in `Instrumental Falling` la base può includere grancassa, rullante, tom/tamburo, piatti, pianoforte, corde di chitarra e violino/archi; ogni famiglia selezionata deve comparire nella base quando il numero di step lo permette;
- gli oggetti effettivamente generati vengono elencati e modificati singolarmente nel pannello destro;
- la sostituzione del tipo dal menu dell'Inspector deve aggiornare immediatamente geometria e materiali nella scena esistente, senza rimontare la viewport o perdere il tempo di riproduzione;
- gli elementi fisici non devono apparire e scomparire bruscamente in base a una finestra discreta attorno allo step attivo: la loro presenza nella scena resta stabile e l'inquadratura è gestita dalla camera;
- le modalità di animazione sono definite tramite un registro dichiarativo che fornisce etichetta, descrizione, generatore, tipi disponibili e base predefinita; aggiungere una nuova modalità non deve richiedere di riscrivere il layout comune dell'editor.
- la sfera deve riflettere realmente l'illuminazione della scena, comprese le insegne neon collocate dietro di essa: usare una sonda ambientale dinamica attorno alla biglia, illuminazione fisica colorata e materiali HDR, mantenendo lo stesso risultato in preview ed export;
- entrambe le modalità devono offrire nella scheda `Scena` una luce PBR opzionale attivabile con checkbox; l'utente seleziona direttamente nella viewport due punti tridimensionali, origine e destinazione, e può rifinirne le coordinate X/Y/Z;
- la luce personalizzata deve essere una sorgente direzionale a cono reale che influenza tutti i materiali della scena e conserva nel progetto colore, intensità, portata, decadimento fisico, dispersione, penombra, ombre, visibilità e dimensione della sorgente, intensità dei riflessi sulla biglia, visibilità e densità del fascio volumetrico;
- il fascio deve essere realmente visibile fra origine e destinazione mediante un volume conico trasparente, morbido e a doppio strato, coerente con colore, apertura e penombra della `SpotLight`; non può essere sostituito da linee di debug o da un cono opaco;
- il volume luminoso deve includere scattering interno incrociato e una componente atmosferica molto tenue che ne impedisce la scomparsa completa dietro la densità della scena, senza disegnare una sagoma opaca sopra gli oggetti;
- quando l'analisi o la rigenerazione ricostruiscono il percorso, origine e destinazione della luce devono essere traslate dello stesso delta del riferimento iniziale della scena, conservandone inquadratura e posizione relativa;
- la sorgente fisica deve combinare il cono principale con un leggero spill locale; strumenti, ambiente e materiali della biglia devono mostrare chiaramente colore, illuminamento, speculare e ombre prodotti dalla luce anche dopo la generazione degli elementi;
- la luce deve offrire una modalità fissa e una modalità `Segui la biglia per tutto il percorso`: in inseguimento il vettore origine-destinazione resta invariato ma l'intero rig viene traslato per ogni fotogramma affinché la destinazione coincida con la posizione corrente della sfera;
- l'utente deve poter estendere il volume oltre la destinazione da `0,25×` a `12×`, mantenerlo attivo per tutto il video oppure definire secondo iniziale e finale; visibilità e trasformazione devono essere valutate dal tempo assoluto anche nell'export;
- la biglia deve ricevere sia lo speculare fisico della luce sia uno scintillio professionale derivato matematicamente dal vettore della sorgente, dalla normale della sfera e dalla posizione della camera; la sorgente visibile entra nella cubemap dinamica e ogni fotogramma di export aggiorna luce, riflesso e scintillio prima del rendering;
- l'export offre almeno i profili `Alta` e `Massima`, con `Massima` predefinito, bitrate proporzionale a risoluzione e frame rate fino a 160 Mbit/s, audio a 320 kbit/s e compositing con filtraggio di qualità elevata.
- il menu `Oggetto del rimbalzo` dell'evento musicale e il menu `Nuovo tipo` del singolo oggetto devono sostituire immediatamente la geometria nella scena, aggiornare superficie di contatto e traiettoria e salvare l'override sull'evento, senza richiedere una rigenerazione;
- una sostituzione locale conserva colore, ruvidezza, metallicità, scala e binario dell'elemento; la rigenerazione della base è non distruttiva e riapplica personalizzazioni per tipo e per istanza agli oggetti corrispondenti.
- aggiungere la modalità selezionabile `New York Streets`, con generatore, pannello e ambiente propri ma timeline, Inspector, clock, sfera principale ed export condivisi;
- in `New York Streets` l'utente sceglie da 1 a 13 sfere secondarie oltre alla principale: soltanto la principale può contenere l'immagine, mentre le secondarie hanno un colore collettivo e colori modificabili singolarmente;
- `New York Streets` è una vera gara di biglie, non uno sciame vincolato: ogni sfera ha tempo locale, velocità, corsia, sorpassi, rotazione, collisioni e rimbalzi autonomi ma deterministici; le sfere rispettano la separazione fisica e non possono compenetrarsi;
- la corsa avanza soprattutto in profondità lungo una strada riconoscibile e continua anche dietro al punto di partenza, senza vuoti davanti alla camera; l'inquadratura inseguitrice bassa è vincolata esclusivamente alla sfera principale, mentre le secondarie possono superarla o restare fuori campo;
- l'ambiente è una New York notturna fotorealistica: asfalto usurato e leggermente bagnato, segnaletica, marciapiedi, cordoli, tombini, lampioni che illuminano realmente fondo e vetro, e palazzi alti con mattoni, finestre, negozi, cornicioni e scale antincendio;
- l'asfalto non può essere una superficie cromatica piatta: deve mostrare aggregato, porosità, carreggiate, rattoppi, crepe ramificate e rilievo fisico mediante texture colore e bump ad alta definizione;
- le biglie devono rotolare velocemente per la maggior parte del tempo e compiere soltanto rimbalzi occasionali, bassi e legati agli accenti musicali: è vietato farle saltellare continuamente;
- durante il rotolamento il centro delle biglie deve essere vincolato alla quota reale dell'asfalto; nella modalità non devono essere generati sassolini o detriti stradali, e i rari sobbalzi bassi derivano dalle irregolarità dell'asfalto e dagli accenti musicali;
- ogni sfera secondaria seleziona autonomamente e in modo deterministico un sottoinsieme dei rimbalzi: è vietato riutilizzare la stessa parabola verticale per tutto il gruppo;
- circa a metà percorso la corsa arriva a un tombino realmente aperto nella geometria dell'asfalto: le biglie convergono sul foro, vi entrano e cadono verticalmente per almeno `8,2 m`, senza deriva laterale né impulso verso l'alto; solo dopo aver raggiunto il livello sotterraneo riprendono la corsa in profondità;
- la fognatura deve trovarsi interamente a un livello nettamente inferiore alla strada ed essere un tunnel continuo, completamente chiuso e voltato, rivestito internamente di mattoni umidi con malta, sporco e muschio; non deve apparire come un corridoio aperto e non deve contenere tubi metallici longitudinali, anelli o condotte decorative estranee;
- l'acqua delle fognature scorre in un canale laterale continuo delimitato da argini in muratura e usa un'animazione deterministica basata sul tempo assoluto, identica in preview ed export;
- le sfere secondarie si rompono progressivamente con animazione deterministica fino a lasciare soltanto la principale all'arrivo; posizione, rotazione e rottura usano tempo assoluto e coincidono fra preview ed export;
- l'utente può caricare fino a otto immagini che vengono rese come volantini usurati, leggermente spiegazzati e con piccoli strappi ma ancora ampi, visibili e leggibili; sulla strada devono essere appoggiati a pochi millimetri dalla superficie corretta, senza ombre che li facciano apparire sospesi, mentre nelle fognature aderiscono alla parete interna; ogni immagine persiste nel progetto;
- la sfera principale conserva anche in `New York Streets` il finale cinematografico esistente: rottura del vetro, uscita dell'immagine, zoom e flip con adattamento `contain`.
- i frammenti di ogni sfera rotta ricevono gravità, velocità iniziale differenziata, collisione col terreno, rimbalzi con restituzione decrescente, attrito e arresto; non possono orbitare attorno al punto di rottura né sparire prima di essersi riversati al suolo;
- la preview usa una risoluzione GPU ridotta e aggiorna meno spesso le riflessioni dinamiche, mentre l'export ripristina la risoluzione esatta e forza il rendering completo di ogni fotogramma secondo risoluzione, frame rate e qualità scelti dall'utente;
- la rotazione della sfera principale deve integrare la distanza percorsa attorno all'asse perpendicolare alla direzione di marcia, restare continua agli impatti e conservare il momento angolare durante i tratti in aria; è vietato ricavarla direttamente dalle coordinate assolute della posizione;
- l'export del canvas usa richiesta esplicita dei fotogrammi quando disponibile e verifica l'avanzamento con un contatore reale, evitando video congelati su un unico frame; il fallback temporizzato resta disponibile per i browser privi di `requestFrame`.
- aggiungere la modalità `Cover Sphere Visualizer`: l’immagine di copertina viene incorporata in una grande sfera di vetro centrale che ruota e pulsa sul contenuto audio, senza ostacoli o percorso;
- sotto la sfera deve essere presente uno spettrogramma professionale reale a 48 bande logaritmiche, alte e luminose, ricavato dall’FFT del brano e interpolato sul tempo assoluto affinché preview ed export coincidano;
- la rotazione della sfera deve derivare da una fase continua e non dalla moltiplicazione del tempo per l’energia istantanea; il brano può modulare pulsazione e luminosità senza introdurre scatti nell’orientamento;
- la copertina è una superficie interna leggermente curva, opaca, a doppia faccia e interamente contenuta nel volume della sfera; condivide esattamente trasformazione e rotazione del vetro;
- le bande non devono inseguire nervosamente ogni frame FFT: applicare sovrapposizione temporale, attacco morbido, rilascio più lungo e una lieve fusione tra frequenze adiacenti, sempre calcolati dal tempo assoluto;
- pioggia e foglie devono essere sistemi di elementi indipendenti: ogni goccia aggiorna i vertici della propria scia e ogni foglia possiede traiettoria, caduta, oscillazione e rotazione deterministiche; è vietato simulare l’effetto traslando un unico gruppo.
- aggiungere la quarta modalità selezionabile `Teddy Walk`, indipendente da `Instrumental Falling`, `New York Streets` e `Cover Sphere Visualizer`, con pannello, scena e controlli propri ma clock audio, sfondo ed export condivisi;
- `Teddy Walk` presenta un orsacchiotto tridimensionale vissuto e professionale, ispirato al riferimento: pelo tessile ruvido con un leggero strato di fibre geometriche visibili soprattutto sui bordi e sotto la luce, toppe sfrangiate, usura, cuciture, muso imbottito, un occhio a bottone e un occhio ricamato a X;
- l’orsacchiotto cammina lentamente a cadenza half-time su una strada PBR realistica ed è sempre inquadrato di mezzo profilo; braccia e gambe alternano il passo lungo la direzione di marcia, senza alcun salto o saltello, e ogni trasformazione deriva dal tempo assoluto per coincidere in preview ed export;
- la strada mostra grana, rugosità, avvallamenti, rappezzi e crepe dell’asfalto, cordoli e segnaletica consumata; il suo scorrimento continuo rende percepibile l’avanzamento senza spostare l’orsacchiotto fuori dall’inquadratura;
- sul petto è presente uno squarcio sfrangiato e cucito che contiene la cover caricata dall’utente; la cover resta nitida, incorporata nel personaggio e pulsa in scala e luminosità seguendo in modo morbido l’energia e i beat della musica;
- la palette estratta dalla cover determina automaticamente pelo, toppe, dettagli e tinta dell’asfalto, mantenendo ogni colore modificabile manualmente e persistente nel progetto;
- `Teddy Walk` offre controlli per intensità della camminata e pulsazione della cover. I vecchi progetti `Teddy Wheel` vengono migrati automaticamente, senza conservare ruota, scritte o saltelli.
- `Teddy Walk` offre inoltre il flag persistente `Balla mentre cammina`: quando attivo sovrappone alla camminata una coreografia semplice ma professionale, senza deriva laterale, che solleva entrambe le braccia, esegue periodicamente un giro completo su sé stesso con accelerazione e frenata morbide e introduce un piccolo salto atletico con raccolta delle gambe, salita e atterraggio. Tutte le fasi derivano dal clock BPM e vengono rinforzate dai beat reali; il salto è vietato quando il flag è spento.
- i movimenti di `Teddy Walk` devono usare le clip motion-capture Mixamo fornite nel progetto: `Walking` e `Start Walking` per la base, `Hip Hop Dancing` e `Silly Dancing` per la danza, `Joyful Jump` e `Jumping Up` per i salti. Il retargeting è geometrico: ricava le direzioni spalla-gomito-polso e anca-ginocchio-caviglia, le risolve sulle proporzioni dell’orsacchiotto con limiti articolari e margini anticollisione dal busto e mantiene continui i quaternion tra i campioni. Ignora la traslazione orizzontale originale degli FBX, limita quella verticale, precampiona a 60 Hz dal tempo assoluto e usa un passo base lento di quattro beat con coreografie estese e dissolvenze morbide.
- aggiungere la modalità indipendente `Teddy Sing`, che riutilizza lo stesso orsacchiotto tridimensionale; tutte le modalità Teddy condividono un pelo folto e morbido ottenuto con sottopelo fitto e fibre esterne corte e curve, senza ciuffi radi, lunghi o appuntiti, e con variazioni cromatiche appena percettibili. La superficie sottostante deve avere una texture PBR da peluche vissuto con trama tessile irregolare, scoloriture, sporco assorbito e abrasioni sottili;
- in `Teddy Sing` l’orso è seduto a terra e appoggiato alla parete di una stanza moderna PBR: deve risultare storto, afflosciato, asimmetrico e cedevole come un vero peluche, non eretto come un personaggio rigido. La ripresa è un primo piano dal basso verso l’alto; pavimento materico, pannelli decorativi, illuminazione LED e luci reali influenzano personaggio e ambiente;
- la cover caricata dall’utente diventa un poster fisico incorniciato sulla parete, sempre mostrato per intero con adattamento `contain`; la palette estratta imposta automaticamente pelo, toppe, stanza e LED, lasciando tutti i colori modificabili e persistenti;
- la stanza di `Teddy Sing` offre particelle atmosferiche persistenti e modificabili per abilitazione, colore e densità; il moto è lento, tridimensionale e lievemente audio-reattivo;
- il lip sync di `Teddy Sing` deve agire esclusivamente sulla geometria 3D del muso e controllare separatamente mandibola, cavità orale, labbro superiore, labbro inferiore, denti e lingua; è vietato animare o deformare una foto;
- il labiale usa intensità, transienti e zone formantiche della traccia analizzata per produrre visemi continui con anticipazione delle consonanti, attacco e rilascio morbidi e silenzio a bocca chiusa. L’interfaccia consiglia esplicitamente una traccia vocale isolata, pur supportando il mix completo, e offre controlli persistenti per espressività, sensibilità vocale e movimento della testa;
- l’analisi di `Teddy Sing` genera una corsia `Fonemi` nella timeline con intervalli viseme selezionabili. L’utente può dividere il fonema al playhead o nel punto del doppio clic ed eliminarlo con comando dedicato o tastiera; una parte eliminata produce bocca chiusa nell’intervallo e tutte le modifiche persistono nel progetto e governano sia preview sia export;
- labiale, testa, respirazione e LED derivano dal tempo audio assoluto, affinché preview ed export producano lo stesso fotogramma allo stesso istante.
- `Cover Sphere Visualizer` riutilizza lo sfondo foto/video comune e offre, davanti allo sfondo, fumo, particelle, vento con foglie, pioggia e volantini personalizzati attivabili separatamente;
- `New York Streets` non deve essere visibile né selezionabile nell’elenco delle modalità; schema, dati e renderer possono restare nel progetto esclusivamente per compatibilità con file precedenti;
- copertina e sfondo estraggono automaticamente la palette per sfera, spettrogramma ed effetti; colori e intensità restano modificabili manualmente e persistono nel progetto;
- quando una sfera contiene un’immagine, il guscio usa trasparenza e riflessione senza rifrazione screen-space: la luce personalizzata non può annerire né desaturare la copertina e deve aggiungere soltanto riflessi, scintillio e luminosità.
- il rendering globale usa color management professionale e non deve sovrapporre una patina opaca: fog, usura e vignettatura sono effetti localizzati e tenui, mentre colori, neri e speculari restano leggibili e saturi in preview ed export;
- la sfera usa vetro fisico luminoso con trasmissione mantenuta anche quando contiene una cover, riflessi HDR, doppio highlight e geometria ad alta risoluzione; una luce aggiuntiva non può trasformarla in nero;
- la cover non può apparire come un quadrato piatto sovrapposto alla sfera: deve essere una lente interna realmente convessa, arretrata rispetto al guscio, con spessore, retro fisico, angoli arrotondati, riflesso ottico e rotazione solidale; la tinta del vetro resta confinata a bordo e riflessi e non forma un velo opaco sopra l’immagine;
- tutte le modalità Teddy usano fibre corte tridimensionali arrotondate che reagiscono alle luci, sopra un sottopelo fitto e una superficie tessile usurata; sono vietati segmenti appuntiti simili a barba;
- durante l'export l'audio viene demuxato e codificato offline nel file senza avviare il player e senza essere inviato a cuffie o altoparlanti; preview ed export condividono gestione colore, vignettatura, finitura e stato temporale;
- i sottotitoli automatici sono una funzione globale disponibile in tutte le modalità: Whisper locale estrae parole e timestamp, il testo completo incollato dall'utente viene usato per l'allineamento e un piccolo LLM locale esegue controlli aggiuntivi senza download ripetuti;
- Whisper e il LLM quantizzati vengono salvati stabilmente nella cartella pubblica del progetto, caricati con accesso remoto disabilitato e inclusi nella build web;
- l'utente sceglie una lunghezza indicativa della frase, font, dimensione, colore, bagliore e velocità; la segmentazione non impone un limite rigido di parole e privilegia le pause vocali e la punteggiatura;
- ogni frase è un blocco autonomo nella timeline e può essere selezionata, trascinata, divisa, eliminata o modificata manualmente; i sottotitoli sono renderizzati dallo stesso WebGL usato dal video ed esportabili anche come SRT.
- in Cover Sphere la palette estratta dalla cover aggiorna automaticamente anche colore LED e bagliore dei sottotitoli; un flag persistente permette di interrompere il collegamento e conservare colori manuali;
- la UI dei sottotitoli espone i modelli Whisper locali Tiny, Base e Medium, mostrando dimensione, compromesso velocità/accuratezza e stato di installazione;
- la revisione LLM non può restare un passaggio nascosto: possiede pannello dedicato con attivazione, modello locale, da uno a dieci passaggi, comando manuale di correzione/verifica e stato per singolo blocco; usa il testo ufficiale come fonte autorevole e non modifica i timestamp;
- i sottotitoli offrono almeno cinque animazioni selezionabili (`LED in caduta`, dissolvenza cinematografica, Word Pop, Karaoke Glow e Slide Up) e almeno cinque font locali professionali;
- unificare l'importazione video e la gestione dei sottotitoli nella sola modalità `Pro Subtitles`, eliminando la precedente modalità duplicata `Add Subtitles`.
- la corsia sottotitoli resta sempre visibile e permette di inserire manualmente nuovi blocchi al playhead, con un pulsante dedicato o tramite doppio clic; ogni blocco viene immediatamente modificato nella timeline e nel pannello;
- la segmentazione professionale dei sottotitoli usa i timestamp a livello di parola come autorità: il numero di parole è soltanto indicativo, mentre pause, punteggiatura, durata massima, massimo due righe e velocità di lettura sono vincoli configurabili. Il testo ufficiale può correggere soltanto parole monotonicamente allineabili e non deve mai essere distribuito in proporzione su versi che Whisper non ha rilevato;
- la revisione locale è organizzata come una chat multi-agente persistente per la singola elaborazione: editor del testo, montatore del timing, controllo qualità e coordinatore leggono i messaggi precedenti e collaborano fino al numero di turni scelto, da uno a dieci. L’LLM non può inventare timestamp: ogni proposta passa da un validatore deterministico che controlla attacco, fine sull’ultima parola, sovrapposizioni, durata, righe e velocità di lettura;
- in `Cover Sphere Visualizer` un flag persistente collega automaticamente le 48 bande e gli effetti alla palette estratta dalla cover. La modifica manuale disattiva il collegamento; riattivandolo viene riapplicata in tempo reale l’ultima palette estratta;
- in `Teddy Sing` il labiale deve rilasciare morbidamente ciascun visema verso la posa neutra e deve chiudere sempre la bocca alla conclusione del fonema e del brano, sia in preview sia in export.
- aggiungere la modalità indipendente `Stereo Unfold`: la cover entra dall’alto come un foglio fortemente stropicciato, atterra con inerzia e si dispiega progressivamente, mantenendo pieghe, curvature dei bordi, normali, ombre e riflessi fisici residui. Durata dell’ingresso/apertura e quantità di pieghe residue devono essere persistenti e configurabili;
- dietro la cover di `Stereo Unfold` deve apparire un campo spettrale stereofonico professionale con almeno tre stili selezionabili (`Nastri luminosi`, `Prismi di frequenza`, `Aurora stereofonica`), profondità tridimensionale, intensità e bagliore regolabili;
- l’analisi audio di `Stereo Unfold` non può duplicare un segnale mono: deve conservare separatamente per i canali sinistro e destro 48 bande, RMS e una misura di ampiezza stereo. Geometria, profondità e illuminazione dei due lati devono reagire ai rispettivi dati L/R; soltanto i file realmente mono usano un fallback simmetrico;
- la palette estratta dalla cover di `Stereo Unfold` controlla automaticamente i due lati del campo stereo e i sottotitoli collegati. Un flag persistente permette colori manuali e, quando riattivato, ripristina l’ultima palette estratta. Preview ed export devono condividere la stessa simulazione deterministica basata sul tempo audio assoluto.
- gruppi completi di blocchi possono essere salvati in una libreria locale condivisa da tutte le modalità e da tutti i progetti. Ogni elemento della libreria conserva testo, timestamp e stile; può sostituire la traccia corrente, adattarsi alla durata di un nuovo video oppure essere inserito dal playhead. La libreria deve essere esportabile e importabile in JSON per l'uso su altre installazioni.
- aggiungere la modalità indipendente `Cube Animation`: l’immagine caricata deve essere mostrata per intero su tutte le sei facce di un unico cubo fotografico sospeso, racchiuso in un guscio di vetro PBR neutro con trasmissione ottica, clearcoat, Fresnel, riflessi ambientali e illuminazione dedicata. La palette dominante aggiorna automaticamente tre colori modificabili senza tingere o spegnere la cover;
- `Cube Animation` mantiene il cubo fermo al centro e lo fa ruotare nello spazio su assi combinati X/Y/Z in corrispondenza dei beat analizzati, con accelerazione e frenata smussate. Non devono esistere piano d’appoggio, percorso, traslazioni, rimbalzi, divisioni, copie o zoom ricorsivi. L’orientamento deve coincidere esattamente tra il primo frame e la durata finale per creare un loop senza salto;
- l’utente può caricare una fotografia di sfondo, adattata in modalità cover dietro il cubo, e regolarne l’oscuramento. In basso deve essere sempre presente uno spettrogramma professionale a 48 bande con indicatori di picco, intensità configurabile e risposta stereo. Increspature d’acqua concentriche devono propagarsi attraverso la scena sui beat con intensità regolabile e colori derivati dalla cover. Alone ottico, anelli orbitali, particelle profonde, increspature e light sweep devono essere attivabili singolarmente e rimanere elementi secondari rispetto al cubo. La cover sulle facce deve conservare luminosità e saturazione originali tramite un livello fotografico separato, non illuminato e non tonemappato; il vetro e i riflessi appartengono soltanto al guscio esterno;
- aggiungere nella famiglia `Sound Animation` la modalità visibile `Pixels Subtitles` (ID interno stabile `pixelsSub`): l’utente importa un brano e un’immagine; la cover deve rimanere sempre pulita, intera e leggermente rientrata rispetto al fotogramma, anche quando immagine e video sono entrambi 9:16. È vietato degradare, pixelare, scolorire o coprire la cover;
- attorno alla cover deve esistere un’area protetta che nessun elemento animato può invadere. I pixel vivono soltanto ai lati e nel perimetro esterno, ma devono arrivare sempre esattamente al bordo della cover senza fasce vuote. La dimensione predefinita delle celle è 27 px. La maggior parte delle celle è opaca, netta e quadrata; le scie sono soltanto un accento minoritario. Il campo usa sempre tutti e tre i colori reali della palette. Le frequenze modificano esclusivamente densità e distribuzione cromatica, mai altezza, larghezza o estensione della cornice. Gli eventi kick e snare prodotti dalla stessa analisi usata dalla fisica della sfera devono scambiare in modo deterministico coppie di pixel: gruppi più ampi e profondi sul kick, scambi più stretti e rapidi sullo snare, con interpolazione continua e risultato identico in preview ed export. Margine della cover, dimensione dei pixel, velocità, reattività e scie sono configurabili;
- i sottotitoli di `Pixels Subtitles` devono essere rasterizzati come vera tipografia pixel nitida sopra la cover, con auto-fit fino a tre righe, entrata e uscita fluide e senza contenitori opachi. Devono essere disponibili localmente almeno i font pixel Pixelify Sans, Press Start 2P, Silkscreen, VT323, Tiny5 e Jersey 10; non bisogna simulare un font pixel degradando un normale carattere vettoriale. L’utente sceglie font, uno dei tre colori reali della palette, posizione verticale, attivazione dell’ombra pixel, colore dell’ombra e distanza;
- i sottotitoli possono essere importati da SRT/WebVTT oppure creati tramite Whisper e consiglio LLM locale, conservando modifica, divisione, spostamento e cancellazione dei blocchi in timeline. Preview ed export devono usare la stessa funzione deterministica di rendering per mantenere identici immagine, pixel, timing e movimento;
- l’export di `Pixels Subtitles` non deve dipendere dalla riproduzione o dal rendering live della preview: deve produrre offline ogni frame alla risoluzione e al frame rate selezionati usando `frameIndex / fps` come clock, attendere esplicitamente la backpressure dell’encoder prima di continuare, transcodificare e muxare l’audio senza riprodurlo e verificare il contenitore finale. Se il numero dei pacchetti video non coincide con il numero atteso o manca la traccia audio, il file deve essere rifiutato; non è consentito ridurre volontariamente risoluzione o FPS sotto carico;
- l’intera interfaccia deve derivare da una palette unica nero, bianco e rosa: nella modalità Giorno il bianco è principale, nella modalità Notte il nero è principale. Pulsante e finestra dell’assistente AI, menu laterali, schede, campi e stati attivi non possono conservare viola, blu o verde hard-coded dei layout precedenti. Le palette iniziali a tre colori di `Pixels Subtitles` e `Pro Subtitles` sono `#000000`, `#ffffff`, `#ed75a7`, prima dell’eventuale estrazione automatica dalla cover;
- i menu laterali devono essere ridimensionabili indipendentemente tramite separatori trascinabili, accessibili anche da tastiera, con limiti sicuri, ripristino al doppio clic, persistenza locale e una larghezza minima garantita alla viewport centrale;
- la viewport possiede un comando sempre visibile per mostrare la sola animazione a tutto schermo e un comando per tornare all’editor; anche il tasto `Esc` deve uscire da questa modalità senza interrompere la preview;
- aggiungere l’area indipendente `Photo & Video Studio`, separata da `Sound Animation`, con controlli contestuali e nomi delle modalità in inglese. La prima modalità visibile è `Static Watermark Remover` (ID stabile `staticWatermark`) ed è destinata a video propri o autorizzati;
- aggiungere l’area `Music` con la modalità `AI Quantizer` (ID stabile `aiQuantizer`) come runtime completamente interno a MLSM Studio, senza dipendere da repository o cartelle sorelle. Backend, interfaccia e analisi devono essere versionati nel progetto e adattati alla palette e al brand MLSM Studio; ambiente Python, modelli e cache vanno creati/scaricati localmente al primo utilizzo e ignorati da Git. La pipeline deve conservare quantizzazione beat-by-beat pitch-preserving, warp map condivisa per master e stem, DAW Align, restauro, mastering e AI Forensics;
- `Static Watermark Remover` importa un video con watermark e la fotografia originale pulita della stessa inquadratura. L’utente seleziona la regione direttamente sulla preview oppure tramite coordinate percentuali e può regolare fit `cover/contain/stretch`, scala, offset X/Y, opacità della patch e correzione automatica di luminosità, la cui intensità predefinita è `5%`. La sfumatura parte sempre da `0 px`; quando viene aumentata da 1 a 24 px deve agire esclusivamente sulla fascia del video confinante fuori dalla selezione, mentre tutti i pixel interni alla regione trattata restano pienamente sostituiti e opachi. Un pulsante `Anteprima zona rimozione` apre a schermo intero la regione corretta al centro insieme a un’ampia porzione del video confinante, senza bordo di selezione, con sotto una copia live dei controlli di allineamento e fusione;
- preview ed export devono condividere lo stesso compositore. La guida della selezione non compare nel file. L’export opera offline sui frame originali, preserva risoluzione, ordine, timestamp, durata e VFR, lascia al browser la selezione del backend H.264 hardware/software, copia i pacchetti audio originali senza ricodificarli o riprodurli e riapre il contenitore finale. Se il numero di frame codificati non coincide esattamente col sorgente o una traccia audio presente viene persa, il file parziale deve essere rifiutato;
- aggiungere in `Photo & Video Studio` la modalità `Upscaler` (ID stabile `upscaler`) per immagini e video. Deve includere `RealESRGAN_x4plus`, `RealESRGAN_x2plus`, `RealESRNet_x4plus`, `RealESRGAN_x4plus_anime_6B`, `realesr-general-x4v3` e `realesr-animevideov3`, mostrando per ciascuno destinazione d’uso, pro, contro, scala e costo. I pesi non entrano nel repository e sono conservati nella cache locale dopo il primo utilizzo;
- Upscaler rileva CUDA/NVIDIA, Apple Silicon/Metal, WebGPU e CPU, seleziona automaticamente il backend migliore e permette l’override manuale. Espone tile e TTA, risoluzione finale libera con rapporto bloccabile e preset fino a 8K, confronto originale/migliorato, split e fusione alla stessa dimensione finale. Deve includere esposizione, contrasto, luci, ombre, bianchi, neri, saturazione, vividezza, temperatura, tinta, nitidezza e denoise. L’export immagine produce PNG alla dimensione scelta; quello video opera offline, copia l’audio e rifiuta qualsiasi risultato con frame mancanti;
- i preset Full HD, QHD, 4K e 8K dell’Upscaler sono limiti di contenimento e non dimensioni imposte: devono ruotarsi automaticamente per una sorgente verticale e mantenere sempre il rapporto originale, anche quando non è 16:9. La preview mostra inizialmente l’originale e dispone di un comando esplicito `Genera anteprima upscaling`, presente sia nei controlli sia sulla viewport; modello, tile, TTA o nuova sorgente invalidano il risultato precedente e richiedono una nuova generazione;
- `Canvas Enhanced` deve restare un profilo autonomo, immediato e senza download, chiaramente distinto dall’inferenza AI. Se viene scelto un modello neurale, `Genera anteprima upscaling` scarica il checkpoint soltanto quando non è già nella cache persistente e mostra fase, percentuale, MB scaricati e dimensione totale; i caricamenti successivi devono indicare che il modello proviene dalla cache. I checkpoint PyTorch ufficiali devono essere eseguibili anche dalla web app tramite un servizio Python locale su loopback, senza fallback Canvas simulati. L’ambiente deve essere isolato con `pyenv`, versione bloccata in `.python-version`, e `.venv` escluso da Git. Il servizio non parte automaticamente: setup e avvio sono comandi espliciti. Su Apple Silicon il backend automatico prioritario è PyTorch MPS/Metal, poi CUDA sulle macchine NVIDIA e infine CPU. Nella preview a tutto schermo deve rimanere sotto l’immagine una plancia con modello, confronto, separatore, fusione, contrasto, saturazione, nitidezza e rigenerazione;
- la pipeline Real-ESRGAN deve conservare la qualità dell'implementazione storica `Video Editor`: checkpoint RRDB completi a 23 blocchi per x4plus/x2plus/RealESRNet, input alla risoluzione originale, RGB/BGR coerente, tile con `10 px` di padding sovrapposto, FP16 quando supportato e TTA opzionale. È vietato ridurre l'intera sorgente a una miniatura prima dell'inferenza. Ogni tile viene ricomposto direttamente alla risoluzione finale, evitando seam e canvas intermedi x4 eccessivi. Download, inizializzazione e avanzamento tile devono restare visibili. Il risultato finale è ispezionabile con zoom 100–400%, originale, migliorato, separatore e fusione regolabile; la stessa inferenza a tile deve essere usata per foto e per ciascun frame del video offline;
- aggiungere nella famiglia `Sound Animation` la modalità visibile `From 9:16 to 16:9` (ID stabile `portraitLandscape`). Il video 9:16 importato resta intero e centrato in un canvas 16:9; una seconda immagine 9:16 riempie il lato scelto dall’utente e viene specchiata sul lato opposto. Cover e immagine laterale sono sorgenti indipendenti;
- la cover viene applicata al cubo fotografico in vetro. Il cubo percorre continuamente il canvas e rimbalza geometricamente sui quattro bordi; posizione e scala non ricevono vibrazioni o salti dagli impulsi musicali. La rotazione non si ferma: cambia direzione ogni 8 quarti, con cadenza configurabile, e a ogni contatto con una parete non già coincidente con il cue musicale. Velocità di rotazione e velocità del moto sui bordi sono indipendenti. Le 48 bande del visualizer vengono divise in due gruppi da 24 sui rispettivi lati e devono rimanere chiaramente visibili anche prima dell’analisi: il caricamento del video avvia automaticamente l’analisi audio, mentre un moto deterministico di sicurezza evita un layer vuoto sui codec non decodificabili. Le palette della cover e dell’immagine laterale sono estratte e conservate separatamente; l’utente sceglie una delle due oppure tre colori manuali per le barre. L’altezza deve conservare il livello assoluto del brano e non può essere normalizzata rispetto al picco di ciascun frame, altrimenti si perde la dinamica musicale. A opacità `100%` il corpo delle barre deve essere realmente opaco; glow e riflessi sono passaggi separati. Pioggia e fulmini devono conservare core, contrasto e glow leggibili anche nella preview ridotta. Le particelle hanno nucleo opaco al 100% e glow colorato intermittente da lucciola. Pioggia, fulmini, piume e particelle si attivano e regolano nel pannello laterale, inclusi colore e opacità; la profondità non usa menu astratti ma una pila di tracce riordinabili nella timeline, condivisa dal compositore di preview ed export. Tutti i livelli, inclusi immagini laterali, cubo, video centrale e spettro, sono sbloccati e riordinabili tramite trascinamento o frecce. La timeline ha altezza regolabile con maniglia superiore, persiste la scelta e mostra sempre lo scrollbar verticale destro; il resize ricontiene la preview interamente nello spazio superiore. Più effetti attivi vengono sovrapposti nello stesso frame secondo l’ordine della pila. L’immagine laterale dispone di un editor modale non distruttivo per luminosità, esposizione, contrasto, saturazione, temperatura e sfocatura;
- l’export di `From 9:16 to 16:9` deve essere offline e deterministico: decodifica il video sorgente ai timestamp `frameIndex / FPS`, ricompone video, lati, cubo, spettro ed effetti, attende la backpressure H.264, converte e muxa l’audio senza riprodurlo e riapre il file per verificare `ceil(durata × FPS)` pacchetti video. Offre Full HD, QHD/2K, 4K, 5K e 8K fino a 120 fps; per una sorgente 1080 × 1920 raccomanda 3840 × 2160.
- la preview di `From 9:16 to 16:9` usa un profilo leggero a 30 fps con risoluzione interna, texture WebGL, antialiasing, densità degli effetti, glow e blur ridotti. La cornice 16:9 viene calcolata usando contemporaneamente larghezza e altezza effettivamente disponibili nel workspace, così la timeline non può coprirne la parte inferiore. Timing audio, posizione, ordine dei livelli e risposta delle bande restano identici. L’export non riutilizza i frame della preview: ricostruisce ogni frame con il profilo completo alla risoluzione e agli fps scelti;
- l’area indipendente `Video Editor` usa un montaggio multitraccia non distruttivo: tutti i livelli visivi sono semanticamente equivalenti, riordinabili e compatibili con trasformazioni, opacità, modalità di fusione, correzione colore ed effetti. Non esistono ruoli speciali `video principale` o `overlay`; l’ordine verticale della timeline determina esclusivamente il compositing;
- il player del `Video Editor` deve presentare esattamente e contemporaneamente tutti i video e le immagini attivi al playhead, dal livello inferiore al superiore. Import, cancellazione, riordino, gap, seek e tagli consecutivi aggiornano lo stack nello stesso frame senza lasciare in vista un media rimosso o precedente. Gli intervalli delle clip sono sempre `[inizio, fine)`, così al punto di taglio non possono comparire due clip dello stesso livello;
- la libreria del `Video Editor` è organizzata per categorie e comprende almeno transizioni, movimento, colore, distorsione e luce. Deve includere almeno `Fade In`, `Fade Out`, `Push In`, `Pull Back`, `Slide Up`, `Slide Right`, `Camera Shake`, `Film Flicker`, `Modern Noir`, `RGB Split`, `Digital Glitch`, `Dream Bloom`, `Light Leak` e `Cinematic Vignette`; ogni effetto possiede anteprima, parametri reali, durata e intensità, può comparire più volte sulla stessa clip ed è inseribile, spostabile e ridimensionabile come blocco in timeline. Le istanze temporalmente sovrapposte vengono distribuite in sottocorsie deterministiche affinché restino tutte selezionabili e modificabili;
- preview ed export del `Video Editor` condividono la stessa risoluzione temporale degli effetti e delle regolazioni. L’export è sempre offline e deterministico: decodifica le sorgenti al timestamp di ciascun frame, compone tutti i livelli, attende la backpressure dell’encoder, muxa l’audio senza riprodurlo e verifica il file finale; non può catturare la riproduzione live né perdere fotogrammi sotto carico;
