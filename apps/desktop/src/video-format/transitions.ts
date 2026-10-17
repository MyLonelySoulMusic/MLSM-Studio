import { compositionRows, type VideoFormat } from './model';
import { sceneTransitionKinds, type SceneTransition, type SceneTransitionKind, type TimedSceneTransition } from '../services/scene-transitions';
export interface FormatTransitions {
  mode: SceneTransitionKind | 'none' | 'random'; duration: number; intensity: number; seed: number;
}
export const defaultTransitions: FormatTransitions = { mode: 'none', duration: 1, intensity: .5, seed: 0 };
export const boundaryKey = (from: string, to: string) => JSON.stringify([from, to]);
export function resolveTransition(format: VideoFormat, from: string, to: string): SceneTransition | null {
  const key = boundaryKey(from, to);
  if (Object.prototype.hasOwnProperty.call(format.transitions ?? {}, key)) return format.transitions![key] ?? null;
  const config = format.transitionDefaults ?? defaultTransitions;
  if (config.mode === 'none') return null;
  let hash = config.seed;
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return { kind: config.mode === 'random' ? sceneTransitionKinds[(hash >>> 0) % sceneTransitionKinds.length]! : config.mode, duration: config.duration, intensity: config.intensity };
}
export function rowSegments(format: VideoFormat, activeId?: string) {
  const rows = compositionRows(format);
  const row = rows.find(row => row.media.some(media => media.id === activeId)) ?? rows[0];
  let at = 0;
  return row?.media.flatMap(media => {
    const start = media.trimIn ?? 0, end = media.stopSeconds ?? media.duration;
    const source = { key: `${media.id}-source`, start, end, at };
    at += end - start;
    const reaction = format.library.find(item => item.id === media.reactionId);
    if (!reaction) return [source];
    const next = { key: `${media.id}-reaction`, start: reaction.trimIn ?? 0, end: reaction.trimOut ?? reaction.duration, at };
    at += next.end - next.start;
    return [source, next];
  }) ?? [];
}
export function timedTransitions(format: VideoFormat, segments: { key: string; start: number; end: number; at: number }[]): TimedSceneTransition[] {
  return segments.slice(1).flatMap((next, index) => {
    const previous = segments[index]!;
    const transition = resolveTransition(format, previous.key, next.key);
    if (!transition) return [];
    // Each side occupies at most half a clip: adjacent transitions cannot overlap.
    return [{ ...transition, at: next.at, duration: Math.min(transition.duration, previous.end - previous.start, next.end - next.start) }];
  });
}
