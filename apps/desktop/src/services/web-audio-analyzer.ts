import { analysisCacheKey, defaultAnalysisParameters, type AnalysisParameters, type AnalysisProgress, type AudioAnalysisResult } from "@rbs/audio-analysis";
import { AnalysisCache } from "./analysis-cache";

export class WebAudioAnalyzer {
  constructor(private readonly cache = new AnalysisCache()) {}
  async analyze(url: string, hash: string, parameters: AnalysisParameters = defaultAnalysisParameters, onProgress?: (progress: AnalysisProgress) => void): Promise<{ result: AudioAnalysisResult; cached: boolean }> {
    const key = analysisCacheKey(hash, parameters); const cached = await this.cache.get(key); if (cached) { onProgress?.({ stage: "complete", progress: 1 }); return { result: cached, cached: true }; }
    const response = await fetch(url); if (!response.ok) throw new Error("Impossibile leggere l’audio per l’analisi"); const bytes = await response.arrayBuffer(); const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(bytes); const left = new Float32Array(buffer.getChannelData(0)); const right = buffer.numberOfChannels > 1 ? new Float32Array(buffer.getChannelData(1)) : undefined;
      const result = await this.runWorker(left, right, buffer.sampleRate, parameters, onProgress); await this.cache.set(key, result); return { result, cached: false };
    } finally { await context.close(); }
  }
  private runWorker(leftSamples: Float32Array, rightSamples: Float32Array | undefined, sampleRate: number, parameters: AnalysisParameters, onProgress?: (progress: AnalysisProgress) => void): Promise<AudioAnalysisResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../workers/audio-analysis.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ type: "progress"; progress: AnalysisProgress } | { type: "result"; result: AudioAnalysisResult } | { type: "error"; message: string }>) => {
        if (event.data.type === "progress") onProgress?.(event.data.progress);
        else if (event.data.type === "result") { worker.terminate(); resolve(event.data.result); }
        else { worker.terminate(); reject(new Error(event.data.message)); }
      };
      worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
      const leftBuffer = leftSamples.buffer as ArrayBuffer; const rightBuffer = rightSamples?.buffer as ArrayBuffer | undefined;
      const transfer: ArrayBuffer[] = [leftBuffer]; if (rightBuffer) transfer.push(rightBuffer);
      worker.postMessage({ leftSamples: leftBuffer, ...(rightBuffer ? { rightSamples: rightBuffer } : {}), sampleRate, parameters }, transfer);
    });
  }
}
