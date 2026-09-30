import { StereoAnalysisEngine, defaultAnalysisSettings, type AnalysisSettings } from "./analysis-engine";
let engine: StereoAnalysisEngine | undefined;
let settings = defaultAnalysisSettings;
let pending = 0;
self.onmessage = (event: MessageEvent<{ type: string; settings?: AnalysisSettings; pcm?: Float32Array; sampleRate?: number }>) => {
  const message = event.data;
  if (message.type === "reset") { engine = undefined; pending = 0; return; }
  if (message.settings) { settings = message.settings; engine?.configure(settings); }
  if (!message.pcm || !message.sampleRate) return;
  if (!engine || engine.sampleRate !== message.sampleRate) { engine = new StereoAnalysisEngine(message.sampleRate, settings); pending = 0; }
  engine.push(message.pcm); pending += message.pcm.length / 2;
  if (pending < message.sampleRate / 30) return;
  pending = 0;
  const frame = engine.snapshot();
  self.postMessage(frame, { transfer: [frame.spectrumLeft.buffer, frame.spectrumRight.buffer, frame.waveLeft.buffer, frame.waveRight.buffer, frame.bands.buffer] });
};
