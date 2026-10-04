import { invoke, isTauri } from "@tauri-apps/api/core";

export interface LivePhrase { id: number; text: string; start: number; end: number }
export interface LiveTranscriptState { phase: "idle" | "loading" | "listening" | "transcribing" | "paused" | "error" | "off"; model: string; detail: string; phrases: LivePhrase[]; partial: string; stage: string; progress: number | null; backend: string; lag: number }
interface NativeResult { phrases?: { text: string; start: number; end: number }[]; partial?: { text: string }; processedUntil?: number; backend?: string; device?: string; initialSeconds?: number; model?: string; id?: string }
interface StartupProgress { stage?: string; percent?: number | null }
export const emptyLiveTranscript = (): LiveTranscriptState => ({ phase: "idle", model: "", detail: "", phrases: [], partial: "", stage: "", progress: null, backend: "", lag: 0 });

/** Fractional resampling positions persist across PCM boundaries. Only ASR
 * receives mono: the stereo buffer used for playback/meters is never changed. */
export class LiveMonoResampler {
  private tail = new Float32Array(0); private cursor = 0; private rate = 0;
  push(pcm: Float32Array, rate: number): Float32Array {
    if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) return new Float32Array(0);
    if (this.rate !== rate) { this.tail = new Float32Array(0); this.cursor = 0; this.rate = rate; }
    const mono = new Float32Array(this.tail.length + Math.floor(pcm.length / 2)); mono.set(this.tail);
    for (let i = 0; i + 1 < pcm.length; i += 2) mono[this.tail.length + i / 2] = (pcm[i]! + pcm[i + 1]!) / 2;
    const step = rate / 16000, samples: number[] = [];
    while (this.cursor < mono.length - 1) { const index = Math.floor(this.cursor), fraction = this.cursor - index; samples.push(mono[index]! * (1 - fraction) + mono[index + 1]! * fraction); this.cursor += step; }
    const consumed = Math.min(Math.floor(this.cursor), mono.length);
    this.tail = mono.slice(consumed); this.cursor -= consumed;
    return Float32Array.from(samples);
  }
}
export function trimTranscriptOverlap(previous: string, next: string): string {
  const before = previous.trim().split(/\s+/), after = next.trim().split(/\s+/);
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (let count = Math.min(before.length, after.length, 16); count > 0; count--) if (before.slice(-count).every((word, index) => normalize(word) === normalize(after[index]!))) return after.slice(count).join(" ");
  return next.trim();
}

const route = "/__mlsm/streamer-whisper";
async function read(response: Response): Promise<NativeResult> {
  const value = await response.json().catch(() => ({})) as NativeResult & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Whisper HTTP ${response.status}`);
  return value;
}
export interface LiveWhisperTransport { start(signal: AbortSignal, progress?: (value: StartupProgress) => void): Promise<NativeResult>; transcribe(id: string, pcm: Float32Array, language: string, signal: AbortSignal, final?: boolean): Promise<NativeResult>; stop(id: string): Promise<unknown> }
export const localWhisperTransport: LiveWhisperTransport = {
  start: async (signal, onProgress) => {
    const id = crypto.randomUUID();
    if (!isTauri()) {
      const timer = setInterval(() => { void fetch(`${route}/${id}/progress`, { signal }).then(response => response.ok ? response.json() : null).then(value => { if (value) onProgress?.(value as StartupProgress); }).catch(() => undefined); }, 500);
      try { return await fetch(`${route}/start?id=${id}`, { method: "POST", signal }).then(read); }
      finally { clearInterval(timer); }
    }
    const { Channel } = await import("@tauri-apps/api/core");
    if (signal.aborted) throw new DOMException("Whisper startup cancelled", "AbortError");
    const onStartup = new Channel<StartupProgress>(); onStartup.onmessage = value => onProgress?.(value);
    signal.addEventListener("abort", () => { void invoke("streamer_whisper_stop", { id }).catch(() => undefined); }, { once: true });
    return invoke("streamer_whisper_start", { id, onStartup });
  },
  transcribe: (id, pcm, language, signal, final = false) => {
    if (isTauri()) {
      const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength); let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return invoke("streamer_whisper_chunk", { id, pcm: btoa(binary), language, finalBlock: final });
    }
    return fetch(`${route}/${encodeURIComponent(id)}?language=${language}&final=${final ? "1" : "0"}`, { method: "POST", body: new Blob([pcm.slice().buffer]), signal, headers: { "Content-Type": "application/octet-stream" } }).then(read);
  },
  stop: id => isTauri() ? invoke("streamer_whisper_stop", { id }) : fetch(`${route}/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }),
};

