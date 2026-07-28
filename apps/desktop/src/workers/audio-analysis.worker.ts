import { analyzePcmStereo, type AnalysisParameters } from "@rbs/audio-analysis";

interface Request { leftSamples: ArrayBuffer; rightSamples?: ArrayBuffer; sampleRate: number; parameters: AnalysisParameters; }
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const left = new Float32Array(event.data.leftSamples); const right = event.data.rightSamples ? new Float32Array(event.data.rightSamples) : undefined;
    const result = analyzePcmStereo(left, right, event.data.sampleRate, event.data.parameters, (progress) => self.postMessage({ type: "progress", progress }));
    self.postMessage({ type: "result", result });
  } catch (error) { self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
};
