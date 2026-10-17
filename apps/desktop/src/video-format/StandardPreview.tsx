import { useEffect, useRef, useState } from 'react';
import type { FormatMedia } from './model';
import type { UiLanguage } from '../services/ui-preferences';
import { useMediaUrl } from './useMediaUrl';

export function StandardPreview({ media, language, onClose }: { media: FormatMedia; language: UiLanguage; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const url = useMediaUrl(media.file), [error, setError] = useState(false);
  const start = media.trimIn ?? 0, end = media.trimOut ?? media.duration;
  const t = (it: string, en: string) => language === 'it' ? it : en;
  useEffect(() => { dialog.current?.showModal(); const player = video.current; return () => player?.pause(); }, []);
  const close = () => { video.current?.pause(); onClose(); };
  return <dialog ref={dialog} className="vfb-dialog vfb-standard-preview" aria-label={t('Anteprima video standard', 'Standard video preview')} onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2>{media.name}</h2><button autoFocus onClick={close} aria-label={t('Chiudi anteprima', 'Close preview')}>×</button></header>
    {media.description && <p>{media.description}</p>}
    <video ref={video} src={url || undefined} controls playsInline preload="auto"
      onLoadedMetadata={event => { event.currentTarget.currentTime = start; }}
      onPlay={event => { if (event.currentTarget.currentTime < start || event.currentTarget.currentTime >= end) event.currentTarget.currentTime = start; }}
      onTimeUpdate={event => { const player = event.currentTarget; if (player.currentTime >= end) { player.pause(); if (player.currentTime > end) player.currentTime = end; } else if (player.currentTime < start) player.currentTime = start; }}
      onError={() => setError(true)} />
    <p>{t('Taglio salvato', 'Saved trim')}: {start.toFixed(2)}–{end.toFixed(2)} s · {(end - start).toFixed(2)} s</p>
    {error && <p role="alert">{t('Impossibile riprodurre questo video.', 'Unable to play this video.')}</p>}
    <footer><button onClick={() => { const player = video.current; if (player) { player.currentTime = start; void player.play().catch(() => setError(true)); } }}>{t('Riproduci dall’inizio', 'Play from start')}</button><button onClick={close}>{t('Chiudi', 'Close')}</button></footer>
  </dialog>;
}
