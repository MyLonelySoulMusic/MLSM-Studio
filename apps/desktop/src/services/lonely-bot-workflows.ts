import { exportUpscalerImage } from "./upscaler-image-exporter";
import { exportUpscaledVideo } from "./upscaler-video-exporter";
import { frameInterpolationJob, type FrameInterpolationMethod } from "./frame-interpolation-client";
import { classifyUpscalerMediaFile } from "./upscaler-media-file";
import { pythonUpscalerHealth } from "./upscaler-python-client";
import { resolveUpscalerTarget } from "./upscaler-renderer";
import { type UpscalerModelId, upscalerModels } from "./upscaler-runtime";
import { useProjectStore } from "../store/project-store";

export type LonelyBotWorkflowKind = "upscaler" | "frameBooster";

export interface LonelyBotWorkflowConfig {
  kind: LonelyBotWorkflowKind;
  scale: 2 | 4;
  model: UpscalerModelId;
  frameMethod: FrameInterpolationMethod;
  frameMultiplier: 2 | 3 | 4;
}

export interface LonelyBotWorkflowProgress {
  progress: number;
  message: string;
}

export interface LonelyBotArtifact {
  name: string;
  blob: Blob;
}

export const defaultLonelyBotWorkflowConfig: LonelyBotWorkflowConfig = {
  kind: "upscaler",
  scale: 4,
  model: "realesr-general-x4v3",
  frameMethod: "motion",
  frameMultiplier: 2,
};

export const lonelyBotUpscalerModels = upscalerModels.map(({ id, label }) => ({ id, label }));

export function detectLonelyBotWorkflow(question: string): LonelyBotWorkflowKind | null {
  const normalized = question.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "");
  const operation = /(?:avvia|avviare|fai|fare|esegui|elabora|processa|migliora|aumenta|porta|crea)/.test(normalized);
  if (!operation) return null;
  if (/(?:frame booster|interpol|aumenta(?:re)? (?:gli )?fps|60 fps|120 fps)/.test(normalized)) return "frameBooster";
  if (/(?:upscal|aumenta(?:re)? la risoluzione|porta(?:re)? (?:in|a) (?:4k|8k))/.test(normalized)) return "upscaler";
  return null;
}

export function validateLonelyBotWorkflow(kind: LonelyBotWorkflowKind, files: readonly File[]): string | null {
  if (!files.length) return kind === "upscaler" ? "Allega almeno un’immagine o un video da elaborare." : "Allega il video da interpolare.";
  if (kind === "frameBooster") {
    if (files.length !== 1) return "Frame Booster accetta un video alla volta: lascia un solo allegato video.";
    const classification = classifyUpscalerMediaFile(files[0]!);
    if (!classification.supported || classification.kind !== "video") return "Frame Booster richiede un file video supportato.";
    return null;
  }
  const invalid = files.find((file) => !classifyUpscalerMediaFile(file).supported);
  return invalid ? `${invalid.name} non è un’immagine o un video supportato dall’Upscaler.` : null;
}

function mediaDimensions(file: File, kind: "image" | "video", url: string): Promise<{ width: number; height: number; duration: number }> {
  if (kind === "image") return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, duration: 0 });
    image.onerror = () => reject(new Error(`${file.name}: immagine non leggibile.`));
    image.src = url;
  });
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const release = () => { video.removeAttribute("src"); video.load(); };
    video.preload = "metadata";
    video.onloadedmetadata = () => { const result = { width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 }; release(); resolve(result); };
    video.onerror = () => { release(); reject(new Error(`${file.name}: video non leggibile.`)); };
    video.src = url;
  });
}

async function imageSource(file: File, url: string): Promise<{ source: CanvasImageSource; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, close: () => bitmap.close() };
  }
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve({ source: image, close: () => undefined }); image.onerror = () => reject(new Error(`${file.name}: immagine non leggibile.`)); image.src = url;
  });
}

function frameOutputName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "") || "video";
  return `${stem}-boosted.mp4`;
}

export async function runLonelyBotWorkflow(options: {
  config: LonelyBotWorkflowConfig;
  files: readonly File[];
  signal: AbortSignal;
  onProgress: (value: LonelyBotWorkflowProgress) => void;
}): Promise<LonelyBotArtifact[]> {
  const validation = validateLonelyBotWorkflow(options.config.kind, options.files);
  if (validation) throw new Error(validation);
  if (options.config.kind === "frameBooster") {
    options.onProgress({ progress: .02, message: "Verifica del backend Frame Booster" });
    const health = await pythonUpscalerHealth(true);
    if (!health?.interpolation?.ffmpeg) throw new Error("Il backend FFmpeg di Frame Booster non è disponibile.");
    const file = options.files[0]!;
    const result = await frameInterpolationJob({
      blob: file,
      fileName: file.name,
      method: options.config.frameMethod,
      targetMultiplier: options.config.frameMultiplier,
      signal: options.signal,
      onStatus: (status) => options.onProgress({ progress: status.stageProgress ?? status.progress, message: status.phaseLabel ?? status.phase }),
    });
    if (!result.blob.size) throw new Error("Frame Booster ha restituito un file vuoto.");
    return [{ name: frameOutputName(file.name), blob: result.blob }];
  }

  const artifacts: LonelyBotArtifact[] = [];
  const baseSettings = useProjectStore.getState().project.animation.upscaler;
  for (let index = 0; index < options.files.length; index += 1) {
    if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
    const file = options.files[index]!;
    const classification = classifyUpscalerMediaFile(file);
    if (!classification.supported) throw new Error(classification.message);
    const url = URL.createObjectURL(file);
    try {
      const metadata = await mediaDimensions(file, classification.kind, url);
      const target = resolveUpscalerTarget(metadata.width, metadata.height, options.config.scale);
      const settings = {
        ...baseSettings,
        sourceUrl: url,
        sourceName: file.name,
        sourceKind: classification.kind,
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        durationSeconds: metadata.duration,
        finalWidth: target.width,
        finalHeight: target.height,
        scale: options.config.scale,
        model: options.config.model,
        remote: { ...baseSettings.remote, enabled: false, endpoints: baseSettings.remote.endpoints.map((endpoint) => ({ ...endpoint })) },
        adjustments: { ...baseSettings.adjustments },
      };
      const offset = index / options.files.length;
      const span = 1 / options.files.length;
      if (classification.kind === "image") {
        const loaded = await imageSource(file, url);
        try {
          const output = await exportUpscalerImage({
            source: loaded.source,
            settings,
            sourceName: file.name,
            signal: options.signal,
            onModelProgress: (value) => options.onProgress({ progress: offset + value.progress * span, message: `${file.name} · ${value.phase}` }),
          });
          artifacts.push({ name: output.fileName, blob: output.blob });
        } finally { loaded.close(); }
      } else {
        const output = await exportUpscaledVideo({ projectName: file.name.replace(/\.[^.]+$/, ""), quality: "high", sourceVideoUrl: url, sourceVideoFile: file, upscalerSettings: settings, suppressDownload: true }, options.signal, (value) => options.onProgress({ progress: offset + value.progress * span, message: `${file.name} · ${value.phaseLabel ?? value.phase}` }));
        if (!output.blob?.size) throw new Error(`${file.name}: l’Upscaler non ha restituito il video.`);
        artifacts.push({ name: output.fileName, blob: output.blob });
      }
      options.onProgress({ progress: (index + 1) / options.files.length, message: `${file.name} completato` });
    } finally { URL.revokeObjectURL(url); }
  }
  return artifacts;
}
