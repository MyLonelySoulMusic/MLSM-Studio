import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompositionGrid } from './CompositionGrid';
import { newFormat } from './model';
afterEach(cleanup);
it('shows independent rows, targets the plus button, applies trims and appends to the selected row', () => {
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  const format = newFormat(); format.uploads = ['first', 'second'].map(id => ({ id, name: id, file: new File([''], `${id}.mp4`), duration: 10, description: '' }));
  const onReaction = vi.fn(), onUpload = vi.fn(), onChange = vi.fn();
  render(<CompositionGrid format={format} language="it" activeId="first" onActive={vi.fn()} expandedId="first" renderEditor={() => <div>Editor attivo</div>} onReaction={onReaction} onUpload={onUpload} onChange={onChange} onCreate={vi.fn()} onDelete={vi.fn()} />);
  const row = within(screen.getByRole('article', { name: 'Video finale 2' }));
  fireEvent.click(row.getByRole('button', { name: 'Aggiungi reazione a second' })); expect(onReaction).toHaveBeenCalledWith('second');
  expect(screen.getAllByText('Editor attivo')).toHaveLength(1);
  fireEvent.click(row.getByRole('button', { name: /Aggiungi colonna/ })); expect(onUpload).toHaveBeenCalledWith('second');
  fireEvent.change(row.getByLabelText('Riga di second'), { target: { value: 'first' } });
  expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'first', rowId: 'first' }), expect.objectContaining({ id: 'second', rowId: 'first' })]);
});

it('moves the full block by position and drag handle without editing its trim', () => {
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  const format = newFormat();
  format.uploads = ['a', 'b', 'c'].map((id, index) => ({ id, name: id, file: new File([''], id), description: '', duration: 10, rowId: 'row', trimIn: index + .25, stopSeconds: index + 3.5, reactionId: 'r' }));
  const onChange = vi.fn();
  render(<CompositionGrid format={format} language="it" activeId="a" expandedId="a" onActive={vi.fn()} renderEditor={() => <div>Taglio attivo</div>} onReaction={vi.fn()} onUpload={vi.fn()} onChange={onChange} onCreate={vi.fn()} onDelete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Posizione blocco a'), { target: { value: '2' } });
  expect(onChange).toHaveBeenLastCalledWith([format.uploads[1], format.uploads[2], format.uploads[0]]);
  const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
  fireEvent.dragStart(screen.getByRole('button', { name: 'Trascina blocco c' }), { dataTransfer: transfer });
  const target = screen.getByRole('button', { name: 'Modifica clip a' }).closest('.vfb-segment')!;
  fireEvent.dragOver(target, { dataTransfer: transfer, clientX: 0 });
  fireEvent.drop(target, { dataTransfer: transfer, clientX: 0 });
  expect(onChange).toHaveBeenLastCalledWith([format.uploads[2], format.uploads[0], format.uploads[1]]);
  expect(screen.getByText('Taglio attivo')).toBeInTheDocument();
  expect(format.uploads[0]?.trimIn).toBe(.25);
});
