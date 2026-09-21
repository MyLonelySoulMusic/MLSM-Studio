import type { RhythmBallProject } from "@rbs/project-schema";
import type { ModelLoadProgress } from "./upscaler-ai";
import { canvasImageSourceSize } from "./canvas-image-source";

type Settings = RhythmBallProject["animation"]["upscaler"];
const remoteCoordinatorBaseUrl = "http://127.0.0.1:8765";

export interface RemoteUpscalerModel { name: string; scale: number; description: string; default: boolean }
export interface RemoteUpscalerEndpointStatus { url: string; ok: boolean; models: RemoteUpscalerModel[]; error?: string }
export interface RemoteUpscalerCatalog { ok: boolean; endpoints: RemoteUpscalerEndpointStatus[]; models: RemoteUpscalerModel[]; defaultModel: string; transport?: "coordinator" | "direct" }

interface GradioCatalog {
  ok?: boolean;
  default_model?: string;
  models?: RemoteUpscalerModel[];
}
interface GradioCatalogEnvelope { data?: GradioCatalog[] }

interface GradioQueuedEnvelope { event_id?: string }
interface GradioUpscaleResult { ok?: boolean; image?: string; error?: string }

export function normalizeRemoteUpscalerEndpoint(value: string): string {
  return value.trim().replace(/\/(?:gradio_api\/)?(?:api\/upscale_models|call\/(?:upscale_models|upscale_image|upscale_video_chunk))\/?$/i, "").replace(/\/$/, "");
}

export function activeRemoteUpscalerEndpoints(settings: Settings): string[] {
  return [...new Set(settings.remote.endpoints.filter((item) => item.enabled).map((item) => normalizeRemoteUpscalerEndpoint(item.url)).filter(Boolean))];
}

export function usesRemoteUpscaler(settings: Settings): boolean {
  // Enabling the remote coordinator is an explicit routing decision. A missing
  // model must surface as a configuration error; it must never silently fall
  // through to the local Canvas/PyTorch video path.
  return settings.provider === "classic" && settings.remote.enabled && activeRemoteUpscalerEndpoints(settings).length > 0;
}

export function shouldGenerateUpscalerAi(settings: Settings): boolean {
  return settings.provider === "mlx-dlss" || usesRemoteUpscaler(settings) || settings.model !== "canvas";
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  try { const value = JSON.parse(text) as { detail?: string }; return value.detail || fallback; }
  catch { return text || fallback; }
}

function abortError(signal?: AbortSignal): DOMException | null {
  return signal?.aborted ? new DOMException("Operazione annullata", "AbortError") : null;
}

async function directCatalogForEndpoint(endpoint: string, signal?: AbortSignal): Promise<{
  status: RemoteUpscalerEndpointStatus;
  defaultModel: string;
}> {
  const normalized = normalizeRemoteUpscalerEndpoint(endpoint);
  const errors: string[] = [];
  for (const path of ["/gradio_api/call/upscale_models", "/call/upscale_models"]) {
    const aborted = abortError(signal); if (aborted) throw aborted;
    try {
      const submission = await fetch(`${normalized}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [] }),
        ...(signal ? { signal } : {})
      });
      if (!submission.ok) throw new Error(await errorMessage(submission, `HTTP ${submission.status}`));
      const queued = await submission.json() as GradioQueuedEnvelope;
      if (!queued.event_id) throw new Error("Gradio non ha restituito event_id per il catalogo.");
      const stream = await fetch(`${normalized}${path}/${encodeURIComponent(queued.event_id)}`, signal ? { signal } : undefined);
      if (!stream.ok) throw new Error(await errorMessage(stream, `HTTP ${stream.status}`));
      const catalog = parseGradioCompleteEvent(await stream.text())[0] as GradioCatalog | undefined;
      if (!catalog?.ok || !Array.isArray(catalog.models) || !catalog.models.length) {
        throw new Error("risposta catalogo non valida");
      }
      return {
        status: { url: normalized, ok: true, models: catalog.models },
        defaultModel: catalog.default_model ?? ""
      };
    } catch (reason) {
      const aborted = abortError(signal); if (aborted) throw aborted;
      errors.push(reason instanceof Error ? reason.message : String(reason));
    }
  }
  for (const path of ["/gradio_api/api/upscale_models", "/api/upscale_models"]) {
    const aborted = abortError(signal); if (aborted) throw aborted;
    try {
      const response = await fetch(`${normalized}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [] }),
        ...(signal ? { signal } : {})
      });
      if (!response.ok) throw new Error(await errorMessage(response, `HTTP ${response.status}`));
      const envelope = await response.json() as GradioCatalogEnvelope;
      const catalog = envelope.data?.[0];
      if (!catalog?.ok || !Array.isArray(catalog.models) || !catalog.models.length) {
        throw new Error("risposta catalogo non valida");
      }
      return {
        status: { url: normalized, ok: true, models: catalog.models },
        defaultModel: catalog.default_model ?? ""
      };
    } catch (reason) {
      const aborted = abortError(signal); if (aborted) throw aborted;
      errors.push(reason instanceof Error ? reason.message : String(reason));
    }
  }
  throw new Error(errors.at(-1) || "endpoint non raggiungibile");
}

