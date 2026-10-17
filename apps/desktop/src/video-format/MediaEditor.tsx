import { StandardPreview } from './StandardPreview';
import { useEffect, useRef, useState } from 'react';
import { useMediaUrl } from './useMediaUrl';
import type { FormatMedia } from './model';
import type { UiLanguage } from '../services/ui-preferences';

export function StandardCard({ media, selected, language, onSelect, onEdit, onDelete }: { media: FormatMedia; selected: boolean; language: UiLanguage; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const url = useMediaUrl(media.file);
  const [preview, setPreview] = useState(false);
  return <article className={`vfb-standard${selected ? ' selected' : ''}`}>
    <button className="vfb-card-select" aria-pressed={selected} onClick={onSelect} aria-label={`${language === 'it' ? 'Usa reazione' : 'Use reaction'} ${media.name}`}>
      <video src={url || undefined} muted preload="metadata" onLoadedMetadata={event => { event.currentTarget.currentTime = media.trimIn ?? 0; }} />
      <span className="vfb-card-check">{selected ? '✓' : '+'}</span><strong>{media.name}</strong><small>{((media.trimOut ?? media.duration) - (media.trimIn ?? 0)).toFixed(2)} s</small>
      <p>{media.description}</p>
    </button>
    <button className="vfb-preview-button" aria-label={`${language === 'it' ? 'Anteprima' : 'Preview'} ${media.name}`} onClick={() => setPreview(true)}>▶ {language === 'it' ? 'Anteprima' : 'Preview'}</button>
    {preview && <StandardPreview media={media} language={language} onClose={() => setPreview(false)} />}
    <button className="vfb-delete"  aria-label={`${language === 'it' ? 'Elimina video standard' : 'Delete standard video'} ${media.name}`} onClick={onDelete}>{language === 'it' ? 'Elimina video standard' : 'Delete standard video'}</button>
    <button onClick={onEdit}>{language === 'it' ? '✂ Taglia / rinomina' : '✂ Trim / rename'}</button>
  </article>;
}
export function StandardEditor({ media, language, busy, onSave, onClose }: { media: FormatMedia; language: UiLanguage; busy: boolean; onSave: (media: FormatMedia) => void; onClose: () => void }) {
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const url = useMediaUrl(media.file), video = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState(media.name), [description, setDescription] = useState(media.description);
  const [start, setStart] = useState(String(media.trimIn ?? 0)), [end, setEnd] = useState(String(media.trimOut ?? media.duration));
  const [position, setPosition] = useState(0);
  const valid = name.trim() && start.trim() && end.trim() && Number.isFinite(Number(start)) && Number.isFinite(Number(end)) && Number(start) >= 0 && Number(end) <= media.duration && Number(end) - Number(start) >= 1 / 60;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="vfb-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>{t('Prepara un video standard', 'Prepare a standard video')}</h2><button disabled={busy} onClick={onClose} aria-label={t('Chiudi', 'Close')}>×</button></header>
    <p>{t('Taglia la parte da riutilizzare e salvala con un nome riconoscibile.', 'Trim the part to reuse and save it with a recognizable name.')}</p>
    <video ref={video} src={url || undefined} controls onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} />
    <label>{t('Scorri il video', 'Scrub video')}<input type="range" min="0" max={media.duration} step="0.01" value={position} onChange={event => { const time = Number(event.target.value); setPosition(time); if (video.current) video.current.currentTime = time; }} /></label>
    <fieldset disabled={busy}><div className="vfb-trim"><label>{t('Inizio (s)', 'Start (s)')}<input type="number" step="0.01" min="0" value={start} onChange={event => setStart(event.target.value)} /></label><button onClick={() => setStart(String(video.current?.currentTime ?? 0))}>{t('Inizia qui', 'Start here')}</button><label>{t('Fine (s)', 'End (s)')}<input type="number" step="0.01" max={media.duration} value={end} onChange={event => setEnd(event.target.value)} /></label><button onClick={() => setEnd(String(video.current?.currentTime ?? 0))}>{t('Finisci qui', 'End here')}</button></div>
    <label>{t('Nome della reazione', 'Reaction name')}<input autoFocus value={name} maxLength={150} onChange={event => setName(event.target.value)} placeholder={t('Es. Reazione king', 'E.g. King reaction')} /></label>
    <label>{t('Descrizione per la ricerca', 'Search description')}<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder={t('Esulta per una giocata incredibile…', 'Celebrates an incredible play…')} /></label>
    {!valid && <p role="alert">{t('Inserisci un nome e un intervallo valido.', 'Enter a name and a valid range.')}</p>}
    <footer><button onClick={onClose}>{t('Annulla', 'Cancel')}</button><button className="vfb-primary" disabled={!valid} onClick={() => onSave({ ...media, name: name.trim(), description: description.trim(), trimIn: Number(start), trimOut: Number(end) })}>{t('Salva nella galleria standard', 'Save to standard gallery')}</button></footer></fieldset>
  </dialog>;
}
