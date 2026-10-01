import { DiscordLink } from "./DiscordLink";
import { SettingsButton } from "./StudioSettings";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { analyzeMlsmPostLipsync, type MlsmPostLipsyncPipelineProgress, type MlsmPostLipsyncPipelineStage } from "../services/mlsm-post-lipsync-pipeline";
import { fitLipsyncPreview, lipsyncPreviewClockAdjustment, lipsyncPreviewStartTime, type LipsyncPreviewSize } from "../services/mlsm-post-lipsync-preview";
import { createManualLipsyncAnchor, editLipsyncAnchor, lipsyncTargetToSource, shiftLipsyncAnchors } from "../services/mlsm-post-lipsync-time-map";
import { editLipsyncTimelineAnchors, lipsyncMasterWaveformBars, selectLipsyncTimelineWords, type LipsyncTimelineEditMode } from "../services/mlsm-post-lipsync-timeline";
import { replaceMlsmPostLipsyncAnchors } from "../services/mlsm-post-lipsync-analysis";
import type { ImportedAudio } from "../services/audio-import";
import { importAudio, importVideoFile, releaseImportedAudio } from "../services/audio-import";
import type { MlsmPostLipsyncAnalysis, WordAnchor } from "../services/mlsm-post-lipsync-types";
import { requestMediaPlayback } from "../services/media-playback";
import { mlsmPostLipsyncCache } from "../services/mlsm-post-lipsync-cache";
import { exportMlsmPostLipsyncVideo } from "../services/mlsm-post-lipsync-exporter";
import { whisperModelOptions, type TimestampedWord, type WhisperModelId } from "../services/subtitle-generation";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { SupportArtistButton } from "./ArtistSupport";
import { MemoryButton } from "./MemoryStudio";
import { MlsmPerformancePromptModal } from "./MlsmPerformancePromptModal";
import { MlsmAudioTrimModal } from "./MlsmAudioTrimModal";
import { MlsmWhisperWordEditor } from "./MlsmWhisperWordEditor";
import { applyMlsmWhisperWordCorrection } from "../services/mlsm-post-lipsync-transcript-editor";

interface SourceVideo { path: string; name: string; url: string; durationSeconds: number; revokeUrl: boolean; contentHash?: string; sourceAudio?: ImportedAudio }
interface SubtitleInput { name: string; text: string; origin: "file" | "paste" }
type PreviewMode = "post" | "original";
type AnchorEditorTab = "detail" | "waveform" | "whisper";
interface TimelinePointerEdit { pointerId: number; startClientX: number; trackWidth: number; mode: LipsyncTimelineEditMode; canonicalIndexes: number[]; initialAnalysis: MlsmPostLipsyncAnalysis; clickedIndex: number; moved: boolean }
interface LipsyncReviewMenu { canonicalIndex: number; x: number; y: number }

const stageOrder: readonly MlsmPostLipsyncPipelineStage[] = [
  "extract-source-audio", "cache", "separate-source-vocal", "separate-target-vocal", "overlay-waveforms",
  "transcribe-source", "transcribe-target", "llm-correct", "align", "micro-align", "visual-align"
];

