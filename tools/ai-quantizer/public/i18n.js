/* global document, window, MutationObserver, URLSearchParams, CustomEvent */
(function initializeAiQuantizerI18n() {
  'use strict';

  const english = Object.freeze({
    'Music · AI Quantizer': 'Music · AI Quantizer',
    '＋ Nuovo progetto': '＋ New project',
    'I tuoi progetti': 'Your projects',
    'Verifica…': 'Checking…',
    'Il tuo brano.': 'Your track.',
    'Finalmente a tempo.': 'Finally on beat.',
    'Stabilizza le variazioni di BPM, conserva il pitch e applica la stessa precisione a ogni stem.': 'Stabilize BPM variations, preserve pitch and apply the same precision to every stem.',
    'Crea il primo progetto': 'Create your first project',
    'PROGETTO': 'PROJECT',
    'Salvato': 'Saved',
    'Elimina progetto': 'Delete project',
    'Flusso di lavorazione': 'Processing workflow',
    'Importa': 'Import',
    'Master e stem': 'Master and stems',
    'Tempo e warp': 'Tempo and warp',
    'Allinea': 'Align',
    'Griglia DAW': 'DAW grid',
    'Restauro': 'Restoration',
    'Facoltativo': 'Optional',
    'Master': 'Master',
    'Esporta': 'Export',
    'File e verifica': 'Files and verification',
    'PASSAGGIO 1 DI 6': 'STEP 1 OF 6',
    'Importa le tracce': 'Import your tracks',
    'Parti dal mix completo; aggiungi gli stem che dovranno seguire la stessa mappa temporale.': 'Start with the full mix, then add the stems that should follow the same time map.',
    'TRACCE DEL PROGETTO': 'PROJECT TRACKS',
    'La stessa warp map verrà applicata a ogni traccia senza rianalizzarla.': 'The same warp map will be applied to every track without analyzing it again.',
    'Continua · Quantizza ↗': 'Continue · Quantize ↗',
    'PASSAGGIO 2 DI 6': 'STEP 2 OF 6',
    'Stabilizza il tempo': 'Stabilize the tempo',
    'Analizza il master, rifinisci i marker e crea una sola warp map per tutte le tracce.': 'Analyze the master, refine the markers and create one warp map for every track.',
    'Warp ritmico attivo': 'Rhythmic warp enabled',
    'Vista della mappa temporale': 'Time-map view',
    'Prima · originale': 'Before · original',
    'Dopo · quantizzato': 'After · quantized',
    'Mappa originale: i colori indicano le correzioni di tempo.': 'Original map: colors show the timing corrections.',
    'Mappa originale: i colori indicano le correzioni di tempo. Click per modificare i beat.': 'Original map: colors show the timing corrections. Click to edit beats.',
    'Mappa applicata al risultato: beat e waveform rimappati sulla timeline finale. Premi Play per ascoltare.': 'Map applied to the result: beats and waveform are remapped to the final timeline. Press Play to listen.',
    '← Importa': '← Import',
    'Salta quantizzazione': 'Skip quantization',
    'Continua · Allinea ↗': 'Continue · Align ↗',
    'PASSAGGIO 3 DI 6': 'STEP 3 OF 6',
    'Allinea alla sessione DAW': 'Align to the DAW session',
    'Porta il primo downbeat utile su una battuta intera, poi applica nuovamente il render.': 'Move the first useful downbeat to a full bar, then render the tracks again.',
    'Applica spostamento DAW': 'Apply DAW offset',
    'Applica allineamento': 'Apply alignment',
    'Applicazione allineamento': 'Applying alignment',
    'Sposto i WAV già quantizzati sulla griglia DAW. La quantizzazione non viene ripetuta.': 'Moving the already quantized WAV files onto the DAW grid. Quantization is not repeated.',
    'Allineamento applicato senza ripetere la quantizzazione': 'Alignment applied without repeating quantization',
    'Allineamento rimosso': 'Alignment removed',
    '← Quantizza': '← Quantize',
    'Salta allineamento': 'Skip alignment',
    'Continua · Restauro ↗': 'Continue · Restoration ↗',
    'PASSAGGIO 4 DI 6 · FACOLTATIVO': 'STEP 4 OF 6 · OPTIONAL',
    'Usa il restauro solo se la sorgente presenta artefatti, clipping o banda limitata.': 'Use restoration only when the source has artifacts, clipping or limited bandwidth.',
    'Includi restauro': 'Include restoration',
    '← Allinea': '← Align',
    'Salta restauro': 'Skip restoration',
    'Continua · Master ↗': 'Continue · Master ↗',
    'PASSAGGIO 5 DI 6 · FACOLTATIVO': 'STEP 5 OF 6 · OPTIONAL',
    'Prepara il master finale': 'Prepare the final master',
    'Misura prima del render, applica gain e limiter, quindi verifica il risultato.': 'Measure before rendering, apply gain and limiting, then verify the result.',
    'Includi mastering': 'Include mastering',
    '← Restauro': '← Restoration',
    'Salta mastering': 'Skip mastering',
    'Continua · Esporta ↗': 'Continue · Export ↗',
    'PASSAGGIO 6 DI 6': 'STEP 6 OF 6',
    'Verifica ed esporta': 'Verify and export',
    'Scarica le tracce pronte. Se serve, rigenera tutto con le impostazioni correnti.': 'Download the completed tracks. If needed, render everything again with the current settings.',
    'STEM & EXPORT': 'STEMS & EXPORT',
    'Consegna del progetto': 'Project delivery',
    'Lo ZIP raccoglie master e stem quantizzati nello stesso archivio.': 'The ZIP collects the quantized master and stems in one archive.',
    'Scarica i WAV singolarmente oppure crea uno ZIP; le versioni restaurata e masterizzata vengono incluse quando disponibili.': 'Download WAV files individually or create a ZIP; restored and mastered versions are included when available.',
    'Rigenera master + stem': 'Render master + stems again',
    'Rivedi quantizzazione': 'Review quantization',
    'STRUMENTO FACOLTATIVO · AI MUSIC FORENSICS': 'OPTIONAL TOOL · AI MUSIC FORENSICS',
    'Controlla l’impronta generativa': 'Check the generative fingerprint',
    'Confronta la probabilità stimata sul file originale, quantizzato/allineato, restaurato e master finale. Non è necessaria per esportare.': 'Compare the estimated probability for the original, quantized/aligned, restored and final master files. This is not required for export.',
    'Abilita verifica AI': 'Enable AI check',
    'Avvia l’analisi solo se ti serve un controllo forense aggiuntivo.': 'Run the analysis only when you need an additional forensic check.',
    '← Master': '← Master',
    'Preparazione archivio…': 'Preparing archive…',
    'Quantizza': 'Quantize',
    'TRACCIA DI RIFERIMENTO': 'REFERENCE TRACK',
    'Trascina il mix completo o scegli un file audio.': 'Drop the full mix here or choose an audio file.',
    'Scegli audio': 'Choose audio',
    'BPM rilevato': 'Detected BPM',
    'BPM obiettivo': 'Target BPM',
    'Interpretazione ritmica': 'Rhythmic interpretation',
    'Tempo normale': 'Normal time',
    'Half-time · BPM dimezzato': 'Half-time · half BPM',
    'Non cambia la velocità di riproduzione.': 'Does not change playback speed.',
    'Il BPM obiettivo è sempre un numero intero.': 'Target BPM is always a whole number.',
    'Mappa precedente: esegui Analisi Smart per aggiornarla prima di quantizzare.': 'Previous map: run Smart Analysis to update it before quantizing.',
    'Il brano non è quantizzabile automaticamente: pulsazione troppo incerta. Puoi saltare la quantizzazione.': 'This song cannot be quantized automatically: the pulse is too uncertain. You can skip quantization.',
    'Confidenza analisi': 'Analysis confidence',
    'Correzione max': 'Maximum correction',
    'Timeline ritmica': 'Rhythm timeline',
    'Beat originale': 'Original beat',
    'Griglia target': 'Target grid',
    'Correzione forte': 'Strong correction',
    'CONTROLLO QUALITÀ · TIME WARP': 'QUALITY CHECK · TIME WARP',
    'Correzione oltre il limite consigliato': 'Correction above the recommended limit',
    'La mappa temporale richiede una deformazione locale intensa. Prima di procedere, valuta il rischio di artefatti udibili.': 'The time map requires intense local warping. Before continuing, consider the risk of audible artifacts.',
    'Dettagli della correzione': 'Correction details',
    'Correzione rilevata': 'Detected correction',
    'Soglia consigliata': 'Recommended threshold',
    'La correzione può alterare transienti, batteria e materiale percussivo. Tornando alla mappa puoi modificare BPM o marker prima del render.': 'The correction may affect transients, drums and percussive material. Return to the map to adjust the BPM or markers before rendering.',
    'Torna alla mappa': 'Return to the map',
    'Procedi comunque': 'Continue anyway',
    'Chiudi avviso': 'Close warning',
    'Oltre soglia': 'Above threshold',
    'Marker = ogni beat quantizzato · Click: aggiungi beat · Alt/⌥ + click: rimuovi il beat più vicino': 'Marker = each quantized beat · Click: add beat · Alt/⌥ + click: remove the nearest beat',
    'Modalità': 'Mode',
    'Tempo fisso · quantizzazione beat-by-beat': 'Fixed tempo · beat-by-beat quantization',
    'Analisi Smart': 'Smart analysis',
    'Quantizza master + stem': 'Quantize master + stems',
    'ASCOLTO A/B': 'A/B LISTENING',
    'Originale': 'Original',
    'Risultato': 'Result',
    'Continua · DAW Align ↗': 'Continue · DAW Align ↗',
    'Allinea il brano alle battute': 'Align the track to bars',
    'Prima quantizza il tempo, poi porta il primo downbeat forte sulla battuta DAW più adatta.': 'First quantize the tempo, then move the first strong downbeat to the most suitable DAW bar.',
    'Abilita': 'Enable',
    'Downbeat di riferimento': 'Reference downbeat',
    'Spostamento': 'Offset',
    'Battuta DAW': 'DAW bar',
    'Direzione': 'Direction',
    'Auto · più vicina': 'Auto · nearest',
    'Indietro': 'Backward',
    'Avanti': 'Forward',
    'secondi': 'seconds',
    "Abilita l'opzione per visualizzare lo spostamento.": 'Enable this option to preview the offset.',
    'Continua · Restoration ↗': 'Continue · Restoration ↗',
    'Recupero qualità e dettaglio': 'Restore quality and detail',
    'Riduce artefatti di compressione e ricostruisce armoniche plausibili prima del mastering.': 'Reduces compression artifacts and reconstructs plausible harmonics before mastering.',
    'Crea versione restaurata': 'Create restored version',
    'Riduzione conservativa della texture MP3': 'Conservative reduction of MP3 texture',
    'Ripara picchi appiattiti e distorsione impulsiva': 'Repairs flattened peaks and impulsive distortion',
    'Genera armoniche alte plausibili': 'Generates plausible high harmonics',
    'Intensità': 'Intensity',
    'Prima': 'Before',
    'Dopo': 'After',
    "L'estensione di banda crea contenuto armonico plausibile: non recupera le frequenze originali eliminate da un codec lossy.": 'Bandwidth extension creates plausible harmonic content; it cannot recover original frequencies removed by a lossy codec.',
    'Continua · Mastering ↗': 'Continue · Mastering ↗',
    'Controllo finale Spotify': 'Final Spotify check',
    'Misura il risultato allineato, applica gain e limiter ISP-aware, quindi verifica nuovamente il master.': 'Measures the aligned result, applies gain and an ISP-aware limiter, then checks the master again.',
    'Misura LUFS / True Peak': 'Measure LUFS / True Peak',
    'PRIMA DEL MASTERING': 'BEFORE MASTERING',
    'Non misurato': 'Not measured',
    'MASTER FINALE': 'FINAL MASTER',
    'Non renderizzato': 'Not rendered',
    'Crea master finale': 'Create final master',
    'Spotify Normal: target −14 LUFS · massimo consigliato −1 dBTP. Se il master supera −14 LUFS, consigliato −2 dBTP.': 'Spotify Normal: −14 LUFS target · recommended maximum −1 dBTP. If the master exceeds −14 LUFS, −2 dBTP is recommended.',
    'Continua · AI Forensics ↗': 'Continue · AI Forensics ↗',
    'Impronta generativa per ogni passaggio': 'Generative fingerprint for every stage',
    'Confronta la probabilità stimata sul file originale, quantizzato/allineato e master finale.': 'Compare the estimated probability for the original, quantized/aligned and final master files.',
    'Analizza tutti i passaggi': 'Analyze every stage',
    'Il valore è la probabilità del classificatore, non la percentuale di audio “creata dall’AI” e non costituisce prova legale. Time-stretch e mastering possono alterare l’impronta.': 'This value is the classifier probability, not the percentage of audio “created by AI”, and is not legal evidence. Time stretching and mastering can alter the fingerprint.',
    'Tracce allineate': 'Aligned tracks',
    'La warp map del master viene riutilizzata senza rianalizzare.': 'The master warp map is reused without analyzing it again.',
    '＋ Aggiungi stem': '＋ Add stems',
    'Riapplica a master + stem': 'Reapply to master + stems',
    'Elaborazione audio': 'Audio processing',
    'Questa operazione può richiedere qualche minuto.': 'This operation may take a few minutes.',
    'Salvataggio dei passaggi': 'Saving workflow steps',
    'Salvataggio delle impostazioni…': 'Saving settings…',
    'Preparazione ZIP': 'Preparing ZIP',
    'Raccolgo master e stem e preparo l’archivio. Attendi: il download partirà automaticamente.': 'Collecting the master and stems and preparing the archive. Please wait: the download will start automatically.',
    'Creazione archivio…': 'Creating archive…',
    'Impossibile preparare lo ZIP. Riprova.': 'Could not prepare the ZIP. Try again.',
    'Download ZIP': 'ZIP download',
    'Archivio pronto. Trasferimento del file in corso…': 'Archive ready. File transfer in progress…',
    'Download incompleto. Riprova.': 'Incomplete download. Try again.',
    'L’archivio ZIP è vuoto. Riprova.': 'The ZIP archive is empty. Try again.',
    'ZIP pronto. Download avviato.': 'ZIP ready. Download started.',
    'Importa e analizza una traccia master prima di continuare.': 'Import and analyze a master track before continuing.',
    'Quantizza tutte le tracce con le impostazioni correnti prima di continuare.': 'Quantize every track with the current settings before continuing.',
    'Applica l’allineamento oppure scegli esplicitamente di saltarlo.': 'Apply alignment or explicitly choose to skip it.',
    'Crea la versione restaurata oppure scegli “Salta restauro”.': 'Create the restored version or choose “Skip restoration”.',
    'Crea il master finale oppure scegli “Salta mastering”.': 'Create the final master or choose “Skip mastering”.',
    'Completa il passaggio corrente prima di continuare.': 'Complete the current step before continuing.',
    'Cestino': 'Delete',
    'Nome del progetto': 'Project name',
    'Nuovo brano': 'New track',
    'NUOVO PROGETTO · MUSIC': 'NEW PROJECT · MUSIC',
    'GESTIONE PROGETTO · MUSIC': 'PROJECT MANAGEMENT · MUSIC',
    'Crea un nuovo progetto': 'Create a new project',
    'Eliminare questo progetto?': 'Delete this project?',
    'Assegna un nome al brano. Potrai importare master e stem nel passaggio successivo.': 'Name the track. You can import the master and stems in the next step.',
    'Il progetto verrà eliminato definitivamente:': 'The project will be permanently deleted:',
    'Crea progetto': 'Create project',
    'Annulla': 'Cancel',
    'Chiudi finestra': 'Close dialog',
    'Inserisci un nome per continuare.': 'Enter a name to continue.',
    'Progetto eliminato': 'Project deleted',
    'Caricamento audio': 'Uploading audio',
    'Il file viene verificato e aggiunto al progetto.': 'The file is checked and added to the project.',
    'Quantizzazione degli stem': 'Stem quantization',
    'Applico agli stem la stessa identica timeline del master.': 'Applying the exact same master timeline to all stems.',
    'Master caricato': 'Master uploaded',
    'Stem aggiunti e quantizzati': 'Stems added and quantized',
    'Stem aggiunti': 'Stems added',
    'Analisi della traccia': 'Track analysis',
    'Decodifico la waveform e individuo la pulsazione.': 'Decoding the waveform and identifying the pulse.',
    'Analisi ritmica neurale': 'Neural rhythm analysis',
    'Rilevo beat, downbeat, battute e stabilità della tempo map.': 'Detecting beats, downbeats, bars and tempo-map stability.',
    'Disattivato': 'Disabled',
    'Analizza prima il brano': 'Analyze the track first',
    'Quantizzazione di master e stem': 'Master and stem quantization',
    'Applico a tutte le tracce una sola timeline, conservando il pitch.': 'Applying a single timeline to every track while preserving pitch.',
    'Quantizzazione annullata': 'Quantization cancelled',
    'Master e stem quantizzati sulla stessa timeline': 'Master and stems quantized on the same timeline',
    'nessuna normalizzazione': 'no normalization',
    '✓ Conforme': '✓ Compliant',
    '⚠ True Peak oltre consiglio': '⚠ True Peak above recommendation',
    'Quantizza prima il master': 'Quantize the master first',
    'Misurazione loudness': 'Loudness measurement',
    'Analizzo LUFS integrati e True Peak secondo ITU-R BS.1770.': 'Measuring integrated LUFS and True Peak according to ITU-R BS.1770.',
    'Misurazione completata': 'Measurement complete',
    'Applico gain, oversampling 4×, limiter e rimisuro il risultato.': 'Applying gain, 4× oversampling and limiting, then measuring the result again.',
    'Master finale completato': 'Final master complete',
    'Quantizzato + DAW': 'Quantized + DAW',
    'Restaurato': 'Restored',
    'Master finale': 'Final master',
    'Non analizzato': 'Not analyzed',
    'Passaggio non creato': 'Stage not created',
    'Esegui analisi': 'Run analysis',
    'Crea prima il restauro': 'Create the restored version first',
    'Completa prima il passaggio': 'Complete this stage first',
    'Analizzo separatamente ogni file disponibile nella pipeline.': 'Analyzing every available pipeline file separately.',
    'Analisi AI completata': 'AI analysis complete',
    'Pulisco gli artefatti ed elaboro la versione ad alta definizione.': 'Cleaning artifacts and processing the high-definition version.',
    'Restauro completato': 'Restoration complete',
    'Crea prima la versione restaurata': 'Create the restored version first',
    'QUANTIZZATA': 'QUANTIZED',
    'ORIGINALE': 'ORIGINAL',
    'Scarica WAV': 'Download WAV',
    'Scarica master e stem in un unico archivio ZIP': 'Download master and stems in a single ZIP archive',
    'Completa prima la quantizzazione di tutte le tracce': 'Complete quantization for every track first',
    'Genera prima il risultato': 'Generate the result first',
    'Non ci sono altri moduli attivi': 'There are no other active modules',
    'Pronto · R3 quality': 'Ready · R3 quality',
    'Tool mancanti': 'Missing tools',
    'AI probabile': 'AI likely',
    'AI non rilevata': 'No AI detected',
    'Identificatore non valido': 'Invalid identifier',
    'Richiesta troppo grande': 'Request too large',
    'Misurazione loudness non disponibile': 'Loudness measurement unavailable',
    'Il file non contiene audio leggibile': 'The file contains no readable audio',
    'File oltre il limite di 1 GB': 'File exceeds the 1 GB limit',
    'Beat map insufficiente': 'Insufficient beat map',
    'Durata timeline master non valida': 'Invalid master timeline duration',
    'La beat map non è valida alla risoluzione di 48 kHz': 'The beat map is invalid at 48 kHz resolution',
    'Il progetto non contiene tracce': 'The project contains no tracks',
    'Servono almeno due beat': 'At least two beats are required',
    'La beat map deve essere strettamente crescente': 'The beat map must be strictly increasing',
    'Il brano non è quantizzabile automaticamente': 'This song cannot be quantized automatically',
    'Carica prima una traccia master': 'Upload a master track first',
    'Pulsazione non sufficientemente affidabile per la quantizzazione automatica': 'The detected pulse is not reliable enough for automatic quantization',
    'Analizza e salva prima la beat map': 'Analyze and save the beat map first',
    'Nessuna traccia selezionata': 'No track selected',
    'Quantizza e allinea prima il master': 'Quantize and align the master first',
    'Il modulo Mastering è disattivato': 'The Mastering module is disabled',
    'Il modulo Restoration è attivo: crea prima la versione restaurata': 'The Restoration module is enabled: create the restored version first',
    'Il modulo Audio Restoration è disattivato': 'The Audio Restoration module is disabled',
    'Il modulo AI Forensics è disattivato': 'The AI Forensics module is disabled',
    'Impostazioni dei passaggi non valide': 'Invalid workflow settings',
    'Traccia master non disponibile': 'Master track unavailable',
    'Traccia non trovata': 'Track not found',
    'Audio non disponibile': 'Audio unavailable',
    'Endpoint non trovato': 'Endpoint not found',
    'Accesso negato': 'Access denied',
    'Errore interno': 'Internal error'
  });

  const patterns = Object.freeze([
    [/^Pulsazione utilizzabile: (\d+)%\. Le zone senza riferimenti seguono solo il cambio BPM globale, senza correzioni locali\.$/, (_match, percent) => `Usable pulse: ${percent}%. Untracked regions follow only the global BPM change, without local corrections.`],
    [/^Errore (\d+)$/, (_match, code) => `Error ${code}`],
    [/^Eliminare definitivamente “(.+)”\?$/, (_match, name) => `Permanently delete “${name}”?`],
    [/^Preview non disponibile: (.+)$/, (_match, error) => `Preview unavailable: ${translate(error)}`],
    [/^Analisi completata · confidenza (.+)$/, (_match, confidence) => `Analysis complete · confidence ${confidence}`],
    [/^Auto-allineamento avanti, aggiungendo spazio\. Fade-in di (.+) s applicato dopo la traslazione\.$/, (_match, seconds) => `Auto-alignment forward, adding space. ${seconds} s fade-in applied after the offset.`],
    [/^Auto-allineamento indietro, tagliando l’anticipo\. Fade-in di (.+) s applicato dopo la traslazione\.$/, (_match, seconds) => `Auto-alignment backward, trimming the lead-in. ${seconds} s fade-in applied after the offset.`],
    [/^Auto-allineamento già allineato\. Fade-in di (.+) s applicato dopo la traslazione\.$/, (_match, seconds) => `Already aligned. ${seconds} s fade-in applied after the offset.`],
    [/^Abilita l’opzione per ordinare il risultato quantizzato sulla griglia DAW\.$/, () => 'Enable this option to place the quantized result on the DAW grid.'],
    [/^(.+)\. La correzione può produrre artefatti udibili\. Procedere comunque\?$/, (_match, warning) => `${translate(warning)}. The correction may produce audible artifacts. Continue anyway?`],
    [/^CONFERMA_WARP: correzione locale fino al (.+), oltre il limite consigliato$/, (_match, amount) => `CONFIRM_WARP: local correction up to ${amount}, above the recommended limit`],
    [/^correzione locale fino al (.+), oltre il limite consigliato$/, (_match, amount) => `Local correction up to ${amount}, above the recommended limit`],
    [/^(.+) dB in riproduzione$/, (_match, amount) => `${amount} dB during playback`],
    [/^(✓ Conforme|⚠ True Peak oltre consiglio) · Spotify: (.+)$/, (_match, status, action) => `${translate(status)} · Spotify: ${translate(action)}`],
    [/^Confidenza (.+)$/, (_match, confidence) => `Confidence ${confidence}`],
    [/^Quantizza prima tutte le tracce \((\d+) ancora da elaborare\)$/, (_match, count) => `Quantize all tracks first (${count} still pending)`],
    [/^Stem non aggiunto: (.+)$/, (_match, error) => `Stem not added: ${translate(error)}`]
  ]);

  let language = new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'it';
  const sourceText = new WeakMap();
  const renderedText = new WeakMap();
  const sourceAttributes = new WeakMap();
  const renderedAttributes = new WeakMap();

  function translate(value) {
    if (language !== 'en' || typeof value !== 'string') return value;
    const exact = english[value];
    if (exact) return exact;
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(value)) return value.replace(pattern, replacement);
    }
    return value;
  }

  function translatedWithWhitespace(value) {
    const trimmed = value.trim();
    if (!trimmed) return value;
    const start = value.indexOf(trimmed);
    return `${value.slice(0, start)}${translate(trimmed)}${value.slice(start + trimmed.length)}`;
  }

  function translateTextNode(node, externalMutation = false) {
    const current = node.nodeValue || '';
    if (externalMutation && current !== renderedText.get(node)) sourceText.set(node, current);
    if (!sourceText.has(node)) sourceText.set(node, current);
    const next = language === 'en' ? translatedWithWhitespace(sourceText.get(node) || '') : sourceText.get(node) || '';
    renderedText.set(node, next);
    if (current !== next) node.nodeValue = next;
  }

  function translateAttribute(element, attribute, externalMutation = false) {
    const current = element.getAttribute(attribute) || '';
    let sources = sourceAttributes.get(element);
    let rendered = renderedAttributes.get(element);
    if (!sources) { sources = new Map(); sourceAttributes.set(element, sources); }
    if (!rendered) { rendered = new Map(); renderedAttributes.set(element, rendered); }
    if (externalMutation && current !== rendered.get(attribute)) sources.set(attribute, current);
    if (!sources.has(attribute)) sources.set(attribute, current);
    const next = language === 'en' ? translate(sources.get(attribute) || '') : sources.get(attribute) || '';
    rendered.set(attribute, next);
    if (current !== next) element.setAttribute(attribute, next);
  }

  function translateTree(root) {
    if (root.nodeType === window.Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== window.Node.ELEMENT_NODE && root.nodeType !== window.Node.DOCUMENT_NODE) return;
    if (root.nodeType === window.Node.ELEMENT_NODE) {
      for (const attribute of ['title', 'placeholder', 'aria-label']) {
        if (root.hasAttribute(attribute)) translateAttribute(root, attribute);
      }
    }
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT | window.NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === window.Node.TEXT_NODE) translateTextNode(node);
      else for (const attribute of ['title', 'placeholder', 'aria-label']) {
        if (node.hasAttribute(attribute)) translateAttribute(node, attribute);
      }
      node = walker.nextNode();
    }
  }

  function setLanguage(nextLanguage) {
    language = nextLanguage === 'en' ? 'en' : 'it';
    document.documentElement.lang = language;
    translateTree(document.body);
    window.dispatchEvent(new CustomEvent('aiq-languagechange', { detail: { language } }));
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateTextNode(mutation.target, true);
      else if (mutation.type === 'attributes') translateAttribute(mutation.target, mutation.attributeName, true);
      else mutation.addedNodes.forEach((node) => translateTree(node));
    }
  });

  window.AIQ_I18N = Object.freeze({
    getLanguage: () => language,
    setLanguage,
    translate: (value) => translate(value)
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'mlsm-language') setLanguage(event.data.language);
    if (event.data.type === 'mlsm-theme') document.documentElement.dataset.theme = event.data.theme === 'night' ? 'night' : 'day';
  });
  translateTree(document.body);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
}());
