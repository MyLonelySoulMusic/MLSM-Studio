/**
 * Client del servizio locale di interpolazione. Il calcolo dei fotogrammi intermedi
 * richiede ffmpeg (filtro `minterpolate`) oppure un modello RIFE su GPU: nessuno dei
 * due esiste nel browser, quindi vive nello stesso servizio Python locale già usato
 * dall’Upscaler. Il servizio va avviato dall’utente e non parte mai da solo.
 */
export type VideoEditorInterpolationMethod = "blend" | "motion" | "rife";

export interface VideoEditorInterpolationHealth {
  available: boolean;
  ffmpeg: boolean;
  rife: boolean;
  device: string;
}

export interface VideoEditorInterpolationResult {
  blob: Blob;
  method: VideoEditorInterpolationMethod;
  sourceFps: number;
  targetFps: number;
  backend: string;
}

const port = 8765;
export const videoEditorInterpolationBaseUrl = `http://127.0.0.1:${port}`;
/** Guida mostrata quando il servizio non risponde: la stessa dell’Upscaler, per non moltiplicare i riti. */
export const videoEditorInterpolationCommand = "npm run upscaler:server";

const healthTimeoutMs = 2_500;

interface HealthPayload { interpolation?: { ffmpeg?: boolean; rife?: boolean; device?: string } }

export async function videoEditorInterpolationHealth(): Promise<VideoEditorInterpolationHealth | null> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), healthTimeoutMs);
    const response = await fetch(`${videoEditorInterpolationBaseUrl}/interpolation/health`, { signal: controller.signal }).finally(() => window.clearTimeout(timer));
    if (!response.ok) return null;
    const payload = await response.json() as HealthPayload;
    const info = payload.interpolation ?? {};
    return { available: Boolean(info.ffmpeg || info.rife), ffmpeg: Boolean(info.ffmpeg), rife: Boolean(info.rife), device: info.device ?? "cpu" };
  } catch {
    // Servizio assente: l’export continua al frame rate reso, senza interpolazione.
    return null;
  }
}

export function videoEditorInterpolationMethodLabel(method: VideoEditorInterpolationMethod): string {
  if (method === "blend") return "Fusione fotogrammi · veloce";
  if (method === "motion") return "Stima del movimento ffmpeg · consigliata";
  return "RIFE su GPU · qualità massima";
}

/**
 * Invia il file già codificato al servizio locale e restituisce la versione al frame
 * rate richiesto. Un errore qui non deve mai far perdere il montaggio: chi chiama
 * conserva il file di partenza e riporta il motivo del mancato aumento.
 */
export async function videoEditorInterpolate(options: {
  blob: Blob;
  fileName: string;
  sourceFps: number;
  targetFps: number;
  method: VideoEditorInterpolationMethod;
  signal: AbortSignal;
}): Promise<VideoEditorInterpolationResult> {
  if (options.targetFps <= options.sourceFps) throw new Error("Il frame rate di destinazione deve superare quello del montaggio.");
  const body = new FormData();
  body.append("file", options.blob, options.fileName);
  body.append("source_fps", String(options.sourceFps));
  body.append("target_fps", String(options.targetFps));
  body.append("method", options.method);
  const response = await fetch(`${videoEditorInterpolationBaseUrl}/interpolate`, { method: "POST", body, signal: options.signal });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Interpolazione non riuscita (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}.`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("Il servizio di interpolazione ha restituito un file vuoto.");
  return {
    blob,
    method: (response.headers.get("X-Interpolation-Method") as VideoEditorInterpolationMethod | null) ?? options.method,
    sourceFps: options.sourceFps,
    targetFps: Number(response.headers.get("X-Interpolation-Target-Fps") ?? options.targetFps),
    backend: response.headers.get("X-Interpolation-Backend") ?? "ffmpeg"
  };
}
