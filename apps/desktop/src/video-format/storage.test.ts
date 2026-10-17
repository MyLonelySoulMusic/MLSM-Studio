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
