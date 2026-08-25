import type { RhythmBallProject } from "@rbs/project-schema";
import type { ModelLoadProgress } from "./upscaler-ai";
import { canvasImageSourceSize } from "./canvas-image-source";

type Settings = RhythmBallProject["animation"]["upscaler"];
const remoteCoordinatorBaseUrl = "http://127.0.0.1:8765";

export interface RemoteUpscalerModel { name: string; scale: number; description: string; default: boolean }
export interface RemoteUpscalerEndpointStatus { url: string; ok: boolean; models: RemoteUpscalerModel[]; error?: string }
export interface RemoteUpscalerCatalog { ok: boolean; endpoints: RemoteUpscalerEndpointStatus[]; models: RemoteUpscalerModel[]; defaultModel: string }

export function normalizeRemoteUpscalerEndpoint(value: string): string {
  return value.trim().replace(/\/(?:gradio_api\/)?(?:api\/upscale_models|call\/upscale_image)\/?$/i, "").replace(/\/$/, "");
}

export function activeRemoteUpscalerEndpoints(settings: Settings): string[] {
  return [...new Set(settings.remote.endpoints.filter((item) => item.enabled).map((item) => normalizeRemoteUpscalerEndpoint(item.url)).filter(Boolean))];
}

export function usesRemoteUpscaler(settings: Settings): boolean {
  return settings.remote.enabled && Boolean(settings.remote.model) && activeRemoteUpscalerEndpoints(settings).length > 0;
}

export function shouldGenerateUpscalerAi(settings: Settings): boolean {
  return usesRemoteUpscaler(settings) || settings.model !== "canvas";
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  try { const value = JSON.parse(text) as { detail?: string }; return value.detail || fallback; }
  catch { return text || fallback; }
}

export async function discoverRemoteUpscalerModels(endpoints: string[], signal?: AbortSignal): Promise<RemoteUpscalerCatalog> {
  const response = await fetch(`${remoteCoordinatorBaseUrl}/upscale/remote/catalog`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoints }), ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error(await errorMessage(response, `Discovery remota fallita: HTTP ${response.status}.`));
  const catalog = await response.json() as RemoteUpscalerCatalog;
  if (!Array.isArray(catalog.models) || !Array.isArray(catalog.endpoints)) throw new Error("Catalogo remoto non valido.");
  return catalog;
}

async function sourcePng(source: CanvasImageSource): Promise<Blob> {
  const size = canvasImageSourceSize(source);
  const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas sorgente remoto non disponibile.");
  context.drawImage(source, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Codifica PNG remota fallita.")), "image/png"));
}

export async function generateRemoteUpscale(
  source: CanvasImageSource, settings: Settings, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal
): Promise<HTMLCanvasElement> {
  const endpoints = activeRemoteUpscalerEndpoints(settings);
  if (!settings.remote.model || !endpoints.length) throw new Error("Seleziona un modello e almeno un endpoint remoto attivo.");
  onProgress({ phase: "initializing", progress: 0 });
  const input = await sourcePng(source);
  const form = new FormData();
  form.set("file", input, "source.png"); form.set("endpoints", JSON.stringify(endpoints)); form.set("model", settings.remote.model);
  form.set("width", String(settings.finalWidth)); form.set("height", String(settings.finalHeight));
  onProgress({ phase: "inference", progress: .05 });
  const response = await fetch(`${remoteCoordinatorBaseUrl}/upscale/remote/image`, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(await errorMessage(response, `Upscaling remoto fallito: HTTP ${response.status}.`));
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const result = document.createElement("canvas"); result.width = bitmap.width; result.height = bitmap.height;
    const context = result.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas risultato remoto non disponibile.");
    context.drawImage(bitmap, 0, 0); onProgress({ phase: "ready", progress: 1 }); return result;
  } finally { bitmap.close(); }
}