export async function discoverRemoteUpscalerModelsDirect(
  endpoints: string[],
  signal?: AbortSignal
): Promise<RemoteUpscalerCatalog> {
  const normalized = [...new Set(endpoints.map(normalizeRemoteUpscalerEndpoint).filter(Boolean))];
  const results = await Promise.allSettled(normalized.map((endpoint) => directCatalogForEndpoint(endpoint, signal)));
  const healthy: Array<{ status: RemoteUpscalerEndpointStatus; defaultModel: string }> = [];
  const statuses = results.map((result, index): RemoteUpscalerEndpointStatus => {
    if (result.status === "fulfilled") { healthy.push(result.value); return result.value.status; }
    return {
      url: normalized[index] ?? "",
      ok: false,
      models: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    };
  });
  const aborted = abortError(signal); if (aborted) throw aborted;
  if (!healthy.length) {
    const details = statuses.map((item) => `${item.url}: ${item.error || "offline"}`).join(" | ");
    throw new Error(`Nessun endpoint Gradio ha risposto. ${details}`);
  }
  const modelsByName = new Map<string, RemoteUpscalerModel>();
  for (const item of healthy) {
    for (const model of item.status.models) if (!modelsByName.has(model.name)) modelsByName.set(model.name, model);
  }
  const models = [...modelsByName.values()];
  const preferred = healthy.map((item) => item.defaultModel).find((name) => modelsByName.has(name));
  return {
    ok: true,
    endpoints: statuses,
    models,
    defaultModel: preferred || models.find((model) => model.default)?.name || models[0]?.name || "",
    transport: "direct"
  };
}

export async function discoverRemoteUpscalerModels(endpoints: string[], signal?: AbortSignal): Promise<RemoteUpscalerCatalog> {
  let response: Response;
  try {
    response = await fetch(`${remoteCoordinatorBaseUrl}/upscale/remote/catalog`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoints }), ...(signal ? { signal } : {})
    });
  } catch {
    const aborted = abortError(signal); if (aborted) throw aborted;
    return discoverRemoteUpscalerModelsDirect(endpoints, signal);
  }
  if (!response.ok) {
    const coordinatorError = await errorMessage(response, `Discovery remota fallita: HTTP ${response.status}.`);
    try { return await discoverRemoteUpscalerModelsDirect(endpoints, signal); }
    catch (reason) {
      const aborted = abortError(signal); if (aborted) throw aborted;
      throw new Error(`${coordinatorError} Verifica diretta: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  const catalog = await response.json() as RemoteUpscalerCatalog;
  if (!Array.isArray(catalog.models) || !Array.isArray(catalog.endpoints)) throw new Error("Catalogo remoto non valido.");
  return { ...catalog, transport: "coordinator" };
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Codifica base64 remota fallita."));
    reader.onerror = () => reject(reader.error ?? new Error("Codifica base64 remota fallita."));
    reader.readAsDataURL(blob);
  });
}

function decodeDataUrl(value: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!match) throw new Error("Gradio ha restituito un'immagine non valida.");
  const mimeType = match[1] || "image/png";
  const payload = match[3] ?? "";
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

function parseGradioCompleteEvent(body: string): unknown[] {
  let event = "";
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (event === "error") throw new Error(raw || "Il job Gradio ha restituito un errore.");
    if (event !== "complete") continue;
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) throw new Error("Risultato Gradio non valido.");
    return data;
  }
  throw new Error("Lo stream Gradio è terminato senza un risultato.");
}

function parseGradioImageEventStream(body: string): GradioUpscaleResult {
  const result = parseGradioCompleteEvent(body)[0] as GradioUpscaleResult | undefined;
  if (!result?.ok || !result.image) throw new Error(result?.error || "Risultato Gradio non valido.");
  return result;
}

export async function upscaleRemoteImageDirect(
  endpoint: string,
  input: Blob,
  model: string,
  signal?: AbortSignal
): Promise<Blob> {
  const normalized = normalizeRemoteUpscalerEndpoint(endpoint);
  const encoded = await blobDataUrl(input);
  const errors: string[] = [];
  for (const path of ["/gradio_api/call/upscale_image", "/call/upscale_image"]) {
    const aborted = abortError(signal); if (aborted) throw aborted;
    try {
      const submission = await fetch(`${normalized}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [encoded, model] }),
        ...(signal ? { signal } : {})
      });
      if (!submission.ok) throw new Error(await errorMessage(submission, `HTTP ${submission.status}`));
      const queued = await submission.json() as GradioQueuedEnvelope;
      if (!queued.event_id) throw new Error("Gradio non ha restituito event_id.");
      const stream = await fetch(`${normalized}${path}/${encodeURIComponent(queued.event_id)}`, signal ? { signal } : undefined);
      if (!stream.ok) throw new Error(await errorMessage(stream, `HTTP ${stream.status}`));
      return decodeDataUrl(parseGradioImageEventStream(await stream.text()).image ?? "");
    } catch (reason) {
      const aborted = abortError(signal); if (aborted) throw aborted;
      errors.push(reason instanceof Error ? reason.message : String(reason));
    }
  }
  throw new Error(`${normalized}: ${errors.at(-1) || "upscaling non riuscito"}`);
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
  let blob: Blob;
  try {
    const response = await fetch(`${remoteCoordinatorBaseUrl}/upscale/remote/image`, { method: "POST", body: form, ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error(await errorMessage(response, `Upscaling remoto fallito: HTTP ${response.status}.`));
    blob = await response.blob();
  } catch (reason) {
    const aborted = abortError(signal); if (aborted) throw aborted;
    const failures: string[] = [];
    blob = new Blob();
    for (const endpoint of endpoints) {
      try { blob = await upscaleRemoteImageDirect(endpoint, input, settings.remote.model, signal); break; }
      catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    if (!blob.size) throw new Error(`Upscaling remoto diretto fallito. ${failures.join(" | ") || (reason instanceof Error ? reason.message : String(reason))}`);
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const result = document.createElement("canvas"); result.width = settings.finalWidth; result.height = settings.finalHeight;
    const context = result.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas risultato remoto non disponibile.");
    context.drawImage(bitmap, 0, 0, result.width, result.height); onProgress({ phase: "ready", progress: 1 }); return result;
  } finally { bitmap.close(); }
}
