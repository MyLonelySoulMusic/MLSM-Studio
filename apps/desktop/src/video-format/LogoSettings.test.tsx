import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LogoSettings } from './LogoSettings';
import { logoLayout } from './logo';
import { compileFormat, newFormat, type FormatLogo } from './model';
const logo: FormatLogo = { file: new File(['png'], 'logo.png', { type: 'image/png' }), width: 800, height: 400, size: .2, x: .95, y: .05 };
afterEach(cleanup);
it('uploads, positions, resizes and removes a logo', () => {
  URL.createObjectURL = vi.fn(() => 'blob:logo'); URL.revokeObjectURL = vi.fn();
  const change = vi.fn(), upload = vi.fn();
  const { rerender } = render(<LogoSettings logo={undefined} language="it" onUpload={upload} onChange={change} />);
  fireEvent.change(screen.getByLabelText('File logo'), { target: { files: [logo.file] } });
  expect(upload).toHaveBeenCalledWith(logo.file);
  rerender(<LogoSettings logo={logo} language="it" onUpload={upload} onChange={change} />);
  fireEvent.change(screen.getByLabelText('Posizione rapida logo'), { target: { value: '0.05,0.95' } });
  expect(change).toHaveBeenLastCalledWith({ ...logo, x: .05, y: .95 });
  fireEvent.change(screen.getByLabelText(/Dimensione logo/), { target: { value: '.3' } });
  expect(change).toHaveBeenLastCalledWith({ ...logo, size: .3 });
  fireEvent.click(screen.getByRole('button', { name: 'Rimuovi logo' }));
  expect(change).toHaveBeenLastCalledWith(undefined);
});
it('keeps wide and tall logos inside both aspect ratios and matches the export transform', () => {
  for (const aspect of ['9:16', '16:9'] as const) for (const width of [10, 800, 4000]) {
    const value = { ...logo, width, size: .6, x: 1, y: 1 }, layout = logoLayout(value, aspect);
    expect(layout.left + layout.width).toBeCloseTo(1);
    expect(layout.top + layout.height).toBeCloseTo(1);
    expect(layout.height).toBeLessThanOrEqual(.900001);
    const format = newFormat(); format.aspect = aspect; format.logo = value;
    format.uploads = [{ id: 'clip', name: 'clip', description: '', file: new File([''], 'clip.mp4'), duration: 3 }];
    format.clips = [{ id: 'c', mediaId: 'clip', sceneId: '', zoom: 1 }];
    const asset = { id: 'clip', name: 'clip', kind: 'video' as const, url: 'blob:clip', thumbnailUrl: null, durationSeconds: 3, width: 1920, height: 1080, hasAudio: true, waveform: [], bpm: null, beats: [], downbeats: [] };
    const logoAsset = { ...asset, id: 'logo', kind: 'image' as const, width, height: value.height, url: 'blob:logo', hasAudio: false, durationSeconds: 0 };
    const editor = compileFormat(format, new Map([['clip', asset]]), new Map(), new Map(), logoAsset).animation.videoEditor;
    expect(editor.tracks[0]?.id).toBe('video-format-logo');
    expect(editor.clips.find(item => item.id === 'video-format-logo')).toMatchObject({ assetId: 'logo', startSeconds: 0, durationSeconds: 3, muted: true, transform: { x: layout.x, y: layout.y, scale: layout.scale } });
    expect(editor.assets).toContainEqual(expect.objectContaining({ id: 'logo' }));
  }
});
