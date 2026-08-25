import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type LongCatVideoMode = "textToVideo" | "imageToVideo" | "videoContinuation";
export type LongCatVideoStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface LongCatVideoCapabilities {
  desktop: boolean;
  ready: boolean;
  platformSupported: boolean;
  runtimeReady: boolean;
  repositoryReady: boolean;
  checkpointReady: boolean;
  cudaReady: boolean;
  gpuName: string | null;
  revision: string;
  reason: string | null;
  setupCommand: string;
}

interface LongCatVideoBaseRequest {
  prompt: string;
  negativePrompt: string;
  outputDirectory: string;
  numFrames: number;
  numInferenceSteps: number;
  guidanceScale: number;
  seed: number;
  useDistill: boolean;
  enableCompile: boolean;
}

export type LongCatVideoStartRequest =
  | (LongCatVideoBaseRequest & { mode: "textToVideo"; width: number; height: number })
  | (LongCatVideoBaseRequest & { mode: "imageToVideo"; inputPath: string; resolution: "480p" | "720p" })
  | (LongCatVideoBaseRequest & { mode: "videoContinuation"; inputPath: string; resolution: "480p" | "720p"; numCondFrames: number });

export interface LongCatVideoResult {
  mode: LongCatVideoMode;
  path: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  durationSeconds: number;
  seed: number;
}

export interface LongCatVideoJob {
  jobId: string;
  mode: LongCatVideoMode;
  status: LongCatVideoStatus;
  progress: number;
  message: string | null;
  result: LongCatVideoResult | null;
  error: string | null;
}

const browserCapabilities: LongCatVideoCapabilities = {
  desktop: false,
  ready: false,
  platformSupported: false,
  runtimeReady: false,
  repositoryReady: false,
  checkpointReady: false,
  cudaReady: false,
  gpuName: null,
  revision: "6b3f4b8582a8bc3f20f795735f5383716c4ba794",
  reason: "Il servizio locale LongCat-Video non risponde oppure il runtime CUDA non è pronto.",
  setupCommand: "npm run longcat-video:setup"
};

export async function getLongCatVideoCapabilities(): Promise<LongCatVideoCapabilities> {
  if (!isTauri()) {
    try {
      const response = await fetch("http://127.0.0.1:8766/health", { headers: { "X-MLSM-LongCat": "1" }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return browserCapabilities;
      return { desktop: false, ...await response.json() as Omit<LongCatVideoCapabilities, "desktop"> };
    } catch { return browserCapabilities; }
  }
  return invoke<LongCatVideoCapabilities>("longcat_video_capabilities");
}

async function browserJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://127.0.0.1:8766${path}`, { ...init, headers: { "X-MLSM-LongCat": "1", ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.error || `Servizio LongCat-Video: HTTP ${response.status}`);
  return payload as T;
}

export async function startLongCatVideoJob(request: LongCatVideoStartRequest): Promise<LongCatVideoJob> {
  if (!isTauri()) return browserJson<LongCatVideoJob>("/jobs", { method: "POST", body: JSON.stringify(request) });
  return invoke<LongCatVideoJob>("longcat_video_start_job", { request });
}

export async function getLongCatVideoJob(jobId: string): Promise<LongCatVideoJob> {
  if (!isTauri()) return browserJson<LongCatVideoJob>(`/jobs/${encodeURIComponent(jobId)}`);
  return invoke<LongCatVideoJob>("longcat_video_get_job", { jobId });
}

export async function cancelLongCatVideoJob(jobId: string): Promise<LongCatVideoJob> {
  if (!isTauri()) return browserJson<LongCatVideoJob>(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  return invoke<LongCatVideoJob>("longcat_video_cancel_job", { jobId });
}

function chooseBrowserMedia(mode: Exclude<LongCatVideoMode, "textToVideo">): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input"); input.type = "file";
    input.accept = mode === "imageToVideo" ? "image/png,image/jpeg,image/webp" : "video/mp4,video/quicktime,video/webm,.mkv";
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) { resolve(null); return; }
      try {
        const response = await fetch(`http://127.0.0.1:8766/uploads?kind=${mode === "imageToVideo" ? "image" : "video"}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "X-MLSM-LongCat": "1", "Content-Type": "application/octet-stream" }, body: file });
        const payload = await response.json().catch(() => null) as { inputRef?: string; error?: string } | null;
        if (!response.ok || !payload?.inputRef) throw new Error(payload?.error || `Upload LongCat-Video fallito: HTTP ${response.status}`);
        resolve(payload.inputRef);
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

export async function chooseLongCatInput(mode: Exclude<LongCatVideoMode, "textToVideo">): Promise<string | null> {
  if (!isTauri()) return chooseBrowserMedia(mode);
  const selected = await open({
    multiple: false,
    title: mode === "imageToVideo" ? "Scegli l’immagine di partenza" : "Scegli il video da continuare",
    filters: mode === "imageToVideo"
      ? [{ name: "Immagini", extensions: ["png", "jpg", "jpeg", "webp"] }]
      : [{ name: "Video", extensions: ["mp4", "mov", "webm", "mkv"] }]
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseLongCatOutputDirectory(): Promise<string | null> {
  if (!isTauri()) return "mlsm-browser-download";
  const selected = await open({ multiple: false, directory: true, title: "Scegli dove salvare i video LongCat" });
  return typeof selected === "string" ? selected : null;
}

export function longCatVideoPreviewUrl(path: string): string {
  return isTauri() && !path.startsWith("http") ? convertFileSrc(path) : path;
}

export function isLongCatVideoTerminal(status: LongCatVideoStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
