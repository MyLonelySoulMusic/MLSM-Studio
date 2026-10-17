import { expect, it } from 'vitest';
import { newFormat, compileFormat, reactionClips } from './model';
import { boundaryKey, defaultTransitions, resolveTransition, rowSegments, timedTransitions } from './transitions';
import { sceneTransitionFrame, sceneTransitionKinds } from '../services/scene-transitions';
import { createProject } from '@rbs/project-schema';

function fixture() {
  const format = newFormat();
  format.uploads = ['a', 'b', 'separate'].map(id => ({ id, name: id, description: '', duration: 3, stopSeconds: 2, reactionId: 'r', rowId: id === 'separate' ? 'other' : 'row', file: new File([''], id) }));
  format.library = [{ id: 'r', name: 'r', description: '', duration: .4, file: new File([''], 'r') }];
  return format;
}
it('resolves stable random transitions for every boundary, with local overrides and no row crossing', () => {
  const format = fixture();
  format.transitionDefaults = { ...defaultTransitions, mode: 'random', seed: 42 };
  const segments = rowSegments(format, 'a');
  const first = timedTransitions(format, segments);
  expect(first).toHaveLength(3);
  expect(first.map(item => item.at)).toEqual([2, 2.4, 4.4]);
  expect(first.every(item => item.duration <= .4)).toBe(true);
  expect(timedTransitions(structuredClone(format), segments)).toEqual(first);
  format.transitions = { [boundaryKey('a-source', 'a-reaction')]: { kind: 'white', duration: .2, intensity: .8 }, [boundaryKey('b-source', 'b-reaction')]: null };
  expect(resolveTransition(format, 'a-source', 'a-reaction')).toEqual({ kind: 'white', duration: .2, intensity: .8 });
  expect(timedTransitions(format, segments)).toHaveLength(2);
  expect(timedTransitions(format, rowSegments(format, 'separate'))).toHaveLength(1);
});
it('covers the entire scene at the cut and returns to an unchanged image for all ten styles', () => {
  expect(sceneTransitionKinds).toHaveLength(10);
  for (const kind of sceneTransitionKinds) {
    const items = [{ kind, at: 2, duration: 1, intensity: .5 }];
    expect(sceneTransitionFrame(items, 1.5)).toBeNull();
    expect(sceneTransitionFrame(items, 2.5)).toBeNull();
    expect(sceneTransitionFrame(items, 2)?.opacity).toBe(0);
    expect(sceneTransitionFrame(items, 1.75)?.opacity).toBeCloseTo(sceneTransitionFrame(items, 2.25)!.opacity);
  }
});
it('exports one transition for the composition rather than duplicating it per video and still layer', () => {
  const format = fixture(); format.uploads = format.uploads.slice(0, 1);
  format.transitionDefaults = { ...defaultTransitions, mode: 'blur' };
  format.clips = reactionClips(format);
  const asset = (id: string, kind: 'video' | 'image') => ({ id, kind, name: id, url: 'blob:test', thumbnailUrl: null, durationSeconds: 3, width: 1920, height: 1080, hasAudio: kind === 'video', waveform: [], bpm: null, beats: [], downbeats: [] });
  const result = compileFormat(format, new Map([['a', asset('a', 'video')], ['r', asset('r', 'video')]]), new Map([['a-reaction', asset('still', 'image')]]));
  expect(result.animation.videoEditor.sceneTransitions).toEqual([{ kind: 'blur', duration: .4, intensity: .5, at: 2 }]);
  expect(result.animation.videoEditor.clips).toHaveLength(4);
  expect(createProject().animation.videoEditor.sceneTransitions).toBeUndefined();
});
