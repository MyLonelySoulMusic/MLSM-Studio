import { describe, expect, it } from 'vitest';
import { compileFormat, newFormat, timeline, reactionClips, compositionRows, rowFormat, mediaRatio, ratioRule, gradientColors, type FormatMedia } from './model';
import type { VideoEditorAsset } from '../services/video-editor';
const media = (id: string, duration: number): FormatMedia => ({ id, name: id, description: 'reazione king', file: new File(['video'], `${id}.mp4`), duration });
const asset = (id: string, duration: number, kind: 'video' | 'image' = 'video'): VideoEditorAsset => ({ id, name: id, kind, url: `blob:${id}`, thumbnailUrl: null, durationSeconds: duration, width: 1920, height: 1080, hasAudio: kind === 'video', waveform: [], bpm: null, beats: [], downbeats: [] });
function fixture() {
  const format = newFormat(); format.uploads = [media('game', 5)]; format.library = [media('king', 2)];
  format.clips = [{ id: 'first', mediaId: 'game', sceneId: '', zoom: 1.5 }, { id: 'second', mediaId: 'king', sceneId: format.scenes[0]!.id, zoom: 1 }];
  return format;
}
describe('Video Format composition', () => {
  it('compiles contiguous clips with source audio, zoom and an overlapping still', () => {
    const format = fixture();
    const project = compileFormat(format, new Map([['game', asset('game', 5)], ['king', asset('king', 2)]]), new Map([['second', asset('freeze', 0, 'image')]]));
    const editor = project.animation.videoEditor;
    expect(editor.outputWidth).toBe(1080); expect(editor.outputHeight).toBe(1920);
    expect(editor.clips).toHaveLength(4);
    expect(editor.clips[1]).toMatchObject({ startSeconds: 0, durationSeconds: 5, transform: { scale: 1.5 }, muted: false });
    expect(editor.clips[2]).toMatchObject({ startSeconds: 5, durationSeconds: 2, assetId: 'king' });
    expect(editor.clips[3]).toMatchObject({ startSeconds: 5, durationSeconds: 2, assetId: 'freeze', muted: true, transform: { x: .55, y: -.55, scale: .35 } });
  });
  it('supports landscape and repeated reactions without duplicating assets', () => {
    const format = fixture(); format.aspect = '16:9'; format.clips.push({ ...format.clips[1]!, id: 'third', sceneId: '' });
    const project = compileFormat(format, new Map([['game', asset('game', 5)], ['king', asset('king', 2)]]), new Map([['second', asset('freeze', 0, 'image')]]));
    expect(project.animation.videoEditor.outputWidth).toBe(1920); expect(timeline(format).map(item => item.start)).toEqual([0, 5, 7]);
    expect(project.animation.videoEditor.assets).toHaveLength(3);
  });
  it('rejects missing media and a freeze scene without a predecessor', () => {
    const format = fixture(); format.clips.reverse();
    expect(() => compileFormat(format, new Map([['king', asset('king', 2)]]), new Map())).toThrow('precedente');
    format.library = []; expect(() => timeline(format)).toThrow('non è disponibile');
  });
});

it('applies ratio rules to incoming clips, preserves reaction trims and freezes at the selected cut', () => {
  const format = fixture();
  format.ratioRules = { '16:9': { zoom: .9, fit: 'contain', gradient: 'cool', intensity: 4 } };
  format.uploads[0] = { ...format.uploads[0]!, width: 1920, height: 1080, stopSeconds: 3.5, reactionId: 'king' };
  format.library[0] = { ...format.library[0]!, trimIn: .5, trimOut: 1.5 };
  format.clips = reactionClips(format);
  const project = compileFormat(format, new Map([['game', asset('game', 5)], ['king', asset('king', 2)]]), new Map([['game-reaction', asset('freeze', 0, 'image')]]), new Map([['game-source', asset('gradient', 0, 'image')]]));
  expect(timeline(format).map(item => [item.sourceIn, item.sourceOut, item.start])).toEqual([[0,3.5,0],[.5,1.5,3.5]]);
  const clips = project.animation.videoEditor.clips;
  expect(clips.find(clip => clip.id === 'game-source')).toMatchObject({ fit: 'contain', transform: { scale: .9 }, durationSeconds: 3.5 });
  expect(clips.find(clip => clip.id === 'game-reaction')).toMatchObject({ sourceInSeconds: .5, durationSeconds: 1, transform: { scale: 1 } });
  expect(clips.find(clip => clip.id === 'game-reaction-freeze')).toMatchObject({ sourceInSeconds: 0 });
  expect(clips.find(clip => clip.id === 'game-source-background')).toMatchObject({ trackId: 'video-format-background', assetId: 'game', sourceInSeconds: 0, paletteBackground: { colors: ['#000000', '#ed589c', '#ffffff'], intensity: 4 }, muted: true, durationSeconds: 3.5 });
  expect(project.animation.videoEditor.tracks.at(-1)?.id).toBe('video-format-background');
  expect(mediaRatio({ width: 1280, height: 720 })).toBe('16:9');
  expect(ratioRule(format, { width: 1080, height: 1920 }).zoom).toBe(1);
  expect(gradientColors(format.ratioRules!['16:9']!)).toEqual(['#000000', '#ed589c', '#ffffff']);
});
it('rejects invalid saved trims', () => { const format = fixture(); format.library[0]!.trimOut = 9; expect(() => timeline(format)).toThrow('Intervallo'); });

it('keeps outputs separate and concatenates only the trimmed columns in the selected row', () => {
  const format = fixture();
  format.uploads = ['a','b','c','separate'].map((id, index) => ({ ...media(id, 10), rowId: index < 3 ? 'long' : 'other', trimIn: 2, stopSeconds: 5, reactionId: 'king' }));
  expect(compositionRows(format).map(row => row.media.length)).toEqual([3,1]);
  const long = rowFormat(format, 'long');
  expect(long.clips).toHaveLength(6);
  expect(timeline(long).map(item => [item.start, item.duration, item.sourceIn])).toEqual([[0,3,2],[3,2,0],[5,3,2],[8,2,0],[10,3,2],[13,2,0]]);
  expect(rowFormat(format, 'other').clips).toHaveLength(2);
  format.uploads[1]!.reactionId = '';
  expect(() => rowFormat(format, 'long')).toThrow('Completa');
});
