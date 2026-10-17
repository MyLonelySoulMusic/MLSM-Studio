import { logoLayout } from './logo';
import type { SceneTransition } from '../services/scene-transitions';
import { timedTransitions, type FormatTransitions } from './transitions';
import { lonelyPalette } from '../services/video-palette-background';
import { createProject, parseProject } from '@rbs/project-schema';
import { formatText } from './copy';
import type { UiLanguage } from '../services/ui-preferences';
import type { VideoEditorAsset } from '../services/video-editor';

export interface RatioRule { zoom: number; fit: 'contain' | 'cover'; gradient: 'none' | 'cool' | 'warm' | 'neutral' | 'lonely' | 'custom'; colors?: string[]; intensity: 1 | 2 | 3 | 4 }
export function mediaRatio(media: Pick<FormatMedia, 'width' | 'height'>): string {
  if (!media.width || !media.height) return 'unknown';
  const ratio = media.width / media.height;
  for (const [name, value] of [['16:9', 16/9], ['9:16', 9/16], ['1:1', 1], ['4:3', 4/3], ['3:4', 3/4]] as const) if (Math.abs(ratio / value - 1) < .025) return name;
  return `${Number(ratio.toFixed(3))}:1`;
}
export function ratioRule(format: VideoFormat, media: Pick<FormatMedia, 'width' | 'height'>): RatioRule {
  return format.ratioRules?.[mediaRatio(media)] ?? { zoom: format.zoom, fit: 'contain', gradient: 'lonely', intensity: 2 };
}
export function gradientColors(rule: RatioRule): string[] {
  return rule.colors?.length ? rule.colors.slice(0, 3) : [...lonelyPalette];
}
export interface ScenePreset { id: string; name: string; zoom: number; freeze: boolean; x: number; y: number; scale: number }
export interface FormatMedia { id: string; name: string; description: string; file: File; duration: number; width?: number; height?: number; trimIn?: number; trimOut?: number; stopSeconds?: number; rowId?: string; reactionId?: string }
export interface FormatClip { id: string; mediaId: string; sceneId: string; zoom: number; sourceIn?: number; sourceOut?: number }
export interface FormatLogo { file: File; width: number; height: number; size: number; x: number; y: number }
export interface VideoFormat { logo?: FormatLogo | undefined; transitionDefaults?: FormatTransitions; transitions?: Record<string, SceneTransition | null>; id: string; name: string; aspect: '9:16' | '16:9'; zoom: number; ratioRules?: Record<string, RatioRule>; scenes: ScenePreset[]; library: FormatMedia[]; uploads: FormatMedia[]; clips: FormatClip[] }
export function newFormat(language: UiLanguage = 'it'): VideoFormat {
  return { id: crypto.randomUUID(), name: 'Gaming reaction', aspect: '9:16', zoom: 1, library: [], uploads: [], clips: [], scenes: [{ id: crypto.randomUUID(), name: formatText(language, 'Reazione con ultimo frame'), zoom: 1, freeze: true, x: .55, y: -.55, scale: .35 }] };
}
export function timeline(format: VideoFormat) {
  let start = 0;
  return format.clips.map(clip => {
    const media = [...format.library, ...format.uploads].find(item => item.id === clip.mediaId);
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) throw new Error('Una clip della timeline non è disponibile.');
    const scene = format.scenes.find(item => item.id === clip.sceneId);
    const sourceIn = clip.sourceIn ?? media.trimIn ?? 0;
    const sourceOut = clip.sourceOut ?? media.trimOut ?? media.duration;
    if (!Number.isFinite(sourceIn) || !Number.isFinite(sourceOut) || sourceIn < 0 || sourceOut > media.duration || sourceOut <= sourceIn) throw new Error('Intervallo clip non valido.');
    const item = { clip, media, scene, start, sourceIn, sourceOut, duration: sourceOut - sourceIn };
    start += item.duration;
    return item;
  });
}
export function compileFormat(format: VideoFormat, assets: Map<string, VideoEditorAsset>, stills: Map<string, VideoEditorAsset>, backgrounds = new Map<string, VideoEditorAsset>(), logoAsset?: VideoEditorAsset) {
  const project = createProject();
  const items = timeline(format);
  const clips = items.flatMap((item, index) => {
    const asset = assets.get(item.media.id);
    if (!asset) throw new Error(`Media mancante: ${item.media.name}`);
    const variable = format.uploads.some(media => media.id === item.media.id);
    const rule = ratioRule(format, { width: asset.width, height: asset.height });
    const base = { fit: variable ? rule.fit : 'contain', id: item.clip.id, assetId: asset.id, trackId: 'video-editor-track-main', startSeconds: item.start, durationSeconds: item.duration, sourceInSeconds: item.sourceIn, transform: { x: 0, y: 0, scale: variable && format.ratioRules?.[mediaRatio(asset)] ? rule.zoom : item.clip.zoom, rotation: 0 } };
    const background = backgrounds.get(item.clip.id);
    const layers = variable ? [{ ...base, id: `${base.id}-background`, trackId: 'video-format-background', muted: true, fit: 'cover', paletteBackground: { colors: gradientColors(rule), intensity: rule.intensity }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }, base] : background ? [{ ...base, id: `${base.id}-background`, assetId: background.id, trackId: 'video-format-background', sourceInSeconds: 0, muted: true, fit: 'fill', transform: { x: 0, y: 0, scale: 1, rotation: 0 } }, base] : [base];
    if (!item.scene?.freeze) return layers;
    if (!index) throw new Error('La scena con ultimo frame richiede una clip precedente.');
    const still = stills.get(item.clip.id);
    if (!still) throw new Error('Fermo immagine mancante.');
    return [...layers, { ...base, id: `${base.id}-freeze`, assetId: still.id, trackId: 'video-editor-track-overlay', sourceInSeconds: 0, fit: 'contain', muted: true, transform: { x: item.scene.x, y: item.scene.y, scale: item.scene.scale, rotation: 0 } }];
  });
  if (format.logo && !logoAsset) throw new Error('Logo non disponibile.');
  if (format.logo && logoAsset && items.length) {
    const placement = logoLayout(format.logo, format.aspect);
    clips.push({ id: 'video-format-logo', assetId: logoAsset.id, trackId: 'video-format-logo', startSeconds: 0, durationSeconds: items.reduce((sum, item) => sum + item.duration, 0), sourceInSeconds: 0, fit: 'contain', muted: true, transform: { x: placement.x, y: placement.y, scale: placement.scale, rotation: 0 } });
  }
  const [width, height] = format.aspect === '9:16' ? [1080, 1920] : [1920, 1080];
  return parseProject({ ...project, project: { ...project.project, name: format.name }, animation: { ...project.animation, modeId: 'videoEditor', videoEditor: { ...project.animation.videoEditor, outputWidth: width, outputHeight: height, tracks: [...(logoAsset ? [{ id: 'video-format-logo', name: 'Logo', kind: 'video', hidden: false, muted: true, locked: false, volume: 1 }] : []), ...project.animation.videoEditor.tracks, { id: 'video-format-background', name: 'Sfondo / Background', kind: 'video', hidden: false, muted: true, locked: false, volume: 1 }], assets: [...assets.values(), ...stills.values(), ...backgrounds.values(), ...(logoAsset ? [logoAsset] : [])], clips, sceneTransitions: timedTransitions(format, items.map(item => ({ key: item.clip.id, start: item.sourceIn, end: item.sourceOut, at: item.start }))) } } });
}

