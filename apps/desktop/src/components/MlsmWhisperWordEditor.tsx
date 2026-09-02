import { useEffect, useMemo, useRef, useState } from "react";
import type { MlsmPostLipsyncAnalysis } from "../services/mlsm-post-lipsync-types";
import { requestMediaPlayback } from "../services/media-playback";
import type { TimestampedWord } from "../services/subtitle-generation";

type Track = "source" | "target";
type Language = "it" | "en";

interface DraftWord {
  id: string;
  text: string;
  start: string;
  end: string;
  confidence: number;
  confidenceSource?: TimestampedWord["confidenceSource"];
}

const labels = {
  it: {
    title: "Timestamp Whisper parola per parola",
    hint: "Questi sono i valori reali di words restituiti da Whisper. Il master definisce la sequenza finale; il video descrive ciò che pronuncia la bocca. Modifica testo, ordine e intervalli, poi Correggi ricostruisce davvero anchor, time-map, anteprima ed export.",
    source: "Video originale",
    target: "Brano master",
    word: "Parola",
    start: "Inizio (s)",
    end: "Fine (s)",
    listen: "Ascolta parola",
    stop: "Ferma ascolto",
    insertBefore: "Inserisci all’inizio",
    insertAfter: "Inserisci dopo",
    remove: "Elimina parola",
    fix: "Correggi e applica",
    fixing: "Applicazione…",
    applied: "Correzione applicata realmente alla time-map e all’export.",
    localTime: "Tempo locale",
    absoluteTime: "Tempo nel master",
    empty: "Inserisci almeno una parola"
  },
  en: {
    title: "Word-level Whisper timestamps",
    hint: "These are the real values from Whisper’s words property. The master defines the final sequence; the video describes what the mouth says. Edit text, order and ranges, then Apply correction rebuilds the actual anchors, time-map, preview and export.",
    source: "Original video",
    target: "Audio master",
    word: "Word",
    start: "Start (s)",
    end: "End (s)",
    listen: "Audition word",
    stop: "Stop audition",
    insertBefore: "Insert at start",
    insertAfter: "Insert after",
    remove: "Delete word",
    fix: "Apply correction",
    fixing: "Applying…",
    applied: "Correction applied to the actual time-map and export.",
    localTime: "Local time",
    absoluteTime: "Master time",
    empty: "Insert at least one word"
  }
} as const;

let editorWordSequence = 0;

function draftWords(track: Track, words: readonly TimestampedWord[]): DraftWord[] {
  return words.map((word) => ({
    id: `${track}-${editorWordSequence += 1}`,
    text: word.text,
    start: word.start.toFixed(3),
    end: word.end.toFixed(3),
    confidence: word.confidence,
    ...(word.confidenceSource ? { confidenceSource: word.confidenceSource } : {})
  }));
}

function materialize(words: readonly DraftWord[]): TimestampedWord[] {
  return words.map((word) => ({
    text: word.text,
    start: Number(word.start.replace(",", ".")),
    end: Number(word.end.replace(",", ".")),
    confidence: word.confidence,
    ...(word.confidenceSource ? { confidenceSource: word.confidenceSource } : {})
  }));
}

function wordCenter(word: DraftWord | undefined, fallback: number): number {
  if (!word) return fallback;
  const start = Number(word.start.replace(",", "."));
  const end = Number(word.end.replace(",", "."));
  return Number.isFinite(start) && Number.isFinite(end) ? (start + end) / 2 : fallback;
}

function newWord(track: Track, words: readonly DraftWord[], afterIndex: number, durationSeconds: number): DraftWord {
  const previousCenter = wordCenter(words[afterIndex], 0);
  const nextCenter = wordCenter(words[afterIndex + 1], durationSeconds);
  const center = afterIndex < 0
    ? Math.max(.04, Math.min(durationSeconds - .04, nextCenter / 2))
    : Math.max(.04, Math.min(durationSeconds - .04, nextCenter > previousCenter ? (previousCenter + nextCenter) / 2 : previousCenter + .2));
  const half = Math.max(.02, Math.min(.14, (nextCenter - previousCenter) / 4 || .1));
  return {
    id: `${track}-${editorWordSequence += 1}`,
    text: "",
    start: Math.max(0, center - half).toFixed(3),
    end: Math.min(durationSeconds, center + half).toFixed(3),
    confidence: .62,
    confidenceSource: "estimated"
  };
}

