# Dynamic Sound Animation Studio — Architettura

## Scopo della Fase 0

Questo documento definisce i confini del sistema prima dell'implementazione. La priorità è la sincronizzazione deterministica: la timeline musicale è la sorgente di verità, l'audio è il clock della preview e l'indice del frame è il clock dell'export.

## Architettura proposta

Il repository è un monorepo npm con workspace TypeScript e un sidecar Python. Le dipendenze puntano verso il dominio, mai dalla logica di dominio verso UI, Tauri o Three.js.

```text
React editor ───────┐
Three.js adapter ───┼──> application services ──> domain packages
Tauri commands ─────┘             │
                                  ├──> Python audio analyzer
                                  └──> FFmpeg/FFprobe export
```

### Processi e responsabilità

- **Webview React**: editor, timeline, viewport, stato della sessione e preview. Non accede direttamente al filesystem.
- **Core Tauri/Rust**: dialoghi e accesso file, process lifecycle, hash, scrittura atomica, sidecar, export e cancellazione. Tutti gli argomenti ai processi sono array, mai shell interpolate.
- **Audio analyzer Python**: decodifica/analisi fuori dal thread UI e protocollo JSON versionato su stdin/stdout.
- **FFmpeg/FFprobe**: probing, decodifica temporanea, encoding e mux. La disponibilità e gli encoder sono rilevati a runtime.
- **Package di dominio TypeScript**: schema, eventi, timeline, traiettoria e clock sono puri e testabili in Node.

## Moduli

| Modulo | Responsabilità | Non deve conoscere |
|---|---|---|
| `core` | casi d'uso e contratti applicativi | React, Three.js |
| `audio-types` | input/output analyzer e tipi musicali | processi Python |
| `timeline` | editing, snapping, selezione, command history | renderer |
| `trajectory` | planning ed evaluation deterministica | Three.js |
| `physics` | collisioni decorative e primitive matematiche | timeline UI |
| `scene` | modello scena e generazione seeded | WebGL |
| `renderer` | porte di rendering preview/offscreen | filesystem |
| `export` | frame schedule, job e progress | componenti React |
| `project-schema` | schema, migrazioni, validazione | servizi OS |
| `ui` | componenti accessibili condivisi | sidecar |
| `shared` | utility senza dipendenze di dominio | framework UI |

## Modalità di animazione estendibili

L'editor separa il layout comune dalla logica specifica della modalità. Il registro dichiarativo `apps/desktop/src/services/animation-modes.ts` è la sorgente delle opzioni mostrate a sinistra e dei tipi disponibili nell'Inspector. Ogni definizione contiene identificativo persistente, etichetta, descrizione, generatore, famiglie ammesse e selezione predefinita.

Il progetto salva `animation.modeId` e `animation.baseObjectTypes`. Il pannello sinistro legge la definizione attiva e consente di preparare la base; il generatore riceve solo i tipi abilitati; il pannello destro elenca invece le istanze effettive e consente modifiche locali. Per aggiungere una nuova animazione si registra una nuova definizione e il relativo generatore, senza duplicare toolbar, viewport, timeline o Inspector.

`Instrumental Falling` espone grancassa, rullante, tom/tamburo, piatti, pianoforte, corde di chitarra e violino/archi. La rigenerazione garantisce una prima distribuzione normalizzata delle famiglie selezionate; dopo questa base, i riconoscimenti musicali guidano gli elementi successivi. La sostituzione di un tipo aggiorna in-place il gruppo Three.js, mentre la presenza degli oggetti non dipende da una finestra discreta sullo step attivo, evitando comparsa e scomparsa improvvise.

`New York Streets` usa lo stesso contratto con `generator: newYorkStreets` e `panel: newYorkStreets`. La configurazione persistita comprende numero e colori delle sfere e immagini dei volantini. Strada, tombino, tunnel, tubazioni, gara autonoma e rotture sono costruiti nel renderer condiviso; il loro stato deriva dal tempo assoluto e compare identico nel canvas acquisito dall'export.

## Flussi principali

### Import e analisi

1. Tauri valida il file scelto, calcola SHA-256 e interroga FFprobe.
2. L'analyzer crea al massimo un WAV temporaneo normalizzato per la singola analisi.
3. Il risultato JSON è validato al confine e salvato in cache con chiave composta da hash audio, versione analyzer e hash parametri.
4. Gli eventi entrano nella timeline; modifiche manuali sono conservate separatamente dai risultati automatici.

### Generazione e preview

1. Il generatore seeded associa eventi abilitati a oggetti e punti di contatto.
2. Il planner costruisce segmenti che raggiungono esattamente ogni impatto.
3. Un evaluator puro produce lo stato a un tempo assoluto.
4. In preview il tempo assoluto proviene dall'audio clock; i frame in ritardo vengono saltati.

### Export

1. Il job congela uno snapshot immutabile del progetto.
2. Per il frame `N`, valuta sempre `N / fps` e renderizza offscreen.
3. I frame vengono inviati progressivamente a FFmpeg; non sono accumulati in RAM.
4. L'audio originale viene muxato e il risultato è verificato con FFprobe.

## Persistenza e affidabilità

