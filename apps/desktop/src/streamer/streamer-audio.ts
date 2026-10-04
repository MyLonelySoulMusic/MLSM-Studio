import { Channel, convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import tapUrl from "./pcm-tap.worklet?worker&url";
import type { AnalysisFrame, AnalysisSettings } from "./analysis-engine";
import { requestBrowserCapture, type CaptureInfo } from "./streamer-capture";

export interface CaptureSource { kind: "system" | "application" | "outputDevice"; id?: string; }
export interface CaptureCapabilities { platform: string; systemAudio: boolean; applicationCapture: boolean; outputDevices: { id: string; name: string }[]; applications: { id: string; name: string }[]; permission: string; reason?: string; }
export interface ImportedTrack { path: string; playbackPath?: string; title: string; artist?: string; album?: string; artwork?: string; duration: number; sampleRate: number; channels: number; format: string; codec: string; bitDepth?: number; bitrate?: number; }

export async function captureCapabilities(): Promise<CaptureCapabilities> {
  if (isTauri()) return invoke<CaptureCapabilities>("streamer_capabilities");
  return { platform: "browser", systemAudio: Boolean(navigator.mediaDevices?.getDisplayMedia), applicationCapture: false, outputDevices: [], applications: [], permission: "prompt" };
}
export async function importNativeTracks(paths?: string[]): Promise<ImportedTrack[]> { return invoke("streamer_import_audio", { paths: paths ?? null }); }

/** Owns one active analysis route. Stream capture is never connected to speakers. */
export class StreamerAudioRuntime {
  readonly audio = new Audio();
  frame: AnalysisFrame | null = null; receivedAt = 0;
  private worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
  private context: AudioContext | null = null; private tap: AudioWorkletNode | null = null; private output: GainNode | null = null; private silent: GainNode | null = null;
  private localSource: MediaElementAudioSourceNode | null = null; private captureNode: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null; private unlisten: UnlistenFn | null = null; private route: "local" | "capture" | "none" = "none"; private objectUrl: string | null = null;
  private generation = 0; private localLoadGeneration = 0; private disposed = false; private nativeCapture = false; private volume = .8;
  private preparation: Promise<void> | null = null;
  private captureInfo: CaptureInfo | null = null;
  private pcmListeners = new Set<(pcm: Float32Array, sampleRate: number) => void>();
  subscribePcm(listener: (pcm: Float32Array, sampleRate: number) => void) { this.pcmListeners.add(listener); return () => { this.pcmListeners.delete(listener); }; }
  onCaptureStatus: (state: string, message?: string) => void = () => undefined;
  onCaptureInfo: (info: CaptureInfo | null) => void = () => undefined;
  constructor() {
    this.audio.preload = "metadata";
    this.worker.onmessage = (event: MessageEvent<AnalysisFrame>) => { if (this.disposed) return; this.frame = event.data; this.receivedAt = performance.now(); };
    this.worker.onerror = () => this.onCaptureStatus("error", "Audio analysis worker failed");
  }
  private push(pcm: Float32Array, sampleRate: number) {
    if (this.disposed) return;
    for (const listener of this.pcmListeners) {
      try { listener(pcm, sampleRate); }
      catch (error) { this.pcmListeners.delete(listener); console.warn("[Streamer] PCM subscriber stopped", error); }
    }
    this.worker.postMessage({ type: "pcm", pcm, sampleRate }, [pcm.buffer]);
  }
  private prepare(): Promise<void> {
    if (!this.preparation) this.preparation = this.prepareOnce().finally(() => { this.preparation = null; });
    return this.preparation;
  }
  private async prepareOnce() {
    if (this.disposed) return;
    if (this.context) { await this.context.resume(); return; }
    const context = new AudioContext({ latencyHint: "playback" }); this.context = context;
    try {
      await context.audioWorklet.addModule(tapUrl);
      if (this.disposed) { await context.close(); return; }
      // Preserve the source's actual channel count, including a physically
      // mono track. An explicit mono input or a speaker downmix loses L/R.
      this.tap = new AudioWorkletNode(context, "mlsm-stereo-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "max", channelInterpretation: "discrete" });
      this.output = context.createGain(); this.output.gain.value = this.volume; this.output.connect(context.destination);
      this.silent = context.createGain(); this.silent.gain.value = 0; this.silent.connect(context.destination);
      this.tap.port.onmessage = (event: MessageEvent<{ pcm: Float32Array; sampleRate: number; channels: number }>) => {
        if (this.route === "capture" && this.captureInfo && this.captureInfo.receivedChannels !== event.data.channels) {
          this.captureInfo = { ...this.captureInfo, receivedChannels: event.data.channels, sampleRate: event.data.sampleRate };
          this.onCaptureInfo(this.captureInfo);
          console.info("[Streamer capture] PCM input", this.captureInfo);
        }
        if (this.route === "capture" || (this.route === "local" && !this.audio.paused)) this.push(event.data.pcm, event.data.sampleRate);
      };
      this.localSource = context.createMediaElementSource(this.audio); await context.resume();
    }
    catch (error) { this.context = null; await context.close().catch(() => undefined); throw error; }
  }
  configure(settings: AnalysisSettings) { this.worker.postMessage({ type: "settings", settings }); }
  reset() { this.worker.postMessage({ type: "reset" }); this.frame = null; this.receivedAt = 0; }
  setVolume(value: number) { this.volume = value; if (this.output && this.context) this.output.gain.setTargetAtTime(value, this.context.currentTime, .025); }
  private disconnectRoute() { this.localSource?.disconnect(); this.captureNode?.disconnect(); this.captureNode = null; this.tap?.disconnect(); }
  private connectStereoSource(source: AudioNode, destination: AudioNode) {
    if (!this.tap) return;
    this.tap.port.postMessage({ enabled: true });
    source.connect(this.tap);
    this.tap.connect(destination);
  }
  async loadLocal(input: { file?: Blob; nativePath?: string; channels?: number }) {
    const generation = ++this.localLoadGeneration;
    await this.stopCapture();
    if (this.disposed || generation !== this.localLoadGeneration) return;
    this.audio.pause(); this.disconnectRoute(); this.route = "local";
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = null;
    if (input.file) { this.objectUrl = URL.createObjectURL(input.file); this.audio.src = this.objectUrl; }
    else if (input.nativePath) this.audio.src = convertFileSrc(input.nativePath);
    else throw new Error("Audio file is no longer available");
    this.audio.load();
  }
  async playLocal() { await this.prepare(); if (this.disposed || !this.localSource || !this.tap || !this.output) return; this.disconnectRoute(); this.route = "local"; this.connectStereoSource(this.localSource, this.output); await this.audio.play(); }
  pause() { this.audio.pause(); }
  stopLocal() { this.audio.pause(); if (Number.isFinite(this.audio.duration)) this.audio.currentTime = 0; }
  seek(value: number) { if (Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(value, this.audio.duration)); }
  async startCapture(source: CaptureSource | { kind: "input"; id?: string }) {
    ++this.localLoadGeneration;
    await this.stopCapture(); const generation = ++this.generation; this.audio.pause(); this.disconnectRoute(); this.route = "capture"; this.reset(); this.onCaptureStatus("starting");
    try {
      if (source.kind !== "input" && isTauri()) {
        this.unlisten = await listen<{ state: string; message?: string }>("streamer-capture-status", event => { if (generation === this.generation) this.onCaptureStatus(event.payload.state, event.payload.message); });
        const onPcm = new Channel<ArrayBuffer | number[]>();
        onPcm.onmessage = packet => { if (generation !== this.generation || this.disposed) return; const buffer = packet instanceof ArrayBuffer ? packet : Uint8Array.from(packet).buffer; if (buffer.byteLength < 8) return; const header = new DataView(buffer); const rate = header.getFloat32(0, true), frames = header.getUint32(4, true); if (frames * 8 + 8 !== buffer.byteLength) return; this.push(new Float32Array(buffer.slice(8)), rate); };
        this.nativeCapture = true;
        await invoke("streamer_start_capture", { source, onPcm });
        if (generation !== this.generation || this.disposed) { await invoke("streamer_stop_capture"); return; }
      } else {
        const { stream, info } = await requestBrowserCapture(source);
        if (generation !== this.generation || this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!stream.getAudioTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error("No audio was shared by this browser / Nessun audio condiviso dal browser"); }
        this.stream = stream; this.captureInfo = info; this.onCaptureInfo(info); await this.prepare();
        if (generation !== this.generation || !this.context || !this.tap || !this.silent) { stream.getTracks().forEach(track => track.stop()); return; }
        this.captureNode = this.context.createMediaStreamSource(stream);
        this.connectStereoSource(this.captureNode, this.silent);
        for (const track of stream.getTracks()) track.onended = () => { if (generation === this.generation) { void this.stopCapture(); this.onCaptureStatus("error", "Capture source disconnected / Sorgente di acquisizione disconnessa"); } };
      }
      this.onCaptureStatus("active");
    } catch (error) { if (generation === this.generation) { await this.stopCapture(); this.onCaptureStatus("error", error instanceof Error ? error.message : String(error)); } throw error; }
  }
  async stopCapture() {
    ++this.generation; this.unlisten?.(); this.unlisten = null;
    this.captureInfo = null; this.onCaptureInfo(null);
    if (this.stream) { this.stream.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null; }
    this.captureNode?.disconnect(); this.captureNode = null;
    if (this.nativeCapture) { this.nativeCapture = false; await invoke("streamer_stop_capture").catch(error => this.onCaptureStatus("error", String(error))); }
    if (this.route === "capture") { this.route = "none"; this.tap?.disconnect(); this.onCaptureStatus("stopped"); }
  }
  async dispose() { this.disposed = true; this.pcmListeners.clear(); ++this.localLoadGeneration; this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); await this.stopCapture(); this.disconnectRoute(); this.worker.terminate(); await this.preparation?.catch(() => undefined); await this.context?.close().catch(() => undefined); if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); }
}
