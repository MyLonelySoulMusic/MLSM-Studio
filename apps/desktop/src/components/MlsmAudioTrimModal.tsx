import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ImportedAudio } from "../services/audio-import";
import { requestMediaPlayback } from "../services/media-playback";

interface AudioRange { startSeconds: number; endSeconds: number }

const modalCopy = {
  it: {
    title: "Ascolta e taglia il master", subtitle: "Riproduci il brano, trova la frase interessata e applica soltanto l’intervallo scelto all’analisi.",
    close: "Chiudi", start: "Inizio selezione", end: "Fine selezione", cursor: "Posizione ascolto", duration: "Durata selezione",
    play: "Ascolta selezione", pause: "Pausa", stop: "Torna all’inizio", whole: "Seleziona tutto", cancel: "Annulla", apply: "Usa questa porzione",
    waveform: "Forma d’onda del master audio", selection: "Porzione che verrà analizzata"
  },
  en: {
    title: "Listen and trim the master", subtitle: "Play the track, locate the required phrase and apply only the selected interval to the analysis.",
    close: "Close", start: "Selection start", end: "Selection end", cursor: "Playback position", duration: "Selection duration",
    play: "Play selection", pause: "Pause", stop: "Return to start", whole: "Select all", cancel: "Cancel", apply: "Use this excerpt",
    waveform: "Master audio waveform", selection: "Excerpt that will be analyzed"
  }
} as const;

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function timeLabel(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0); const minutes = Math.floor(safe / 60); const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}

function TimeField({ label, value, maximum, onChange }: { label: string; value: number; maximum: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(3));
  useEffect(() => setDraft(value.toFixed(3)), [value]);
  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (Number.isFinite(parsed)) onChange(clamp(parsed, 0, maximum));
    else setDraft(value.toFixed(3));
  };
  return <label className="lipsync-trim-time-field"><span>{label}</span><input aria-label={label} type="text" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { setDraft(value.toFixed(3)); event.currentTarget.blur(); }
  }} /></label>;
}

