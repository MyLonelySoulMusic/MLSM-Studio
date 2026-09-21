import type { RhythmBallProject } from "@rbs/project-schema";
import type { ModelLoadProgress } from "./upscaler-ai";
import { pythonUpscalerBaseUrl, pythonUpscalerHealth } from "./upscaler-python-client";
import { canvasImageSourceSize } from "./canvas-image-source";

type Settings = RhythmBallProject["animation"]["upscaler"];
const baseUrl = `${pythonUpscalerBaseUrl}/upscale/providers/mlx-dlss`;

export interface MlxDlssModel { id: string; name: string; kind: "neural-rendering" | "image-vsr" | "video-sr" | "unknown"; bytes: number; sha256: string }
export interface MlxDlssCapabilities {
  id: "mlx-dlss"; label: string; platform: string; architecture: string; macOSVersion: string;
  appleSilicon: boolean; metal: boolean; memoryBytes: number; supported: boolean; reason: string;
  metalError?: string;
  installStatus?: MlxDlssInstallStatus;
  installReady: boolean; missingInstallTools: string[]; automaticInstallTools: string[]; manualInstallTools: string[];
  packageManager: "homebrew" | null; minimumMacOS: string; installed: boolean;
  usable: boolean; healthError: string; runtimeRoot: string; logPath: string; version: string; models: MlxDlssModel[];
  profiles: string[]; codecs: string[]; containers: string[]; limitations: string[];
}
export interface MlxDlssInstallStatus { phase: "idle" | "preparing" | "dependencies" | "cloning" | "venv" | "building" | "verifying" | "ready" | "error"; progress: number; message: string; error?: string; revision?: string; detail?: string }

async function responseError(response: Response, fallback: string): Promise<Error> {
  try { const payload = await response.json() as { detail?: string }; return new Error(payload.detail || fallback); }
  catch { return new Error(fallback); }
}

async function ensureService(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  // Starting the Python process does not mean its HTTP server is listening yet.
  // Share the Upscaler readiness check while Torch and the other imports load.
  const health = await pythonUpscalerHealth();
  signal?.throwIfAborted();
  if (!health?.ok) throw new Error("Il servizio locale Upscaler non risponde. Premi Riprova per riavviare la verifica.");
}

export async function getMlxDlssCapabilities(signal?: AbortSignal): Promise<MlxDlssCapabilities> {
  await ensureService(signal);
  let response: Response;
  try {
    response = await fetch(baseUrl, signal ? { signal } : undefined);
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error("Connessione al servizio locale Upscaler interrotta. Premi Riprova per riconnetterti.", { cause: error });
  }
  if (response.status === 404) throw new Error("Il servizio Upscaler in esecuzione non include MLX-DLSS. Esci dall’area e rientra per caricare il backend aggiornato.");
  if (!response.ok) throw await responseError(response, "Impossibile verificare MLX-DLSS.");
  return response.json() as Promise<MlxDlssCapabilities>;
}

export async function installMlxDlss(signal?: AbortSignal, onProgress?: (status: MlxDlssInstallStatus) => void): Promise<MlxDlssCapabilities> {
  await ensureService(signal);
  const started = await fetch(`${baseUrl}/install`, { method: "POST", signal: requestSignal(signal, 60000) });
  if (!started.ok) throw await responseError(started, "Avvio installazione MLX-DLSS fallito.");
  onProgress?.(await started.json() as MlxDlssInstallStatus);
  return waitForMlxDlssInstall(signal, onProgress);
}

