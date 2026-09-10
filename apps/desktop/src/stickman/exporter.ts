import type { ExportProgress } from "@rbs/export-engine";
import { exportOfflineSceneVideo, type OfflineSceneExportResult } from "../services/offline-video-exporter";
import { ensureBivioFont, renderBivioFrame } from "./renderer";
import { normalizeBivioSettings, type BivioSettings } from "./settings";

export interface BivioExportSettings { sourceUrl: string; durationSeconds: number; settings: BivioSettings; resolution: 720 | 1080; fps: 24 | 30; }

export async function exportBivioVideo(options: BivioExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<OfflineSceneExportResult> {
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || !options.sourceUrl) throw new Error("Carica prima un brano audio valido.");
  if (![720, 1080].includes(options.resolution) || ![24, 30].includes(options.fps)) throw new Error("Formato di esportazione non valido.");
  if (signal.aborted) throw new DOMException("Esportazione annullata", "AbortError");
  // The workspace prepares the font before enabling export, so save-file picker
  // keeps the user's click activation. This promise is also checked by rendering.
  const prepared = ensureBivioFont();
  const settings = normalizeBivioSettings(options.settings);
  const canvas = document.createElement("canvas");
  const width = options.resolution, height = options.resolution * 16 / 9;
  const background = { colors: ["#fffefa", "#fffefa"] as [string, string], imageUrl: null, mediaType: "image" as const, presetId: "gradient" as const, finish: "clean" as const, opacity: 1, blur: 0, effects: { glow: false, particles: false, vignette: false }, neon: { enabled: false, text: "", color: "#fff" } };
  const ball = { radius: .4, color: "#fff", emission: 0, metalness: 0, trailEnabled: false, innerColor: "#fff", innerShape: "orb" as const, innerImageUrl: null, endRevealEnabled: false, revealMode: "end" as const, revealTimeSeconds: 0, revealHoldSeconds: 0 };
  let lastYield = performance.now();
  await prepared;
  if (signal.aborted) throw new DOMException("Esportazione annullata", "AbortError");
  return exportOfflineSceneVideo({ width, height, aspectRatio: "9:16", fps: options.fps, durationSeconds: options.durationSeconds, sourceDuration: options.durationSeconds, sourceUrl: options.sourceUrl, projectName: "MLSM-Bivio", quality: "high", background, ball }, {
    canvas,
    setExportSize: (w, h) => { canvas.width = w; canvas.height = h; },
    restorePreviewSize: () => { canvas.width = 1; canvas.height = 1; },
    renderNow: (time = 0) => renderBivioFrame(canvas, { timeSeconds: time, durationSeconds: options.durationSeconds, settings }),
  }, () => undefined, signal, (progress) => {
    // UI updates are capped independently from the sequential, backpressured
    // encoder. No 4K buffers, inference, parallel workers or live recording.
    const now = performance.now();
    if (now - lastYield > 100 || progress.progress === 1) { onProgress(progress); lastYield = now; }
  });
}
