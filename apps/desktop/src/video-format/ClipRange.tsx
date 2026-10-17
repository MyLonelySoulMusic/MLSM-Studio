import { useState } from 'react';
import type { FormatMedia } from './model';
import type { UiLanguage } from '../services/ui-preferences';

export function ClipRange({ media, language, time, onSave, onPreview }: { media: FormatMedia; language: UiLanguage; time?: number; onPreview?: (start: number, end: number) => void; onSave: (start: number, end: number) => void }) {
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const [start, setStart] = useState(String(media.trimIn ?? 0));
  const [end, setEnd] = useState(String(media.stopSeconds ?? media.duration));
  const valid = start.trim() !== '' && end.trim() !== '' && Number.isFinite(Number(start)) && Number.isFinite(Number(end)) && Number(start) >= 0 && Number(end) <= media.duration && Number(end) > Number(start);
  const edit = (nextStart: string, nextEnd: string) => {
    setStart(nextStart); setEnd(nextEnd);
    if (nextStart.trim() && nextEnd.trim() && Number.isFinite(Number(nextStart)) && Number.isFinite(Number(nextEnd)) && Number(nextStart) >= 0 && Number(nextEnd) <= media.duration && Number(nextEnd) > Number(nextStart)) onPreview?.(Number(nextStart), Number(nextEnd));
  };
  return <div className="vfb-clip-range"><label>{t('Inizio (s)', 'Start (s)')}<input aria-label={`${t('Inizio', 'Start')} ${media.name}`} type="number" min="0" step="0.01" value={start} onChange={event => edit(event.target.value, end)} /></label>
    <label>{t('Fine (s)', 'End (s)')}<input aria-label={`${t('Fine', 'End')} ${media.name}`} type="number" max={media.duration} step="0.01" value={end} onChange={event => edit(start, event.target.value)} /></label>
    {time !== undefined && <div><button onClick={() => edit(time.toFixed(3), end)}>{t('Inizia qui', 'Start here')}</button><button onClick={() => edit(start, time.toFixed(3))}>{t('Finisci qui', 'End here')}</button></div>}
    <button disabled={!valid} onClick={() => onSave(Number(start), Number(end))}>{t('Applica taglio', 'Apply trim')}</button>
    {!valid && <small role="alert">{t('La fine deve essere dopo l’inizio e dentro il video.', 'End must be after start and within the video.')}</small>}
  </div>;
}
