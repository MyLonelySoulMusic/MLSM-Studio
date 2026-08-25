import type { ImportedAudio } from "./audio-import";

const endpoint = "/__mlsm/song-player-vocals";
type RuntimeStatus = { status: "idle" | "installing" | "ready" | "failed"; progress: number; message: string; error: string | null; ready: boolean };
const abortError = () => new DOMException("Operazione annullata", "AbortError");
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const timer = globalThis.setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(abortError()); }, { once: true });
});

async function readJson(response: Response) {
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status !== 202) throw new Error(typeof value.error === "string" ? value.error : typeof value.message === "string" ? value.message : "Servizio vocale locale non raggiungibile.");
  return value;
}

export async function ensureBrowserVocalRuntime(signal?: AbortSignal, onProgress?: (progress: number, message: string) => void) {
  let status = await readJson(await fetch(`${endpoint}/ensure`, { method: "POST", ...(signal ? { signal } : {}) })) as unknown as RuntimeStatus;
  while (!status.ready) {
    if (status.status === "failed") throw new Error(status.error ?? status.message ?? "Installazione automatica Demucs non riuscita.");
    onProgress?.(Math.max(0, Math.min(.35, status.progress / 100 * .35)), status.message || "Preparazione automatica Demucs");
    await wait(600, signal);
    status = await readJson(await fetch(`${endpoint}/status`, signal ? { signal } : undefined)) as unknown as RuntimeStatus;
  }
  onProgress?.(.35, "Demucs htdemucs pronto");
}

export async function separateBrowserCassetteDeskVocals(audio: ImportedAudio, signal?: AbortSignal, onProgress?: (progress: number, message: string) => void) {
  await ensureBrowserVocalRuntime(signal, onProgress);
  if (signal?.aborted) throw abortError();
  onProgress?.(.4, "Caricamento locale del brano nel separatore vocale");
  const audioResponse = await fetch(audio.url, signal ? { signal } : undefined);
  if (!audioResponse.ok) throw new Error("Il brano selezionato non è più leggibile.");
  const blob = await audioResponse.blob();
  if (signal?.aborted) throw abortError();
  onProgress?.(.5, "Separazione reale della voce con Demucs htdemucs");
  const filename = encodeURIComponent(audio.metadata.fileName || "track.wav");
  const response = await fetch(`${endpoint}/separate?filename=${filename}`, { method: "POST", body: blob, ...(signal ? { signal } : {}), headers: { "Content-Type": blob.type || "application/octet-stream" } });
  return readJson(response);
}
