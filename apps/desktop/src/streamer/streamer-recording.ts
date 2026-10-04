/** Explicit, local-only recording. Analysis/player tracks are never owned or stopped here. */
export type RecordingPhase = "arming" | "armed" | "recording" | "paused" | "saving" | "idle";
export interface RecordingInfo {
  phase: RecordingPhase; seconds: number; width?: number; height?: number; fps?: number;
  mimeType?: string; videoBitrate?: number; audioBitrate?: number; message?: string;
}
export interface SavedRecording {
  id: string; created: string; mimeType: string; width: number; height: number; fps: number;
  videoBitrate: number; audioBitrate: number; sampleRate: number; seconds: number;
  videoBytes: number; audioBytes: number; complete: boolean;
}
export interface PcmSource { subscribePcm(listener: (pcm: Float32Array, sampleRate: number) => void): () => void; }
export function recordingErrorMessage(message: string, language: string) {
  if (language !== "it") return message;
  const translations: Array<[string, string]> = [
    ["Screen recording is unavailable", "Questo runtime non permette la cattura video. Apri MLSM Studio in Chrome o Edge su Mac/Windows."],
    ["No audio received for 7 seconds", "Non arriva audio da 7 secondi. Abilita l’analisi audio di sistema e condividi l’audio della sorgente prima di registrare."],
    ["No source audio was received", "Non è arrivato audio dalla sorgente. Il video è stato conservato: abilita l’analisi audio e riprova."],
    ["Audio sample rate changed", "La frequenza audio è cambiata durante la registrazione. Usa una sola sorgente per ogni registrazione."],
    ["Recording disk cannot keep up", "Il disco non riesce a scrivere abbastanza velocemente. Registrazione interrotta per non esaurire la memoria."],
    ["QuotaExceeded", "Spazio locale insufficiente. Esporta le registrazioni già salvate e libera spazio prima di riprovare."],
    ["Video encoder failed", "L’encoder video ha avuto un errore. Prova con una finestra MLSM più piccola."],
    ["No supported recording codec", "Nessun codec di registrazione compatibile. Usa Chrome o Edge aggiornato."],
    ["Local recording storage is unavailable", "L’archivio locale delle registrazioni non è disponibile. Apri MLSM Studio in Chrome o Edge."],
    ["Audio recording cannot keep up", "La registrazione audio non riesce a seguire il tempo reale. Registrazione interrotta senza modificare la riproduzione."],
    ["Recording encoder did not finish", "L’encoder non ha finalizzato il video entro 15 secondi. Verifica le risorse disponibili."],
    ["WAV reached its 4 GB limit", "Il WAV ha raggiunto il limite di 4 GB. Avvia una nuova registrazione."],
  ];
  return translations.find(([source]) => message.includes(source))?.[1] ?? message;
}
const storageName = "mlsm-streamer-recordings-v1";
const maxPendingBytes = 32 * 1024 * 1024;
const maxWavBytes = 0xffffffff - 56;

export function recordingCodec(supported: (mime: string) => boolean) {
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4"].find(supported);
}
export function recordingBitrate(width: number, height: number, fps: number) {
  return Math.round(Math.min(100_000_000, Math.max(24_000_000, width * height * fps * .2)));
}
/** IEEE float WAV keeps the original two PCM channels, without volume adjustment or lossy encoding. */
export function floatWavHeader(sampleRate: number, bytes: number) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || bytes < 0 || bytes % 8 || bytes > maxWavBytes) throw new Error("Invalid stereo WAV size or sample rate.");
  const buffer = new ArrayBuffer(56), view = new DataView(buffer);
  const ascii = (offset: number, value: string) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 48 + bytes, true); ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 8, true);
  view.setUint16(32, 8, true); view.setUint16(34, 32, true); ascii(36, "fact"); view.setUint32(40, 4, true); view.setUint32(44, bytes / 8, true);
  ascii(48, "data"); view.setUint32(52, bytes, true); return buffer;
}
export function stereoBuffer(context: AudioContext, pcm: Float32Array, sampleRate: number) {
  if (!pcm.length || pcm.length % 2) throw new Error("Invalid stereo PCM block.");
  const buffer = context.createBuffer(2, pcm.length / 2, sampleRate);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  for (let i = 0; i < left.length; i++) { left[i] = pcm[i * 2]!; right[i] = pcm[i * 2 + 1]!; }
  return buffer;
}

