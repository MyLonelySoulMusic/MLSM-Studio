import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createProject } from '@rbs/project-schema';
import { updateUiPreferences } from '../services/ui-preferences';
import { UiLocalizationBridge } from '../components/UiLocalizationBridge';
import { newFormat, reactionClips } from './model';
import { VideoFormatWorkspace } from './VideoFormatWorkspace';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), prepare: vi.fn(), deleteRecord: vi.fn() }));
vi.mock('../services/memory-engine', () => ({ createMemoryEngine: () => ({ deleteRecord: mocks.deleteRecord }) }));
vi.mock('./storage', () => ({ readFormats: mocks.read, saveFormat: mocks.save }));
vi.mock('./render', () => ({ prepareFormat: mocks.prepare, lastFrame: vi.fn().mockResolvedValue(new File([''], 'frame.png')) }));
beforeEach(() => { updateUiPreferences({ language: 'it' }); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); });
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
it('restores a format, saves edits and opens the generated composition in the editor', async () => {
  const format = newFormat(); format.uploads = [{ id: 'game', name: 'Gameplay', description: '', duration: 5, stopSeconds: 3, reactionId: 'king', file: new File([''], 'game.mp4') }];
  format.library = [{ id: 'king', name: 'King', description: '', duration: 2, file: new File([''], 'king.mp4') }]; format.clips = reactionClips(format);
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue(createProject());
  const onEditor = vi.fn(); render(<VideoFormatWorkspace onHome={vi.fn()} onEditor={onEditor} />);
  await waitFor(() => expect(screen.getByLabelText('Nome del format')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Nome del format'), { target: { value: 'Gaming highlights' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crea questa riga →' }));
  await waitFor(() => expect(onEditor).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gaming highlights' }));
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ clips: format.clips }));
});
it('keeps the draft open when saving fails', async () => {
  mocks.read.mockResolvedValue([newFormat()]); mocks.save.mockRejectedValue(new Error('Spazio esaurito'));
  const onHome = vi.fn(); render(<VideoFormatWorkspace onHome={onHome} onEditor={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '← Aree' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '← Aree' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Spazio esaurito');
  expect(onHome).not.toHaveBeenCalled();
});

it('switches full UI phrases with the legacy bridge active and preserves user text', async () => {
  const format = newFormat('en'); format.name = 'La mia reaction';
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined);
  updateUiPreferences({ language: 'en' });
  render(<><UiLocalizationBridge /><VideoFormatWorkspace onHome={vi.fn()} onEditor={vi.fn()} /></>);
  await waitFor(() => expect(screen.getByLabelText('Format name')).toBeEnabled());
  expect(screen.getByLabelText('Format name')).toHaveValue('La mia reaction');
  expect(screen.getByRole('heading', { name: 'New videos' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Search a name or describe the reaction…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ Add standard video' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save format and draft' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Format and draft saved on this device.'));
  act(() => updateUiPreferences({ language: 'it' }));
  expect(screen.getByRole('heading', { name: 'Video nuovi' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Format e bozza salvati sul dispositivo.');
  expect(screen.getByLabelText('Nome del format')).toHaveValue('La mia reaction');
  act(() => updateUiPreferences({ language: 'en' }));
  expect(screen.getByRole('button', { name: 'Save format and draft' })).toBeInTheDocument();
});

it('saves a stop point and reuses the chosen reaction for the next queued video', async () => {
  const format = newFormat();
  format.uploads = ['one', 'two'].map(id => ({ id, name: id, description: '', duration: 10, width: 1920, height: 1080, file: new File([''], `${id}.mp4`) }));
  format.library = [{ id: 'king', name: 'King', description: '', duration: 4, trimIn: 1, trimOut: 3, file: new File([''], 'king.mp4') }];
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined);
  render(<VideoFormatWorkspace onHome={vi.fn()} onEditor={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Nome del format')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Usa reazione King' }));
  fireEvent.change(screen.getByLabelText('Punto di arresto'), { target: { value: '2.5' } });
  fireEvent.click(screen.getByRole('button', { name: /Ferma qui/ }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'two' })).toBeInTheDocument());
  expect(mocks.save.mock.lastCall?.[0].clips[0]).toMatchObject({ sourceOut: 2.5 });
  fireEvent.change(screen.getByLabelText('Punto di arresto'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: /Ferma qui/ }));
  await waitFor(() => expect(mocks.save.mock.lastCall?.[0].clips).toHaveLength(4));
  fireEvent.change(screen.getByLabelText('Palette sfondo'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Intensità sfocatura'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salva format e bozza' }));
  await waitFor(() => expect(mocks.save.mock.lastCall?.[0].ratioRules['16:9']).toMatchObject({ gradient: 'custom', intensity: 4, fit: 'contain' }));
});

it('inserts a reaction with the clip plus and exports only the selected row', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  const format = newFormat();
  format.uploads = ['first', 'second', 'separate'].map((id, index) => ({ id, name: id, description: '', duration: 10, trimIn: 2, stopSeconds: 5, rowId: index < 2 ? 'long' : 'other', ...(id === 'second' ? {} : { reactionId: 'king' }), file: new File([''], `${id}.mp4`) }));
  format.library = [{ id: 'king', name: 'King', description: '', duration: 3, file: new File([''], 'king.mp4') }];
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue(createProject());
  const onEditor = vi.fn();
  render(<VideoFormatWorkspace onHome={vi.fn()} onEditor={onEditor} />);
  await waitFor(() => expect(screen.getByLabelText('Nome del format')).toBeEnabled());
  expect(screen.getAllByRole('button', { name: 'Crea questa riga →' })[0]).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Aggiungi reazione a second' }));
  expect(screen.getByRole('heading', { name: 'Reazione per second' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'King' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Crea questa riga →' })[0]!);
  await waitFor(() => expect(onEditor).toHaveBeenCalledOnce());
  const compiled = mocks.prepare.mock.lastCall?.[0];
  expect(compiled.uploads.map((media: { id: string }) => media.id)).toEqual(['first', 'second']);
  expect(compiled.clips).toHaveLength(4);
  expect(compiled.clips[2]).toMatchObject({ mediaId: 'second', sourceIn: 2, sourceOut: 5 });
});

it('deletes standards and uploads persistently while clearing dependent reactions', async () => {
  const format = newFormat();
  format.uploads = [{ id: 'game', name: 'Gameplay', description: '', duration: 8, trimIn: 2, stopSeconds: 5, reactionId: 'king', file: new File([''], 'game.mp4') }];
  format.library = [{ id: 'king', name: 'King', description: '', duration: 3, file: new File([''], 'king.mp4') }];
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined); mocks.deleteRecord.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  render(<VideoFormatWorkspace onHome={vi.fn()} onEditor={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Nome del format')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Elimina video standard King' }));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('1 clip usano questa reazione');
  fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
  fireEvent.click(screen.getByRole('button', { name: 'Elimina video standard King' }));
  fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Usa reazione King' })).not.toBeInTheDocument());
  expect(mocks.deleteRecord).toHaveBeenCalledWith('king');
  expect(mocks.save.mock.lastCall?.[0].uploads[0]).toMatchObject({ trimIn: 2, stopSeconds: 5 });
  expect(mocks.save.mock.lastCall?.[0].uploads[0].reactionId).toBeUndefined();
  expect(mocks.save.mock.lastCall?.[0].clips).toEqual([]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Elimina clip Gameplay' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Elimina clip Gameplay' }));
  fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Modifica clip Gameplay' })).not.toBeInTheDocument());
  expect(mocks.save.mock.lastCall?.[0].uploads).toEqual([]);
});

