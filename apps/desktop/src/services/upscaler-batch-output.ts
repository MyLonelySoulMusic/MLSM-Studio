import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type UpscalerBatchOutputKind = "tauri" | "file-system-access" | "download";

export interface UpscalerBatchOutputSink {
  kind: UpscalerBatchOutputKind;
  label: string;
  warning?: string;
  write: (blob: Blob, fileName: string) => Promise<void>;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function fallbackSink(): UpscalerBatchOutputSink {
  return { kind: "download", label: "Download singoli file", warning: "Il browser non consente di scegliere una cartella: ogni immagine verrà scaricata separatamente.", write: async (blob, fileName) => download(blob, fileName) };
}

async function uniqueFileName(directory: FileSystemDirectoryHandle, requested: string): Promise<string> {
  const extension = requested.toLowerCase().endsWith(".png") ? ".png" : ".png";
  const stem = requested.replace(/\.png$/i, "") || "image-upscaled";
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 0 ? `${stem}${extension}` : `${stem}-${suffix}${extension}`;
    try { await directory.getFileHandle(candidate); } catch { return candidate; }
  }
  throw new Error("Impossibile trovare un nome libero nella cartella di destinazione.");
}

export async function chooseUpscalerBatchOutputSink(): Promise<UpscalerBatchOutputSink | null> {
  if (isTauri()) {
    const selected = await open({ multiple: false, directory: true, title: "Scegli la cartella per l’upscaling batch" });
    if (typeof selected !== "string") return null;
    return {
      kind: "tauri", label: selected,
      write: async (blob, fileName) => {
        const payload = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await invoke("write_upscaler_batch_image", { directoryPath: selected, filename: fileName, payload });
      }
    };
  }
  if (typeof window.showDirectoryPicker === "function") {
    try {
      const directory = await window.showDirectoryPicker({ mode: "readwrite" });
      return {
        kind: "file-system-access", label: "Cartella selezionata",
        write: async (blob, fileName) => {
          const safeName = await uniqueFileName(directory, fileName);
          const handle = await directory.getFileHandle(safeName, { create: true }); const writable = await handle.createWritable();
          try { await writable.write(blob); await writable.close(); } catch (error) { await writable.abort?.(); throw error; }
        }
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
  }
  return fallbackSink();
}

export const chooseBatchOutputSink = chooseUpscalerBatchOutputSink;
