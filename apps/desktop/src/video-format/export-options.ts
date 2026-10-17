import type { FormatMedia } from './model';
export interface ExportMediaInfo { id: string; name: string; width: number; height: number; fps: number | null }
export async function probeExportMedia(media: FormatMedia): Promise<ExportMediaInfo> {
  const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(media.file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Traccia video non disponibile');
    const stats = await track.computePacketStats(300).catch(() => null);
    const rate = stats?.averagePacketRate ?? 0;
    const standards = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120, 144, 240];
    const fps = Number.isFinite(rate) && rate > 0 ? standards.find(value => Math.abs(value - rate) < .015) ?? Math.round(rate * 1000) / 1000 : null;
    return { id: media.id, name: media.name, width: track.displayWidth, height: track.displayHeight, fps };
  } finally { input.dispose(); }
}
export function exportOptions(info: ExportMediaInfo[], aspect: '9:16' | '16:9') {
  const maxEdge = Math.max(0, ...info.map(item => Math.max(item.width, item.height)));
  const maxFps = Math.max(0, ...info.map(item => item.fps ?? 0));
  const suggestedEdge = Math.min(7680, maxEdge || 1920);
  const edges = [...new Set([854, 1280, 1920, 2560, 3840, Math.round(suggestedEdge / 2) * 2])].sort((a, b) => a - b);
  const resolutions = edges.map(edge => {
    const short = Math.round(edge * 9 / 16 / 2) * 2;
    const [width, height] = aspect === '9:16' ? [short, edge] : [edge, short];
    return { width, height, value: `${width}x${height}`, recommended: edge === Math.round(suggestedEdge / 2) * 2 };
  });
  const suggestedFps = Math.min(240, maxFps || 30);
  const fps = [...new Set([23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120, suggestedFps])].sort((a, b) => a - b);
  return { resolutions, fps, maxEdge, maxFps, suggestedFps };
}