const copy = {
  it: {
    subtitle: "Riallineamento labiale professionale", ready: "Pronto per l’analisi", analyzing: "Analisi in corso", complete: "Analisi completata", home: "Home",
    setup: "Materiale sorgente", setupHint: "Video cantato e master sono obbligatori. Il testo temporizzato è opzionale: senza SRT/VTT l’allineamento usa esclusivamente le parole e i tempi misurati da Whisper.",
    sourceVideo: "Video cantato sorgente", targetAudio: "Master audio definitivo", timedLyrics: "Testo SRT o VTT · opzionale", selectVideo: "Seleziona video", selectAudio: "Seleziona audio", selectSubtitles: "Carica file SRT / VTT", pasteSubtitles: "Oppure incolla qui il contenuto", pastedSubtitles: "Testo incollato", subtitlePlaceholder: "1\n00:00:00,000 --> 00:00:02,720\nThe fallen\n\n2\n00:00:04,340 --> 00:00:07,360\nStill loves me", clear: "Svuota",
    missing: "Non selezionato", language: "Lingua cantata", model: "Precisione Whisper", analyze: "Analizza e crea time-map", cancel: "Annulla analisi", reset: "Nuova sessione", masterTrim: "Porzione del master da analizzare", masterTrimHint: "Ascolta il master e scegli visivamente la frase: viene analizzata soltanto questa porzione. Il file originale resta intatto.", trimStart: "Inizio taglio", trimEnd: "Fine taglio", openTrim: "Ascolta e modifica il taglio", selectedTrim: "Selezione corrente", vocalSeparation: "Separa la voce · Demucs", vocalSeparationHint: "Opzionale e disattivata di default. Whisper Medium analizza direttamente l’audio originale; attiva Demucs soltanto quando strumenti o rumore coprono davvero il cantato.", deepAnalysis: "Analisi fonema per fonema", deepAnalysisHint: "Modalità approfondita: due passaggi Whisper, attacchi bidirezionali e time-map lettera/fonema. Più lenta ma più precisa sugli inizi delle frasi.", llmCorrection: "Correzione sequenza con LLM locale", llmCorrectionHint: "Attiva di default: Qwen confronta le parole del video con il master e recupera gli inizi o le chiusure saltati da Whisper. Può scegliere solo parole già misurate nel master; MFCC/DTW resta responsabile dei tempi.", exactLyrics: "Parole esatte pronunciate", exactLyricsHint: "Scrivi soltanto le parole cantate in questa clip. Il testo diventa il riferimento vincolante dell’LLM; identità e tempi vengono comunque verificati sul master.", exactLyricsPlaceholder: "The Fallen, still loves me", llmExactLyricsUsed: "Testo vincolante", llmRecovered: "Parole recuperate", llmNoChange: "Nessuna omissione confermata", exactConstraint: "Sequenza esatta applicata; tempi verificati da Whisper e MFCC/DTW", llmUnavailable: "LLM locale non disponibile",
    preview: "Anteprima sincronizzazione", original: "Originale", post: "Post Lipsync", play: "Riproduci", pause: "Pausa", stop: "Stop", noPreview: "Carica video e master per preparare l’anteprima; il testo è opzionale.", analyzePreview: "Avvia l’analisi per vedere il video riallineato sul master.",
    progress: "Pipeline reale", anchors: "Anchor vocali", source: "Sorgente", target: "Target", correction: "Correzione", confidence: "Affidabilità", state: "Stato", locked: "Bloccato", auto: "Auto", manual: "Manuale", editable: "Modificabile",
    report: "Controllo qualità", matched: "Parole allineate", unresolved: "Da verificare", average: "Correzione media", critical: "Segmenti critici", monotonic: "Time-map monotona", masterSegment: "Porzione riconosciuta nel master", yes: "Sì", no: "No", download: "Scarica report JSON",
    speedMap: "Mappa retiming", safe: "Sicuro", moderate: "Moderato", criticalBand: "Critico", interpolation: "interpolazione", subtitlePreview: "Testo allineato", alignmentMode: "Base allineamento", whisperOnly: "Solo Whisper", subtitleGuided: "Whisper + SRT/VTT",
    guide: {
      title: "Come funziona · ogni passo dell’analisi",
      intro: "MLSM POST LIPSYNC non ritocca il video a occhio: misura dove cade ogni parola nel master, dove cade nel video generato e costruisce una time-map monotona che riscala il video su quei punti. Ogni passo qui sotto viene eseguito in locale, nell’ordine mostrato.",
      steps: {
        "extract-source-audio": "FFmpeg locale estrae la traccia audio del video cantato in un WAV PCM temporaneo. Il file video non viene mai riscritto.",
        cache: "Impronta SHA-256 di video, master, testo, modello Whisper e di ogni parametro di allineamento. Se la stessa richiesta è già stata analizzata il risultato viene riusato, altrimenti parte un’analisi nuova.",
        "separate-source-vocal": "Per impostazione predefinita Whisper Medium legge l’audio originale del video. Se attivi Demucs, questo passaggio genera invece una stem vocale isolata.",
        "separate-target-vocal": "Il master usa la stessa scelta; il taglio viene sempre applicato prima della trascrizione, con o senza Demucs.",
        "overlay-waveforms": "Disponibile quando Demucs è attivo: le due stem vengono sovrapposte con cross-correlazione normalizzata. Quando Demucs è spento questo passaggio non modifica i timestamp Whisper originali.",
        "transcribe-source": "Whisper trascrive la voce del video con timestamp parola per parola (o per fonema in modalità approfondita). Decodifica deterministica: nessun campionamento, nessuna temperatura.",
        "transcribe-target": "Stessa trascrizione sulla voce del master: è il riferimento delle parole realmente cantate.",
        "llm-correct": "Qwen2.5 in locale confronta le due liste e indica quali parole Whisper ha perso all’inizio o alla fine della frase. Può scegliere soltanto tra parole già misurate nel master, non inventa testo e non scrive nessun timestamp: la posizione delle parole recuperate deriva dal rapporto misurato al passo delle onde sovrapposte.",
        align: "Le parole canoniche (SRT/VTT quando presente, altrimenti Whisper) vengono agganciate alla trascrizione con confronto di sottosequenza e somiglianza: nascono gli anchor, l’elenco delle parole da verificare e la time-map monotona.",
        "micro-align": "Disponibile con Demucs: MFCC + delta-MFCC e DTW rifiniscono le stem isolate. Con la separazione spenta la time-map conserva direttamente i timestamp Whisper originali.",
        "visual-align": "Opzionale: Auto-AVSR legge la bocca frame per frame e i visemi vengono fusi con il timing audio solo quando sono affidabili e non rompono la monotonia. Se non è disponibile resta il timing audio."
      },
      notes: [
        "Nessun passo riscrive i file originali: video e master vengono soltanto letti.",
        "Se la sovrapposizione delle onde non è affidabile MLSM lo dichiara e torna al comportamento precedente, invece di fingere una misura.",
        "Il video viene ricostruito sulla linea del tempo del master: la durata finale coincide con la porzione selezionata.",
        "L’export è bloccato se meno del 70% delle parole è allineato o se la time-map non è monotona."
      ]
    },
    editHint: "Ogni parola è modificabile. Nella colonna Correzione, − ritarda il video e + lo anticipa di 10 ms; apri i dettagli per regolare inizio, centro e fine. Tasto destro su una parola incerta per riesaminarla.", error: "Analisi non riuscita", freshAnalysis: "Gli stessi file e parametri ripristinano sempre lo stesso risultato automatico. Svuota la cache per forzare un calcolo completamente nuovo.", clearCache: "Svuota cache LIP SYNC", cacheCleared: "Cache analisi LIP SYNC svuotata", unresolvedWord: "Da verificare", unsafeExport: "Export bloccato: devono essere allineate almeno il 70% delle parole e la time-map deve essere monotona.", reviewWrong: "Segnala errato e approfondisci", reviewWrongHint: "Rianalizza questa parola con vincolo fonetico e finestra DTW mirata", boundaries: "Dettagli temporali", sourceStart: "Inizio sorgente", sourceCenter: "Centro sorgente", sourceEnd: "Fine sorgente", targetStart: "Inizio master", targetCenter: "Centro master", targetEnd: "Fine master", createManual: "Crea anchor manuale", nudgeEarlier: "Anticipa video", nudgeLater: "Ritarda video", detailTab: "Dettaglio parole", waveformTab: "Timeline grafica", whisperTab: "Timestamp Whisper", waveformHint: "La corsia superiore conserva il risultato automatico. Nella corsia inferiore trascina le parole, usa le maniglie laterali per accorciarle o allungarle e Shift/Cmd/Ctrl per selezioni multiple.", selectedWords: "Parole selezionate", moveSelection: "Sposta la selezione", automaticLane: "Risultato automatico", editableLane: "Video editabile", dragWord: "Trascina per spostare · maniglie per ridimensionare", expandPreview: "Espandi anteprima", collapsePreview: "Riduci anteprima", promptTool: "Generatore prompt video", promptToolHint: "Funzione indipendente · usa soltanto SRT/VTT e LLM locale", openPromptTool: "Apri generatore prompt", exportVideo: "Esporta MP4", cancelExport: "Annulla export", exportPreparing: "Preparazione export con time-map corrente…", exportDone: "Export completato", phoneticPoints: "punti fonetici", visualSpeech: "Analisi visiva del labiale · Auto-AVSR", visualSpeechHint: "Disattivata di default: se la abiliti, legge la bocca frame per frame e fonde i visemi con Whisper/MFCC soltanto quando sono affidabili e monotoni.", visualApplied: "Timing migliorato con i visemi", visualNoChange: "Nessun visema abbastanza affidabile: timing audio mantenuto", visualUnavailable: "Auto-AVSR non disponibile: timing audio mantenuto", faceCoverage: "copertura volto"
  },
  en: {
    subtitle: "Professional lip-sync realignment", ready: "Ready to analyze", analyzing: "Analysis running", complete: "Analysis complete", home: "Home",
    setup: "Source material", setupHint: "The sung video and final master are required. Timed lyrics are optional: without SRT/VTT, alignment relies exclusively on words and timings measured by Whisper.",
    sourceVideo: "Sung source video", targetAudio: "Final audio master", timedLyrics: "SRT or VTT lyrics · optional", selectVideo: "Select video", selectAudio: "Select audio", selectSubtitles: "Load SRT / VTT file", pasteSubtitles: "Or paste the content here", pastedSubtitles: "Pasted text", subtitlePlaceholder: "1\n00:00:00,000 --> 00:00:02,720\nThe fallen\n\n2\n00:00:04,340 --> 00:00:07,360\nStill loves me", clear: "Clear",
    missing: "Not selected", language: "Sung language", model: "Whisper accuracy", analyze: "Analyze and build time-map", cancel: "Cancel analysis", reset: "New session", masterTrim: "Master excerpt to analyze", masterTrimHint: "Listen to the master and select the phrase visually: only this excerpt is analysed. The original file remains untouched.", trimStart: "Trim start", trimEnd: "Trim end", openTrim: "Listen and edit trim", selectedTrim: "Current selection", vocalSeparation: "Separate vocals · Demucs", vocalSeparationHint: "Optional and disabled by default. Whisper Medium analyses the original audio directly; enable Demucs only when instruments or noise genuinely mask the vocal.", deepAnalysis: "Phoneme-by-phoneme analysis", deepAnalysisHint: "Deep mode: two Whisper passes, bidirectional onsets and a letter/phoneme time-map. Slower, but more accurate at phrase starts.", llmCorrection: "Local LLM sequence correction", llmCorrectionHint: "Enabled by default: Qwen compares the video words with the master and restores openings or endings missed by Whisper. It may select only words already measured in the master; MFCC/DTW remains responsible for timing.", exactLyrics: "Exact spoken words", exactLyricsHint: "Enter only the words sung in this clip. This becomes the LLM’s binding reference; identity and timing are still verified against the master.", exactLyricsPlaceholder: "The Fallen, still loves me", llmExactLyricsUsed: "Binding lyrics", llmRecovered: "Recovered words", llmNoChange: "No omission confirmed", exactConstraint: "Exact sequence applied; timing verified by Whisper and MFCC/DTW", llmUnavailable: "Local LLM unavailable",
    preview: "Synchronization preview", original: "Original", post: "Post Lipsync", play: "Play", pause: "Pause", stop: "Stop", noPreview: "Load the video and master to prepare the preview; lyrics are optional.", analyzePreview: "Run the analysis to preview the video realigned to the master.",
    progress: "Real pipeline", anchors: "Vocal anchors", source: "Source", target: "Target", correction: "Correction", confidence: "Confidence", state: "State", locked: "Locked", auto: "Auto", manual: "Manual", editable: "Editable",
    report: "Quality control", matched: "Aligned words", unresolved: "Needs review", average: "Average correction", critical: "Critical segments", monotonic: "Monotonic time-map", masterSegment: "Segment recognized in the master", yes: "Yes", no: "No", download: "Download JSON report",
    speedMap: "Retiming map", safe: "Safe", moderate: "Moderate", criticalBand: "Critical", interpolation: "interpolation", subtitlePreview: "Aligned text", alignmentMode: "Alignment basis", whisperOnly: "Whisper only", subtitleGuided: "Whisper + SRT/VTT",
    guide: {
      title: "How it works · every analysis step",
      intro: "MLSM POST LIPSYNC does not nudge the video by eye: it measures where every word lands in the master, where it lands in the generated video, and builds a monotonic time-map that rescales the video onto those points. Every step below runs locally, in the order shown.",
      steps: {
        "extract-source-audio": "Local FFmpeg extracts the sung video’s audio track into a temporary PCM WAV. The video file is never rewritten.",
        cache: "A SHA-256 fingerprint of video, master, lyrics, Whisper model and every alignment parameter. If the same request was analysed before the result is reused, otherwise a fresh analysis starts.",
        "separate-source-vocal": "By default Whisper Medium reads the video’s original audio. When Demucs is enabled, this step produces an isolated vocal stem instead.",
        "separate-target-vocal": "The master uses the same choice; its trim is always applied before transcription, with or without Demucs.",
        "overlay-waveforms": "Available when Demucs is enabled: the two stems are overlaid through normalised cross-correlation. With Demucs disabled this step does not alter the original Whisper timestamps.",
        "transcribe-source": "Whisper transcribes the video’s voice with word-level timestamps (phoneme-level in deep mode). Deterministic decoding: no sampling, no temperature.",
        "transcribe-target": "The same transcription on the master’s voice: this is the reference for the words actually sung.",
        "llm-correct": "Qwen2.5 running locally compares the two lists and reports which words Whisper dropped at the start or the end of the phrase. It may only pick words already measured in the master, it never invents text and it never writes a timestamp: recovered words are positioned from the ratio measured in the waveform-overlay step.",
        align: "The canonical words (SRT/VTT when present, otherwise Whisper) are matched to the transcript by subsequence and similarity: this produces the anchors, the list of words needing review and the monotonic time-map.",
        "micro-align": "Available with Demucs: MFCC + delta-MFCC and DTW refine the isolated stems. With separation disabled, the time-map preserves the original Whisper timestamps directly.",
        "visual-align": "Optional: Auto-AVSR reads the mouth frame by frame and visemes are fused with the audio timing only when they are reliable and do not break monotonicity. If it is unavailable, the audio timing stands."
      },
      notes: [
        "No step rewrites the original files: the video and master are only read.",
        "If the waveform overlay is not trustworthy MLSM says so and falls back to the previous behaviour instead of faking a measurement.",
        "The video is rebuilt on the master’s timeline: the final duration matches the selected excerpt exactly.",
        "Export is blocked if fewer than 70% of the words are aligned or the time-map is not monotonic."
      ]
    },
    editHint: "Every word is editable. In Correction, − delays the video and + advances it by 10 ms; open the details to adjust start, centre and end. Right-click an uncertain word to inspect it again.", error: "Analysis failed", freshAnalysis: "The same files and parameters always restore the same automatic result. Clear the cache to force a completely fresh computation.", clearCache: "Clear LIP SYNC cache", cacheCleared: "LIP SYNC analysis cache cleared", unresolvedWord: "Needs review", unsafeExport: "Export blocked: at least 70% of the words must be aligned and the time-map must be monotonic.", reviewWrong: "Mark wrong and inspect deeper", reviewWrongHint: "Reanalyze this word with phonetic constraints and a focused DTW window", boundaries: "Timing details", sourceStart: "Source start", sourceCenter: "Source centre", sourceEnd: "Source end", targetStart: "Master start", targetCenter: "Master centre", targetEnd: "Master end", createManual: "Create manual anchor", nudgeEarlier: "Advance video", nudgeLater: "Delay video", detailTab: "Word detail", waveformTab: "Graphic timeline", whisperTab: "Whisper timestamps", waveformHint: "The upper lane preserves the automatic result. In the lower lane drag words, use the edge handles to shorten or extend them, and Shift/Cmd/Ctrl for multi-selection.", selectedWords: "Selected words", moveSelection: "Move selection", automaticLane: "Automatic result", editableLane: "Editable video", dragWord: "Drag to move · handles to resize", expandPreview: "Expand preview", collapsePreview: "Collapse preview", promptTool: "Video prompt generator", promptToolHint: "Independent tool · uses only SRT/VTT and the local LLM", openPromptTool: "Open prompt generator", exportVideo: "Export MP4", cancelExport: "Cancel export", exportPreparing: "Preparing export with the current time-map…", exportDone: "Export complete", phoneticPoints: "phonetic points", visualSpeech: "Visual lip analysis · Auto-AVSR", visualSpeechHint: "Disabled by default: when enabled, it reads the mouth frame by frame and fuses visemes with Whisper/MFCC only when confidence and monotonicity are safe.", visualApplied: "Timing refined with visemes", visualNoChange: "No reliable viseme: audio timing preserved", visualUnavailable: "Auto-AVSR unavailable: audio timing preserved", faceCoverage: "face coverage"
  }
} as const;

