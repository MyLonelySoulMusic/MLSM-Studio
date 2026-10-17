import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { newFormat } from './model';
import { readFormats, saveFormat } from './storage';
it('persists independent formats and replaces the saved draft', async () => {
  const first = newFormat(), second = newFormat();
  await saveFormat(first); await saveFormat(second); first.name = 'Aggiornato'; await saveFormat(first);
  const saved = await readFormats(); expect(saved.filter(item => item.id === first.id)).toHaveLength(1);
  expect(saved.find(item => item.id === first.id)?.name).toBe('Aggiornato');
  expect(saved.find(item => item.id === second.id)?.scenes[0]?.freeze).toBe(true);
});

it('keeps the logo dimensions and position in the saved format and supports removal', async () => {
  const format = newFormat();
  format.logo = { file: new File(['image'], 'logo.png', { type: 'image/png' }), width: 600, height: 300, size: .2, x: .95, y: .05 };
  await saveFormat(format);
  expect((await readFormats()).find(item => item.id === format.id)?.logo).toMatchObject({ width: 600, height: 300, size: .2, x: .95, y: .05 });
  format.logo = undefined;
  await saveFormat(format);
  expect((await readFormats()).find(item => item.id === format.id)?.logo).toBeUndefined();
});

it('saves independent compositions and deletes one without removing the trimmed format library', async () => {
  const { saveFormatVideo, readFormatVideos, deleteFormatVideo } = await import('./storage');
  const format = newFormat();
  const media = { id: 'a', name: 'a', description: '', duration: 10, file: new File([''], 'a') };
  format.library = [{ ...media, id: 'r', trimIn: 2, trimOut: 5 }];
  format.uploads = [{ ...media, trimIn: 1, stopSeconds: 7 }];
  const first = { id: crypto.randomUUID(), formatId: format.id, name: 'one', updatedAt: 1, snapshot: format };
  const second = { ...first, id: crypto.randomUUID(), name: 'two', snapshot: { ...format, uploads: [] } };
  await saveFormatVideo(first); await saveFormatVideo(second);
  const template = (await readFormats()).find(item => item.id === format.id)!;
  expect(template.uploads).toEqual([]);
  expect(template.library[0]?.trimIn).toBe(2);
  expect((await readFormatVideos()).find(item => item.id === first.id)?.snapshot.uploads[0]?.stopSeconds).toBe(7);
  await deleteFormatVideo(first.id);
  expect((await readFormatVideos()).some(item => item.id === first.id)).toBe(false);
  expect((await readFormatVideos()).some(item => item.id === second.id)).toBe(true);
  expect((await readFormats()).find(item => item.id === format.id)?.library).toHaveLength(1);
});

it('preserves the entire saved template after deleting every video and reuses it for a fresh composition', async () => {
  const { cleanTemplate, saveFormatVideo, readFormatVideos, deleteFormatVideo } = await import('./storage');
  const format = newFormat();
  format.name = 'Template permanente'; format.aspect = '16:9'; format.zoom = 1.4;
  format.ratioRules = { '9:16': { zoom: 1.2, fit: 'contain', gradient: 'custom', colors: ['#000000', '#ed589c'], intensity: 3 } };
  format.scenes[0] = { ...format.scenes[0]!, freeze: true, x: .3, y: -.4, scale: .27, zoom: 1.1 };
  format.logo = { file: new File(['logo'], 'logo.png'), width: 800, height: 400, size: .15, x: .9, y: .1 };
  format.transitionDefaults = { mode: 'random', duration: .8, intensity: .6, seed: 123 };
  format.library = [{ id: 'reaction', name: 'King', description: 'Esultanza', file: new File(['reaction'], 'king.mp4'), duration: 10, trimIn: 2.25, trimOut: 5.75 }];
  format.uploads = [{ id: 'clip', name: 'clip', description: '', file: new File(['clip'], 'clip.mp4'), duration: 20, trimIn: 3, stopSeconds: 8, reactionId: 'reaction' }];
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of ids) await saveFormatVideo({ id, formatId: format.id, name: id, updatedAt: 1, snapshot: format });
  const before = (await readFormats()).find(item => item.id === format.id)!;
  for (const id of ids) await deleteFormatVideo(id);
  expect((await readFormatVideos()).filter(item => item.formatId === format.id)).toEqual([]);
  const restored = (await readFormats()).find(item => item.id === format.id)!;
  expect(restored).toEqual(before);
  expect(restored).toMatchObject({ name: format.name, aspect: '16:9', zoom: 1.4, ratioRules: format.ratioRules, scenes: format.scenes, transitionDefaults: format.transitionDefaults, logo: { x: .9, y: .1, size: .15 } });
  expect(restored.library[0]).toMatchObject({ name: 'King', trimIn: 2.25, trimOut: 5.75 });
  const fresh = cleanTemplate(restored);
  expect(fresh.uploads).toEqual([]); expect(fresh.clips).toEqual([]);
  const id = crypto.randomUUID();
  await saveFormatVideo({ id, formatId: restored.id, name: 'Nuovo', updatedAt: 2, snapshot: fresh });
  expect((await readFormatVideos()).find(item => item.id === id)?.snapshot).toEqual(restored);
});