export function MlsmAudioTrimModal({ open, audio, range, language, onClose, onApply }: {
  open: boolean;
  audio: ImportedAudio | null;
  range: AudioRange;
  language: "it" | "en";
  onClose: () => void;
  onApply: (range: AudioRange) => void;
}) {
  const t = modalCopy[language]; const duration = audio?.metadata.durationSeconds ?? 0; const mediaRef = useRef<HTMLAudioElement>(null); const playIntentRef = useRef(0);
  const [draft, setDraft] = useState(range); const [cursor, setCursor] = useState(range.startSeconds); const [playing, setPlaying] = useState(false); const [playbackError, setPlaybackError] = useState<string | null>(null); const minimumRange = Math.min(.1, Math.max(.01, duration));
  const bars = useMemo(() => {
    if (!audio?.waveform.length) return [];
    const buckets = 180; const stride = Math.max(1, Math.floor(audio.waveform.length / buckets));
    return Array.from({ length: Math.min(buckets, Math.ceil(audio.waveform.length / stride)) }, (_, index) => Math.min(1, Math.max(.025, ...audio.waveform.slice(index * stride, (index + 1) * stride).map(Math.abs))));
  }, [audio]);

  const pause = () => { playIntentRef.current += 1; mediaRef.current?.pause(); setPlaying(false); };
  const seek = (next: number) => {
    const value = clamp(next, draft.startSeconds, draft.endSeconds); setCursor(value);
    if (mediaRef.current) mediaRef.current.currentTime = value;
  };
  const stop = () => { pause(); seek(draft.startSeconds); };
  const updateBoundary = (side: "start" | "end", value: number) => {
    const next = side === "start"
      ? { startSeconds: clamp(value, 0, Math.max(0, draft.endSeconds - minimumRange)), endSeconds: draft.endSeconds }
      : { startSeconds: draft.startSeconds, endSeconds: clamp(value, Math.min(duration, draft.startSeconds + minimumRange), duration) };
    setDraft(next);
    if (cursor < next.startSeconds || cursor > next.endSeconds) {
      const nextCursor = side === "start" ? next.startSeconds : next.endSeconds; setCursor(nextCursor);
      if (mediaRef.current) mediaRef.current.currentTime = nextCursor;
    }
  };
  const play = async () => {
    const media = mediaRef.current; if (!media || !audio) return;
    const nextCursor = cursor >= draft.endSeconds - .01 || cursor < draft.startSeconds ? draft.startSeconds : cursor;
    media.currentTime = nextCursor; setCursor(nextCursor); const intent = ++playIntentRef.current;
    setPlaybackError(null);
    try { if (await requestMediaPlayback(media, () => intent === playIntentRef.current)) setPlaying(true); }
    catch (reason) { if (intent === playIntentRef.current) { setPlaying(false); setPlaybackError(reason instanceof Error ? reason.message : String(reason)); } }
  };
  const seekFromWaveform = (event: ReactMouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(); if (bounds.width <= 0) return;
    seek((event.clientX - bounds.left) / bounds.width * duration);
  };

  useEffect(() => {
    if (!open || !audio) return;
    const startSeconds = clamp(range.startSeconds, 0, Math.max(0, duration - minimumRange));
    const endSeconds = clamp(range.endSeconds, startSeconds + minimumRange, duration);
    setDraft({ startSeconds, endSeconds }); setCursor(startSeconds); setPlaying(false); setPlaybackError(null);
    if (mediaRef.current) mediaRef.current.currentTime = startSeconds;
  }, [audio, duration, minimumRange, open, range.endSeconds, range.startSeconds]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { pause(); onClose(); } };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => () => { playIntentRef.current += 1; mediaRef.current?.pause(); }, []);
  if (!open || !audio) return null;

  const selectionLeft = duration ? draft.startSeconds / duration * 100 : 0; const selectionWidth = duration ? (draft.endSeconds - draft.startSeconds) / duration * 100 : 0; const cursorLeft = duration ? cursor / duration * 100 : 0;
  return <div className="lipsync-trim-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { pause(); onClose(); } }}>
    <section className="lipsync-trim-modal" role="dialog" aria-modal="true" aria-labelledby="lipsync-trim-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>LIPSYNC / MASTER EDITOR</small><h2 id="lipsync-trim-title">{t.title}</h2><p>{t.subtitle}</p></div><button type="button" aria-label={t.close} onClick={() => { pause(); onClose(); }}>×</button></header>
      <div className="lipsync-trim-file"><strong>{audio.metadata.fileName}</strong><span>{timeLabel(duration)} · {audio.metadata.sampleRate.toLocaleString()} Hz · {audio.metadata.channels} ch</span></div>
      <div className="lipsync-trim-waveform" role="slider" aria-label={t.waveform} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={cursor} tabIndex={0} onClick={seekFromWaveform} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seek(cursor + (event.key === "ArrowLeft" ? -.1 : .1)); } }}>
        <div className="lipsync-trim-bars" aria-hidden="true">{bars.map((amplitude, index) => <i key={index} style={{ height: `${amplitude * 92}%` }} />)}</div>
        <span className="lipsync-trim-selection" title={t.selection} style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }} />
        <span className="lipsync-trim-cursor" style={{ left: `${cursorLeft}%` }} />
      </div>
      <div className="lipsync-trim-handles">
        <input aria-label={t.start} type="range" min={0} max={duration} step={.01} value={draft.startSeconds} onChange={(event) => updateBoundary("start", Number(event.target.value))} />
        <input aria-label={t.end} type="range" min={0} max={duration} step={.01} value={draft.endSeconds} onChange={(event) => updateBoundary("end", Number(event.target.value))} />
      </div>
      <div className="lipsync-trim-fields"><TimeField label={t.start} value={draft.startSeconds} maximum={duration} onChange={(value) => updateBoundary("start", value)} /><span>→</span><TimeField label={t.end} value={draft.endSeconds} maximum={duration} onChange={(value) => updateBoundary("end", value)} /><output><small>{t.duration}</small><strong>{timeLabel(draft.endSeconds - draft.startSeconds)}</strong></output></div>
      <div className="lipsync-trim-transport"><button type="button" className="primary" onClick={() => playing ? pause() : void play()}>{playing ? `Ⅱ ${t.pause}` : `▶ ${t.play}`}</button><button type="button" onClick={stop}>■ {t.stop}</button><span><b>{t.cursor}</b>{timeLabel(cursor)} / {timeLabel(duration)}</span><input aria-label={t.cursor} type="range" min={draft.startSeconds} max={draft.endSeconds} step={.01} value={cursor} onChange={(event) => seek(Number(event.target.value))} /></div>
      {playbackError ? <p className="lipsync-trim-error" role="alert">{playbackError}</p> : null}
      <audio ref={mediaRef} src={audio.url} preload="auto" onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => { const current = event.currentTarget.currentTime; if (current >= draft.endSeconds - .005) { event.currentTarget.pause(); event.currentTarget.currentTime = draft.endSeconds; setCursor(draft.endSeconds); setPlaying(false); } else setCursor(clamp(current, draft.startSeconds, draft.endSeconds)); }} onEnded={() => { setPlaying(false); setCursor(draft.endSeconds); }} />
      <footer><button type="button" onClick={() => { pause(); setDraft({ startSeconds: 0, endSeconds: duration }); setCursor(0); if (mediaRef.current) mediaRef.current.currentTime = 0; }}>{t.whole}</button><span /><button type="button" onClick={() => { pause(); onClose(); }}>{t.cancel}</button><button type="button" className="primary" onClick={() => { pause(); onApply(draft); }}>{t.apply}</button></footer>
    </section>
  </div>;
}