const stageLabels = {
  it: { "extract-source-audio": "Estrazione audio dal video", cache: "Baseline deterministico", "separate-source-vocal": "Audio sorgente / voce", "separate-target-vocal": "Audio master / voce", "overlay-waveforms": "Sovrapposizione delle onde", "transcribe-source": "Trascrizione sorgente", "transcribe-target": "Trascrizione target", "llm-correct": "Correzione sequenza LLM", align: "Allineamento parole", "micro-align": "Rifinitura MFCC / DTW", "visual-align": "Lettura labiale Auto-AVSR" },
  en: { "extract-source-audio": "Extracting video audio", cache: "Deterministic baseline", "separate-source-vocal": "Source audio / vocal", "separate-target-vocal": "Master audio / vocal", "overlay-waveforms": "Waveform overlay", "transcribe-source": "Transcribing source", "transcribe-target": "Transcribing target", "llm-correct": "LLM sequence correction", align: "Aligning words", "micro-align": "MFCC / DTW refinement", "visual-align": "Auto-AVSR lip reading" }
} as const;

function chooseBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null), { once: true }); input.click();
  });
}

function probeVideo(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video"); const timeout = window.setTimeout(() => reject(new Error("Timeout durante la lettura del video.")), 15_000);
    video.preload = "metadata"; video.muted = true;
    video.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(video.duration); };
    video.onerror = () => { window.clearTimeout(timeout); reject(new Error("Il video selezionato non è leggibile.")); };
    video.src = url; video.load();
  });
}

async function selectSourceVideo(): Promise<SourceVideo | null> {
  if (!isTauri()) {
    const file = await chooseBrowserFile(".mp4,.mov,.m4v,.webm,.mkv,.avi,video/*"); if (!file) return null;
    const sourceAudio = await importVideoFile(file);
    return { path: file.name, name: file.name, url: sourceAudio.url, durationSeconds: sourceAudio.metadata.durationSeconds, revokeUrl: true, contentHash: sourceAudio.metadata.hash, sourceAudio };
  }
  const path = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi"] }] });
  if (typeof path !== "string") return null;
  const url = convertFileSrc(path); const name = path.split(/[\\/]/).at(-1) ?? path;
  return { path, name, url, durationSeconds: await probeVideo(url), revokeUrl: false };
}

async function selectSubtitleFile(): Promise<SubtitleInput | null> {
  const file = await chooseBrowserFile(".srt,.vtt,text/plain");
  if (!file) return null;
  const text = await file.text(); if (!text.trim()) throw new Error("Il file dei sottotitoli è vuoto.");
  return { name: file.name, text, origin: "file" };
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0); const minutes = Math.floor(safe / 60); const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}

function overallProgress(progress: MlsmPostLipsyncPipelineProgress | null): number {
  if (!progress) return 0; const index = stageOrder.indexOf(progress.stage); const local = progress.stageProgress ?? .35;
  return Math.max(0, Math.min(1, (Math.max(0, index) + local) / stageOrder.length));
}

function segmentAtTarget(analysis: MlsmPostLipsyncAnalysis, time: number) {
  return analysis.timeMap.segments.find((segment) => time <= segment.targetEnd + 1e-6) ?? analysis.timeMap.segments.at(-1) ?? null;
}

function shiftedAnchor(anchor: WordAnchor, side: "source" | "target", center: number): Partial<WordAnchor> {
  const current = side === "source" ? anchor.sourceCenter : anchor.targetCenter; const delta = center - current;
  return side === "source"
    ? { sourceStart: Math.max(0, anchor.sourceStart + delta), sourceCenter: center, sourceEnd: Math.max(center, anchor.sourceEnd + delta) }
    : { targetStart: Math.max(0, anchor.targetStart + delta), targetCenter: center, targetEnd: Math.max(center, anchor.targetEnd + delta) };
}

function LipsyncTimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => boolean }) {
  const formatted = value.toFixed(3);
  const [draft, setDraft] = useState(formatted);
  useEffect(() => setDraft(formatted), [formatted]);
  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) { setDraft(formatted); return; }
    if (!onCommit(parsed)) setDraft(formatted);
  };
  return <label className="lipsync-time-field"><span>{label}</span><input aria-label={label} type="text" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.key === "Enter") { event.currentTarget.blur(); }
    if (event.key === "Escape") { setDraft(formatted); event.currentTarget.blur(); }
  }} /></label>;
}

