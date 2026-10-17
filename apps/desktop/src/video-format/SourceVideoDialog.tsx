import { useEffect, useId, useRef, useState } from 'react';
import type { FormatMedia } from './model';
import type { UiLanguage } from '../services/ui-preferences';
import { useMediaUrl } from './useMediaUrl';
import { ClipRange } from './ClipRange';

export function SourceVideoDialog({ media, language, initialTime, busy, onClose, onRange, onPreviewRange }: { media: FormatMedia; language: UiLanguage; initialTime: number; busy: boolean; onClose: (time: number) => void; onRange: (start: number, end: number) => void; onPreviewRange: (start: number, end: number) => void }) {
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const title = useId(), dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const url = useMediaUrl(media.file);
  const [time, setTime] = useState(initialTime);
  const [range, setRange] = useState({ start: media.trimIn ?? 0, end: media.stopSeconds ?? media.duration });
  const playingTrim = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const seek = (value: number) => { const next = Math.max(0, Math.min(media.duration, value)); setTime(next); if (video.current) video.current.currentTime = next; };
  const close = () => { video.current?.pause(); onClose(video.current?.currentTime ?? time); };
  return <dialog ref={dialog} className="vfb-dialog vfb-source-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><div><small>{t('VIDEO ORIGINALE · TAGLIO', 'SOURCE VIDEO · TRIM')}</small><h2 id={title}>{media.name}</h2></div><button disabled={busy} onClick={close} autoFocus>{t('Chiudi', 'Close')} ×</button></header>
    <video ref={video} src={url || undefined} controls playsInline onLoadedMetadata={() => seek(initialTime)} onTimeUpdate={event => { const value = event.currentTarget.currentTime; setTime(value); if (playingTrim.current && value >= range.end) { event.currentTarget.pause(); playingTrim.current = false; seek(range.end); } }} onError={() => { playingTrim.current = false; }} />
    <fieldset disabled={busy}>
      <div className="vfb-scrub"><button aria-label={t('Indietro un fotogramma', 'Previous frame')} onClick={() => seek(time - 1/60)}>−1f</button><input aria-label={t('Posizione video originale', 'Source video position')} type="range" min="0" max={media.duration} step={1/60} value={time} onChange={event => seek(Number(event.target.value))} /><button aria-label={t('Avanti un fotogramma', 'Next frame')} onClick={() => seek(time + 1/60)}>+1f</button><output>{time.toFixed(2)} / {media.duration.toFixed(2)} s</output></div>
      <ClipRange key={`${media.trimIn}:${media.stopSeconds}`} media={media} language={language} time={time} onPreview={(start, end) => { setRange({ start, end }); onPreviewRange(start, end); }} onSave={(start, end) => { video.current?.pause(); playingTrim.current = false; seek(start); onRange(start, end); }} />
      <footer><span>{t('Proporzioni originali · il taglio si applica alla clip del montaggio.', 'Original aspect ratio · trimming updates the composition clip.')}</span><button onClick={() => { seek(range.start); playingTrim.current = true; void video.current?.play().catch(() => { playingTrim.current = false; }); }}>{t('Riproduci il taglio', 'Play trimmed clip')}</button></footer>
    </fieldset>
  </dialog>;
}
