import { FormatExportDialog } from './FormatExportDialog';
import { LogoSettings } from './LogoSettings';
import { GlobalTransitions, TransitionDialog } from './TransitionControls';
import { boundaryKey, resolveTransition } from './transitions';
import { FullVideoPreview } from './FullVideoPreview';
import { useEffect, useRef, useState } from 'react';
import { createMemoryEngine } from '../services/memory-engine';
import { importVideoEditorAsset } from '../services/video-editor-import';
import { useProjectStore } from '../store/project-store';
import { newFormat, reactionClips, rowFormat, type FormatMedia, type ScenePreset, type VideoFormat } from './model';
import { readFormats, saveFormat } from './storage';
import { prepareFormat } from './render';
import { StandardCard, StandardEditor } from './MediaEditor';
import { DeleteMediaDialog } from './DeleteMediaDialog';
import { CompositionGrid } from './CompositionGrid';
import { ReactionPicker } from './ReactionPicker';
import { RatioSettings } from './RatioSettings';
import { ReactionMonitor } from './ReactionMonitor';
import { useUiPreferences } from '../services/ui-preferences';
import { formatError } from './copy';
import './video-format.css';

const memory = createMemoryEngine();
async function indexMedia(format: VideoFormat, media: FormatMedia) {
  const category = `video-format-${format.id}`;
  await memory.createCategory({ id: category, name: format.name, description: 'Video Format Builder' });
  await memory.upsertRecord({ id: media.id, path: `/video-formats/${format.id}/${media.id}`, name: media.name, description: media.description, kind: 'video', mimeType: media.file.type, categoryIds: [category] });
}

