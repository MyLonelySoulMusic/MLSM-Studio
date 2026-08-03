import type { RhythmBallProject } from "@rbs/project-schema";
import type { ModelLoadProgress } from "./upscaler-ai";

type Settings = RhythmBallProject["animation"]["upscaler"];
export const pythonUpscalerBaseUrl = "http://127.0.0.1:8765";
export interface PythonUpscalerHealth { ok: boolean; mps: boolean; cuda: boolean; recommendedBackend: "metal" | "cuda" | "cpu"; gpuName: string }
let healthPromise: Promise<PythonUpscalerHealth | null> | null = null;
let healthCheckedAt = 0;

export function pythonUpscalerHealth(refresh = false): Promise<PythonUpscalerHealth | null> {
  const stale = Date.now() - healthCheckedAt > 3_000;
  if (refresh || !healthPromise || stale) {
    healthCheckedAt = Date.now();
    healthPromise = fetch(`${pythonUpscalerBaseUrl}/health`, { signal: AbortSignal.timeout(2500) }).then((response) => response.ok ? response.json() as Promise<PythonUpscalerHealth> : null).catch(() => null);
  }
  return healthPromise;
}

export function shouldUsePythonUpscaler(webExecutable: boolean, backend: Settings["backend"], health: PythonUpscalerHealth | null): boolean {
  return !webExecutable || backend === "metal" || backend === "cuda" || (backend === "auto" && Boolean(health && (health.mps || health.cuda)));
}

async function prepareModel(model: Settings["model"], onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<void> {
  const start = await fetch(`${pythonUpscalerBaseUrl}/models/${encodeURIComponent(model)}/prepare`, { method: "POST", ...(signal ? { signal } : {}) }); if (!start.ok) throw new Error(`Il servizio Python non riesce a preparare ${model}.`);
  while (true) {
    if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
    const response = await fetch(`${pythonUpscalerBaseUrl}/models/${encodeURIComponent(model)}/status`, signal ? { signal } : undefined); const item = await response.json() as { phase: string; progress?: number; loadedBytes?: number; totalBytes?: number; error?: string };
    if (item.phase === "error") throw new Error(item.error || "Download PyTorch fallito.");
    if (item.phase === "ready") { onProgress({ phase: "cache", progress: 1, ...(item.loadedBytes ? { loadedBytes: item.loadedBytes } : {}), ...(item.totalBytes ? { totalBytes: item.totalBytes } : {}) }); return; }
    onProgress({ phase: "download", progress: item.progress ?? 0, ...(item.loadedBytes ? { loadedBytes: item.loadedBytes } : {}), ...(item.totalBytes ? { totalBytes: item.totalBytes } : {}) });
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas) return { width: source.width, height: source.height };
  return { width: 1, height: 1 };
}

export async function generatePythonUpscale(source: CanvasImageSource, settings: Settings, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const health = await pythonUpscalerHealth(true); if (!health) throw new Error("Nessun servizio PyTorch risponde su 127.0.0.1:8765. Lascia aperto un secondo terminale con `npm run upscaler:server`, poi premi Riprova connessione nell’Upscaler.");
  await prepareModel(settings.model, onProgress, signal); onProgress({ phase: "initializing", progress: 0 });
  const size = sourceSize(source); const input = document.createElement("canvas"); input.width = size.width; input.height = size.height; const context = input.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas sorgente non disponibile."); context.drawImage(source, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob>((resolve, reject) => input.toBlob((value) => value ? resolve(value) : reject(new Error("Codifica sorgente fallita.")), "image/png")); const form = new FormData(); form.set("file", blob, "source.png"); form.set("model", settings.model); form.set("backend", settings.backend); form.set("tile", String(settings.tileSize)); form.set("width", String(settings.finalWidth)); form.set("height", String(settings.finalHeight)); form.set("tta", String(settings.tta));
  onProgress({ phase: "inference", progress: 0 }); const response = await fetch(`${pythonUpscalerBaseUrl}/upscale`, { method: "POST", body: form, ...(signal ? { signal } : {}) }); if (!response.ok) throw new Error(await response.text() || `Upscaling PyTorch fallito: HTTP ${response.status}.`);
  const resultBlob = await response.blob(); const bitmap = await createImageBitmap(resultBlob); const result = document.createElement("canvas"); result.width = bitmap.width; result.height = bitmap.height; const resultContext = result.getContext("2d", { alpha: false }); if (!resultContext) throw new Error("Canvas PyTorch risultato non disponibile."); resultContext.drawImage(bitmap, 0, 0); bitmap.close(); onProgress({ phase: "ready", progress: 1 }); return result;
}
