import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StandardEditor } from './MediaEditor';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('saves a named trimmed standard and allows empty drafts without saving them', () => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:standard');
  URL.revokeObjectURL = vi.fn();
  const onSave = vi.fn();
  const media = { id: 'king', name: 'original', description: '', duration: 10, file: new File([''], 'king.mp4') };
  render(<StandardEditor media={media} language="it" busy={false} onSave={onSave} onClose={vi.fn()} />);
  // jsdom's modal shim needs the native open attribute for accessibility queries.
  document.querySelector('dialog')!.setAttribute('open', '');
  fireEvent.change(screen.getByLabelText('Inizio (s)'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Salva nella galleria standard' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Inizio (s)'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Fine (s)'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Nome della reazione'), { target: { value: 'Reazione king' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salva nella galleria standard' }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reazione king', trimIn: 2, trimOut: 5, file: media.file }));
});
