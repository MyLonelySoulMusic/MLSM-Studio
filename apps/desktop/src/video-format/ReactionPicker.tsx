import { useEffect, useRef, useState } from 'react';
import type { FormatMedia } from './model';
import type { UiLanguage } from '../services/ui-preferences';
import { useMediaUrl } from './useMediaUrl';
function Choice({ media, onSelect }: { media: FormatMedia; onSelect: () => void }) { const url = useMediaUrl(media.file); return <button onClick={onSelect}><video src={url || undefined} muted preload="metadata" onLoadedMetadata={event => { event.currentTarget.currentTime = media.trimIn ?? 0; }} /><strong>{media.name}</strong><small>{media.description}</small></button>; }
export function ReactionPicker({ target, library, language, onSelect, onClose }: { target: FormatMedia; library: FormatMedia[]; language: UiLanguage; onSelect: (id: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [query, setQuery] = useState('');
  const t = (it: string, en: string) => language === 'it' ? it : en;
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="vfb-dialog vfb-picker" onCancel={onClose}><header><h2>{t('Reazione per', 'Reaction for')} {target.name}</h2><button onClick={onClose}>{t('Chiudi', 'Close')}</button></header><label>{t('Cerca reazione salvata', 'Find saved reaction')}<input autoFocus value={query} onChange={event => setQuery(event.target.value)} /></label><div className="vfb-picker-grid">{library.filter(media => `${media.name} ${media.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(media => <Choice key={media.id} media={media} onSelect={() => onSelect(media.id)} />)}</div>{!library.length && <p>{t('Aggiungi prima un video standard nella galleria in alto.', 'First add a standard video to the gallery above.')}</p>}</dialog>;
}
