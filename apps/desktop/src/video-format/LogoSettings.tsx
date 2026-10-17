import { useRef } from 'react';
import type { UiLanguage } from '../services/ui-preferences';
import type { FormatLogo } from './model';
import { useMediaUrl } from './useMediaUrl';

export function LogoSettings({ logo, language, onUpload, onChange }: { logo: FormatLogo | undefined; language: UiLanguage; onUpload: (file: File) => void; onChange: (logo: FormatLogo | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null), url = useMediaUrl(logo?.file), it = language === 'it';
  return <section className="vfb-logo-settings"><h3>{it ? 'Logo del format' : 'Format logo'}</h3>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={it ? 'File logo' : 'Logo file'} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(file); }} />
    <button onClick={() => input.current?.click()}>{logo ? (it ? 'Sostituisci logo' : 'Replace logo') : (it ? '+ Carica logo' : '+ Upload logo')}</button>
    {logo && <><img className="vfb-logo-thumbnail" src={url || undefined} alt={logo.file.name} /><p>{logo.file.name}</p>
      <label>{it ? 'Posizione rapida logo' : 'Logo position preset'}<select value="" onChange={event => { const [x, y] = event.target.value.split(',').map(Number); onChange({ ...logo, x: x!, y: y! }); }}><option value="" disabled>{it ? 'Scegli una posizione' : 'Choose a position'}</option>{[
        [.05, .05, 'In alto a sinistra', 'Top left'], [.5, .05, 'In alto al centro', 'Top center'], [.95, .05, 'In alto a destra', 'Top right'],
        [.05, .5, 'A sinistra', 'Center left'], [.5, .5, 'Al centro', 'Center'], [.95, .5, 'A destra', 'Center right'],
        [.05, .95, 'In basso a sinistra', 'Bottom left'], [.5, .95, 'In basso al centro', 'Bottom center'], [.95, .95, 'In basso a destra', 'Bottom right'],
      ].map(([x, y, italian, english]) => <option key={`${x},${y}`} value={`${x},${y}`}>{it ? italian : english}</option>)}</select></label>
      <label>{it ? 'Dimensione logo' : 'Logo size'} · {Math.round(logo.size * 100)}%<input type="range" min=".05" max=".6" step=".01" value={logo.size} onChange={event => onChange({ ...logo, size: Number(event.target.value) })} /></label>
      <label>{it ? 'Posizione orizzontale logo' : 'Logo horizontal position'} · {Math.round(logo.x * 100)}%<input type="range" min="0" max="1" step=".01" value={logo.x} onChange={event => onChange({ ...logo, x: Number(event.target.value) })} /></label>
      <label>{it ? 'Posizione verticale logo' : 'Logo vertical position'} · {Math.round(logo.y * 100)}%<input type="range" min="0" max="1" step=".01" value={logo.y} onChange={event => onChange({ ...logo, y: Number(event.target.value) })} /></label>
      <button onClick={() => onChange(undefined)}>{it ? 'Rimuovi logo' : 'Remove logo'}</button>
    </>}
    <p>{it ? 'PNG, WebP o JPEG. Per la trasparenza usa PNG o WebP. Posizione e dimensione si salvano con “Salva format e bozza” e si applicano a tutte le righe.' : 'PNG, WebP or JPEG. Use PNG or WebP for transparency. Save the position and size with “Save format and draft” to reuse them in every row.'}</p>
  </section>;
}
