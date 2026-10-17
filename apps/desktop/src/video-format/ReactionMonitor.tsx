import { SourceVideoDialog } from './SourceVideoDialog';
import { PalettePreview } from './PalettePreview';
import { useEffect, useRef, useState } from 'react';
import { ratioRule, type FormatMedia, type ScenePreset, type VideoFormat } from './model';
import type { UiLanguage } from '../services/ui-preferences';
import { useMediaUrl } from './useMediaUrl';
import { ClipRange } from './ClipRange';
import { lastFrame } from './render';

export function ReactionMonitor({ media, reaction, format, language, busy, onMark, onScene, onDimensions, onRange, onReaction, onPreviewRange }: { media: FormatMedia; reaction: FormatMedia | undefined; format: VideoFormat; language: UiLanguage; busy: boolean; onDimensions: (width: number, height: number) => void; onPreviewRange: (start: number, end: number) => void; onRange: (start: number, end: number) => void; onReaction: () => void; onMark: (time: number) => void; onScene: (patch: Partial<ScenePreset>) => void }) {
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const video = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const playingTrim = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ x: number; y: number; sceneX: number; sceneY: number } | null>(null);
  const [time, setTime] = useState(media.trimIn ?? 0), [preview, setPreview] = useState(false), [still, setStill] = useState(''), [error, setError] = useState(false);
  const sourceUrl = useMediaUrl(media.file), reactionUrl = useMediaUrl(reaction?.file);
  const scene = format.scenes[0];
  const rule = ratioRule(format, media);

  useEffect(() => {
    if (!preview || media.stopSeconds === undefined || !scene?.freeze) return;
    let active = true, url = '';
    setStill(''); setError(false);
    void lastFrame(media.file, media.stopSeconds).then(file => { if (active) { url = URL.createObjectURL(file); setStill(url); } }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [media.file, media.stopSeconds, preview, scene?.freeze]);
  useEffect(() => {
    const start = media.trimIn ?? 0;
    setTime(start); playingTrim.current = false;
    if (video.current) { video.current.pause(); video.current.currentTime = start; }
  }, [media.trimIn, media.stopSeconds]);
  const seek = (next: number) => { const value = Math.max(0, Math.min(media.duration, next)); setTime(value); if (video.current) video.current.currentTime = value; };
  return <section className="vfb-monitor">
    <header><div><small>{t('VIDEO VARIABILE', 'VARIABLE VIDEO')}</small><h2>{media.name}</h2></div><div className="vfb-tabs"><button onClick={() => { video.current?.pause(); setExpanded(true); }}>{t('Apri in grande', 'Open large preview')}</button><button aria-pressed={!preview} onClick={() => setPreview(false)}>{t('Scegli il momento', 'Choose the moment')}</button><button disabled={!reaction || media.stopSeconds === undefined} aria-pressed={preview} onClick={() => { video.current?.pause(); setPreview(true); }}>{t('Anteprima reazione', 'Reaction preview')}</button></div></header>
    <div className="vfb-stage" ref={stage} style={{ aspectRatio: format.aspect.replace(':', '/'), width: `min(100%, calc(var(--vfb-stage-height) * ${format.aspect === '9:16' ? 9/16 : 16/9}))`, background: '#000' }}>
      {!preview && <PalettePreview video={video} rule={rule} aspect={format.aspect} />}
      {!preview ? <video ref={video} src={sourceUrl || undefined} controls onPlay={event => { const el = event.currentTarget; const start = media.trimIn ?? 0, end = media.stopSeconds ?? media.duration; if (el.currentTime < start || el.currentTime >= end) el.currentTime = start; playingTrim.current = true; }} onLoadedMetadata={event => { seek(media.trimIn ?? 0); const el = event.currentTarget; if (el.videoWidth && el.videoHeight && (el.videoWidth !== media.width || el.videoHeight !== media.height)) onDimensions(el.videoWidth, el.videoHeight); }} onTimeUpdate={event => { setTime(event.currentTarget.currentTime); if (playingTrim.current && event.currentTarget.currentTime >= (media.stopSeconds ?? media.duration)) { event.currentTarget.pause(); playingTrim.current = false; seek(media.stopSeconds ?? media.duration); } }} style={{ objectFit: rule.fit, transform: `scale(${rule.zoom})` }} /> : <>
        <video key={reaction?.id} src={reactionUrl || undefined} controls style={{ objectFit: 'contain', transform: `scale(${scene?.zoom ?? 1})` }} onLoadedMetadata={event => { event.currentTarget.currentTime = reaction?.trimIn ?? 0; }} onTimeUpdate={event => { if (event.currentTarget.currentTime >= (reaction?.trimOut ?? reaction?.duration ?? Infinity)) { event.currentTarget.pause(); event.currentTarget.currentTime = reaction?.trimIn ?? 0; } }} />
        {scene?.freeze && still && <div className="vfb-frozen" role="img" aria-label={t('Ultimo frame: trascina per riposizionarlo', 'Last frame: drag to reposition')} style={{ transform: `translate(${scene.x * 50}%, ${scene.y * 50}%) scale(${scene.scale})` }}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, sceneX: scene.x, sceneY: scene.y }; }}
          onPointerMove={event => { const start = drag.current, box = stage.current?.getBoundingClientRect(); if (start && box) onScene({ x: Math.max(-1, Math.min(1, start.sceneX + 2 * (event.clientX - start.x) / box.width)), y: Math.max(-1, Math.min(1, start.sceneY + 2 * (event.clientY - start.y) / box.height)) }); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><img src={still} draggable={false} alt="" /></div>}
        {scene?.freeze && !still && <p className="vfb-stage-message" role="status">{error ? t('Fotogramma non disponibile. Riprova.', 'Frame unavailable. Try again.') : t('Preparazione fotogramma…', 'Preparing frame…')}</p>}
      </>}
    </div>
    {!preview ? <><div className="vfb-scrub"><button onClick={() => seek(time - 1 / 60)} aria-label={t('Indietro un fotogramma', 'Previous frame')}>−1f</button><input aria-label={t('Punto di arresto', 'Stop point')} type="range" min="0" max={media.duration} step={1 / 60} value={time} onChange={event => seek(Number(event.target.value))} /><button onClick={() => seek(time + 1 / 60)} aria-label={t('Avanti un fotogramma', 'Next frame')}>+1f</button><output>{time.toFixed(2)} / {media.duration.toFixed(2)} s</output></div>
      <button className="vfb-mark" disabled={busy || time <= (media.trimIn ?? 0)} onClick={() => { video.current?.pause(); onMark(video.current?.currentTime ?? time); }}>✂ {t('Ferma qui', 'Stop here')} · {time.toFixed(2)} s</button>
      <ClipRange key={`${media.id}:${media.trimIn}:${media.stopSeconds}`} media={media} language={language} time={time} onSave={onRange} onPreview={onPreviewRange} />
      <button onClick={() => { seek(media.trimIn ?? 0); playingTrim.current = true; void video.current?.play().catch(() => { playingTrim.current = false; }); }}>{t('Riproduci il taglio', 'Play trimmed clip')}</button>
      <button className="vfb-add-reaction" onClick={onReaction}>+ {t('Reazione', 'Reaction')}</button>
      <p>{t('Vai al momento assurdo, ferma il video e scegli una reazione dalla galleria in alto.', 'Find the absurd moment, stop the video and choose a reaction from the gallery above.')}</p></> : <p>{t('Trascina il fotogramma e regola la dimensione nel pannello del format. Questa disposizione vale per tutte le clip.', 'Drag the frame and adjust its size in the format panel. This layout applies to all clips.')}</p>}
    {expanded && <SourceVideoDialog media={media} language={language} initialTime={time} busy={busy} onClose={position => { setExpanded(false); seek(position); }} onRange={onRange} onPreviewRange={onPreviewRange} />}
  </section>;
}