it('opens at most one clip editor and keeps the full preview visible when collapsed', async () => {
  const format = newFormat(); format.uploads = ['one', 'two', 'three'].map(id => ({ id, name: id, description: '', duration: 10, file: new File([''], `${id}.mp4`) }));
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined);
  render(<VideoFormatWorkspace onHome={vi.fn()} onEditor={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Nome del format')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Modifica clip two' }));
  expect(screen.queryByLabelText('Inizio one')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Inizio two')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Chiudi modifica' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Inizio two'), { target: { value: '3' } });
  expect(screen.getByRole('slider', { name: 'Posizione nel video completo' })).toHaveAttribute('max', '7');
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi modifica' }));
  expect(screen.queryByLabelText('Inizio two')).not.toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Anteprima video completo' })).toBeInTheDocument();
});

it('applies and saves trims, resets the source monitor and exports the selected interval', async () => {
  const format = newFormat();
  format.uploads = [{ id: 'game', name: 'Gameplay', description: '', duration: 10, reactionId: 'king', file: new File([''], 'game.mp4') }];
  format.library = [{ id: 'king', name: 'King', description: '', duration: 3, file: new File([''], 'king.mp4') }];
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue(createProject());
  const { container } = render(<VideoFormatWorkspace onHome={vi.fn()} onEditor={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Inizio Gameplay')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Inizio Gameplay'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Fine Gameplay'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Applica taglio' }));
  await screen.findByText('Taglio applicato a Gameplay: 2.00–6.00 s · durata 4.00 s');
  expect(mocks.save.mock.lastCall?.[0].uploads[0]).toMatchObject({ trimIn: 2, stopSeconds: 6 });
  const video = container.querySelector('.vfb-monitor video') as HTMLVideoElement;
  expect(video.currentTime).toBe(2);
  video.currentTime = 0; fireEvent.play(video); expect(video.currentTime).toBe(2);
  video.currentTime = 7; fireEvent.timeUpdate(video); expect(video.currentTime).toBe(6);
  fireEvent.click(screen.getByRole('button', { name: 'Crea questa riga →' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
  expect(mocks.prepare.mock.lastCall?.[0].clips[0]).toMatchObject({ sourceIn: 2, sourceOut: 6 });
});


it('applies a global transition to the left boundaries, saves one override and exports both', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  const format = newFormat();
  format.uploads = ['a', 'b'].map(id => ({ id, name: id, description: '', duration: 5, stopSeconds: 3, reactionId: 'r', rowId: 'row', file: new File([''], id) }));
  format.library = [{ id: 'r', name: 'Reaction', description: '', duration: 2, file: new File([''], 'r') }];
  mocks.read.mockResolvedValue([format]); mocks.save.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue(createProject());
  render(<VideoFormatWorkspace onHome={vi.fn()} onEditor={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Modalità transizioni')).toBeEnabled());
  expect(screen.getAllByRole('button', { name: 'Aggiungi transizione' })).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Modalità transizioni'), { target: { value: 'black' } });
  expect(screen.getAllByRole('button', { name: 'Modifica transizione' })).toHaveLength(3);
  fireEvent.click(screen.getAllByRole('button', { name: 'Modifica transizione' })[1]!);
  fireEvent.change(screen.getByLabelText('Tipo di transizione'), { target: { value: 'blur' } });
  fireEvent.change(screen.getByLabelText(/^Durata ·/), { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Applica transizione' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salva format e bozza' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    transitionDefaults: expect.objectContaining({ mode: 'black', duration: 1 }),
    transitions: { '["a-reaction","b-source"]': { kind: 'blur', duration: 1.5, intensity: .5 } }
  })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Crea questa riga →' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Crea questa riga →' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
    transitions: { '["a-reaction","b-source"]': { kind: 'blur', duration: 1.5, intensity: .5 } }
  })));
});
