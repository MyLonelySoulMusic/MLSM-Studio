import { expect, it } from 'vitest';
import { newFormat, rowFormat, timeline } from './model';
import { reorderBlocks } from './reorder';
import { boundaryKey, resolveTransition } from './transitions';
it('inserts complete blocks without swapping intermediate blocks or changing any trims', () => {
  const format = newFormat();
  format.uploads = ['a', 'other', 'b', 'c'].map((id, index) => ({
    id, name: id, description: '', file: new File([''], id), duration: 20, rowId: id === 'other' ? 'other' : 'row',
    trimIn: index + .125, stopSeconds: index + 4.625, trimOut: index + 5, reactionId: 'r'
  }));
  format.library = [{ id: 'r', name: 'r', description: '', file: new File([''], 'r'), duration: 6, trimIn: 1.25, trimOut: 3.75 }];
  format.transitions = { [boundaryKey('a-source', 'a-reaction')]: { kind: 'blur', duration: .5, intensity: .4 } };
  const originals = [...format.uploads], originalTimeline = timeline(rowFormat(format, 'row'));
  const reordered = { ...format, uploads: reorderBlocks(format.uploads, 'a', 2) };
  expect(reordered.uploads.map(media => media.id)).toEqual(['b', 'other', 'c', 'a']);
  expect(format.uploads).toEqual(originals);
  for (const media of reordered.uploads) expect(media).toBe(originals.find(original => original.id === media.id));
  const items = timeline(rowFormat(reordered, 'row'));
  expect(items.map(item => item.clip.id)).toEqual(['b-source', 'b-reaction', 'c-source', 'c-reaction', 'a-source', 'a-reaction']);
  for (const item of items) {
    const original = originalTimeline.find(original => original.clip.id === item.clip.id)!;
    expect([item.sourceIn, item.sourceOut, item.duration]).toEqual([original.sourceIn, original.sourceOut, original.duration]);
  }
  expect(items.map(item => item.start)).toEqual([0, 4.5, 7, 11.5, 14, 18.5]);
  expect(resolveTransition(reordered, 'a-source', 'a-reaction')).toEqual({ kind: 'blur', duration: .5, intensity: .4 });
});
it('ignores invalid IDs and preserves an unchanged list', () => {
  const format = newFormat();
  expect(reorderBlocks(format.uploads, 'missing', 0)).toBe(format.uploads);
});
