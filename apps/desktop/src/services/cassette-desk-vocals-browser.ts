import type { ImportedAudio } from "./audio-import";

const endpoint = "/__mlsm/song-player-vocals";
type RuntimeStatus = { status: "idle" | "installing" | "ready" | "failed"; progress: number; message: string; error: string | null; ready: boolean };
const abortError = () => new DOMException("Operazione annullata", "AbortError");
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const timer = globalThis.setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(abortError()); }, { once: true });
});

export async function fetchBrowserVocalService(path: string, init: RequestInit = {}, label = "servizio vocale locale"): Promise<Response> {
  const url = `${endpoint}${path}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await fetch(url, init); }
    catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
      if (attempt < 2) { await wait(180 * (attempt + 1), init.signal ?? undefined); continue; }
      throw new Error(`Connessione al ${label} non riuscita. MLSM ha provato 3 volte su ${url}; il servizio locale integrato non ha risposto.`, { cause: reason });
    }
  }
  throw new Error(`Connessione al ${label} non riuscita.`);
}

async function readJson(response: Response) {
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status !== 202) throw new Error(typeof value.error === "string" ? value.error : typeof value.message === "string" ? value.message : "Servizio vocale locale non raggiungibile.");
  return value;
}

export async function ensureBrowserVocalRuntime(signal?: AbortSignal, onProgress?: (progress: number, message: string) => void) {
  let status = await readJson(await fetchBrowserVocalService("/ensure", { method: "POST", ...(signal ? { signal } : {}) }, "runtime Demucs")) as unknown as RuntimeStatus;
  while (!status.ready) {
    if (status.status === "failed") throw new Error(status.error ?? status.message ?? "Installazione automatica Demucs non riuscita.");
    onProgress?.(Math.max(0, Math.min(.35, status.progress / 100 * .35)), status.message || "Preparazione automatica Demucs");
    await wait(600, signal);
    status = await readJson(await fetchBrowserVocalService("/status", signal ? { signal } : {}, "runtime Demucs")) as unknown as RuntimeStatus;
  }
  onProgress?.(.35, "Demucs htdemucs pronto");
}

export async function separateBrowserCassetteDeskVocals(audio: ImportedAudio, signal?: AbortSignal, onProgress?: (progress: number, message: string) => void, window?: { startSeconds: number; endSeconds: number }) {
  await ensureBrowserVocalRuntime(signal, onProgress);
  if (signal?.aborted) throw abortError();
  onProgress?.(.4, "Caricamento locale del brano nel separatore vocale");
  const audioResponse = await fetch(audio.url, signal ? { signal } : undefined).catch((reason: unknown) => { throw new Error("Il file audio selezionato non è più leggibile dalla sessione corrente.", { cause: reason }); });
  if (!audioResponse.ok) throw new Error("Il brano selezionato non è più leggibile.");
  const blob = await audioResponse.blob();
  if (signal?.aborted) throw abortError();
  onProgress?.(.5, "Separazione reale della voce con Demucs htdemucs");
  const parameters = new URLSearchParams({ filename: audio.metadata.fileName || "track.wav" });
  if (window) { parameters.set("startSeconds", window.startSeconds.toFixed(6)); parameters.set("endSeconds", window.endSeconds.toFixed(6)); }
  const response = await fetchBrowserVocalService(`/separate?${parameters.toString()}`, { method: "POST", body: blob, ...(signal ? { signal } : {}), headers: { "Content-Type": blob.type || "application/octet-stream" } }, "separatore vocale Demucs");
  return readJson(response);
}

export async function releaseBrowserVocalStem(path: string | undefined): Promise<void> {
  if (!path || !path.startsWith(`${endpoint}/stem/`)) return;
  await fetchBrowserVocalService(path.slice(endpoint.length), { method: "DELETE" }, "servizio di pulizia stem").then(() => undefined).catch(() => undefined);
}
