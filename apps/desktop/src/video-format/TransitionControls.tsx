import { useEffect, useRef, useState } from 'react';
import type { UiLanguage } from '../services/ui-preferences';
import { sceneTransitionKinds, transitionNames, type SceneTransition } from '../services/scene-transitions';
import type { VideoFormat } from './model';
import { defaultTransitions, resolveTransition, type FormatTransitions } from './transitions';

function TransitionFields({ value, language, onChange }: { value: SceneTransition; language: UiLanguage; onChange: (value: SceneTransition) => void }) {
  const it = language === 'it';
  return <>
    <label>{it ? 'Tipo di transizione' : 'Transition type'}<select value={value.kind} onChange={event => onChange({ ...value, kind: event.target.value as SceneTransition['kind'] })}>{sceneTransitionKinds.map(kind => <option key={kind} value={kind}>{transitionNames[kind][it ? 0 : 1]}</option>)}</select></label>
    <label>{it ? 'Durata' : 'Duration'} · {value.duration.toFixed(1)} s<input type="range" min=".1" max="5" step=".1" value={value.duration} onChange={event => onChange({ ...value, duration: Number(event.target.value) })} /></label>
    <label>{it ? 'Intensità' : 'Intensity'} · {Math.round(value.intensity * 100)}%<input type="range" min="0" max="1" step=".05" value={value.intensity} onChange={event => onChange({ ...value, intensity: Number(event.target.value) })} /></label>
  </>;
}
export function GlobalTransitions({ format, language, onChange }: { format: VideoFormat; language: UiLanguage; onChange: (value: FormatTransitions) => void }) {
  const it = language === 'it', value = format.transitionDefaults ?? defaultTransitions;
  return <section className="vfb-transition-settings"><h3>{it ? 'Transizioni per tutte le clip' : 'Transitions for all clips'}</h3>
    <label>{it ? 'Modalità transizioni' : 'Transition mode'}<select value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as FormatTransitions['mode'], seed: Math.floor(Math.random() * 2147483647) })}><option value="none">{it ? 'Nessuna' : 'None'}</option><option value="random">{it ? 'Casuale automatico' : 'Automatic random'}</option>{sceneTransitionKinds.map(kind => <option key={kind} value={kind}>{transitionNames[kind][it ? 0 : 1]}</option>)}</select></label>
    {value.mode !== 'none' && <><label>{it ? 'Durata globale' : 'Global duration'} · {value.duration.toFixed(1)} s<input type="range" min=".1" max="5" step=".1" value={value.duration} onChange={event => onChange({ ...value, duration: Number(event.target.value) })} /></label><label>{it ? 'Intensità globale' : 'Global intensity'} · {Math.round(value.intensity * 100)}%<input type="range" min="0" max="1" step=".05" value={value.intensity} onChange={event => onChange({ ...value, intensity: Number(event.target.value) })} /></label></>}
    {value.mode === 'random' && <button onClick={() => onChange({ ...value, seed: Math.floor(Math.random() * 2147483647) })}>{it ? 'Genera un’altra combinazione' : 'Generate another combination'}</button>}
    <p>{it ? 'La scelta globale sostituisce le personalizzazioni. Poi puoi modificare ogni passaggio a sinistra. Durata ridotta automaticamente sulle clip brevi.' : 'Global changes replace individual overrides. Then edit each transition on the left. Duration is shortened automatically for brief clips.'}</p>
  </section>;
}
export function TransitionButton({ format, from, to, language, onClick }: { format: VideoFormat; from: string; to: string; language: UiLanguage; onClick: () => void }) {
  const value = resolveTransition(format, from, to), it = language === 'it';
  return <button className="vfb-transition-button" onClick={onClick} aria-label={value ? (it ? 'Modifica transizione' : 'Edit transition') : (it ? 'Aggiungi transizione' : 'Add transition')}><b>{value ? '↔' : '+'}</b><span>{value ? transitionNames[value.kind][it ? 0 : 1] : (it ? 'Transizione' : 'Transition')}{value && <small>{value.duration.toFixed(1)} s · {Math.round(value.intensity * 100)}%</small>}</span></button>;
}
export function TransitionDialog({ value, language, onSave, onClose }: { value: SceneTransition | null; language: UiLanguage; onSave: (value: SceneTransition | null) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), it = language === 'it';
  const [draft, setDraft] = useState<SceneTransition>(value ?? { kind: 'black', duration: 1, intensity: .5 });
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="vfb-transition-dialog" aria-label={it ? 'Modifica transizione' : 'Edit transition'} onCancel={onClose}>
    <h2>{it ? 'Transizione tra le clip' : 'Transition between clips'}</h2>
    <p>{it ? 'Si applica alla scena intera: video, sfondo e fermo immagine.' : 'Applies to the whole scene: video, background and still frame.'}</p>
    <TransitionFields value={draft} language={language} onChange={setDraft} />
    <footer><button onClick={onClose}>{it ? 'Annulla' : 'Cancel'}</button><button onClick={() => onSave(null)}>{it ? 'Nessuna transizione' : 'No transition'}</button><button className="vfb-primary" onClick={() => onSave(draft)}>{it ? 'Applica transizione' : 'Apply transition'}</button></footer>
  </dialog>;
}