- File progetto JSON versionato, validato prima dell'uso e migrato in memoria in sequenza.
- Salvataggio atomico: file temporaneo nella stessa directory, flush e rename.
- Autosave separato dal file esplicito, con recovery contenente revisione e timestamp.
- Path degli asset relativi alla directory progetto quando copiati; path esterni esplicitamente marcati.
- Undo/redo basato su comandi serializzabili; l'import audio e l'export sono job, non comandi undoable.
- Lo snapshot di export impedisce che modifiche UI cambino un render in corso.

## Portabilità e dipendenze

Dipendenze previste, da fissare nelle rispettive fasi:

- Node LTS, npm workspaces, TypeScript strict, Vite, React, Zustand e Zod.
- Tauri 2 con plugin dialog/filesystem strettamente autorizzati.
- Three.js con adapter renderer; nessun tipo Three.js nei modelli persistiti.
- Rust stable.
- Python 3.12, librosa, NumPy, SciPy e soundfile in ambiente sidecar riproducibile.
- FFmpeg/FFprobe distribuiti quando la licenza del pacchetto lo consente, altrimenti rilevati con diagnostica guidata.
- Vitest per unit/integration TypeScript e pytest per analyzer.

## Struttura delle cartelle

```text
apps/desktop/{src,src-tauri}
packages/{core,audio-types,timeline,trajectory,physics,scene,renderer,export,project-schema,ui,shared}
packages/project-schema/schema/project.schema.json
sidecars/audio-analyzer/{src,tests,pyproject.toml}
tests/{unit,integration,golden,sync}
docs/{architecture,audio-analysis,synchronization,trajectory-planning,export,roadmap,project-format}.md
```

Le cartelle applicative sono create nella Fase 0; i manifest e il codice arrivano nella Fase 1 per non introdurre uno skeleton non ancora approvato.

## Decisioni tecniche (ADR sintetiche)

1. **Timeline-first**: gli impatti programmati prevalgono sulla fisica libera.
2. **Tempo assoluto**: secondi `number` più sample index intero; nessuna integrazione incrementale per il master state.
3. **Evaluator puro condiviso**: preview ed export usano la stessa funzione e gli stessi dati.
4. **Fisica ibrida**: planner proprietario per la sfera, motore opzionale solo per decorazioni.
5. **Coordinate serializzabili**: semplici triple numeriche, convertite ai tipi Three.js nell'adapter.
6. **Random deterministico**: PRNG esplicito e seed derivati per sottosistemi; vietato `Math.random()` nel contenuto renderizzato.
7. **Frame streaming**: pipe raw o PNG temporanei con backpressure, mai intero video in memoria.
8. **Contratti versionati**: progetto, cache analyzer e messaggi job hanno versioni indipendenti.
9. **Editing non distruttivo**: dati automatici e override manuali restano distinguibili.
10. **Renderer sostituibile**: porta applicativa WebGL2 oggi, possibile adapter WebGPU futuro.

## Rischi principali e mitigazioni

| Rischio | Impatto | Mitigazione / prova anticipata |
|---|---|---|
| Beat/onset inaccurati | alto | confidence, editing, offset, golden click-track |
| Codec/licenze multipiattaforma | alto | matrice build e capability detection prima della Fase 9 |
| Lettura pixel 4K120 lenta | alto | benchmark pipe/offscreen e backpressure nella Fase 9 |
| Precisione Web Audio seek | alto | clock assoluto, calibrazione e test drift di 10 minuti |
| Archi non plausibili tra eventi densi | alto | vincoli, oggetti assistivi e diagnostica per segmento |
| Divergenza preview/export | alto | un solo evaluator e test agli stessi timestamp |
| Sidecar Python voluminoso | medio-alto | ambiente bloccato, build per piattaforma, smoke test CI |
| GPU/WebGL context limit | medio | capability check, tile rendering e preset sicuri |
| File lunghi/cache grandi | medio | analisi a chunk, waveform ridotta e cancellazione cooperativa |
| Modifica progetto durante export | medio | snapshot immutabile e job id |

## Confini dell'MVP

L'MVP comprende import MP3/WAV, analisi beat/onset, waveform e marker editabili; formati 9:16 e 16:9; scena Three.js con sfera e cinque oggetti; generazione seeded e archi programmati; preview audio-master; salvataggio/undo; export offline 1080p e 4K fino a 120 fps con audio, progress e cancellazione. Marketplace, cloud, login, collaborazione, mobile, HDR, EXR e plugin terzi restano fuori.

## Criteri di completamento Fase 0

- Documenti richiesti presenti e coerenti fra loro.
- Schema JSON Draft 2020-12 valido, con `schemaVersion: 1` e invarianti documentate.
- Clock di preview/export, rounding dei campioni e policy dell'ultimo frame definiti senza ambiguità.
- Algoritmo balistico, assistenza e tolleranze descritti.
- Protocollo analyzer, cache e correzione latenza definiti.
- Pipeline FFmpeg, cancellazione, cleanup e verifica A/V definite.
- Roadmap con gate testabili, dipendenze e limiti MVP.
- Nessuna implementazione grafica o runtime avviata prima della revisione.