function timeLabel(value: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

export function MlsmWhisperWordEditor({
  analysis,
  sourceVideoUrl,
  targetAudioUrl,
  language,
  onAuditionStart,
  onApply
}: {
  analysis: MlsmPostLipsyncAnalysis;
  sourceVideoUrl: string;
  targetAudioUrl: string;
  language: Language;
  onAuditionStart?: () => void;
  onApply: (sourceWords: readonly TimestampedWord[], targetWords: readonly TimestampedWord[]) => void | Promise<void>;
}) {
  const t = labels[language];
  const [sourceWords, setSourceWords] = useState(() => draftWords("source", analysis.whisperTranscripts.source.words));
  const [targetWords, setTargetWords] = useState(() => draftWords("target", analysis.whisperTranscripts.target.words));
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourcePreviewRef = useRef<HTMLVideoElement>(null);
  const targetPreviewRef = useRef<HTMLAudioElement>(null);
  const auditionFrameRef = useRef<number | null>(null);
  const auditionTokenRef = useRef(0);

  useEffect(() => {
    setSourceWords(draftWords("source", analysis.whisperTranscripts.source.words));
    setTargetWords(draftWords("target", analysis.whisperTranscripts.target.words));
    setMessage(null);
    setError(null);
  }, [analysis.whisperTranscripts.source, analysis.whisperTranscripts.target]);

  const stopAudition = () => {
    auditionTokenRef.current += 1;
    if (auditionFrameRef.current !== null) cancelAnimationFrame(auditionFrameRef.current);
    auditionFrameRef.current = null;
    sourcePreviewRef.current?.pause();
    targetPreviewRef.current?.pause();
    setActiveWord(null);
  };

  useEffect(() => () => {
    auditionTokenRef.current += 1;
    if (auditionFrameRef.current !== null) cancelAnimationFrame(auditionFrameRef.current);
    sourcePreviewRef.current?.pause();
    targetPreviewRef.current?.pause();
  }, []);

  const tracks = useMemo(() => ({
    source: { words: sourceWords, setWords: setSourceWords, duration: analysis.whisperTranscripts.source.durationSeconds, offset: 0, media: sourcePreviewRef },
    target: { words: targetWords, setWords: setTargetWords, duration: analysis.whisperTranscripts.target.durationSeconds, offset: analysis.targetAnalysisStartSeconds, media: targetPreviewRef }
  }), [analysis.targetAnalysisStartSeconds, analysis.whisperTranscripts.source.durationSeconds, analysis.whisperTranscripts.target.durationSeconds, sourceWords, targetWords]);

  const updateWord = (track: Track, id: string, patch: Partial<DraftWord>) => {
    tracks[track].setWords((current) => current.map((word) => word.id === id ? { ...word, ...patch } : word));
    setMessage(null);
    setError(null);
  };

  const insertWord = (track: Track, afterIndex: number) => {
    tracks[track].setWords((current) => {
      const next = [...current];
      next.splice(afterIndex + 1, 0, newWord(track, current, afterIndex, tracks[track].duration));
      return next;
    });
    setMessage(null);
    setError(null);
  };

  const removeWord = (track: Track, id: string) => {
    tracks[track].setWords((current) => current.filter((word) => word.id !== id));
    if (activeWord === id) stopAudition();
    setMessage(null);
    setError(null);
  };

  const audition = async (track: Track, word: DraftWord) => {
    if (activeWord === word.id) { stopAudition(); return; }
    stopAudition();
    onAuditionStart?.();
    const media = tracks[track].media.current;
    const start = Number(word.start.replace(",", "."));
    const end = Number(word.end.replace(",", "."));
    if (!media || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setError(language === "it" ? "Correggi i timestamp prima dell’ascolto." : "Fix the timestamps before auditioning.");
      return;
    }
    const token = ++auditionTokenRef.current;
    const paddedStart = Math.max(0, start - .12) + tracks[track].offset;
    const paddedEnd = Math.min(tracks[track].duration, end + .12) + tracks[track].offset;
    sourcePreviewRef.current?.pause();
    targetPreviewRef.current?.pause();
    media.currentTime = paddedStart;
    setActiveWord(word.id);
    try {
      const started = await requestMediaPlayback(media, () => auditionTokenRef.current === token);
      if (!started) { stopAudition(); return; }
      const monitor = () => {
        if (auditionTokenRef.current !== token) return;
        if (media.ended || media.currentTime >= paddedEnd - .005) { stopAudition(); return; }
        auditionFrameRef.current = requestAnimationFrame(monitor);
      };
      auditionFrameRef.current = requestAnimationFrame(monitor);
    } catch (reason) {
      stopAudition();
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const apply = async () => {
    stopAudition();
    setApplying(true);
    setMessage(null);
    setError(null);
    try {
      await onApply(materialize(sourceWords), materialize(targetWords));
      setMessage(t.applied);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setApplying(false);
    }
  };

  const renderTrack = (track: Track) => {
    const config = tracks[track];
    const heading = track === "source" ? t.source : t.target;
    return <section className="lipsync-whisper-track" aria-label={heading}>
      <header><span><strong>{heading}</strong><small>{config.words.length} words · {t.localTime} 0 — {timeLabel(config.duration)}</small></span><button type="button" onClick={() => insertWord(track, -1)}>＋ {t.insertBefore}</button></header>
      {track === "source"
        ? <video ref={sourcePreviewRef} src={sourceVideoUrl} controls playsInline preload="metadata" onPlay={() => targetPreviewRef.current?.pause()} />
        : <div className="lipsync-whisper-master-player"><audio ref={targetPreviewRef} src={targetAudioUrl} controls preload="metadata" onPlay={() => sourcePreviewRef.current?.pause()} /><small>{t.absoluteTime}: {timeLabel(analysis.targetAnalysisStartSeconds)} — {timeLabel(analysis.targetAnalysisEndSeconds)}</small></div>}
      <div className="lipsync-whisper-word-list">
        {config.words.length ? config.words.map((word, index) => <div className="lipsync-whisper-word-row" key={word.id}>
          <b>{index + 1}</b>
          <label><span>{t.word}</span><input aria-label={`${t.word} ${heading} ${index + 1}`} value={word.text} onChange={(event) => updateWord(track, word.id, { text: event.target.value })} /></label>
          <label><span>{t.start}</span><input aria-label={`${t.start} ${heading} ${index + 1}`} inputMode="decimal" value={word.start} onChange={(event) => updateWord(track, word.id, { start: event.target.value })} /></label>
          <label><span>{t.end}</span><input aria-label={`${t.end} ${heading} ${index + 1}`} inputMode="decimal" value={word.end} onChange={(event) => updateWord(track, word.id, { end: event.target.value })} /></label>
          <button type="button" className="lipsync-whisper-audition" aria-label={`${activeWord === word.id ? t.stop : t.listen}: ${word.text || index + 1} · ${heading}`} onClick={() => void audition(track, word)}>{activeWord === word.id ? "■" : "▶"}<span>{activeWord === word.id ? t.stop : t.listen}</span></button>
          <button type="button" className="lipsync-whisper-insert" aria-label={`${t.insertAfter}: ${word.text || index + 1} · ${heading}`} onClick={() => insertWord(track, index)}>＋</button>
          <button type="button" className="lipsync-whisper-delete" aria-label={`${t.remove}: ${word.text || index + 1} · ${heading}`} onClick={() => removeWord(track, word.id)}>×</button>
        </div>) : <p className="lipsync-whisper-empty">{t.empty}</p>}
      </div>
    </section>;
  };

  return <div className="lipsync-whisper-editor" role="tabpanel">
    <header className="lipsync-whisper-editor__intro"><span><strong>{t.title}</strong><small>{t.hint}</small></span><button type="button" className="lipsync-whisper-fix" disabled={applying} onClick={() => void apply()}>{applying ? t.fixing : t.fix}</button></header>
    <div className="lipsync-whisper-tracks">{renderTrack("source")}{renderTrack("target")}</div>
    {message ? <div className="lipsync-whisper-message" role="status">✓ {message}</div> : null}
    {error ? <div className="lipsync-error" role="alert"><strong>{error}</strong></div> : null}
  </div>;
}
