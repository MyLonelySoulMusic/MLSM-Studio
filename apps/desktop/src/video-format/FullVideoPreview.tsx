import { logoLayout } from './logo';
import { timedTransitions } from './transitions';
import { sceneTransitionFrame } from '../services/scene-transitions';
import { useEffect, useRef, useState } from 'react';
import { compositionRows, ratioRule, type VideoFormat } from './model';
import type { UiLanguage } from '../services/ui-preferences';
import { PalettePreview } from './PalettePreview';
import { useMediaUrl } from './useMediaUrl';
import { lastFrame } from './render';

export function FullVideoPreview({ format, activeId, language }: { format: VideoFormat; activeId: string | undefined; language: UiLanguage }) {
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const rows = compositionRows(format), row = rows.find(item => item.media.some(media => media.id === activeId)) ?? rows[0];
  let duration = 0;
  const segments = row?.media.flatMap(media => {
    const start = media.trimIn ?? 0, end = media.stopSeconds ?? media.duration;
    const source = { key: `${media.id}-source`, media, start, end, at: duration, previous: null as typeof media | null };
    duration += end - start;
    const reaction = format.library.find(item => item.id === media.reactionId);
    if (!reaction) return [source];
    const next = { key: `${media.id}-reaction`, media: reaction, start: reaction.trimIn ?? 0, end: reaction.trimOut ?? reaction.duration, at: duration, previous: media };
    duration += next.end - next.start;
    return [source, next];
  }) ?? [];
  const signature = JSON.stringify([row?.id, segments.map(item => [item.key, item.media.id, item.start, item.end])]);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null), desiredTime = useRef(0);
  const current = segments.find(item => time < item.at + item.end - item.start - .00001) ?? segments.at(-1);
  const url = useMediaUrl(current?.media.file);
  const logoUrl = useMediaUrl(format.logo?.file);
  const logo = format.logo ? logoLayout(format.logo, format.aspect) : null;
  const scene = format.scenes[0];
  const previous = current?.previous;
  const [frames, setFrames] = useState<{ file: File; time: number; url: string }[]>([]);
  const [loadedStill, setLoadedStill] = useState('');
  const [loadedVideo, setLoadedVideo] = useState('');
  const still = frames.find(frame => frame.file === previous?.file && frame.time === (previous.stopSeconds ?? previous.duration))?.url;
  const waitingForVideo = loadedVideo !== current?.key;
  const waitingForStill = !!(previous && scene?.freeze && (!still || loadedStill !== still));
  useEffect(() => { const selected = segments.find(item => item.key === `${activeId}-source`); const at = selected?.at ?? 0; setTime(at); desiredTime.current = at; setPlaying(false); video.current?.pause(); if (selected && current?.key === selected.key && video.current) video.current.currentTime = selected.start; setError('');
  // Reset only when the sequence or selected clip changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, activeId]);
  useEffect(() => {
    setFrames([]);
    if (!scene?.freeze) return;
    let active = true;
    const urls: string[] = [];
    for (const media of row?.media ?? []) {
      if (!media.reactionId) continue;
      const stop = media.stopSeconds ?? media.duration;
      void lastFrame(media.file, stop).then(file => {
        if (!active) return;
        const url = URL.createObjectURL(file);
        urls.push(url);
        setFrames(frames => [...frames, { file: media.file, time: stop, url }]);
      }).catch(() => { if (active) { setPlaying(false); setError(t('Fermo immagine non disponibile.', 'Still frame unavailable.')); } });
    }
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  // Playback time must not restart frame extraction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format.uploads, row?.id, scene?.freeze]);
  useEffect(() => {
    const element = video.current;
    if (!element || !playing || waitingForStill || waitingForVideo) return;
    let active = true;
    void element.play().catch(() => { if (active) { setPlaying(false); setError(t('Riproduzione non disponibile.', 'Playback unavailable.')); } });
    return () => { active = false; element.pause(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, waitingForStill, waitingForVideo, current?.key]);
  useEffect(() => {
    const element = video.current;
    if (!element || !current || !playing || waitingForStill || waitingForVideo) return;
    let request = 0, active = true;
    const update = (sourceTime: number) => {
      if (!active || element.seeking) return;
      if (sourceTime >= current.end) {
        element.pause();
        const end = current.at + current.end - current.start;
        desiredTime.current = end;
        if (end < duration - .001) setLoadedVideo('');
        setTime(end);
        if (end >= duration - .001) setPlaying(false);
        active = false;
      } else {
        setTime(current.at + Math.max(0, sourceTime - current.start));
      }
    };
    const frame: VideoFrameRequestCallback = (_now, metadata) => {
      update(metadata.mediaTime);
      if (active) request = element.requestVideoFrameCallback(frame);
    };
    const tick = () => { update(element.currentTime); if (active) request = requestAnimationFrame(tick); };
    const nativeFrames = typeof element.requestVideoFrameCallback === 'function';
    request = nativeFrames ? element.requestVideoFrameCallback(frame) : requestAnimationFrame(tick);
    return () => { active = false; if (nativeFrames) element.cancelVideoFrameCallback(request); else cancelAnimationFrame(request); };
  // Segment objects are rebuilt as the playhead advances; only their bounds restart the clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, waitingForStill, waitingForVideo, current?.key, current?.start, current?.end, current?.at, duration]);
  const seek = (value: number) => {
    video.current?.pause(); setLoadedVideo('');
    desiredTime.current = value; setTime(value); setError('');
    if (current && value >= current.at && value < current.at + current.end - current.start && video.current) video.current.currentTime = current.start + value - current.at;
  };
  const finish = () => {
    if (!current) return;
    video.current?.pause();
    const end = current.at + current.end - current.start;
    if (end >= duration - .001) { setPlaying(false); setTime(duration); video.current?.pause(); }
    else { setLoadedVideo(''); desiredTime.current = end; setTime(end); }
  };
  const play = () => { setError(''); if (playing) { setPlaying(false); video.current?.pause(); } else { if (time >= duration) seek(0); setPlaying(true); } };
  const transition = sceneTransitionFrame(timedTransitions(format, segments), time);
  const rule = ratioRule(format, current?.media ?? {});
  return <aside className="vfb-full-preview" aria-label={t('Anteprima video completo', 'Full video preview')}><header><small>{t('RISULTATO FINALE', 'FINAL RESULT')}</small><h2>{t('Anteprima video completo', 'Full video preview')}</h2><p>{row ? `${t('Riga', 'Row')} ${rows.indexOf(row) + 1} · ${row.media.length} ${t('segmenti', 'segments')}` : t('Carica una clip per iniziare', 'Upload a clip to start')}</p></header>
    <div className="vfb-stage" style={{ aspectRatio: format.aspect.replace(':', '/'), width: format.aspect === '9:16' ? 'min(100%, 33.75vh)' : '100%', background: transition?.background ?? '#000', containerType: 'inline-size' }}>
      <div className="vfb-transition-composition" style={transition ? { opacity: transition.opacity, transform: `translateX(${transition.x * 100}%) scale(${transition.scale})`, filter: `blur(${transition.blur * 100}cqw)`, clipPath: `inset(${transition.insetY * 100}% ${transition.insetX * 100}%)` } : undefined}>
      {current && <>{!previous && !waitingForVideo && <PalettePreview key={current.key} video={video} rule={rule} aspect={format.aspect} />}
        <video key={`${current.key}:${current.media.id}`} ref={video} src={url || undefined} playsInline preload="auto" style={{ visibility: waitingForVideo || waitingForStill ? 'hidden' : 'visible', objectFit: previous ? 'contain' : rule.fit, transform: `scale(${previous ? scene?.zoom ?? 1 : rule.zoom})` }} onLoadedMetadata={event => { event.currentTarget.currentTime = current.start + Math.max(0, desiredTime.current - current.at); }} onSeeking={() => setLoadedVideo('')} onSeeked={event => { if (event.currentTarget.readyState >= 2) setLoadedVideo(current.key); }} onLoadedData={event => { if (!event.currentTarget.seeking) setLoadedVideo(current.key); }} onTimeUpdate={event => { if (!playing || waitingForStill || waitingForVideo || event.currentTarget.seeking || typeof event.currentTarget.requestVideoFrameCallback === 'function') return; const sourceTime = event.currentTarget.currentTime; if (sourceTime >= current.end) finish(); else setTime(current.at + Math.max(0, sourceTime - current.start)); }} onEnded={finish} onError={() => { setPlaying(false); setError(t('Video non disponibile.', 'Video unavailable.')); }} />
        {previous && scene?.freeze && still && <div className="vfb-preview-still" style={{ visibility: waitingForVideo || waitingForStill ? 'hidden' : 'visible', transform: `translate(${scene.x * 50}%, ${scene.y * 50}%) scale(${scene.scale})` }}><img src={still} alt="" onLoad={() => setLoadedStill(still)} /></div>}
      </>}
      {logo && logoUrl && <img className="vfb-logo-overlay" src={logoUrl} alt={t('Logo del format', 'Format logo')} style={{ position: 'absolute', left: `${logo.left * 100}%`, top: `${logo.top * 100}%`, width: `${logo.width * 100}%`, height: `${logo.height * 100}%`, objectFit: 'contain', pointerEvents: 'none' }} />}
      </div>
    </div>
    <div className="vfb-full-transport"><button disabled={!current} onClick={play}>{playing ? t('Pausa', 'Pause') : t('Riproduci tutto', 'Play all')}</button><button disabled={!current} onClick={() => { setPlaying(false); video.current?.pause(); seek(0); }}>{t('Da capo', 'Restart')}</button><span>{time.toFixed(1)} / {duration.toFixed(1)} s</span></div>
    <input aria-label={t('Posizione nel video completo', 'Full video position')} type="range" min="0" max={duration || 1} step="0.01" value={time} disabled={!current} onChange={event => seek(Number(event.target.value))} />
    {waitingForStill && !error && <p role="status">{t('Preparazione del fermo immagine…', 'Preparing still frame…')}</p>}
    {error && <p role="alert">{error}</p>}
    {row?.media.some(media => media.stopSeconds === undefined || !media.reactionId) && <p>{t('Bozza: le clip senza taglio usano tutta la durata; aggiungi le reazioni mancanti con +.', 'Draft: untrimmed clips use their full length; add missing reactions with +.')}</p>}
    <p>{t('Segue la riga selezionata e si aggiorna con le modifiche.', 'Follows the selected row and updates with your edits.')}</p>
  </aside>;
}
