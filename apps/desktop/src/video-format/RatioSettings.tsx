import { useState } from 'react';
import { mediaRatio, ratioRule, gradientColors, type FormatMedia, type RatioRule, type VideoFormat } from './model';
import type { UiLanguage } from '../services/ui-preferences';

export function RatioSettings({ format, active, language, onChange }: { format: VideoFormat; active: FormatMedia | undefined; language: UiLanguage; onChange: (rules: Record<string, RatioRule>) => void }) {
  const t = (it: string, en: string) => language === 'it' ? it : en;
  const [selected, setSelected] = useState('');
  const ratio = selected || (active ? mediaRatio(active) : '16:9');
  const ratios = [...new Set(['16:9', '9:16', '1:1', '4:3', ...format.uploads.map(mediaRatio), ...Object.keys(format.ratioRules ?? {})])];
  const rule = format.ratioRules?.[ratio] ?? ratioRule(format, {});
  const patch = (value: Partial<RatioRule>) => onChange({ ...format.ratioRules, [ratio]: { ...rule, ...value } });
  return <div className="vfb-ratio-settings"><h3>{t('Video nuovi: regole per proporzione', 'New videos: rules by aspect ratio')}</h3>
    <label>{t('Applica ai video sorgente', 'Apply to source videos')}<select value={ratio} onChange={event => setSelected(event.target.value)}>{ratios.map(value => <option key={value} value={value}>{value === 'unknown' ? t('Proporzione non rilevata', 'Unknown aspect ratio') : value}</option>)}</select></label>
    <p>{t('La regola vale per tutte le clip con questa proporzione, anche quelle che caricherai dopo.', 'This rule applies to all clips with this aspect ratio, including future uploads.')}</p>
    <label>{t('Adattamento', 'Sizing')}<select value={rule.fit} onChange={event => patch({ fit: event.target.value as RatioRule['fit'] })}><option value="contain">{t('Mostra tutto (con bande)', 'Show all (with bars)')}</option><option value="cover">{t('Riempi (ritaglia)', 'Fill (crop)')}</option></select></label>
    <label>{t('Ridimensionamento', 'Scale')} · {rule.zoom.toFixed(2)}×<input type="range" min="0.1" max="6" step="0.05" value={rule.zoom} onChange={event => patch({ zoom: Number(event.target.value) })} /></label>
    <label>{t('Palette sfondo', 'Background palette')}<select value={rule.gradient === 'custom' ? 'custom' : 'lonely'} onChange={event => patch({ gradient: event.target.value as RatioRule['gradient'], colors: ['#000000', '#ed589c', '#ffffff'] })}><option value="lonely">Lonely · {t('nero, rosa, bianco', 'black, pink, white')}</option><option value="custom">{t('Personalizzata', 'Custom')}</option></select></label>
    <div className="vfb-palette-presets">{[['#000000','#ed589c'], ['#ed589c','#ffffff'], ['#000000','#ffffff']].map(colors => <button key={colors.join()} aria-label={colors.join(' / ')} onClick={() => patch({ gradient: 'custom', colors })} style={{ background: `linear-gradient(90deg, ${colors.join(',')})`, width: 45, height: 28 }} />)}</div>
    {gradientColors(rule).map((color, index) => <div className="vfb-palette-color" key={index}><label>{t('Colore', 'Color')} {index + 1}<input type="color" value={color} onChange={event => patch({ gradient: 'custom', colors: gradientColors(rule).map((value, i) => i === index ? event.target.value : value) })} /></label><button disabled={gradientColors(rule).length === 1} onClick={() => patch({ gradient: 'custom', colors: gradientColors(rule).filter((_, i) => i !== index) })}>{t('Rimuovi', 'Remove')}</button></div>)}
    <button disabled={gradientColors(rule).length >= 3} onClick={() => patch({ gradient: 'custom', colors: [...gradientColors(rule), '#ffffff'] })}>+ {t('Colore', 'Color')}</button>
    <label>{t('Intensità sfocatura', 'Blur intensity')}<select value={rule.intensity} onChange={event => patch({ intensity: Number(event.target.value) as RatioRule['intensity'] })}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} / 4</option>)}</select></label>
  </div>;
}
