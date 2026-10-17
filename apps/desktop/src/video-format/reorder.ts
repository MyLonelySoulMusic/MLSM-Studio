import type { FormatMedia } from './model';

/** Reorder complete clip/reaction blocks, preserving media identities and all trim fields.
 * Only the slots belonging to the selected row change; other outputs keep their order.
 */
export function reorderBlocks(uploads: FormatMedia[], id: string, position: number): FormatMedia[] {
  const source = uploads.find(media => media.id === id);
  if (!source || !Number.isInteger(position)) return uploads;
  const rowId = source.rowId ?? source.id;
  const blocks = uploads.filter(media => (media.rowId ?? media.id) === rowId);
  const from = blocks.findIndex(media => media.id === id);
  const to = Math.max(0, Math.min(blocks.length - 1, position));
  if (from === to) return uploads;
  blocks.splice(from, 1);
  blocks.splice(to, 0, source);
  let index = 0;
  return uploads.map(media => (media.rowId ?? media.id) === rowId ? blocks[index++]! : media);
}