async function rootDirectory() {
  if (!navigator.storage?.getDirectory) throw new Error("Local recording storage is unavailable. Open MLSM Studio in Chrome or Edge.");
  return (await navigator.storage.getDirectory()).getDirectoryHandle(storageName, { create: true });
}
async function writeMetadata(directory: FileSystemDirectoryHandle, metadata: SavedRecording) {
  const handle = await directory.getFileHandle("recording.json", { create: true }), writer = await handle.createWritable();
  try { await writer.write(JSON.stringify(metadata)); await writer.close(); } catch (error) { await writer.abort?.(); throw error; }
}
export async function listRecordings(): Promise<SavedRecording[]> {
  const directory = await rootDirectory(), result: SavedRecording[] = [];
  if (!directory.keys) return result;
  for await (const key of directory.keys()) {
    try {
      const folder = await directory.getDirectoryHandle(key), file = await (await folder.getFileHandle("recording.json")).getFile();
      const item = JSON.parse(await file.text()) as SavedRecording;
      if (item.videoBytes > 0) result.push(item);
    } catch { /* Ignore unfinished sessions, not complete videos. */ }
  }
  return result.sort((a, b) => b.created.localeCompare(a.created));
}
export async function deleteRecording(id: string) { await (await rootDirectory()).removeEntry(id, { recursive: true }); }
export async function recordingFile(item: SavedRecording, kind: "video" | "audio") {
  const folder = await (await rootDirectory()).getDirectoryHandle(item.id);
  return (await folder.getFileHandle(kind === "video" ? "video" : "audio.wav")).getFile();
}
export function recordingFileName(item: SavedRecording, kind: "video" | "audio") {
  return `MLSM-Recording-${item.created.replace(/[:.]/g, "-")}.${kind === "audio" ? "wav" : item.mimeType.startsWith("video/mp4") ? "mp4" : "webm"}`;
}
export async function downloadRecording(item: SavedRecording, kind: "video" | "audio") {
  // Invoke the picker before any await: browser activation belongs to this click.
  const name = recordingFileName(item, kind), mime = kind === "audio" ? "audio/wav" : item.mimeType.split(";")[0]!;
  const picker = window.showSaveFilePicker?.({ suggestedName: name, types: [{ description: kind === "audio" ? "Stereo WAV · Float32" : "MLSM video", accept: { [mime]: [`.${name.split(".").at(-1)}`] } }] });
  const handle = picker ? await picker : null, file = await recordingFile(item, kind);
  if (handle) {
    const writer = await handle.createWritable();
    try { await writer.write(file); await writer.close(); } catch (error) { await writer.abort?.(); throw error; }
  } else {
    const url = URL.createObjectURL(file), link = document.createElement("a"); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Serial disk writes with a hard backpressure limit, never an unbounded in-memory video. */
export class RecordingWriter {
  bytes = 0;
  private pending = 0;
  private tail = Promise.resolve();
  private error: unknown;
  private closing = false;
  constructor(readonly stream: FileSystemWritableFileStream, private failed: (error: unknown) => void) {}
  append(data: Blob | ArrayBuffer) {
    const size = data instanceof Blob ? data.size : data.byteLength;
    if (this.error || this.closing) return;
    if (this.pending + size > maxPendingBytes) { this.error = new Error("Recording disk cannot keep up. Recording stopped to avoid exhausting memory."); this.failed(this.error); return; }
    this.pending += size;
    this.tail = this.tail.then(async () => {
      try { if (!this.error) { await this.stream.write(data); this.bytes += size; } }
      finally { this.pending -= size; }
    }).catch(error => { if (!this.error) { this.error = error; this.failed(error); } });
  }
  async flush() { await this.tail; if (this.error) throw this.error; }
  async close(header?: ArrayBuffer | ((bytes: number) => ArrayBuffer)) {
    this.closing = true;
    await this.tail;
    // Commit successful chunks even if the last write failed. Never replace a previous recording.
    if (header) {
      const data = typeof header === "function" ? header(this.bytes) : header;
      await this.stream.seek(0); await this.stream.write(data); this.bytes = Math.max(this.bytes, data.byteLength);
    }
    await this.stream.close();
    if (this.error) throw this.error;
  }
}

export class StreamerRecording {
  private phase: RecordingPhase = "arming";
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private off: (() => void) | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextAudio = 0;
  private startedAt = 0;
  private elapsed = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private videoWriter: RecordingWriter | null = null;
  private audioWriter: RecordingWriter | null = null;
  private folder: FileSystemDirectoryHandle | null = null;
  private metadata: SavedRecording;
  private finishing: Promise<SavedRecording | null> | null = null;
  private fault: unknown;
  private seenPcmAt = 0;
  private onEnded: () => void;
  private constructor(private video: MediaStream, private update: (info: RecordingInfo) => void, private completed: (item: SavedRecording | null, error?: unknown) => void) {
    const track = video.getVideoTracks()[0]!, settings = track.getSettings();
    const mime = recordingCodec(value => MediaRecorder.isTypeSupported(value));
    if (!mime) throw new Error("No supported recording codec. Use a current Chrome or Edge browser.");
    const width = settings.width || 1920, height = settings.height || 1080, fps = settings.frameRate || 30;
    this.metadata = { id: crypto.randomUUID(), created: new Date().toISOString(), mimeType: mime, width, height, fps, videoBitrate: recordingBitrate(width, height, fps), audioBitrate: 512_000, sampleRate: 48000, seconds: 0, videoBytes: 0, audioBytes: 0, complete: false };
    this.onEnded = () => {
      if (this.phase === "arming") { this.fault = new Error("Video sharing stopped while preparing the recording."); return; }
      void this.finish();
    }; track.addEventListener("ended", this.onEnded);
    this.emit();
  }
  static async arm(update: (info: RecordingInfo) => void, completed: (item: SavedRecording | null, error?: unknown) => void) {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function" || typeof MediaRecorder === "undefined") throw new Error("Screen recording is unavailable in this app runtime. Open MLSM Studio in Chrome or Edge (Mac/Windows).");
    // Permission picker MUST start synchronously in the Record click, not after a disk/IPC call.
    const video = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
    try {
      if (!video.getVideoTracks().length) throw new Error("No video surface was selected.");
      const instance = new StreamerRecording(video, update, completed);
      try { await instance.prepare(); if (instance.fault) throw instance.fault; instance.phase = "armed"; instance.emit(); return instance; }
      catch (error) { instance.fault = error; await instance.finish(); throw error; }
    } catch (error) { video.getTracks().forEach(track => track.stop()); throw error; }
  }
  private emit(message?: string) {
    const seconds = this.elapsed + (this.phase === "recording" ? (performance.now() - this.startedAt) / 1000 : 0);
    this.update({ ...this.metadata, phase: this.phase, seconds, ...(message ? { message } : {}) });
  }
  private async prepare() {
      this.context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
      this.destination = this.context.createMediaStreamDestination();
      this.destination.channelCount = 2; this.destination.channelCountMode = "explicit"; this.destination.channelInterpretation = "discrete";
      this.folder = await (await rootDirectory()).getDirectoryHandle(this.metadata.id, { create: true });
      await writeMetadata(this.folder, this.metadata);
      const videoHandle = await this.folder.getFileHandle("video", { create: true }), audioHandle = await this.folder.getFileHandle("audio.wav", { create: true });
      const failed = (error: unknown) => { this.fault = error; void this.finish(); };
      this.videoWriter = new RecordingWriter(await videoHandle.createWritable(), failed);
      this.audioWriter = new RecordingWriter(await audioHandle.createWritable(), failed); this.audioWriter.append(floatWavHeader(48000, 0));
      await this.audioWriter.flush();
      const stream = new MediaStream([...this.video.getVideoTracks(), ...this.destination.stream.getAudioTracks()]);
      this.recorder = new MediaRecorder(stream, { mimeType: this.metadata.mimeType, videoBitsPerSecond: this.metadata.videoBitrate, audioBitsPerSecond: this.metadata.audioBitrate });
      this.metadata.mimeType = this.recorder.mimeType;
      this.metadata.videoBitrate = this.recorder.videoBitsPerSecond || this.metadata.videoBitrate;
      this.metadata.audioBitrate = this.recorder.audioBitsPerSecond || this.metadata.audioBitrate;
      this.recorder.ondataavailable = event => { if (event.data.size) this.videoWriter?.append(event.data); };
      this.recorder.onerror = () => failed(new Error("Video encoder failed. Try recording a smaller MLSM window."));
      this.recorder.onstop = () => { if (this.phase === "recording" || this.phase === "paused") void this.finish(); };
  }
  async start(runtime: PcmSource) {
    if (this.phase !== "armed" && this.phase !== "paused") return;
    const resume = this.phase === "paused";
    try {
      // Resume directly in Play's click; disk, codecs and tracks were prepared while arming.
      const ready = this.context!.resume();
      this.startedAt = performance.now(); this.seenPcmAt = this.startedAt; this.phase = "recording"; this.nextAudio = this.context!.currentTime + .035;
      if (!this.off) this.off = runtime.subscribePcm((pcm, rate) => this.receive(pcm, rate));
      if (resume) this.recorder!.resume(); else this.recorder!.start(1000);
      const failed = (error: unknown) => { this.fault = error; void this.finish(); };
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (this.phase === "recording" && performance.now() - this.seenPcmAt > 7000) failed(new Error("No audio received for 7 seconds. Enable system audio analysis before recording web players."));
        this.emit();
      }, 250);
      this.emit(); await ready;
      console.info("[Streamer recording]", { state: resume ? "resumed" : "started", width: this.metadata.width, height: this.metadata.height, fps: this.metadata.fps, mimeType: this.metadata.mimeType, videoBitrate: this.metadata.videoBitrate, audioBitrate: this.metadata.audioBitrate });
    } catch (error) { this.fault = error; await this.finish(); throw error; }
  }
  private receive(pcm: Float32Array, rate: number) {
    if (this.phase !== "recording" || !this.context || !this.destination || !this.audioWriter) return;
    try {
      this.seenPcmAt = performance.now();
      if (this.audioWriter.bytes <= 56 && this.metadata.audioBytes === 0) this.metadata.sampleRate = rate;
      if (rate !== this.metadata.sampleRate) throw new Error("Audio sample rate changed during recording. Recording stopped; choose one source for each take.");
      if (this.metadata.audioBytes + pcm.byteLength > maxWavBytes) throw new Error("WAV reached its 4 GB limit. Stop and start a new recording.");
      // Original buffers are transferred to analysis immediately after this callback.
      const copy = new ArrayBuffer(pcm.byteLength), view = new DataView(copy);
      for (let i = 0; i < pcm.length; i++) view.setFloat32(i * 4, pcm[i]!, true);
      this.audioWriter.append(copy); this.metadata.audioBytes += copy.byteLength;
      const buffer = stereoBuffer(this.context, pcm, rate), node = this.context.createBufferSource(); node.buffer = buffer; node.connect(this.destination);
      this.nextAudio = Math.max(this.nextAudio, this.context.currentTime + .008);
      if (this.nextAudio - this.context.currentTime > .75) throw new Error("Audio recording cannot keep up in real time. Recording stopped without changing playback.");
      this.sources.add(node); node.onended = () => { node.disconnect(); this.sources.delete(node); };
      node.start(this.nextAudio); this.nextAudio += buffer.duration;
    } catch (error) { this.fault = error; void this.finish(); }
  }
  pause() {
    if (this.phase !== "recording") return;
    this.elapsed += (performance.now() - this.startedAt) / 1000; this.phase = "paused";
    this.recorder?.pause(); this.stopAudioNodes(); this.emit();
  }
  private stopAudioNodes() { for (const node of this.sources) { node.onended = null; try { node.stop(); } catch { /* Already ended. */ } node.disconnect(); } this.sources.clear(); }
  finish(): Promise<SavedRecording | null> {
    if (this.finishing) return this.finishing;
    this.finishing = this.finishOnce(); return this.finishing;
  }
  private async finishOnce() {
    if (this.phase === "recording") this.elapsed += (performance.now() - this.startedAt) / 1000;
    this.phase = "saving"; clearInterval(this.timer); this.off?.(); this.off = null; this.emit();
    let result: SavedRecording | null = null;
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        // Drain the final already-received audio packets before asking for the last video chunk.
        const tailMs = Math.min(750, Math.max(0, (this.nextAudio - (this.context?.currentTime ?? 0)) * 1000));
        if (tailMs && this.recorder.state === "recording") await new Promise(resolve => setTimeout(resolve, tailMs));
        if ((this.recorder.state as RecordingState) !== "inactive") await new Promise<void>((resolve, reject) => {
          const watchdog = setTimeout(() => reject(new Error("Recording encoder did not finish within 15 seconds.")), 15_000);
          this.recorder!.onstop = () => { clearTimeout(watchdog); resolve(); };
          try { this.recorder!.stop(); } catch (error) { clearTimeout(watchdog); reject(error); }
        });
      }
    } catch (error) { this.fault ??= error; }
    try {
      const closed = await Promise.allSettled([this.videoWriter?.close(), this.audioWriter?.close(bytes => floatWavHeader(this.metadata.sampleRate, Math.max(0, bytes - 56)))]);
      for (const entry of closed) if (entry.status === "rejected") this.fault ??= entry.reason;
      if (this.folder && this.videoWriter?.bytes) {
        if (!this.metadata.audioBytes) this.fault ??= new Error("No source audio was received in this take. The video is preserved; enable audio analysis and try again.");
        this.metadata = { ...this.metadata, seconds: this.elapsed, videoBytes: this.videoWriter.bytes, audioBytes: this.audioWriter?.bytes ?? 0, complete: !this.fault };
        await writeMetadata(this.folder, this.metadata); result = this.metadata;
      }
    } catch (error) { this.fault ??= error; }
    finally {
      this.stopAudioNodes(); this.video.getVideoTracks()[0]?.removeEventListener("ended", this.onEnded);
      this.video.getTracks().forEach(track => track.stop()); this.destination?.stream.getTracks().forEach(track => track.stop());
      try { await this.context?.close(); } catch { /* Audio context may already have closed. */ }
      this.phase = "idle"; this.emit(); this.completed(result, this.fault);
      if (this.fault) console.warn("[Streamer recording]", this.fault);
    }
    return result;
  }
}