/** Lossless PCM queue + upstream LocalAgreement, never replace pending audio. */
export class LiveTranscriptSession {
  state = emptyLiveTranscript();
  private resampler = new LiveMonoResampler(); private queue: Float32Array[] = []; private queuedSamples = 0; private finalPending = false;
  private samples = 0; private sequence = 0; private active = true; private closed = false; private busy = false; private id: string | null = null;
  private controller = new AbortController();
  private failed = false;
  private initialSamples = 16000;
  constructor(private changed: (state: LiveTranscriptState) => void, private language = "auto", private transport = localWhisperTransport) {}
  private publish(patch: Partial<LiveTranscriptState>) { if (!this.closed) { this.state = { ...this.state, ...patch }; this.changed(this.state); } }
  setActive(active: boolean) {
    if (this.failed || this.closed) return;
    if (this.active === active) return; this.active = active;
    if (!active) {
      this.finalPending = true; void this.drain(); if (this.state.phase !== "loading") this.publish({ phase: "paused" });
    } else { this.finalPending = false; this.publish({ phase: "listening" }); }
  }
  push(pcm: Float32Array, rate: number) {
    if (this.closed || this.failed || !this.active) return;
    const mono = this.resampler.push(pcm, rate); this.samples += mono.length;
    if (mono.length) { this.queue.push(mono); this.queuedSamples += mono.length; }
    if (this.queuedSamples > 16000 * 120) {
      this.failed = true;
      this.publish({ phase: "error", detail: "Whisper cannot keep up: 120 seconds of audio are waiting. Pause playback and retry; audio was not silently skipped." });
      this.controller.abort(); if (this.id) void this.transport.stop(this.id).catch(() => undefined); return;
    }
    void this.drain();
  }
  private takeAudio() {
    const count = Math.min(this.queuedSamples, 128000), pcm = new Float32Array(count); let offset = 0;
    while (offset < count) {
      const first = this.queue[0]!, consumed = Math.min(first.length, count - offset);
      pcm.set(first.subarray(0, consumed), offset); offset += consumed;
      if (consumed === first.length) this.queue.shift(); else this.queue[0] = first.subarray(consumed);
    }
    this.queuedSamples -= count; return pcm;
  }
  private async drain() {
    if (this.closed || this.failed || this.busy || (this.queuedSamples < 16000 && !this.finalPending) || (!this.queuedSamples && !this.id)) return; this.busy = true;
    try {
      if (!this.id) {
        this.publish({ phase: "loading", stage: "runtime" }); const ready = await this.transport.start(this.controller.signal, value => this.publish({ stage: value.stage ?? "model", progress: value.percent ?? null }));
        if (!ready.id) throw new Error("Invalid Whisper session");
        if (this.closed || this.failed) { await this.transport.stop(ready.id); return; }
        this.id = ready.id; this.publish({ model: ready.model ?? "Whisper", backend: ready.device ?? "", stage: "", progress: null });
        this.initialSamples = ready.initialSeconds === 2 ? 32000 : 16000;
      }
      while (!this.closed && !this.failed && (this.queuedSamples >= this.initialSamples || this.finalPending)) {
        const pcm = this.takeAudio(), final = this.finalPending && !this.queuedSamples;
        this.initialSamples = 16000;
        if (final) this.finalPending = false;
        this.publish({ phase: this.active ? "transcribing" : "paused" });
        const result = await this.transport.transcribe(this.id, pcm, this.language, this.controller.signal, final);
        if (this.closed || this.failed) return;
        const phrases = [...this.state.phrases];
        for (const phrase of result.phrases ?? []) {
          if (!Number.isFinite(phrase.start) || !Number.isFinite(phrase.end) || !phrase.text?.trim()) continue;
          const start = Math.max(0, phrase.start), end = phrase.end, previous = phrases.at(-1);
          if (end < start || (previous && previous.text === phrase.text.trim() && Math.abs(previous.start - start) < .05 && Math.abs(previous.end - end) < .05)) continue;
          const text = phrase.text.trim();
          if (text) phrases.push({ id: ++this.sequence, text, start, end });
        }
        this.publish({ phrases: phrases.slice(-30), partial: result.partial?.text ?? "", backend: result.backend ?? this.state.backend, phase: this.active ? "listening" : "paused", lag: Math.max(0, this.samples / 16000 - (result.processedUntil ?? (this.samples - this.queuedSamples) / 16000)) });
      }
    } catch (error) { if (!this.closed && !this.failed) { this.failed = true; this.publish({ phase: "error", detail: error instanceof Error ? error.message : String(error) }); if (this.id) void this.transport.stop(this.id).catch(() => undefined); this.id = null; } }
    finally { this.busy = false; }
  }
  dispose() { if (this.closed) return; this.closed = true; this.controller.abort(); this.queue = []; this.queuedSamples = 0; if (this.id) void this.transport.stop(this.id).catch(() => undefined); }
}
