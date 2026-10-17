import { reorderBlocks } from './reorder';
import { Fragment, useState } from 'react';
import { TransitionButton } from './TransitionControls';
import { compositionRows, type FormatMedia, type VideoFormat } from './model';
import type { UiLanguage } from '../services/ui-preferences';
import type { ReactNode } from 'react';
import { useMediaUrl } from './useMediaUrl';
function ClipPoster({ media }: { media: FormatMedia }) { const url = useMediaUrl(media.file); return <video muted preload="metadata" src={url || undefined} onLoadedMetadata={event => { event.currentTarget.currentTime = media.trimIn ?? 0; }} />; }
export function CompositionGrid({ format, language, activeId, onActive, renderEditor, expandedId, onReaction, onUpload, onChange, onCreate, onDelete, onTransition }: { onTransition?: (from: string, to: string) => void; format: VideoFormat; language: UiLanguage; activeId: string | undefined; onActive: (id: string) => void; renderEditor: () => ReactNode; expandedId: string | undefined; onReaction: (id: string) => void; onUpload: (rowId?: string) => void; onChange: (uploads: FormatMedia[]) => void; onCreate: (rowId: string) => void; onDelete: (id: string) => void }) {
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const rows = compositionRows(format);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const move = (id: string, position: number) => onChange(reorderBlocks(format.uploads, id, position));
  const clearDrag = () => { setDragging(null); setDrop(null); };
  return <section className="vfb-compositions"><header><div><h2>{t('Video nuovi', 'New videos')}</h2><p>{t('Una riga = un video finale. Le colonne si riproducono da sinistra a destra: clip + reazione, poi clip + reazione.', 'One row = one final video. Columns play left to right: clip + reaction, then clip + reaction.')}</p></div><button className="vfb-primary" onClick={() => onUpload()}>+ {t('Carica video su nuove righe', 'Upload videos to new rows')}</button></header>
    {!!rows.length && <p>{t('Trascina la maniglia ⠿ o scegli la posizione del blocco: video nuovo e reazione si spostano insieme, mantenendo i tagli.', 'Drag the ⠿ handle or choose the block position: new video and reaction move together, preserving trims.')}</p>}
    {!rows.length && <p>{t('Carica più video insieme: ognuno avrà la propria riga.', 'Upload multiple videos together: each gets its own row.')}</p>}
    {rows.map((row, index) => <article className="vfb-composition-row" key={row.id} aria-label={`${t('Video finale', 'Final video')} ${index + 1}`}><header><strong>{t('Video finale', 'Final video')} {index + 1}</strong><span>{row.media.length} {t('segmenti consecutivi', 'consecutive segments')}</span><button disabled={row.media.some(media => media.stopSeconds === undefined || !media.reactionId)} onClick={() => onCreate(row.id)}>{t('Crea questa riga →', 'Create this row →')}</button></header><div className="vfb-columns">
      {row.media.map((media, column) => <Fragment key={media.id}>{column > 0 && onTransition && <TransitionButton format={format} language={language} from={`${row.media[column - 1]!.id}-${row.media[column - 1]!.reactionId ? 'reaction' : 'source'}`} to={`${media.id}-source`} onClick={() => onTransition(`${row.media[column - 1]!.id}-${row.media[column - 1]!.reactionId ? 'reaction' : 'source'}`, `${media.id}-source`)} />}<div className={`vfb-segment${activeId === media.id ? ' active' : ''}${dragging === media.id ? ' vfb-dragging' : ''}${drop?.id === media.id ? (drop.after ? ' vfb-drop-after' : ' vfb-drop-before') : ''}`} key={media.id}
        onDragOver={event => {
          if (!dragging || dragging === media.id || !row.media.some(item => item.id === dragging)) return;
          event.preventDefault(); event.dataTransfer.dropEffect = 'move';
          const bounds = event.currentTarget.getBoundingClientRect();
          setDrop({ id: media.id, after: event.clientX > bounds.left + bounds.width / 2 });
          const scroller = event.currentTarget.closest('.vfb-columns');
          if (scroller) { const box = scroller.getBoundingClientRect(); if (event.clientX > box.right - 60) scroller.scrollLeft += 24; else if (event.clientX < box.left + 60) scroller.scrollLeft -= 24; }
        }}
        onDrop={event => {
          event.preventDefault();
          if (dragging && drop?.id === media.id && row.media.some(item => item.id === dragging)) {
            const from = row.media.findIndex(item => item.id === dragging);
            move(dragging, column + (drop.after ? 1 : 0) - (from < column ? 1 : 0));
          }
          clearDrag();
        }}>
        <div className="vfb-block-heading"><button className="vfb-drag-handle" draggable aria-label={`${t('Trascina blocco', 'Drag block')} ${media.name}`} title={t('Trascina per spostare video e reazione insieme', 'Drag to move video and reaction together')} onDragStart={event => { setDragging(media.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', media.id); }} onDragEnd={clearDrag}>⠿</button><small>{t('BLOCCO', 'BLOCK')} {column + 1}</small></div><div className="vfb-segment-pair"><button className="vfb-source-preview" onClick={() => onActive(media.id)} aria-expanded={expandedId === media.id} aria-label={`${t('Modifica clip', 'Edit clip')} ${media.name}`}><ClipPoster media={media} /><strong>{media.name}</strong></button>{media.reactionId && onTransition && <TransitionButton format={format} language={language} from={`${media.id}-source`} to={`${media.id}-reaction`} onClick={() => onTransition(`${media.id}-source`, `${media.id}-reaction`)} />}<button className="vfb-add-reaction" aria-label={`${t('Aggiungi reazione a', 'Add reaction to')} ${media.name}`} onClick={() => onReaction(media.id)}><b>+</b><span>{format.library.find(item => item.id === media.reactionId)?.name ?? t('Reazione', 'Reaction')}</span></button></div>
        <p>{t('Taglio', 'Trim')}: {(media.trimIn ?? 0).toFixed(2)}–{(media.stopSeconds ?? media.duration).toFixed(2)} s</p>
        <button aria-expanded={expandedId === media.id} onClick={() => onActive(media.id)}>{expandedId === media.id ? t('Chiudi modifica', 'Collapse editor') : t('Modifica inizio e fine', 'Edit start and end')}</button>
        <label className="vfb-block-position">{t('Ordine del blocco', 'Block order')}<select aria-label={`${t('Posizione blocco', 'Block position')} ${media.name}`} value={column} onChange={event => move(media.id, Number(event.target.value))}>{row.media.map((item, i) => <option key={item.id} value={i}>{i + 1} / {row.media.length}</option>)}</select></label>
        <div className="vfb-segment-actions"><button aria-label={`${t('Sposta prima', 'Move earlier')} ${media.name}`} disabled={!column} onClick={() => move(media.id, column - 1)}>←</button><button aria-label={`${t('Sposta dopo', 'Move later')} ${media.name}`} disabled={column === row.media.length - 1} onClick={() => move(media.id, column + 1)}>→</button><select aria-label={`${t('Riga di', 'Row for')} ${media.name}`} value={row.id} onChange={event => onChange(format.uploads.map(item => item.id === media.id ? { ...item, rowId: event.target.value === '__new' ? crypto.randomUUID() : event.target.value } : { ...item, rowId: item.rowId ?? item.id }))}>{rows.map((target, i) => <option key={target.id} value={target.id}>{t('Riga', 'Row')} {i + 1}</option>)}<option value="__new">{t('Nuova riga separata', 'New separate row')}</option></select><button className="vfb-delete" aria-label={`${t('Elimina clip', 'Delete clip')} ${media.name}`} onClick={() => onDelete(media.id)}>{t('Elimina clip', 'Delete clip')}</button></div>
      </div></Fragment>)}
      <button className="vfb-append-column" onClick={() => onUpload(row.id)}>+ {t('Aggiungi colonna', 'Add column')}<small>{t('Continua questo video', 'Continue this video')}</small></button>
    </div>{row.media.some(media => media.id === expandedId) && <div className="vfb-expanded-editor">{renderEditor()}</div>}</article>)}
  </section>;
}
