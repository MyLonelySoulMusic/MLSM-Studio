import { analysisCacheKey, defaultAnalysisParameters, type AnalysisParameters, type AnalysisProgress, type AudioAnalysisResult } from "@rbs/audio-analysis";
import { AnalysisCache } from "./analysis-cache";

export class WebAudioAnalyzer {
  constructor(private readonly cache = new AnalysisCache()) {}
  async analyze(url: string, hash: string, parameters: AnalysisParameters = defaultAnalysisParameters, onProgress?: (progress: AnalysisProgress) => void, signal?: AbortSignal): Promise<{ result: AudioAnalysisResult; cached: boolean }> {
    if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
    const key = analysisCacheKey(hash, parameters); const cached = await this.cache.get(key); if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError"); if (cached) { onProgress?.({ stage: "complete", progress: 1 }); return { result: cached, cached: true }; }
    const response = await fetch(url, signal ? { signal } : undefined); if (!response.ok) throw new Error("Impossibile leggere l’audio per l’analisi"); const bytes = await response.arrayBuffer(); if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError"); const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(bytes); if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError"); const left = new Float32Array(buffer.getChannelData(0)); const right = buffer.numberOfChannels > 1 ? new Float32Array(buffer.getChannelData(1)) : undefined;
      const result = await this.runWorker(left, right, buffer.sampleRate, parameters, onProgress, signal); if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError"); await this.cache.set(key, result); if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError"); return { result, cached: false };
    } finally { await context.close(); }
  }
  private runWorker(leftSamples: Float32Array, rightSamples: Float32Array | undefined, sampleRate: number, parameters: AnalysisParameters, onProgress?: (progress: AnalysisProgress) => void, signal?: AbortSignal): Promise<AudioAnalysisResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../workers/audio-analysis.worker.ts", import.meta.url), { type: "module" });
      const abort = () => { worker.terminate(); reject(new DOMException("Operazione annullata", "AbortError")); }; signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<{ type: "progress"; progress: AnalysisProgress } | { type: "result"; result: AudioAnalysisResult } | { type: "error"; message: string }>) => {
        if (event.data.type === "progress") onProgress?.(event.data.progress);
        else if (event.data.type === "result") { signal?.removeEventListener("abort", abort); worker.terminate(); resolve(event.data.result); }
        else { signal?.removeEventListener("abort", abort); worker.terminate(); reject(new Error(event.data.message)); }
      };
      worker.onerror = (event) => { signal?.removeEventListener("abort", abort); worker.terminate(); reject(new Error(event.message)); };
      if (signal?.aborted) { abort(); return; }
      const leftBuffer = leftSamples.buffer as ArrayBuffer; const rightBuffer = rightSamples?.buffer as ArrayBuffer | undefined;
      const transfer: ArrayBuffer[] = [leftBuffer]; if (rightBuffer) transfer.push(rightBuffer);
      worker.postMessage({ leftSamples: leftBuffer, ...(rightBuffer ? { rightSamples: rightBuffer } : {}), sampleRate, parameters }, transfer);
    });
  }
}
