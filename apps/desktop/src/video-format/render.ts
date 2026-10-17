import { importVideoEditorAsset, registerVideoEditorFiles } from '../services/video-editor-import';
import type { VideoEditorAsset } from '../services/video-editor';
import { compileFormat, timeline, type VideoFormat } from './model';

export async function lastFrame(file: File, stopSeconds?: number): Promise<File> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    return await new Promise<File>((resolve, reject) => {
      const timeout = window.setTimeout(() => fail(), 20000);
      const fail = () => { window.clearTimeout(timeout); reject(new Error(`Impossibile estrarre l’ultimo frame di ${file.name}.`)); };
      video.muted = true; video.preload = 'auto'; video.onloadedmetadata = () => { const time = Math.max(0, Math.min(stopSeconds ?? video.duration - 1 / 60, video.duration - .0001)); if (time > 0) video.currentTime = time; else video.onloadeddata = draw; };
      video.onerror = fail;
      const draw = () => {
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const context = canvas.getContext('2d'); if (!context) { fail(); return; }
        try { context.drawImage(video, 0, 0); } catch { fail(); return; }
        canvas.toBlob(blob => { window.clearTimeout(timeout); if (blob) resolve(new File([blob], 'ultimo-frame.png', { type: 'image/png' })); else fail(); }, 'image/png');
      };
      video.onseeked = draw;
      video.src = url; video.load();
    });
  } finally { video.onseeked = video.onloadedmetadata = video.onloadeddata = video.onerror = null; video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
export async function prepareFormat(format: VideoFormat) {
  const assets = new Map<string, VideoEditorAsset>(), stills = new Map<string, VideoEditorAsset>(), files = new Map<string, File>(), backgrounds = new Map<string, VideoEditorAsset>();
  let logoAsset: VideoEditorAsset | undefined;
  try {
    if (format.logo) { const imported = await importVideoEditorAsset(format.logo.file); logoAsset = imported.asset; files.set(imported.asset.id, imported.file); }
    const items = timeline(format);
    for (const [index, item] of items.entries()) {
      if (!assets.has(item.media.id)) { const imported = await importVideoEditorAsset(item.media.file); assets.set(item.media.id, imported.asset); files.set(imported.asset.id, imported.file); }
      if (item.scene?.freeze) {
        const previous = items[index - 1]; if (!previous) throw new Error('Inserisci una clip prima della scena con ultimo frame.');
        const imported = await importVideoEditorAsset(await lastFrame(previous.media.file, previous.sourceOut)); stills.set(item.clip.id, imported.asset); files.set(imported.asset.id, imported.file);
      }
    }
    const project = compileFormat(format, assets, stills, backgrounds, logoAsset);
    registerVideoEditorFiles(files);
    return project;
  } catch (error) {
    for (const asset of [...assets.values(), ...stills.values(), ...backgrounds.values(), ...(logoAsset ? [logoAsset] : [])]) { URL.revokeObjectURL(asset.url); if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl); }
    throw error;
  }
}
