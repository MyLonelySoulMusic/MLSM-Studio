import { useEffect, useRef } from 'react';
import type { UiLanguage } from '../services/ui-preferences';

export function DeleteMediaDialog({ name, standard, uses, language, busy, error, onCancel, onConfirm }: { name: string; standard: boolean; uses: number; language: UiLanguage; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const t = (it: string, en: string) => language === 'it' ? it : en;
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="vfb-dialog vfb-delete-dialog" aria-labelledby="vfb-delete-title" aria-describedby="vfb-delete-description" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <small>VIDEO FORMAT BUILDER</small>
    <h2 id="vfb-delete-title">{standard ? t('Elimina video standard', 'Delete standard video') : t('Elimina clip', 'Delete clip')}</h2>
    <strong className="vfb-delete-name">{name}</strong>
    <div id="vfb-delete-description"><p>{standard ? t('Il video verrà rimosso dalla galleria e dalla ricerca del format.', 'The video will be removed from the format gallery and search.') : t('La clip verrà rimossa da questo montaggio.', 'The clip will be removed from this composition.')}</p>
      {uses > 0 && <p className="vfb-delete-impact">{t(`${uses} clip usano questa reazione. Il loro taglio resterà salvato: scegli una nuova reazione con +.`, `${uses} clips use this reaction. Their trims will be preserved: choose a new reaction with +.`)}</p>}
      <p>{t('Il file originale sul disco resta intatto.', 'The original file on disk stays intact.')}</p></div>
    {error && <p role="alert">{error}</p>}
    <footer><button autoFocus disabled={busy} onClick={onCancel}>{t('Annulla', 'Cancel')}</button><button className="vfb-confirm-delete" disabled={busy} onClick={onConfirm}>{busy ? t('Eliminazione…', 'Deleting…') : t('Elimina', 'Delete')}</button></footer>
  </dialog>;
}