export function MlsmPostLipsyncWorkspace({ onHome }: { onHome?: () => void }) {
  const { language: uiLanguage, theme, setLanguage: setUiLanguage, setTheme } = useUiPreferences(); const t = copy[uiLanguage];
  const [sourceVideo, setSourceVideo] = useState<SourceVideo | null>(null); const sourceRef = useRef<SourceVideo | null>(null);
  const [targetMaster, setTargetMaster] = useState<ImportedAudio | null>(null); const targetRef = useRef<ImportedAudio | null>(null);
  const [targetMasterRange, setTargetMasterRange] = useState({ startSeconds: 0, endSeconds: 0 });
  const [trimModalOpen, setTrimModalOpen] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitleInput | null>(null);
  const [singingLanguage, setSingingLanguage] = useState("en"); const [whisperModel, setWhisperModel] = useState<WhisperModelId>("whisper-medium_timestamped");
  const [deepPhonemeAnalysis, setDeepPhonemeAnalysis] = useState(false);
  const [localLlmCorrection, setLocalLlmCorrection] = useState(true);
  const [separateVocals, setSeparateVocals] = useState(false);
  const [visualSpeechAnalysis, setVisualSpeechAnalysis] = useState(false);
  const [exactSungLyrics, setExactSungLyrics] = useState("");
  const [analysis, setAnalysis] = useState<MlsmPostLipsyncAnalysis | null>(null); const [progress, setProgress] = useState<MlsmPostLipsyncPipelineProgress | null>(null);
  const [automaticAnchors, setAutomaticAnchors] = useState<WordAnchor[]>([]);
  const [running, setRunning] = useState(false); const [error, setError] = useState<string | null>(null); const abortRef = useRef<AbortController | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false); const [exportProgress, setExportProgress] = useState(0); const [exportMessage, setExportMessage] = useState<string | null>(null); const exportAbortRef = useRef<AbortController | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("post"); const [playing, setPlaying] = useState(false); const [currentTime, setCurrentTime] = useState(0);
  const [previewExpanded, setPreviewExpanded] = useState(false); const [anchorEditorTab, setAnchorEditorTab] = useState<AnchorEditorTab>("detail");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [reviewMenu, setReviewMenu] = useState<LipsyncReviewMenu | null>(null);
  const [selectedWordIndexes, setSelectedWordIndexes] = useState<number[]>([]); const lastSelectedWordRef = useRef<number | null>(null);
  const editableTimelineTrackRef = useRef<HTMLDivElement>(null); const timelinePointerEditRef = useRef<TimelinePointerEdit | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null); const targetAudioRef = useRef<HTMLAudioElement>(null); const frameRef = useRef<number | null>(null); const playIntent = useRef(0); const videoResumePendingRef = useRef(false);
  const previewStageRef = useRef<HTMLDivElement>(null); const [previewStageSize, setPreviewStageSize] = useState<LipsyncPreviewSize | null>(null); const [previewVideoSize, setPreviewVideoSize] = useState<LipsyncPreviewSize | null>(null);
  const duration = previewMode === "post" ? (analysis?.targetDurationSeconds ?? 0) : (sourceVideo?.durationSeconds ?? 0);
  const canAnalyze = Boolean(sourceVideo && targetMaster && targetMasterRange.endSeconds > targetMasterRange.startSeconds + .05 && !running && !exporting);
  const exportSafe = Boolean(analysis && analysis.report.monotonic && analysis.report.matchedWords / Math.max(1, analysis.report.canonicalWords) >= .7);

  useEffect(() => { sourceRef.current = sourceVideo; }, [sourceVideo]);
  useEffect(() => { targetRef.current = targetMaster; }, [targetMaster]);
  const pause = useCallback(() => { playIntent.current += 1; videoResumePendingRef.current = false; videoRef.current?.pause(); targetAudioRef.current?.pause(); setPlaying(false); }, []);
  const stop = useCallback(() => { pause(); setCurrentTime(0); if (videoRef.current) videoRef.current.currentTime = previewMode === "post" && analysis ? lipsyncTargetToSource(analysis.timeMap, 0) : 0; if (targetAudioRef.current) targetAudioRef.current.currentTime = analysis?.targetAudioStartSeconds ?? 0; }, [analysis, pause, previewMode]);

  useEffect(() => () => {
    abortRef.current?.abort(); exportAbortRef.current?.abort(); playIntent.current += 1; if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (sourceRef.current?.revokeUrl) URL.revokeObjectURL(sourceRef.current.url); releaseImportedAudio(targetRef.current);
  }, []);

  useEffect(() => { stop(); }, [previewMode, stop]);

  useEffect(() => {
    if (!previewExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewExpanded(false); };
    window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewExpanded]);

  useEffect(() => {
    if (!reviewMenu) return;
    const close = () => setReviewMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", closeOnEscape); };
  }, [reviewMenu]);

  useEffect(() => {
    const stage = previewStageRef.current; if (!stage) return;
    const measure = () => { const bounds = stage.getBoundingClientRect(); if (bounds.width > 0 && bounds.height > 0) setPreviewStageSize({ width: bounds.width, height: bounds.height }); };
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure); observer.observe(stage); return () => observer.disconnect();
  }, []);

  useEffect(() => { setPreviewVideoSize(null); }, [sourceVideo?.url]);

  useEffect(() => {
    if (!playing) { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; return; }
    const tick = () => {
      const video = videoRef.current; const target = targetAudioRef.current;
      if (!video) return;
      if (previewMode === "original") {
        setCurrentTime(video.currentTime);
        if (video.ended) { setPlaying(false); return; }
      } else if (target && analysis) {
        const targetTime = Math.max(0, target.currentTime - analysis.targetAudioStartSeconds); const expectedSource = lipsyncTargetToSource(analysis.timeMap, targetTime); const segment = segmentAtTarget(analysis, targetTime);
        const clock = lipsyncPreviewClockAdjustment(segment?.speedRatio ?? 1, video.currentTime, expectedSource);
        try { video.playbackRate = clock.playbackRate; } catch { video.playbackRate = 1; }
        if (!clock.shouldPlay) {
          if (!video.paused) video.pause();
          if (Math.abs(video.currentTime - expectedSource) >= .004) video.currentTime = expectedSource;
        } else {
          if (clock.shouldSeek) video.currentTime = expectedSource;
          if (video.paused && !target.paused && !videoResumePendingRef.current) {
            const intent = playIntent.current; videoResumePendingRef.current = true;
            void requestMediaPlayback(video, () => playIntent.current === intent && !target.paused).catch((reason: unknown) => {
              if (playIntent.current === intent) setError(reason instanceof Error ? reason.message : String(reason));
            }).finally(() => { videoResumePendingRef.current = false; });
          }
        }
        setCurrentTime(targetTime);
        if (target.ended || targetTime >= analysis.targetDurationSeconds - .001) { target.pause(); video.pause(); setCurrentTime(analysis.targetDurationSeconds); setPlaying(false); return; }
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick); return () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; };
  }, [analysis, playing, previewMode]);

  const play = async () => {
    const video = videoRef.current; if (!video || !sourceVideo) return;
    const intent = ++playIntent.current; setError(null);
    try {
      if (previewMode === "original") {
        const startTime = lipsyncPreviewStartTime(currentTime, duration, video.ended);
        if (startTime !== currentTime || video.ended) { video.currentTime = startTime; setCurrentTime(startTime); }
        video.muted = false; const started = await requestMediaPlayback(video, () => playIntent.current === intent); if (started) setPlaying(true);
      } else {
        const target = targetAudioRef.current; if (!target || !analysis) return;
        const startTime = lipsyncPreviewStartTime(currentTime, analysis.targetDurationSeconds, target.ended);
        if (startTime !== currentTime || target.ended) setCurrentTime(startTime);
        target.currentTime = analysis.targetAudioStartSeconds + startTime;
        const expectedSource = lipsyncTargetToSource(analysis.timeMap, startTime); const segment = segmentAtTarget(analysis, startTime);
        const clock = lipsyncPreviewClockAdjustment(segment?.speedRatio ?? 1, expectedSource, expectedSource);
        video.muted = true; video.currentTime = expectedSource;
        try { video.playbackRate = clock.playbackRate; } catch { video.playbackRate = 1; }
        if (!clock.shouldPlay) video.pause();
        const audioStarted = await requestMediaPlayback(target, () => playIntent.current === intent); if (!audioStarted) return;
        if (!clock.shouldPlay) { setPlaying(true); return; }
        const videoStarted = await requestMediaPlayback(video, () => playIntent.current === intent);
        if (videoStarted) setPlaying(true); else target.pause();
      }
    } catch (reason) { if (playIntent.current === intent) { pause(); setError(reason instanceof Error ? reason.message : String(reason)); } }
  };

  const seek = (time: number) => {
    const next = Math.max(0, Math.min(duration, time)); setCurrentTime(next);
    if (previewMode === "original") { if (videoRef.current) videoRef.current.currentTime = next; }
    else if (analysis) { if (targetAudioRef.current) targetAudioRef.current.currentTime = analysis.targetAudioStartSeconds + next; if (videoRef.current) videoRef.current.currentTime = lipsyncTargetToSource(analysis.timeMap, next); }
  };

  const replaceSourceVideo = async () => {
    try { const selected = await selectSourceVideo(); if (!selected) return; pause(); if (sourceVideo?.revokeUrl) URL.revokeObjectURL(sourceVideo.url); setSourceVideo(selected); setExactSungLyrics(""); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const replaceTargetAudio = async () => {
    try { const selected = await importAudio(); if (!selected) return; pause(); releaseImportedAudio(targetMaster); setTargetMaster(selected); setTargetMasterRange({ startSeconds: 0, endSeconds: selected.metadata.durationSeconds }); setTrimModalOpen(true); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const replaceSubtitles = async () => {
    try { const selected = await selectSubtitleFile(); if (!selected) return; setSubtitles(selected); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const updatePastedSubtitles = (text: string) => {
    setSubtitles(text.trim() ? { name: t.pastedSubtitles, text, origin: "paste" } : null);
    setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setError(null);
  };

  const runAnalysis = async (focusCanonicalIndexes: readonly number[] = []) => {
    if (!sourceVideo || !targetMaster) return; pause(); const controller = new AbortController(); abortRef.current = controller;
    const targetedReview = focusCanonicalIndexes.length > 0;
    setRunning(true); if (!targetedReview) { setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; } setError(null); setProgress({ stage: "extract-source-audio", stageProgress: 0, message: stageLabels[uiLanguage]["extract-source-audio"] });
    try {
      const result = await analyzeMlsmPostLipsync({ sourceVideoPath: sourceVideo.path, ...(sourceVideo.contentHash ? { sourceVideoHash: sourceVideo.contentHash } : {}), sourceVideoUrl: sourceVideo.url, sourceVideoName: sourceVideo.name, ...(sourceVideo.sourceAudio ? { sourceAudio: sourceVideo.sourceAudio } : {}), targetMaster, targetMasterRange, ...(subtitles?.text.trim() ? { subtitles: subtitles.text } : {}), ...(exactSungLyrics.trim() ? { exactSungLyrics } : {}), language: singingLanguage, whisperModel, deepPhonemeAnalysis: targetedReview || deepPhonemeAnalysis, ...(targetedReview ? { focusCanonicalIndexes } : {}), localLlmCorrection, separateVocals, visualSpeechAnalysis, reuseCachedAnalysis: !targetedReview, signal: controller.signal, onProgress: setProgress });
      if (!controller.signal.aborted) { setAnalysis(result); setAutomaticAnchors(result.anchors.map((anchor) => ({ ...anchor }))); setProgress({ stage: "visual-align", stageProgress: 1, message: t.complete }); setPreviewMode("post"); setCurrentTime(0); if (videoRef.current) videoRef.current.currentTime = lipsyncTargetToSource(result.timeMap, 0); if (targetAudioRef.current) targetAudioRef.current.currentTime = result.targetAudioStartSeconds; }
    } catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (abortRef.current === controller) abortRef.current = null; setRunning(false); }
  };

  const openReviewMenu = (event: ReactMouseEvent<HTMLElement>, canonicalIndex: number) => {
    event.preventDefault(); event.stopPropagation();
    setReviewMenu({ canonicalIndex, x: Math.max(8, Math.min(window.innerWidth - 290, event.clientX)), y: Math.max(8, Math.min(window.innerHeight - 92, event.clientY)) });
  };

  const runFocusedReview = async () => {
    const canonicalIndex = reviewMenu?.canonicalIndex; setReviewMenu(null);
    if (canonicalIndex === undefined) return;
    await runAnalysis([canonicalIndex]);
  };

  const reset = () => {
    abortRef.current?.abort(); exportAbortRef.current?.abort(); pause(); if (sourceVideo?.revokeUrl) URL.revokeObjectURL(sourceVideo.url); releaseImportedAudio(targetMaster);
    setSourceVideo(null); setTargetMaster(null); setTargetMasterRange({ startSeconds: 0, endSeconds: 0 }); setTrimModalOpen(false); setSubtitles(null); setExactSungLyrics(""); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setPreviewExpanded(false); setProgress(null); setCurrentTime(0); setError(null);
    setWhisperModel("whisper-medium_timestamped"); setSeparateVocals(false); setVisualSpeechAnalysis(false); setDeepPhonemeAnalysis(false); setLocalLlmCorrection(true);
    setExporting(false); setExportProgress(0); setExportMessage(null);
  };

  const toggleDeepAnalysis = (enabled: boolean) => {
    setDeepPhonemeAnalysis(enabled); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const updateSingingLanguage = (value: string) => {
    setSingingLanguage(value); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const updateWhisperModel = (value: WhisperModelId) => {
    setWhisperModel(value); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const toggleLocalLlmCorrection = (enabled: boolean) => {
    setLocalLlmCorrection(enabled); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const toggleVocalSeparation = (enabled: boolean) => {
    setSeparateVocals(enabled); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const toggleVisualSpeechAnalysis = (enabled: boolean) => {
    setVisualSpeechAnalysis(enabled); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const updateExactSungLyrics = (value: string) => {
    setExactSungLyrics(value); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const applyTargetMasterRange = (next: { startSeconds: number; endSeconds: number }) => {
    if (!targetMaster || !Number.isFinite(next.startSeconds) || !Number.isFinite(next.endSeconds) || next.startSeconds < 0 || next.endSeconds <= next.startSeconds + .05 || next.endSeconds > targetMaster.metadata.durationSeconds + .01) return;
    setTargetMasterRange(next); setTrimModalOpen(false); setAnalysis(null); setAutomaticAnchors([]); setSelectedWordIndexes([]); lastSelectedWordRef.current = null; setProgress(null); setCurrentTime(0); setError(null); setExportMessage(null);
  };

  const runExport = async () => {
    if (!analysis || !sourceVideo || !targetMaster || exporting) return;
    if (!exportSafe) { setError(t.unsafeExport); return; }
    pause(); const controller = new AbortController(); exportAbortRef.current = controller;
    setExporting(true); setExportProgress(0); setExportMessage(t.exportPreparing); setError(null);
    try {
      const result = await exportMlsmPostLipsyncVideo({
        projectName: sourceVideo.name.replace(/\.[^.]+$/u, ""),
        sourceVideoUrl: sourceVideo.url,
        targetAudioUrl: targetMaster.url,
        analysis,
        quality: "maximum"
      }, controller.signal, (next) => {
        setExportProgress(next.progress);
        setExportMessage(`${next.currentFrame}/${next.totalFrames} frame · ${Math.round(next.progress * 100)}%`);
      });
      if (!controller.signal.aborted) { setExportProgress(1); setExportMessage(`${t.exportDone} · ${result.width}×${result.height} · ${result.fps.toFixed(3)} FPS`); }
    } catch (reason) {
      setExportMessage(null);
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (exportAbortRef.current === controller) exportAbortRef.current = null; setExporting(false); }
  };

  const clearCache = async () => {
    await mlsmPostLipsyncCache.clear();
    setCacheMessage(t.cacheCleared);
    window.setTimeout(() => setCacheMessage(null), 3_000);
  };

  const adoptEditedAnalysis = (next: MlsmPostLipsyncAnalysis, requestedTime = currentTime) => {
    const time = Math.max(0, Math.min(next.targetDurationSeconds, requestedTime));
    setAnalysis(next); setCurrentTime(time); setError(null);
    if (targetAudioRef.current) targetAudioRef.current.currentTime = next.targetAudioStartSeconds + time;
    if (videoRef.current) videoRef.current.currentTime = lipsyncTargetToSource(next.timeMap, time);
  };

  const applyWhisperWordCorrection = async (sourceWords: readonly TimestampedWord[], targetWords: readonly TimestampedWord[]) => {
    if (!analysis) throw new Error(uiLanguage === "it" ? "Esegui prima l’analisi Whisper." : "Run Whisper analysis first.");
    pause();
    const next = applyMlsmWhisperWordCorrection({ analysis, sourceWords, targetWords });
    setAutomaticAnchors(next.anchors.map((anchor) => ({ ...anchor })));
    setSelectedWordIndexes([]);
    lastSelectedWordRef.current = null;
    setExportMessage(null);
    adoptEditedAnalysis(next, next.anchors[0]?.targetCenter ?? 0);
  };

  const editAnchor = (anchor: WordAnchor, side: "source" | "target", value: number) => {
    if (!analysis || !Number.isFinite(value)) return false;
    try {
      const anchors = editLipsyncAnchor(analysis.anchors, anchor.id, shiftedAnchor(anchor, side, value));
      adoptEditedAnalysis(replaceMlsmPostLipsyncAnchors(analysis, anchors));
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
  };

  const editAnchorBoundary = (anchor: WordAnchor, field: "sourceStart" | "sourceCenter" | "sourceEnd" | "targetStart" | "targetCenter" | "targetEnd", value: number) => {
    if (!analysis || !Number.isFinite(value)) return false;
    try {
      const anchors = editLipsyncAnchor(analysis.anchors, anchor.id, { [field]: Math.max(0, value), locked: false });
      adoptEditedAnalysis(replaceMlsmPostLipsyncAnchors(analysis, anchors));
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
  };

  const createManualAnchor = (canonicalIndex: number) => {
    if (!analysis) return;
    const word = analysis.canonicalLyrics.find((item) => item.canonicalIndex === canonicalIndex); if (!word) return;
    try {
      const anchors = createManualLipsyncAnchor(word, analysis.timeMap, analysis.anchors);
      adoptEditedAnalysis(replaceMlsmPostLipsyncAnchors(analysis, anchors), (word.estimatedStartSeconds + word.estimatedEndSeconds) / 2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const nudgeWords = (canonicalIndexes: readonly number[], deltaSeconds: number) => {
    if (!analysis || !Number.isFinite(deltaSeconds) || !canonicalIndexes.length) return;
    try {
      let anchors = analysis.anchors;
      for (const canonicalIndex of canonicalIndexes) {
        const word = analysis.canonicalLyrics.find((item) => item.canonicalIndex === canonicalIndex); if (!word) continue;
        if (!anchors.some((item) => item.canonicalIndex === canonicalIndex)) anchors = createManualLipsyncAnchor(word, analysis.timeMap, anchors);
      }
      anchors = shiftLipsyncAnchors(anchors, canonicalIndexes, deltaSeconds, analysis.sourceDurationSeconds);
      const next = replaceMlsmPostLipsyncAnchors(analysis, anchors);
      const targetTime = next.anchors.find((item) => item.canonicalIndex === canonicalIndexes[0])?.targetCenter ?? currentTime;
      adoptEditedAnalysis(next, targetTime);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const nudgeWord = (canonicalIndex: number, deltaSeconds: number) => {
    const selection = selectedWordIndexes.includes(canonicalIndex) ? selectedWordIndexes : [canonicalIndex];
    nudgeWords(selection, deltaSeconds);
  };

  const analysisWithTimelineAnchors = (base: MlsmPostLipsyncAnalysis, canonicalIndexes: readonly number[]) => {
    let anchors = base.anchors;
    for (const canonicalIndex of canonicalIndexes) {
      const word = base.canonicalLyrics.find((item) => item.canonicalIndex === canonicalIndex); if (!word) continue;
      if (!anchors.some((anchor) => anchor.canonicalIndex === canonicalIndex)) anchors = createManualLipsyncAnchor(word, base.timeMap, anchors);
    }
    return anchors === base.anchors ? base : replaceMlsmPostLipsyncAnchors(base, anchors);
  };

  const applyTimelineEdit = (base: MlsmPostLipsyncAnalysis, canonicalIndexes: readonly number[], mode: LipsyncTimelineEditMode, deltaSeconds: number) => {
    const prepared = analysisWithTimelineAnchors(base, canonicalIndexes);
    const anchors = editLipsyncTimelineAnchors({ anchors: prepared.anchors, canonicalIndexes, mode, deltaSeconds, targetDurationSeconds: prepared.targetDurationSeconds });
    return replaceMlsmPostLipsyncAnchors(prepared, anchors);
  };

  const nudgeTimelineSelection = (deltaSeconds: number) => {
    if (!analysis || !selectedWordIndexes.length) return;
    try { adoptEditedAnalysis(applyTimelineEdit(analysis, selectedWordIndexes, "move", deltaSeconds)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const beginTimelinePointerEdit = (event: ReactPointerEvent<HTMLElement>, canonicalIndex: number, mode: LipsyncTimelineEditMode) => {
    if (!analysis || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const trackWidth = editableTimelineTrackRef.current?.getBoundingClientRect().width ?? 0; if (trackWidth <= 0) return;
    const modifiers = event.metaKey || event.ctrlKey || event.shiftKey;
    const nextSelection = mode === "move" && selectedWordIndexes.includes(canonicalIndex) && !modifiers
      ? selectedWordIndexes
      : mode === "move"
        ? selectLipsyncTimelineWords({ selected: selectedWordIndexes, clicked: canonicalIndex, lastFocused: lastSelectedWordRef.current, additive: event.metaKey || event.ctrlKey, range: event.shiftKey })
        : [canonicalIndex];
    const prepared = analysisWithTimelineAnchors(analysis, nextSelection);
    if (prepared !== analysis) setAnalysis(prepared);
    setSelectedWordIndexes(nextSelection); lastSelectedWordRef.current = canonicalIndex;
    timelinePointerEditRef.current = { pointerId: event.pointerId, startClientX: event.clientX, trackWidth, mode, canonicalIndexes: nextSelection, initialAnalysis: prepared, clickedIndex: canonicalIndex, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const updateTimelinePointerEdit = (event: ReactPointerEvent<HTMLElement>) => {
    const edit = timelinePointerEditRef.current; if (!edit || edit.pointerId !== event.pointerId) return;
    const pixelDelta = event.clientX - edit.startClientX; if (Math.abs(pixelDelta) >= 2) edit.moved = true;
    try {
      const next = applyTimelineEdit(edit.initialAnalysis, edit.canonicalIndexes, edit.mode, pixelDelta / edit.trackWidth * edit.initialAnalysis.targetDurationSeconds);
      adoptEditedAnalysis(next); setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const finishTimelinePointerEdit = (event: ReactPointerEvent<HTMLElement>) => {
    const edit = timelinePointerEditRef.current; if (!edit || edit.pointerId !== event.pointerId) return;
    if (!edit.moved && edit.mode === "move") {
      const anchor = edit.initialAnalysis.anchors.find((item) => item.canonicalIndex === edit.clickedIndex);
      const word = edit.initialAnalysis.canonicalLyrics.find((item) => item.canonicalIndex === edit.clickedIndex);
      const targetTime = anchor?.targetCenter ?? (word ? (word.estimatedStartSeconds + word.estimatedEndSeconds) / 2 : currentTime);
      seek(targetTime);
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId); timelinePointerEditRef.current = null;
  };

  const downloadReport = () => {
    if (!analysis) return; const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `mlsm-post-lipsync-${sourceVideo?.name.replace(/\.[^.]+$/, "") ?? "analysis"}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const status = running ? t.analyzing : analysis ? t.complete : t.ready; const progressValue = analysis ? 1 : overallProgress(progress);
  const canonicalText = analysis?.canonicalLyrics.map((word) => word.text).join(" ") ?? subtitles?.text.replace(/^\s*\d+\s*$|\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->.*$/gm, "").replace(/\s+/g, " ").trim() ?? "";
  const fittedPreview = previewStageSize && previewVideoSize ? fitLipsyncPreview(previewStageSize.width, previewStageSize.height, previewVideoSize.width, previewVideoSize.height) : null;
  const waveformBars = useMemo(() => analysis && targetMaster ? lipsyncMasterWaveformBars(targetMaster.waveform, targetMaster.metadata.durationSeconds, analysis.targetAudioStartSeconds, analysis.targetDurationSeconds) : [], [analysis, targetMaster]);
  const masterTrimBars = useMemo(() => {
    if (!targetMaster?.waveform.length) return [];
    const stride = Math.max(1, Math.floor(targetMaster.waveform.length / 96));
    return Array.from({ length: Math.min(96, Math.ceil(targetMaster.waveform.length / stride)) }, (_, index) => Math.min(1, Math.max(...targetMaster.waveform.slice(index * stride, (index + 1) * stride).map(Math.abs), .02)));
  }, [targetMaster]);

  return <div className="lipsync-workspace">
    <header className="lipsync-workspace__bar">
      <button type="button" className="home-button" onClick={onHome} aria-label={t.home}>⌂ <span>{t.home}</span></button>
      <div className="lipsync-workspace__identity"><img src="/mlsm-studio-favicon-192.png" alt="" /><span><strong>MLSM POST LIPSYNC</strong><small>{t.subtitle}</small></span></div>
      <div className="lipsync-workspace__status" data-running={running} data-ready={Boolean(analysis)}><i />{status}</div>
      <div className="lipsync-workspace__actions"><button type="button" className="lipsync-export-top" disabled={!exporting && (!analysis || !sourceVideo || !targetMaster || running || !exportSafe)} title={analysis && !exportSafe ? t.unsafeExport : undefined} onClick={() => exporting ? exportAbortRef.current?.abort() : void runExport()}>{exporting ? `${t.cancelExport} · ${Math.round(exportProgress * 100)}%` : `${t.exportVideo} ↓`}</button><DiscordLink /><SettingsButton /><MemoryButton /><SupportArtistButton /><select aria-label={uiCopy[uiLanguage].language} value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select><button type="button" className="theme-toggle" onClick={() => setTheme(theme === "day" ? "night" : "day")}>{theme === "day" ? "☼" : "◐"}</button></div>
    </header>
    <main className="lipsync-workspace__main">
      <aside className="lipsync-setup">
        <header><small>LIPSYNC / INPUT</small><h2>{t.setup}</h2><p>{t.setupHint}</p></header>
        <button type="button" disabled={running || exporting} className={`lipsync-input-card${sourceVideo ? " complete" : ""}`} onClick={() => void replaceSourceVideo()}><span>01</span><div><strong>{t.sourceVideo}</strong><small>{sourceVideo ? `${sourceVideo.name} · ${formatTime(sourceVideo.durationSeconds)}` : t.missing}</small></div><b>{t.selectVideo}</b></button>
        <button type="button" disabled={running || exporting} className={`lipsync-input-card${targetMaster ? " complete" : ""}`} onClick={() => void replaceTargetAudio()}><span>02</span><div><strong>{t.targetAudio}</strong><small>{targetMaster ? `${targetMaster.metadata.fileName} · ${formatTime(targetMaster.metadata.durationSeconds)}` : t.missing}</small></div><b>{t.selectAudio}</b></button>
        {targetMaster ? <section className="lipsync-master-trim">
          <header><strong>{t.masterTrim}</strong><small>{t.masterTrimHint}</small></header>
          <div className="lipsync-master-trim-waveform" aria-hidden="true">{masterTrimBars.map((amplitude, index) => <i key={index} style={{ height: `${Math.max(.08, amplitude) * 100}%` }} />)}<span style={{ left: `${targetMasterRange.startSeconds / targetMaster.metadata.durationSeconds * 100}%`, width: `${(targetMasterRange.endSeconds - targetMasterRange.startSeconds) / targetMaster.metadata.durationSeconds * 100}%` }} /></div>
          <div className="lipsync-master-trim-summary"><span><small>{t.selectedTrim}</small><strong>{formatTime(targetMasterRange.startSeconds)} → {formatTime(targetMasterRange.endSeconds)}</strong><em>{formatTime(targetMasterRange.endSeconds - targetMasterRange.startSeconds)}</em></span><button type="button" disabled={running || exporting} onClick={() => { pause(); setTrimModalOpen(true); }}>▶ {t.openTrim}</button></div>
        </section> : null}
        <button type="button" disabled={running || exporting} className={`lipsync-input-card${subtitles ? " complete" : ""}`} onClick={() => void replaceSubtitles()}><span>03</span><div><strong>{t.timedLyrics}</strong><small>{subtitles ? (subtitles.origin === "paste" ? t.pastedSubtitles : subtitles.name) : t.whisperOnly}</small></div><b>{t.selectSubtitles}</b></button>
        <label className="lipsync-subtitle-paste"><span>{t.pasteSubtitles}{subtitles ? <button type="button" disabled={running || exporting} aria-label={t.clear} onClick={() => updatePastedSubtitles("")}>{t.clear}</button> : null}</span><textarea disabled={running || exporting} value={subtitles?.text ?? ""} placeholder={t.subtitlePlaceholder} spellCheck={false} onChange={(event) => updatePastedSubtitles(event.target.value)} /></label>
        <section className="lipsync-prompt-launch"><span><strong>{t.promptTool}</strong><small>{t.promptToolHint}</small></span><button type="button" aria-label={t.openPromptTool} onClick={() => setPromptModalOpen(true)}>{t.openPromptTool}<b>↗</b></button></section>
        <div className="lipsync-options"><label>{t.language}<select value={singingLanguage} disabled={running || exporting} onChange={(event) => updateSingingLanguage(event.target.value)}><option value="en">English</option><option value="it">Italiano</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="auto">Auto</option></select></label><label>{t.model}<select value={whisperModel} disabled={running || exporting} onChange={(event) => updateWhisperModel(event.target.value as WhisperModelId)}>{whisperModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></div>
        <label className="lipsync-deep-analysis"><span><input type="checkbox" checked={separateVocals} disabled={running || exporting} onChange={(event) => toggleVocalSeparation(event.target.checked)} /><strong>{t.vocalSeparation}</strong></span><small>{t.vocalSeparationHint}</small></label>
        <section className="lipsync-deep-analysis lipsync-llm-control"><label className="lipsync-llm-toggle"><span><input type="checkbox" checked={localLlmCorrection} disabled={running || exporting} onChange={(event) => toggleLocalLlmCorrection(event.target.checked)} /><strong>{t.llmCorrection}</strong></span><small>{t.llmCorrectionHint}</small></label><label className="lipsync-exact-lyrics"><span>{t.exactLyrics}</span><textarea aria-label={t.exactLyrics} value={exactSungLyrics} disabled={running || exporting || !localLlmCorrection} placeholder={t.exactLyricsPlaceholder} rows={2} onChange={(event) => updateExactSungLyrics(event.target.value)} /><small>{t.exactLyricsHint}</small></label></section>
        <label className="lipsync-deep-analysis"><span><input type="checkbox" checked={visualSpeechAnalysis} disabled={running || exporting} onChange={(event) => toggleVisualSpeechAnalysis(event.target.checked)} /><strong>{t.visualSpeech}</strong></span><small>{t.visualSpeechHint}</small></label>
        <label className="lipsync-deep-analysis"><span><input type="checkbox" checked={deepPhonemeAnalysis} disabled={running || exporting} onChange={(event) => toggleDeepAnalysis(event.target.checked)} /><strong>{t.deepAnalysis}</strong></span><small>{t.deepAnalysisHint}</small></label>
        <small className="lipsync-fresh-analysis">{t.freshAnalysis}</small>
        <div className="lipsync-primary-actions">{running ? <button type="button" className="lipsync-cancel" onClick={() => abortRef.current?.abort()}>{t.cancel}</button> : <button type="button" className="lipsync-analyze" disabled={!canAnalyze} onClick={() => void runAnalysis()}>{t.analyze}<span>→</span></button>}<button type="button" onClick={reset}>{t.reset}</button></div>
        <button type="button" className="lipsync-clear-cache" disabled={running} onClick={() => void clearCache()}>{t.clearCache}</button>
        {cacheMessage ? <output className="lipsync-cache-message">{cacheMessage}</output> : null}
      </aside>

      <section className="lipsync-center">
        <div className={`lipsync-preview-card${previewExpanded ? " expanded" : ""}`}>
          <header><span><small>LIPSYNC / MONITOR</small><strong>{t.preview}</strong></span><div className="lipsync-preview-actions"><div className="lipsync-ab"><button type="button" className={previewMode === "original" ? "active" : ""} onClick={() => setPreviewMode("original")}>A · {t.original}</button><button type="button" className={previewMode === "post" ? "active" : ""} disabled={!analysis} onClick={() => setPreviewMode("post")}>B · {t.post}</button></div><button type="button" className="lipsync-preview-expand" aria-label={previewExpanded ? t.collapsePreview : t.expandPreview} title={previewExpanded ? t.collapsePreview : t.expandPreview} onClick={() => setPreviewExpanded((expanded) => !expanded)}>{previewExpanded ? "↙" : "⛶"}</button></div></header>
          <div ref={previewStageRef} className="lipsync-video-stage">
            {sourceVideo ? <video ref={videoRef} src={sourceVideo.url} aria-label={t.preview} preload="metadata" playsInline style={{ width: fittedPreview ? `${fittedPreview.width}px` : "100%", height: fittedPreview ? `${fittedPreview.height}px` : "100%", objectFit: "contain", objectPosition: "center center" }} onLoadedMetadata={(event) => setPreviewVideoSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} onEnded={() => { if (previewMode === "original") { setCurrentTime(duration); setPlaying(false); } }} /> : <div className="lipsync-empty"><i>◎</i><strong>{t.noPreview}</strong></div>}
            {sourceVideo && !analysis && previewMode === "post" ? <div className="lipsync-analysis-overlay"><span>{t.analyzePreview}</span></div> : null}
            {analysis ? <div className="lipsync-live-badge"><i />{t.post} · {segmentAtTarget(analysis, currentTime)?.speedRatio.toFixed(2) ?? "1.00"}×</div> : null}
          </div>
          <audio ref={targetAudioRef} src={targetMaster?.url} preload="auto" />
          <div className="lipsync-transport"><button type="button" className="lipsync-play" disabled={!sourceVideo || (previewMode === "post" && !analysis)} onClick={() => playing ? pause() : void play()}>{playing ? "Ⅱ" : "▶"} {playing ? t.pause : t.play}</button><button type="button" onClick={stop}>■ {t.stop}</button><span>{formatTime(currentTime)} / {formatTime(duration)}</span><input aria-label="Timeline" type="range" min={0} max={Math.max(.01, duration)} step={.001} value={Math.min(currentTime, duration)} onChange={(event) => seek(Number(event.target.value))} /></div>
        </div>

        <section className="lipsync-pipeline">
          <header><span><small>LIPSYNC / ANALYSIS</small><strong>{t.progress}</strong></span><output>{Math.round(progressValue * 100)}%</output></header>
          <div className="lipsync-progress-track"><i style={{ width: `${progressValue * 100}%` }} /></div>
          <div className="lipsync-stage-grid">{stageOrder.map((stage, index) => { const activeIndex = progress ? stageOrder.indexOf(progress.stage) : -1; const state = analysis || index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting"; return <div key={stage} data-state={state}><i>{state === "done" ? "✓" : String(index + 1).padStart(2, "0")}</i><span><strong>{stageLabels[uiLanguage][stage]}</strong><small>{index === activeIndex ? progress?.message : state === "done" ? "OK" : "—"}</small></span></div>; })}</div>
          <details className="lipsync-guide">
            <summary>{t.guide.title}</summary>
            <p>{t.guide.intro}</p>
            <ol>{stageOrder.map((stage, index) => <li key={stage}><strong>{String(index + 1).padStart(2, "0")} · {stageLabels[uiLanguage][stage]}</strong><span>{t.guide.steps[stage]}</span></li>)}</ol>
            <ul>{t.guide.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </details>
          {exportMessage ? <div className="lipsync-export-status" data-running={exporting}><span><strong>{exporting ? t.exportVideo : t.exportDone}</strong><small>{exportMessage}</small></span><output>{Math.round(exportProgress * 100)}%</output><div><i style={{ width: `${exportProgress * 100}%` }} /></div></div> : null}
          {error ? <div className="lipsync-error"><strong>{t.error}</strong><span>{error}</span></div> : null}
        </section>
      </section>

      <aside className="lipsync-report">
        <header><small>LIPSYNC / QC</small><h2>{t.report}</h2></header>
        {analysis ? <>
          <div className="lipsync-metrics"><article><strong>{analysis.report.matchedWords}/{analysis.report.canonicalWords}</strong><span>{t.matched}</span></article><article data-warning={analysis.report.unresolved > 0}><strong>{analysis.report.unresolved}</strong><span>{t.unresolved}</span></article><article><strong>{Math.round(analysis.report.averageTimingCorrectionMs)} ms</strong><span>{t.average}</span></article><article data-warning={analysis.report.criticalRetimeSegments > 0}><strong>{analysis.report.criticalRetimeSegments}</strong><span>{t.critical}</span></article></div>
          <div className="lipsync-monotonic" data-valid="true"><span>{t.alignmentMode}</span><strong>{analysis.alignmentSource === "whisper" ? t.whisperOnly : t.subtitleGuided}</strong></div>
          {analysis.localLlmCorrection.enabled ? <div className="lipsync-monotonic" data-valid={analysis.localLlmCorrection.status !== "unavailable"}><span>{t.llmCorrection}</span><strong>{analysis.localLlmCorrection.status === "exact-constraint" ? t.exactConstraint : analysis.localLlmCorrection.applied ? `${t.llmRecovered}: ${analysis.localLlmCorrection.recoveredWords.join(" ")}` : analysis.localLlmCorrection.status === "unavailable" ? t.llmUnavailable : t.llmNoChange}</strong></div> : null}
          {analysis.localLlmCorrection.exactLyrics ? <div className="lipsync-monotonic" data-valid="true"><span>{t.llmExactLyricsUsed}</span><strong>{analysis.localLlmCorrection.exactLyrics}</strong></div> : null}
          {analysis.visualSpeech.enabled ? <div className="lipsync-monotonic" data-valid={analysis.visualSpeech.status !== "unavailable"}><span>{t.visualSpeech}</span><strong>{analysis.visualSpeech.status === "applied" ? `${t.visualApplied} · ${analysis.visualSpeech.words.length} parole · ${analysis.visualSpeech.visemes.length} visemi${analysis.visualSpeech.faceCoverage === null ? "" : ` · ${t.faceCoverage} ${Math.round(analysis.visualSpeech.faceCoverage * 100)}%`}` : analysis.visualSpeech.status === "unavailable" ? `${t.visualUnavailable}${analysis.visualSpeech.error ? ` · ${analysis.visualSpeech.error}` : ""}` : t.visualNoChange}</strong></div> : null}
          <div className="lipsync-monotonic" data-valid="true"><span>{t.masterSegment}</span><strong>{formatTime(analysis.targetAudioStartSeconds)} — {formatTime(analysis.targetAudioEndSeconds)}</strong></div>
          <div className="lipsync-monotonic" data-valid={analysis.report.monotonic}><span>{t.monotonic}</span><strong>{analysis.report.monotonic ? t.yes : t.no}</strong></div>
          {analysis.detailMode === "phoneme" ? <div className="lipsync-monotonic" data-valid="true"><span>{t.deepAnalysis}</span><strong>{analysis.timeMap.points.filter((point) => point.canonicalIndex !== null).length} {t.phoneticPoints}</strong></div> : null}
          <section className="lipsync-speed-map"><header><strong>{t.speedMap}</strong><span><i data-band="safe" />{t.safe}<i data-band="moderate" />{t.moderate}<i data-band="critical" />{t.criticalBand}</span></header><div>{analysis.timeMap.segments.map((segment) => <i key={segment.id} data-band={segment.speedBand} title={`${segment.speedRatio.toFixed(2)}×${segment.requiresInterpolation ? ` · ${t.interpolation}` : ""}`} style={{ width: `${segment.targetDuration / analysis.targetDurationSeconds * 100}%` }} />)}</div></section>
          <section className="lipsync-canonical"><strong>{t.subtitlePreview}</strong><p>{canonicalText}</p></section>
          {!exportSafe ? <div className="lipsync-error"><strong>{t.unsafeExport}</strong></div> : null}
          <button type="button" className="lipsync-export-main" disabled={exporting || !exportSafe} title={!exportSafe ? t.unsafeExport : undefined} onClick={() => void runExport()}>{t.exportVideo} ↓</button>
          <button type="button" className="lipsync-download" onClick={downloadReport}>{t.download} ↓</button>
        </> : <div className="lipsync-report-empty"><span>00</span><p>{t.analyzePreview}</p></div>}
      </aside>

      {analysis ? <section className="lipsync-anchor-editor">
        <header><span><small>LIPSYNC / TIMELINE</small><h2>{t.anchors}</h2><p>{t.editHint}</p></span><b>{analysis.anchors.length} anchor</b></header>
        <nav className="lipsync-anchor-tabs" role="tablist" aria-label="LIP SYNC timeline"><button type="button" role="tab" aria-selected={anchorEditorTab === "detail"} className={anchorEditorTab === "detail" ? "active" : ""} onClick={() => setAnchorEditorTab("detail")}>{t.detailTab}</button><button type="button" role="tab" aria-selected={anchorEditorTab === "waveform"} className={anchorEditorTab === "waveform" ? "active" : ""} onClick={() => setAnchorEditorTab("waveform")}>{t.waveformTab}</button><button type="button" role="tab" aria-selected={anchorEditorTab === "whisper"} className={anchorEditorTab === "whisper" ? "active" : ""} onClick={() => { pause(); setAnchorEditorTab("whisper"); }}>{t.whisperTab}</button></nav>
        {anchorEditorTab === "detail" ? <div className="lipsync-anchor-detail" role="tabpanel">
          <div className="lipsync-anchor-ruler">{analysis.canonicalLyrics.map((word) => { const anchor = analysis.anchors.find((item) => item.canonicalIndex === word.canonicalIndex); const time = anchor?.targetCenter ?? (word.estimatedStartSeconds + word.estimatedEndSeconds) / 2; return <button type="button" key={`word-${word.canonicalIndex}`} data-band={anchor?.confidenceBand ?? "unresolved"} title={`${word.text} · ${anchor ? formatTime(time) : t.unresolvedWord}`} style={{ left: `${time / analysis.targetDurationSeconds * 100}%` }} onContextMenu={(event) => openReviewMenu(event, word.canonicalIndex)} onClick={() => seek(time)}><span>{word.text}</span></button>; })}</div>
          <div className="lipsync-anchor-table">
          <div className="lipsync-anchor-head"><span>#</span><span>{t.anchors}</span><span>{t.source}</span><span>{t.target}</span><span>{t.correction}</span><span>{t.confidence}</span><span>{t.state}</span></div>
          {analysis.canonicalLyrics.map((word) => {
            const anchor = analysis.anchors.find((item) => item.canonicalIndex === word.canonicalIndex);
            if (!anchor) return <div key={`unresolved-${word.canonicalIndex}`} className="lipsync-anchor-row unresolved" data-band="unresolved" onContextMenu={(event) => openReviewMenu(event, word.canonicalIndex)}><span>{word.canonicalIndex + 1}</span><strong>{word.text}</strong><span>—</span><span>{formatTime((word.estimatedStartSeconds + word.estimatedEndSeconds) / 2)}</span><div className="lipsync-word-stepper"><button type="button" aria-label={`${t.nudgeLater}: ${word.text} 10 ms`} title={`${t.nudgeLater} · 10 ms`} onClick={() => nudgeWord(word.canonicalIndex, -.01)}>−</button><output>10 ms</output><button type="button" aria-label={`${t.nudgeEarlier}: ${word.text} 10 ms`} title={`${t.nudgeEarlier} · 10 ms`} onClick={() => nudgeWord(word.canonicalIndex, .01)}>+</button></div><span>0%</span><button type="button" className="lipsync-create-anchor" onClick={() => createManualAnchor(word.canonicalIndex)}>{t.createManual}</button></div>;
            return <div key={anchor.id} className="lipsync-anchor-item" data-band={anchor.confidenceBand} onContextMenu={(event) => openReviewMenu(event, word.canonicalIndex)}>
              <div className="lipsync-anchor-row" data-band={anchor.confidenceBand}>
                <span>{anchor.canonicalIndex + 1}</span><strong>{anchor.text}</strong>
                <LipsyncTimeInput label={`${anchor.text} ${t.source}`} value={anchor.sourceCenter} onCommit={(value) => editAnchor(anchor, "source", value)} />
                <LipsyncTimeInput label={`${anchor.text} ${t.target}`} value={anchor.targetCenter} onCommit={(value) => editAnchor(anchor, "target", value)} />
                <div className="lipsync-word-stepper"><button type="button" aria-label={`${t.nudgeLater}: ${anchor.text} 10 ms`} title={`${t.nudgeLater} · 10 ms`} onClick={() => nudgeWord(anchor.canonicalIndex, -.01)}>−</button><output>{Math.round((anchor.targetCenter - anchor.sourceCenter) * 1000)} ms</output><button type="button" aria-label={`${t.nudgeEarlier}: ${anchor.text} 10 ms`} title={`${t.nudgeEarlier} · 10 ms`} onClick={() => nudgeWord(anchor.canonicalIndex, .01)}>+</button></div><span>{Math.round(anchor.matchConfidence * 100)}%</span><span>{anchor.manuallyEdited ? t.manual : t.auto} · {t.editable}</span>
              </div>
              <details className="lipsync-anchor-boundaries">
                <summary>{t.boundaries}</summary>
                <div className="lipsync-anchor-nudges"><span>{t.source}</span><button type="button" title={t.nudgeLater} onClick={() => editAnchor(anchor, "source", anchor.sourceCenter - .05)}>−50 ms</button><button type="button" title={t.nudgeLater} onClick={() => editAnchor(anchor, "source", anchor.sourceCenter - .01)}>−10 ms</button><button type="button" title={t.nudgeEarlier} onClick={() => editAnchor(anchor, "source", anchor.sourceCenter + .01)}>+10 ms</button><button type="button" title={t.nudgeEarlier} onClick={() => editAnchor(anchor, "source", anchor.sourceCenter + .05)}>+50 ms</button></div>
                <div className="lipsync-boundary-grid">
                  <LipsyncTimeInput label={`${anchor.text} · ${t.sourceStart}`} value={anchor.sourceStart} onCommit={(value) => editAnchorBoundary(anchor, "sourceStart", value)} />
                  <LipsyncTimeInput label={`${anchor.text} · ${t.sourceCenter}`} value={anchor.sourceCenter} onCommit={(value) => editAnchorBoundary(anchor, "sourceCenter", value)} />
                  <LipsyncTimeInput label={`${anchor.text} · ${t.sourceEnd}`} value={anchor.sourceEnd} onCommit={(value) => editAnchorBoundary(anchor, "sourceEnd", value)} />
                  <LipsyncTimeInput label={`${anchor.text} · ${t.targetStart}`} value={anchor.targetStart} onCommit={(value) => editAnchorBoundary(anchor, "targetStart", value)} />
                  <LipsyncTimeInput label={`${anchor.text} · ${t.targetCenter}`} value={anchor.targetCenter} onCommit={(value) => editAnchorBoundary(anchor, "targetCenter", value)} />
                  <LipsyncTimeInput label={`${anchor.text} · ${t.targetEnd}`} value={anchor.targetEnd} onCommit={(value) => editAnchorBoundary(anchor, "targetEnd", value)} />
                </div>
              </details>
            </div>;
          })}
          </div>
        </div> : anchorEditorTab === "waveform" ? <div className="lipsync-waveform-editor" role="tabpanel">
          <div className="lipsync-waveform-toolbar"><span><strong>{t.selectedWords}: {selectedWordIndexes.length}</strong><small>{t.waveformHint}</small></span><div aria-label={t.moveSelection}><b>{t.moveSelection}</b><button type="button" disabled={!selectedWordIndexes.length} title={t.nudgeEarlier} onClick={() => nudgeTimelineSelection(-.05)}>← 50 ms</button><button type="button" disabled={!selectedWordIndexes.length} title={t.nudgeEarlier} onClick={() => nudgeTimelineSelection(-.01)}>← 10 ms</button><button type="button" disabled={!selectedWordIndexes.length} title={t.nudgeLater} onClick={() => nudgeTimelineSelection(.01)}>10 ms →</button><button type="button" disabled={!selectedWordIndexes.length} title={t.nudgeLater} onClick={() => nudgeTimelineSelection(.05)}>50 ms →</button></div></div>
          <div className="lipsync-master-waveform">
            <div className="lipsync-waveform-audio"><span>MASTER AUDIO</span><div className="lipsync-waveform-bars" aria-hidden="true" onDoubleClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); seek((event.clientX - bounds.left) / Math.max(1, bounds.width) * analysis.targetDurationSeconds); }}>{waveformBars.map((amplitude, index) => <i key={index} style={{ height: `${Math.max(.035, amplitude) * 86}%` }} />)}</div></div>
            <i className="lipsync-waveform-playhead" aria-hidden="true" style={{ left: `calc(125px + ${(currentTime / analysis.targetDurationSeconds * 100).toFixed(5)}% - ${(currentTime / analysis.targetDurationSeconds * 125).toFixed(5)}px)` }} />
            <div className="lipsync-timeline-lanes">
              <section className="lipsync-timeline-lane automatic"><header><strong>{t.automaticLane}</strong><small>{t.auto}</small></header><div className="lipsync-timeline-track">{analysis.canonicalLyrics.map((word) => {
                const anchor = (automaticAnchors.length ? automaticAnchors : analysis.anchors).find((item) => item.canonicalIndex === word.canonicalIndex);
                const start = anchor?.targetStart ?? word.estimatedStartSeconds; const end = anchor?.targetEnd ?? word.estimatedEndSeconds; const center = (start + end) / 2;
                const sourceStart = anchor?.sourceStart ?? lipsyncTargetToSource(analysis.timeMap, start); const sourceEnd = anchor?.sourceEnd ?? lipsyncTargetToSource(analysis.timeMap, end);
                const left = Math.max(0, Math.min(99.8, start / analysis.targetDurationSeconds * 100)); const width = Math.max(.5, Math.min(100 - left, (end - start) / analysis.targetDurationSeconds * 100));
                return <button type="button" key={`automatic-${word.canonicalIndex}`} data-band={anchor?.confidenceBand ?? "unresolved"} style={{ left: `${left}%`, width: `${width}%` }} title={`${word.text} · master ${formatTime(start)} — ${formatTime(end)} · video ${formatTime(sourceStart)} — ${formatTime(sourceEnd)}`} onClick={() => seek(center)}><strong>{word.text}</strong><small>M {formatTime(start)} · V {formatTime(sourceStart)}</small></button>;
              })}</div></section>
              <section className="lipsync-timeline-lane editable"><header><strong>{t.editableLane}</strong><small>{t.dragWord}</small></header><div ref={editableTimelineTrackRef} className="lipsync-timeline-track">{analysis.canonicalLyrics.map((word) => {
                const anchor = analysis.anchors.find((item) => item.canonicalIndex === word.canonicalIndex);
                const start = anchor?.targetStart ?? word.estimatedStartSeconds; const end = anchor?.targetEnd ?? word.estimatedEndSeconds;
                const sourceStart = anchor?.sourceStart ?? lipsyncTargetToSource(analysis.timeMap, start); const sourceEnd = anchor?.sourceEnd ?? lipsyncTargetToSource(analysis.timeMap, end);
                const left = Math.max(0, Math.min(99.8, start / analysis.targetDurationSeconds * 100)); const width = Math.max(.5, Math.min(100 - left, (end - start) / analysis.targetDurationSeconds * 100)); const selected = selectedWordIndexes.includes(word.canonicalIndex);
                return <div role="button" tabIndex={0} key={`editable-${word.canonicalIndex}`} className="lipsync-timeline-word" data-band={anchor?.confidenceBand ?? "unresolved"} data-selected={selected} aria-pressed={selected} style={{ left: `${left}%`, width: `${width}%` }} title={`${word.text} · master ${formatTime(start)} — ${formatTime(end)} · video ${formatTime(sourceStart)} — ${formatTime(sourceEnd)}`} onContextMenu={(event) => openReviewMenu(event, word.canonicalIndex)} onPointerDown={(event) => beginTimelinePointerEdit(event, word.canonicalIndex, "move")} onPointerMove={updateTimelinePointerEdit} onPointerUp={finishTimelinePointerEdit} onPointerCancel={finishTimelinePointerEdit} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const indexes = selected ? selectedWordIndexes : [word.canonicalIndex]; if (!selected) setSelectedWordIndexes(indexes); try { adoptEditedAnalysis(applyTimelineEdit(analysis, indexes, "move", event.key === "ArrowLeft" ? -.01 : .01)); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}><i className="lipsync-word-handle left" title={t.targetStart} onPointerDown={(event) => beginTimelinePointerEdit(event, word.canonicalIndex, "resize-start")} onPointerMove={updateTimelinePointerEdit} onPointerUp={finishTimelinePointerEdit} onPointerCancel={finishTimelinePointerEdit} /><span><strong>{word.text}</strong><small>M {formatTime(start)} · V {formatTime(sourceStart)}</small></span><i className="lipsync-word-handle right" title={t.targetEnd} onPointerDown={(event) => beginTimelinePointerEdit(event, word.canonicalIndex, "resize-end")} onPointerMove={updateTimelinePointerEdit} onPointerUp={finishTimelinePointerEdit} onPointerCancel={finishTimelinePointerEdit} /></div>;
              })}</div></section>
            </div>
            <div className="lipsync-waveform-scale"><span>0:00</span><span>{formatTime(analysis.targetDurationSeconds / 2)}</span><span>{formatTime(analysis.targetDurationSeconds)}</span></div>
          </div>
        </div> : sourceVideo && targetMaster ? <MlsmWhisperWordEditor analysis={analysis} sourceVideoUrl={sourceVideo.url} targetAudioUrl={targetMaster.url} language={uiLanguage} onAuditionStart={pause} onApply={applyWhisperWordCorrection} /> : null}
      </section> : null}
    </main>
    {reviewMenu ? <div className="lipsync-review-menu" role="menu" style={{ left: reviewMenu.x, top: reviewMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" role="menuitem" disabled={running || exporting} onClick={() => void runFocusedReview()}><strong>{t.reviewWrong}</strong><small>{t.reviewWrongHint}</small></button></div> : null}
    <MlsmAudioTrimModal open={trimModalOpen} audio={targetMaster} range={targetMasterRange} language={uiLanguage} onClose={() => setTrimModalOpen(false)} onApply={applyTargetMasterRange} />
    <MlsmPerformancePromptModal open={promptModalOpen} onClose={() => setPromptModalOpen(false)} initialSubtitles={subtitles?.text ?? ""} language={uiLanguage} />
  </div>;
}
