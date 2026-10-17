import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createProject } from '@rbs/project-schema';
import { FormatExportDialog } from './FormatExportDialog';
import { newFormat } from './model';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), probe: vi.fn(), export: vi.fn(), forget: vi.fn() }));
vi.mock('./render', () => ({ prepareFormat: mocks.prepare }));
vi.mock('./export-options', async original => ({ ...await original<typeof import('./export-options')>(), probeExportMedia: mocks.probe }));
vi.mock('../services/video-editor-offline-exporter', () => ({ exportVideoEditorOfflineVideo: mocks.export }));
vi.mock('../services/video-editor-import', () => ({ forgetVideoEditorFile: mocks.forget }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('probes only used clips, recommends their maxima and exports the selected row directly', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  URL.revokeObjectURL = vi.fn();
  const format = newFormat();
  format.uploads = ['a', 'other'].map(id => ({ id, name: id, description: '', duration: 5, stopSeconds: 3, reactionId: 'r', file: new File([''], id) }));
  format.library = ['r', 'unused'].map(id => ({ id, name: id, description: '', duration: 2, file: new File([''], id) }));
  const project = createProject();
  project.animation.videoEditor.assets = [{ id: 'asset', name: 'a', kind: 'image', url: 'blob:a', thumbnailUrl: null, width: 1080, height: 1920, durationSeconds: 0, hasAudio: false, waveform: [], bpm: null, beats: [], downbeats: [] }];
  mocks.prepare.mockResolvedValue(project);
  mocks.probe.mockImplementation(async media => ({ id: media.id, name: media.name, width: media.id === 'a' ? 3840 : 1080, height: media.id === 'a' ? 2160 : 1920, fps: media.id === 'a' ? 60 : 30 }));
  mocks.export.mockResolvedValue({ fileName: 'result.mp4' });
  const close = vi.fn();
  const { unmount } = render(<FormatExportDialog format={format} activeId="a" language="it" onClose={close} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Esporta MP4' })).toBeEnabled());
  expect(mocks.probe.mock.calls.map(call => call[0].id)).toEqual(['a', 'r']);
  expect(screen.getByLabelText('Risoluzione di esportazione')).toHaveValue('2160x3840');
  expect(screen.getByLabelText('FPS')).toHaveValue('60');
  fireEvent.change(screen.getByLabelText('Risoluzione di esportazione'), { target: { value: '1080x1920' } });
  fireEvent.change(screen.getByLabelText('FPS'), { target: { value: '29.97' } });
  fireEvent.click(screen.getByRole('button', { name: 'Esporta MP4' }));
  await screen.findByText(/Esportazione completata/);
  expect(mocks.export).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920, fps: 29.97, interpolationEnabled: false, videoEditorSettings: expect.objectContaining({ outputWidth: 1080, outputHeight: 1920 }) }), expect.any(AbortSignal), expect.any(Function));
  unmount();
  expect(mocks.forget).toHaveBeenCalledWith('asset');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a');
});
it('exports standalone clips without requiring a reaction or explicit stop', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  const format = newFormat();
  format.uploads = [{ id: 'a', name: 'a', description: '', duration: 3, file: new File([''], 'a') }];
  render(<FormatExportDialog format={format} activeId="a" language="it" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Esporta MP4' })).toBeEnabled());
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ clips: [
    expect.objectContaining({ mediaId: 'a', sourceIn: 0, sourceOut: 3, sceneId: '' })
  ] }));
});

it('allows changes while probing and preparing, without displaying 480p or overwriting manual choices', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  let resolveProbe!: (value: { id: string; name: string; width: number; height: number; fps: number }) => void;
  mocks.probe.mockImplementation(() => new Promise(resolve => { resolveProbe = resolve; }));
  let resolvePrepare!: (value: ReturnType<typeof createProject>) => void;
  mocks.prepare.mockImplementation(() => new Promise(resolve => { resolvePrepare = resolve; }));
  const format = newFormat();
  format.uploads = [{ id: 'a', name: 'a', description: '', duration: 5, stopSeconds: 3, reactionId: 'a', file: new File([''], 'a') }];
  format.library = [format.uploads[0]!];
  render(<FormatExportDialog format={format} activeId="a" language="it" onClose={vi.fn()} />);
  const resolution = screen.getByLabelText('Risoluzione di esportazione'), fps = screen.getByLabelText('FPS');
  expect(resolution).toBeEnabled(); expect(fps).toBeEnabled();
  expect(resolution).toHaveValue('1080x1920');
  fireEvent.change(resolution, { target: { value: '720x1280' } });
  fireEvent.change(fps, { target: { value: '25' } });
  resolveProbe({ id: 'a', name: 'a', width: 1920, height: 1080, fps: 60 });
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
  expect(resolution).toBeEnabled(); expect(resolution).toHaveValue('720x1280'); expect(fps).toHaveValue('25');
  resolvePrepare(createProject());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Esporta MP4' })).toBeEnabled());
  expect(resolution).toHaveValue('720x1280'); expect(fps).toHaveValue('25');
});
 

it('prepares the visibly selected row automatically even when row IDs change and metadata is slow', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  mocks.probe.mockImplementation(() => new Promise(() => {}));
  mocks.prepare.mockResolvedValue(createProject());
  const format = newFormat();
  format.uploads = [{ id: 'a', rowId: 'old', name: 'a', description: '', duration: 3, file: new File([''], 'a') }];
  const { rerender } = render(<FormatExportDialog format={format} activeId="a" language="it" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Esporta MP4' })).toBeEnabled());
  const changed = { ...format, uploads: [{ ...format.uploads[0]!, rowId: 'new' }] };
  rerender(<FormatExportDialog format={changed} activeId="a" language="it" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Esporta MP4' })).toBeEnabled());
  expect(screen.getByLabelText('Video da esportare')).toHaveValue('new');
  expect(mocks.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ uploads: changed.uploads }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
