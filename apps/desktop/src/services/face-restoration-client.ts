import { pythonUpscalerHealth, pythonUpscalerBaseUrl } from "./upscaler-python-client";

export interface FaceSettings {
  model: string;
  fidelity_weight: number;
  upscale: number;
  detection_model: string;
  has_aligned: boolean;
  only_center_face: boolean;
  draw_box: boolean;
  bg_upsampler: boolean;
  face_upsample: boolean;
  bg_tile: number;
  device: string;
  crf: number;
  save_video_fps: number;
}
export const codeFormerDefaults: FaceSettings = { model: "codeformer", fidelity_weight: .5, upscale: 2, detection_model: "retinaface_resnet50", has_aligned: false, only_center_face: false, draw_box: false, bg_upsampler: false, face_upsample: false, bg_tile: 400, device: "auto", crf: 18, save_video_fps: 0 };
export interface FaceJob { id: string; phase: string; message: string; currentFrame: number; totalFrames: number; faces: number; outputName: string; timings?: { decodeSeconds: number; inferenceSeconds: number; encodePipeSeconds: number; finalizeSeconds: number } }
export interface FaceModel { id: string; label: string; defaults: FaceSettings }
const base = `${pythonUpscalerBaseUrl}/face-restoration`;
export async function faceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) {
    if (response.status === 404 && path === "/models") throw new Error("Il servizio locale attivo non include Face restoration. Riavvia MLSM Studio per caricare il nuovo modulo.");
    const error = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(error?.detail || `Face restoration: HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
export async function faceModels() {
  if (!await pythonUpscalerHealth()) throw new Error("Servizio locale non disponibile. Avvia npm run upscaler:server.");
  return faceRequest<{ models: FaceModel[]; runtimeReady: boolean }>("/models");
}
export async function createFaceJob(file: File, settings: FaceSettings) {
  const catalog = await faceModels();
  if (!catalog.runtimeReady) throw new Error("Runtime CodeFormer non disponibile. Esegui npm run face-restoration:setup.");
  const body = new FormData(); body.append("file", file); body.append("settings", JSON.stringify(settings));
  return faceRequest<FaceJob>("/jobs", { method: "POST", body });
}
export function faceResultUrl(id: string) { return `${base}/jobs/${encodeURIComponent(id)}/result`; }
