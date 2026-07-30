import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface AudioMetadata {
  path: string; fileName: string; hash: string; durationSeconds: number; sampleRate: number;
  channels: number; codec: string; fileSize: number;
}
export interface ImportedAudio { metadata: AudioMetadata; waveform: number[]; url: string; }
interface WaveformResponse { sampleRate: number; peaks: number[]; }

function chooseBrowserFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".mp3,.wav,audio/mpeg,audio/wav";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

async function decodeBrowserFile(file: File): Promise<ImportedAudio> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice(0));
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const channel = decoded.getChannelData(0); const points = 2048; const bucketSize = Math.max(1, Math.ceil(channel.length / points)); const waveform: number[] = [];
    for (let offset = 0; offset < channel.length; offset += bucketSize) {
      let minimum = 1; let maximum = -1;
      for (let index = offset; index < Math.min(offset + bucketSize, channel.length); index += 1) { const sample = channel[index] ?? 0; minimum = Math.min(minimum, sample); maximum = Math.max(maximum, sample); }
      waveform.push(minimum, maximum);
    }
    return { metadata: { path: file.name, fileName: file.name, hash, durationSeconds: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, codec: file.type || "audio", fileSize: file.size }, waveform, url: URL.createObjectURL(file) };
  } finally { await context.close(); }
}

function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
    };
    const finish = (duration?: number, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error || !Number.isFinite(duration) || duration! <= 0) reject(error ?? new Error("Durata video non valida."));
      else resolve(duration!);
    };
    const timeout = window.setTimeout(() => finish(undefined, new Error("Timeout durante la lettura del video.")), 15_000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(undefined, new Error("Il browser non riesce a leggere i metadati del video."));
    video.src = url;
    video.load();
  });
}

export async function importVideoFile(file: File): Promise<ImportedAudio> {
  if (!file.type.startsWith("video/") && !/\.(?:mp4|webm|mov|m4v)$/i.test(file.name)) throw new Error("Seleziona un file video MP4, WebM, MOV o M4V.");
  const videoUrl = URL.createObjectURL(file);
  let durationSeconds: number;
  try {
    durationSeconds = await probeVideoDuration(videoUrl);
  } catch (error) {
    URL.revokeObjectURL(videoUrl);
    throw error;
  }

  try {
    const decoded = await decodeBrowserFile(file);
    URL.revokeObjectURL(videoUrl);
    return {
      ...decoded,
      metadata: { ...decoded.metadata, durationSeconds }
    };
  } catch {
    // A video can be a perfectly valid visual guide while containing no audio
    // track (or an audio codec unsupported by AudioContext). ProSubtitles must
    // still use the visual duration instead of rejecting the whole source.
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes.slice(0));
    const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    return {
      metadata: {
        path: file.name,
        fileName: file.name,
        hash,
        durationSeconds,
        sampleRate: 48_000,
        channels: 1,
        codec: file.type || "video",
        fileSize: file.size
      },
      waveform: [],
      url: videoUrl
    };
  }
}

export async function importAudio(): Promise<ImportedAudio | null> {
  if (!isTauri()) { const file = await chooseBrowserFile(); return file ? decodeBrowserFile(file) : null; }
  const status = await invoke<{ ffmpeg: boolean; ffprobe: boolean }>("detect_audio_tools");
  if (!status.ffmpeg || !status.ffprobe) throw new Error("FFmpeg e FFprobe sono necessari per importare l’audio.");
  const path = await open({ multiple: false, filters: [{ name: "Audio", extensions: ["mp3", "wav"] }] });
  if (typeof path !== "string") return null;
  return loadAudioFromPath(path);
}

export async function loadAudioFromPath(path: string): Promise<ImportedAudio> {
  const [metadata, waveform, bytes] = await Promise.all([
    invoke<AudioMetadata>("probe_audio", { path }), invoke<WaveformResponse>("generate_waveform", { path, points: 2048 }), invoke<ArrayBuffer>("read_audio_data", { path })
  ]);
  const mime = path.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  return { metadata, waveform: waveform.peaks, url: URL.createObjectURL(new Blob([bytes], { type: mime })) };
}
