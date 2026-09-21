import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export type UpscalerVideoSaveTarget =
  | { kind: "tauri"; path: string }
  | { kind: "file-system-access"; handle: FileSystemFileHandle }
  | { kind: "download" };

export interface UpscalerVideoSaveReceipt {
  bytes: number;
  destination: string;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Starts the picker immediately, while the click still owns transient browser
 * activation. The returned target can safely be committed after a long job.
 */
export async function chooseUpscalerVideoSaveTarget(fileName: string): Promise<UpscalerVideoSaveTarget | null> {
  const mov = fileName.toLowerCase().endsWith(".mov");
  const filter = mov ? { name: "Video QuickTime · ProRes", extensions: ["mov"] } : { name: "Video MP4 · H.264/HEVC", extensions: ["mp4"] };
  if (isTauri()) {
    const path = await save({
      defaultPath: fileName,
      filters: [filter]
    });
    return typeof path === "string" ? { kind: "tauri", path } : null;
  }
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: mov ? [{ description: "Video QuickTime · ProRes", accept: { "video/quicktime": [".mov"] } }] : [{ description: "Video MP4 · H.264/HEVC", accept: { "video/mp4": [".mp4"] } }]
      });
      return { kind: "file-system-access", handle };
    } catch (error) {
      if (isAbortError(error)) return null;
      return { kind: "download" };
    }
  }
  return { kind: "download" };
}

/**
 * Reserves a destination before a long-running job without creating an empty
 * browser file. Native save dialogs only select a path; browsers download the
 * verified artifact after completion and can use the explicit picker later.
 */
export async function prepareUpscalerVideoSaveTarget(fileName: string): Promise<UpscalerVideoSaveTarget | null> {
  if (!isTauri()) return { kind: "download" };
  return chooseUpscalerVideoSaveTarget(fileName);
}

export async function saveUpscalerVideoArtifact(
  target: UpscalerVideoSaveTarget,
  artifact: { blob: Blob; fileName: string; resultPath?: string }
): Promise<UpscalerVideoSaveReceipt> {
  if (artifact.blob.size <= 0) throw new Error("Il video completato è vuoto: salvataggio annullato.");
  if (target.kind === "tauri") {
    if (!artifact.resultPath) throw new Error("Il backend non ha restituito il percorso locale del video completato.");
    const bytes = await invoke<number>("copy_upscaler_video_result", { sourcePath: artifact.resultPath, destinationPath: target.path });
    if (bytes !== artifact.blob.size) throw new Error(`Verifica salvataggio fallita: copiati ${bytes}/${artifact.blob.size} byte.`);
    return { bytes, destination: target.path };
  }
  if (target.kind === "file-system-access") {
    const writable = await target.handle.createWritable();
    try {
      await writable.write(artifact.blob);
      await writable.close();
    } catch (error) {
      await writable.abort?.();
      throw error;
    }
    const saved = await target.handle.getFile();
    if (saved.size !== artifact.blob.size) throw new Error(`Verifica salvataggio fallita: scritti ${saved.size}/${artifact.blob.size} byte.`);
    return { bytes: saved.size, destination: saved.name };
  }
  const url = URL.createObjectURL(artifact.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); }
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { bytes: artifact.blob.size, destination: artifact.fileName };
}