export function VideoFormatEditor({ onHome, onEditor, initialFormat, onSave }: { onHome: () => void; onEditor: () => void; initialFormat?: VideoFormat; onSave?: (format: VideoFormat) => Promise<void> }) {
  const { language } = useUiPreferences();
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const [formats, setFormats] = useState<VideoFormat[]>([]), [format, setFormat] = useState<VideoFormat | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [trimNotice, setTrimNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(true);
  const [previewRange, setPreviewRange] = useState<{ id: string; start: number; end: number } | null>(null);
  const [activeId, setActiveId] = useState(''), [reactionId, setReactionId] = useState('');
  const [query, setQuery] = useState(''), [results, setResults] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<FormatMedia | null>(null), [autoNext, setAutoNext] = useState(true);
  const standardInput = useRef<HTMLInputElement>(null), variableInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false), importRow = useRef<string | undefined>(undefined);
  const [pickerId, setPickerId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [transitionBoundary, setTransitionBoundary] = useState<[string, string] | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; standard: boolean; name: string; uses: number } | null>(null);
  useEffect(() => { let active = true; void (initialFormat ? Promise.resolve([initialFormat]) : readFormats()).then(items => { if (active) { setFormats(items); setFormat(items[0] ?? null); loaded.current = true; } }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [initialFormat]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const persist = async (value: VideoFormat) => { await (onSave ? onSave(value) : saveFormat(value)); setFormats(items => [...items.filter(item => item.id !== value.id), value]); setSaved(true); };
  const update = (value: VideoFormat) => { setFormat(value); setSaved(false); };
  const change = (patch: Partial<VideoFormat>, rebuild = false) => { if (!format) return; const next = { ...format, ...patch }; if (rebuild) next.clips = reactionClips(next); update(next); };
  const active = format?.uploads.find(item => item.id === activeId) ?? format?.uploads[0];
  const chosenId = active?.reactionId ?? reactionId;
  const reaction = format?.library.find(item => item.id === chosenId);
  const scene = format?.scenes[0];

  const shown = format ? results === null ? format.library.filter(item => `${item.name} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : results.flatMap(id => format.library.filter(item => item.id === id)) : [];
  const switchFormat = async (id: string) => { if (format) await persist(format); setFormat(formats.find(item => item.id === id) ?? null); setPreviewRange(null); setActiveId(''); setReactionId(''); setQuery(''); setResults(null); };
  const importFiles = async (files: File[], standard: boolean) => {
    if (!format || !files.length) return;
    await run(async () => {
      let next = format; let firstImported = true;
      for (const file of files) {
        const { asset } = await importVideoEditorAsset(file);
        try {
          if (asset.kind !== 'video' || !Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0) throw new Error('Seleziona un video con durata valida.');
          const media: FormatMedia = { id: crypto.randomUUID(), file, name: file.name.replace(/\.[^.]+$/, ''), description: '', duration: asset.durationSeconds, width: asset.width, height: asset.height };
          if (standard) { setEditing(media); return; }
          if (importRow.current) media.rowId = importRow.current;
          next = { ...next, uploads: [...next.uploads, media] };
          await persist(next); setFormat(next);
          if (!active && firstImported) setActiveId(media.id); firstImported = false;
        } finally { URL.revokeObjectURL(asset.url); if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl); }
      }
    });
  };
  const selectReaction = (media: FormatMedia) => {
    setReactionId(media.id);
    if (format && active) change({ uploads: format.uploads.map(item => item.id === active.id ? { ...item, reactionId: media.id } : item) }, true);
  };
  const mark = (time: number) => {
    if (!format || !active || !Number.isFinite(time) || time <= (active.trimIn ?? 0) || time > active.duration) return;
    void run(async () => {
      const next = { ...format, uploads: format.uploads.map(item => item.id === active.id ? { ...item, stopSeconds: time, ...(chosenId ? { reactionId: chosenId } : {}) } : item) };
      next.clips = reactionClips(next); await persist(next); setFormat(next);
      if (autoNext && chosenId) {
        const remaining = next.uploads.find(item => item.id !== active.id && item.stopSeconds === undefined);
        if (remaining) { setPreviewRange(null); setActiveId(remaining.id); setReactionId(chosenId); }
      }
    });
  };
  const updateScene = (patch: Partial<ScenePreset>) => { if (format && scene) change({ scenes: [{ ...scene, ...patch }, ...format.scenes.slice(1)] }, true); };
  const deleteMedia = (id: string, standard: boolean) => {
    if (!format) return;
    const media = (standard ? format.library : format.uploads).find(item => item.id === id);
    if (!media) return;
    const uses = standard ? format.uploads.filter(item => item.reactionId === id).length : 0;
    setError(''); setDeleting({ id, standard, name: media.name, uses });
  };
  const confirmDelete = () => {
    if (!format || !deleting) return;
    const { id, standard } = deleting;
    void run(async () => {
      const uploads = standard ? format.uploads.map(item => { if (item.reactionId !== id) return item; const next = { ...item }; delete next.reactionId; return next; }) : format.uploads.filter(item => item.id !== id);
      const next = { ...format, library: standard ? format.library.filter(item => item.id !== id) : format.library, uploads };
      next.clips = reactionClips(next);
      await persist(next); setFormat(next); setDeleting(null);
      if (standard && reactionId === id) setReactionId('');
      if (!standard && activeId === id) setActiveId('');
      if (pickerId === id) setPickerId('');
      if (standard) { setResults(null); await memory.deleteRecord(id); }
    });
  };
  const setRange = (id: string, start: number, end: number) => {
    if (!format) return;
    const media = format.uploads.find(item => item.id === id);
    if (!media || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > media.duration) return;
    void run(async () => {
      const next = { ...format, uploads: format.uploads.map(item => item.id === id ? { ...item, trimIn: start, stopSeconds: end } : item) };
      next.clips = reactionClips(next);
      await persist(next); setFormat(next); setPreviewRange(null);
      setTrimNotice(t(`Taglio applicato a ${media.name}: ${start.toFixed(2)}–${end.toFixed(2)} s · durata ${(end - start).toFixed(2)} s`, `Trim applied to ${media.name}: ${start.toFixed(2)}–${end.toFixed(2)} s · duration ${(end - start).toFixed(2)} s`));
    });
  };
  const createVideo = (rowId: string) => { if (!format) return; void run(async () => { const selected = rowFormat(format, rowId); await persist(format); const project = await prepareFormat(selected); useProjectStore.getState().setProject(project, null); onEditor(); }); };
  return <main className="format-builder" data-ui-copy>
    <header className="vfb-header"><button disabled={busy} onClick={() => void run(async () => { if (format) await persist(format); onHome(); })}>← {initialFormat ? t('Video del format', 'Format videos') : t('Aree', 'Areas')}</button><div><small>MLSM STUDIO / VIDEO FORMAT BUILDER</small><h1>{t('Il momento. La reazione.', 'The moment. The reaction.')}</h1></div>{!initialFormat && <><select aria-label={t('Scegli format', 'Choose format')} disabled={busy || !formats.length} value={format?.id ?? ''} onChange={event => void run(() => switchFormat(event.target.value))}>{formats.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy || !loaded.current} onClick={() => void run(async () => { if (format) await persist(format); const next = newFormat(language); await persist(next); setFormat(next); setPreviewRange(null); setActiveId(''); setReactionId(''); setQuery(''); setResults(null); })}>+ {t('Nuovo format', 'New format')}</button></>}<button disabled={busy || !format} onClick={() => void run(async () => { if (format) await persist(format); })}>{t('Salva format e bozza', 'Save format and draft')}</button><button className="vfb-primary" disabled={busy || !format?.uploads.length} onClick={() => setExporting(true)}>{t('Esporta video', 'Export video')} ↑</button></header>
    <div className="vfb-feedback">{error && <p role="alert">{formatError(language, error)}</p>}<span role="status">{busy ? t('Elaborazione in corso…', 'Processing…') : saved ? t('Format e bozza salvati sul dispositivo.', 'Format and draft saved on this device.') : format ? t('Modifiche da salvare', 'Unsaved changes') : t('Crea un format per iniziare.', 'Create a format to get started.')}</span></div>
    {trimNotice && <p className="vfb-trim-notice" role="status">{trimNotice}</p>}
    <div className="vfb-with-preview"><div className="vfb-authoring">
    {format && <fieldset disabled={busy} className="vfb-workspace">
      <section className="vfb-gallery"><header><div><small>01 / {t('RIUTILIZZI SEMPRE', 'REUSE EVERY TIME')}</small><h2>{t('I tuoi video standard', 'Your standard videos')} <span>{format.library.length}</span></h2><p>{t('Reazioni pronte: taglia, dai un nome, poi scegli quella da inserire.', 'Ready-to-use reactions: trim, name, then choose one to insert.')}</p></div><button className="vfb-primary" onClick={() => standardInput.current?.click()}>+ {t('Aggiungi video standard', 'Add standard video')}</button></header>
        <input ref={standardInput} type="file" accept="video/*" hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files, true); }} />
        <div className="vfb-search"><input aria-label={t('Cerca reazioni', 'Search reactions')} placeholder={t('Cerca un nome o descrivi la reazione…', 'Search a name or describe the reaction…')} value={query} onChange={event => { setQuery(event.target.value); setResults(null); }} /><button onClick={() => void run(async () => { for (const item of format.library) await indexMedia(format, item); const matches = await memory.search(query, { categoryIds: [`video-format-${format.id}`], kinds: ['video'], limit: 200 }); setResults(matches.map(item => item.record.id)); })}>{t('Ricerca semantica', 'Semantic search')}</button></div>
        <div className="vfb-gallery-strip">{shown.map(media => <StandardCard key={media.id} media={media} selected={chosenId === media.id} language={language} onSelect={() => selectReaction(media)} onEdit={() => setEditing(media)} onDelete={() => deleteMedia(media.id, true)} />)}{!shown.length && <div className="vfb-gallery-empty"><strong>{t('Qui vanno i video che userai sempre.', 'This is where your reusable videos go.')}</strong><p>{t('Carica una reazione, seleziona inizio e fine e salvala con il suo nome.', 'Upload a reaction, choose its start and end and save it by name.')}</p></div>}</div>
      </section>
      <input ref={variableInput} type="file" accept="video/*" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files, false); }} />
      <CompositionGrid onTransition={(from, to) => setTransitionBoundary([from, to])} format={format} language={language} activeId={active?.id} expandedId={editorOpen ? active?.id : undefined} renderEditor={() => (active ? <ReactionMonitor key={`${format.id}:${active.id}`} media={active} reaction={reaction} format={format} language={language} busy={busy} onPreviewRange={(start, end) => setPreviewRange({ id: active.id, start, end })} onMark={mark} onRange={(start, end) => setRange(active.id, start, end)} onReaction={() => setPickerId(active.id)} onScene={updateScene} onDimensions={(width, height) => change({ uploads: format.uploads.map(item => item.id === active.id ? { ...item, width, height } : item) })} /> : <section className="vfb-monitor vfb-empty"><span>▶</span><h2>{t('Porta qui il momento divertente.', 'Bring the funny moment here.')}</h2><p>{t('Carica un video nuovo nella griglia qui sopra. Le tue reazioni restano nella galleria in alto.', 'Upload a new video in the grid above. Your reactions stay in the gallery above.')}</p></section>)} onActive={id => { setEditorOpen(active?.id === id ? !editorOpen : true); setActiveId(id); setPreviewRange(null); }} onReaction={id => { setActiveId(id); setPickerId(id); }} onUpload={rowId => { importRow.current = rowId; variableInput.current?.click(); }} onChange={uploads => change({ uploads }, true)} onCreate={createVideo} onDelete={id => deleteMedia(id, false)} />
      <label className="vfb-check"><input type="checkbox" checked={autoNext} onChange={event => setAutoNext(event.target.checked)} />{t('Dopo “Ferma qui”, passa al prossimo', 'After “Stop here”, go to the next')}</label>
    </fieldset>}
    </div>{format && <FullVideoPreview format={previewRange ? { ...format, uploads: format.uploads.map(media => media.id === previewRange.id ? { ...media, trimIn: previewRange.start, stopSeconds: previewRange.end } : media) } : format} activeId={active?.id} language={language} />}{format && <fieldset className="vfb-options-sidebar" disabled={busy}>

      <aside className="vfb-format-settings"><small>03 / {t('REGOLE DEL FORMAT', 'FORMAT RULES')}</small><h2>{t('Una volta per tutti', 'Set once, use for all')}</h2><label>{t('Nome del format', 'Format name')}<input value={format.name} onChange={event => change({ name: event.target.value })} /></label><label>{t('Formato', 'Aspect ratio')}<select value={format.aspect} onChange={event => change({ aspect: event.target.value as VideoFormat['aspect'] })}><option>9:16</option><option>16:9</option></select></label><RatioSettings key={format.id} format={format} active={active} language={language} onChange={ratioRules => change({ ratioRules }, true)} />
        <LogoSettings logo={format.logo} language={language} onChange={logo => change({ logo })} onUpload={file => void run(async () => {
          if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error(t('Scegli un logo PNG, WebP o JPEG.', 'Choose a PNG, WebP or JPEG logo.'));
          const imported = await importVideoEditorAsset(file);
          try {
            if (imported.asset.kind !== 'image' || !imported.asset.width || !imported.asset.height) throw new Error(t('Logo non valido.', 'Invalid logo.'));
            change({ logo: { file, width: imported.asset.width, height: imported.asset.height, size: format.logo?.size ?? .18, x: format.logo?.x ?? .95, y: format.logo?.y ?? .05 } });
          } finally { URL.revokeObjectURL(imported.asset.url); if (imported.asset.thumbnailUrl && imported.asset.thumbnailUrl !== imported.asset.url) URL.revokeObjectURL(imported.asset.thumbnailUrl); }
        })} />
        <GlobalTransitions format={format} language={language} onChange={transitionDefaults => change({ transitionDefaults, transitions: {} })} />
        {scene && <><label className="vfb-check"><input type="checkbox" checked={scene.freeze} onChange={event => updateScene({ freeze: event.target.checked })} />{t('Mantieni il fotogramma durante la reazione', 'Keep the frame during the reaction')}</label><label>{t('Zoom reazione', 'Reaction zoom')} · {scene.zoom.toFixed(2)}×<input type="range" min="0.1" max="6" step="0.05" value={scene.zoom} onChange={event => updateScene({ zoom: Number(event.target.value) })} /></label>{scene.freeze && <>{(['x', 'y', 'scale'] as const).map(key => <label key={key}>{key === 'x' ? t('Posizione orizzontale', 'Horizontal position') : key === 'y' ? t('Posizione verticale', 'Vertical position') : t('Dimensione fotogramma', 'Frame size')} · {scene[key].toFixed(2)}<input type="range" min={key === 'scale' ? .05 : -1} max="1" step="0.01" value={scene[key]} onChange={event => updateScene({ [key]: Number(event.target.value) })} /></label>)}</>}</>}
      </aside>
</fieldset>}</div>
    {format && exporting && <FormatExportDialog format={format} activeId={active?.id} language={language} onClose={() => setExporting(false)} />}
    {format && transitionBoundary && <TransitionDialog value={resolveTransition(format, ...transitionBoundary)} language={language} onClose={() => setTransitionBoundary(null)} onSave={value => { change({ transitions: { ...format.transitions, [boundaryKey(...transitionBoundary)]: value } }); setTransitionBoundary(null); }} />}
    {deleting && <DeleteMediaDialog name={deleting.name} standard={deleting.standard} uses={deleting.uses} language={language} busy={busy} error={error ? formatError(language, error) : ''} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />}
    {format && pickerId && format.uploads.find(media => media.id === pickerId) && <ReactionPicker target={format.uploads.find(media => media.id === pickerId)!} library={format.library} language={language} onClose={() => setPickerId('')} onSelect={id => { change({ uploads: format.uploads.map(media => media.id === pickerId ? { ...media, reactionId: id } : media) }, true); setReactionId(id); setPickerId(''); }} />}
    {editing && format && <StandardEditor key={editing.id} media={editing} language={language} busy={busy} onClose={() => setEditing(null)} onSave={media => void run(async () => { const exists = format.library.some(item => item.id === media.id); const next = { ...format, library: exists ? format.library.map(item => item.id === media.id ? media : item) : [...format.library, media] }; await indexMedia(next, media); await persist(next); setFormat(next); setEditing(null); setReactionId(media.id); setQuery(''); setResults(null); })} />}
  </main>;
}

export { VideoFormatHome as VideoFormatWorkspace } from './VideoFormatHome';