function requestSignal(signal: AbortSignal | undefined, timeout: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export async function waitForMlxDlssInstall(signal?: AbortSignal, onProgress?: (status: MlxDlssInstallStatus) => void): Promise<MlxDlssCapabilities> {
  while (true) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/install`, { signal: requestSignal(signal, 15000) });
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error("Il servizio non risponde durante l’installazione. Riapri la configurazione per verificare l’esito; il log è conservato.", { cause: error });
    }
    if (!response.ok) throw await responseError(response, "Lettura installazione MLX-DLSS fallita.");
    const status = await response.json() as MlxDlssInstallStatus;
    onProgress?.(status);
    if (status.phase === "error") throw new Error(status.error || status.message);
    if (status.phase === "idle") throw new Error("L’installazione è stata interrotta dal riavvio del servizio. Riprova dalla configurazione.");
    if (status.phase === "ready") {
      const capabilities = await getMlxDlssCapabilities(signal);
      if (!capabilities.usable) throw new Error(capabilities.healthError || "Installazione terminata, ma il motore non supera la verifica finale.");
      return capabilities;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
}

export async function uninstallMlxDlss(signal?: AbortSignal): Promise<void> {
  await ensureService(signal);
  const response = await fetch(baseUrl, { method: "DELETE", ...(signal ? { signal } : {}) });
  if (!response.ok) throw await responseError(response, "Disinstallazione MLX-DLSS fallita.");
}

export async function importMlxDlssModel(file: File, kind: Exclude<MlxDlssModel["kind"], "unknown">, signal?: AbortSignal): Promise<MlxDlssCapabilities> {
  await ensureService(signal);
  const form = new FormData(); form.set("file", file); form.set("kind", kind);
  const response = await fetch(`${baseUrl}/models`, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  if (!response.ok) throw await responseError(response, "Importazione modello MLX-DLSS fallita.");
  return getMlxDlssCapabilities(signal);
}

export async function extractMlxDlssNeuralModel(file: File, signal?: AbortSignal): Promise<MlxDlssCapabilities> {
  await ensureService(signal);
  const form = new FormData(); form.set("file", file);
  const response = await fetch(`${baseUrl}/models/extract-neural`, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  if (!response.ok) throw await responseError(response, "Estrazione del modello dalla DLL NVIDIA fallita.");
  return getMlxDlssCapabilities(signal);
}

export async function removeMlxDlssModel(modelId: string, signal?: AbortSignal): Promise<MlxDlssCapabilities> {
  await ensureService(signal);
  const response = await fetch(`${baseUrl}/models/${encodeURIComponent(modelId)}`, { method: "DELETE", ...(signal ? { signal } : {}) });
  if (!response.ok) throw await responseError(response, "Rimozione modello MLX-DLSS fallita.");
  return getMlxDlssCapabilities(signal);
}

export function mlxDlssProviderOptions(settings: Settings): Record<string, unknown> {
  return { ...settings.mlxDlss };
}

export async function generateMlxDlssImage(
  source: CanvasImageSource, settings: Settings, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  const config = settings.mlxDlss;
  if (!config.neuralModel) throw new Error("Importa e seleziona il modello Neural Rendering MLX-DLSS.");
  if (config.mode !== "enhance" && !config.imageSrModel) throw new Error("Importa e seleziona il modello RTX VSR 2× per l’immagine.");
  if (config.mode === "enhance" && (settings.finalWidth !== settings.sourceWidth || settings.finalHeight !== settings.sourceHeight)) throw new Error("Enhance Only deve mantenere la risoluzione originale.");
  if (config.mode === "native-2x" && (settings.finalWidth !== settings.sourceWidth * 2 || settings.finalHeight !== settings.sourceHeight * 2)) throw new Error("Upscale nativo 2× richiede esattamente il doppio della risoluzione originale.");
  if (config.mode === "custom" && (settings.finalWidth > settings.sourceWidth * 2 || settings.finalHeight > settings.sourceHeight * 2)) throw new Error("La risoluzione personalizzata non può superare l’output MLX-DLSS 2×.");
  await ensureService(signal);
  if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
  const size = canvasImageSourceSize(source); const input = document.createElement("canvas");
  input.width = size.width; input.height = size.height;
  const context = input.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas sorgente non disponibile.");
  context.drawImage(source, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob>((resolve, reject) => input.toBlob((value) => value ? resolve(value) : reject(new Error("Codifica sorgente fallita.")), "image/png"));
  const form = new FormData(); form.set("file", blob, "source.png"); form.set("options", JSON.stringify(mlxDlssProviderOptions(settings))); form.set("width", String(settings.finalWidth)); form.set("height", String(settings.finalHeight));
  onProgress({ phase: "inference", progress: 0 });
  const response = await fetch(`${baseUrl}/image`, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  if (!response.ok) throw await responseError(response, `Elaborazione MLX-DLSS fallita: HTTP ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob()); const result = document.createElement("canvas"); result.width = bitmap.width; result.height = bitmap.height;
  const output = result.getContext("2d", { alpha: false }); if (!output) throw new Error("Canvas risultato non disponibile.");
  output.drawImage(bitmap, 0, 0); bitmap.close(); onProgress({ phase: "ready", progress: 1 }); return result;
}
