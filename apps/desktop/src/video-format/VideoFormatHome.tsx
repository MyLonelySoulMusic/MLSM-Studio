import { useEffect, useRef, useState } from 'react';
import { VideoFormatEditor } from './VideoFormatWorkspace';
import { newFormat, type VideoFormat } from './model';
import { cleanTemplate, deleteFormatVideo, readFormats, readFormatVideos, saveFormat, saveFormatVideo, type SavedFormatVideo } from './storage';
import { useUiPreferences } from '../services/ui-preferences';

function DeleteVideo({ name, busy, onClose, onDelete }: { name: string; busy: boolean; onClose: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), { language } = useUiPreferences(), it = language === 'it';
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="vfb-dialog" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><h2>{it ? 'Elimina montaggio' : 'Delete composition'}</h2><p>{name}</p><p>{it ? 'Il montaggio verrà eliminato. I video standard e i loro tagli rimarranno nel format. I file esportati sul disco non vengono eliminati.' : 'The composition will be deleted. Standard videos and their trims remain in the format. Exported files on disk are not deleted.'}</p><footer><button disabled={busy} onClick={onClose}>{it ? 'Annulla' : 'Cancel'}</button><button disabled={busy} onClick={onDelete}>{it ? 'Elimina' : 'Delete'}</button></footer></dialog>;
}
export function VideoFormatHome({ onHome, onEditor }: { onHome: () => void; onEditor: () => void }) {
  const { language } = useUiPreferences(), it = language === 'it', t = (a: string, b: string) => it ? a : b;
  const [formats, setFormats] = useState<VideoFormat[]>([]), [videos, setVideos] = useState<SavedFormatVideo[]>([]);
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<SavedFormatVideo | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [deleting, setDeleting] = useState<SavedFormatVideo | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const items = await readFormats(), saved = await readFormatVideos();
        // Preserve the previous editor contents as a named composition, once only.
        for (const format of items) if (format.uploads.length) {
          const id = `legacy-${format.id}`;
          if (!saved.some(video => video.id === id)) {
            const video = { id, formatId: format.id, name: t('Montaggio precedente', 'Previous composition'), updatedAt: Date.now(), snapshot: format };
            await saveFormatVideo(video); saved.push(video);
          } else await saveFormat(cleanTemplate(format));
        }
        if (active) { setFormats(items.map(cleanTemplate)); setVideos(saved); }
      } catch (reason) { if (active) setError(String(reason)); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  // Language changes do not reload or migrate stored data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } };
  const template = formats.find(format => format.id === selected);
  const store = async (snapshot: VideoFormat) => {
    if (!editing) return;
    const video = { ...editing, snapshot, updatedAt: Date.now() };
    await saveFormatVideo(video);
    setVideos(items => [...items.filter(item => item.id !== video.id), video]);
    setFormats(items => items.map(item => item.id === snapshot.id ? cleanTemplate(snapshot) : item));
  };
  if (editing) return <VideoFormatEditor key={editing.id} initialFormat={editing.snapshot} onSave={store} onHome={() => setEditing(null)} onEditor={onEditor} />;
  return <main className="format-builder vfb-home" data-ui-copy>
    <header className="vfb-header"><button disabled={busy} onClick={() => selected ? setSelected(null) : onHome()}>← {selected ? t('Tutti i format', 'All formats') : t('Aree', 'Areas')}</button><div><small>VIDEO FORMAT BUILDER</small><h1>{template?.name ?? t('I tuoi format', 'Your formats')}</h1></div></header>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">{t('Caricamento…', 'Loading…')}</p>}
    {!selected ? <>
      <p>{t('Scegli un format per vedere i montaggi salvati o crearne uno nuovo.', 'Choose a format to view saved compositions or create a new one.')}</p>
      <form onSubmit={event => { event.preventDefault(); if (!name.trim()) return; void run(async () => { const format = { ...newFormat(language), name: name.trim() }; await saveFormat(format); setFormats(items => [...items, format]); setSelected(format.id); setName(''); }); }}><label>{t('Nome nuovo format', 'New format name')}<input value={name} onChange={event => setName(event.target.value)} /></label><button disabled={busy || !name.trim()} className="vfb-primary">+ {t('Crea format', 'Create format')}</button></form>
      <div className="vfb-home-cards">{formats.map(format => <button disabled={busy} key={format.id} onClick={() => setSelected(format.id)}><h2>{format.name}</h2><p>{format.aspect} · {format.library.length} {t('video standard', 'standard videos')}</p><p>{videos.filter(video => video.formatId === format.id).length} {t('montaggi salvati', 'saved compositions')}</p></button>)}</div>
      {!busy && !formats.length && <p>{t('Crea il primo format per iniziare.', 'Create your first format to get started.')}</p>}
    </> : template && <>
      <p>{t('Ogni nuovo montaggio parte senza clip nuove. Reaction tagliate, logo e regole del format restano disponibili.', 'Each new composition starts without new clips. Trimmed reactions, logo and format rules remain available.')}</p>
      <form onSubmit={event => { event.preventDefault(); void run(async () => {
        const video: SavedFormatVideo = { id: crypto.randomUUID(), formatId: template.id, name: name.trim() || t('Nuovo video', 'New video'), updatedAt: Date.now(), snapshot: cleanTemplate(template) };
        await saveFormatVideo(video); setVideos(items => [...items, video]); setEditing(video); setName('');
      }); }}><label>{t('Nome del nuovo video', 'New video name')}<input value={name} onChange={event => setName(event.target.value)} /></label><button disabled={busy} className="vfb-primary">+ {t('Crea nuovo', 'Create new')}</button></form>
      <div className="vfb-home-cards">{videos.filter(video => video.formatId === selected).sort((a,b) => b.updatedAt - a.updatedAt).map(video => <article key={video.id}><h2>{video.name}</h2><p>{video.snapshot.uploads.length} {t('blocchi', 'blocks')} · {new Date(video.updatedAt).toLocaleString(it ? 'it-IT' : 'en-GB')}</p><button disabled={busy} onClick={() => setEditing(video)}>{t('Apri montaggio', 'Open composition')}</button><button disabled={busy} onClick={() => setDeleting(video)}>{t('Elimina video', 'Delete video')}</button></article>)}</div>
      {!videos.some(video => video.formatId === selected) && <p>{t('Nessun video ancora. Premi Crea nuovo per iniziare.', 'No videos yet. Choose Create new to start.')}</p>}
    </>}
    {deleting && <DeleteVideo name={deleting.name} busy={busy} onClose={() => setDeleting(null)} onDelete={() => void run(async () => { await deleteFormatVideo(deleting.id); setVideos(items => items.filter(item => item.id !== deleting.id)); setDeleting(null); })} />}
  </main>;
}