/** One variable clip stopped by the user, followed by its reusable reaction. */
export function reactionClips(format: VideoFormat): FormatClip[] {
  return format.uploads.flatMap(media => {
    if (media.stopSeconds === undefined || !media.reactionId) return [];
    if (!Number.isFinite(media.stopSeconds) || media.stopSeconds <= (media.trimIn ?? 0) || !Number.isFinite(media.trimIn ?? 0) || (media.trimIn ?? 0) < 0 || media.stopSeconds > media.duration) throw new Error('Intervallo clip non valido.');
    const reaction = format.library.find(item => item.id === media.reactionId);
    if (!reaction) throw new Error('Reazione non disponibile.');
    return [
      { id: `${media.id}-source`, mediaId: media.id, sceneId: '', zoom: ratioRule(format, media).zoom, sourceIn: media.trimIn ?? 0, sourceOut: media.stopSeconds },
      { id: `${media.id}-reaction`, mediaId: reaction.id, sceneId: format.scenes[0]?.id ?? '', zoom: format.scenes[0]?.zoom ?? 1 },
    ];
  });
}

/** Each row is a separate output; its columns play consecutively. */
export function compositionRows(format: VideoFormat): { id: string; media: FormatMedia[] }[] {
  const rows = new Map<string, FormatMedia[]>();
  for (const media of format.uploads) { const id = media.rowId ?? media.id; const row = rows.get(id) ?? []; row.push(media); rows.set(id, row); }
  return [...rows].map(([id, media]) => ({ id, media }));
}
export function rowFormat(format: VideoFormat, rowId: string): VideoFormat {
  const uploads = compositionRows(format).find(row => row.id === rowId)?.media;
  if (!uploads?.length || uploads.some(media => media.stopSeconds === undefined || !media.reactionId)) throw new Error('Completa tutte le colonne della riga.');
  const result = { ...format, uploads };
  return { ...result, clips: reactionClips(result) };
}

/** Export exactly the row shown by the preview, including standalone source clips. */
export function exportRowFormat(format: VideoFormat, rowId: string): VideoFormat {
  const uploads = compositionRows(format).find(row => row.id === rowId)?.media;
  if (!uploads?.length) throw new Error('Nessun video da esportare.');
  const clips: FormatClip[] = uploads.flatMap(media => {
    const source: FormatClip = { id: `${media.id}-source`, mediaId: media.id, sceneId: '', zoom: ratioRule(format, media).zoom, sourceIn: media.trimIn ?? 0, sourceOut: media.stopSeconds ?? media.duration };
    if (!media.reactionId) return [source];
    if (!format.library.some(item => item.id === media.reactionId)) throw new Error(`Reazione non disponibile: ${media.name}`);
    return [source, { id: `${media.id}-reaction`, mediaId: media.reactionId, sceneId: format.scenes[0]?.id ?? '', zoom: format.scenes[0]?.zoom ?? 1 }];
  });
  const result = { ...format, uploads, clips };
  timeline(result); // Validate real trim intervals without requiring an optional reaction.
  return result;
}
