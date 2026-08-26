import { cassetteDeskMechanicalEvents } from "./cassette-desk";

export interface CassetteDeskIntroPlayback {
  cancel: () => void;
  finished: Promise<void>;
  startedAt: number;
}

export type CassetteDeskMechanicalKind = "slide" | "door" | "play";
export interface CassetteDeskMechanicalEvent {
  timeSeconds: number;
  kind: CassetteDeskMechanicalKind;
}

export interface CassetteDeskMechanicalAsset {
  sampleRate: number;
  channelData: readonly Float32Array[];
  sourceUrl: string;
}

export const CASSETTE_DESK_MECHANICAL_SFX_URL = "/audio/cassette-desk/cassette-action-cc0.mp3";

const ASSET_CLIPS: Record<CassetteDeskMechanicalKind, { offsetSeconds: number; durationSeconds: number; gain: number }> = {
  // The CC0 field recording contains cassette handling/insertion from 3.67s to
  // 8.69s. Its final, clean insertion movement is the section used here.
  slide: { offsetSeconds: 7.36, durationSeconds: 1.30, gain: 1.18 },
  door: { offsetSeconds: 8.90, durationSeconds: .56, gain: 1.14 },
  play: { offsetSeconds: 10.94, durationSeconds: .34, gain: 1.22 }
};

let mechanicalAssetPromise: Promise<CassetteDeskMechanicalAsset | null> | null = null;

/** Loads and decodes the bundled CC0 recording once; callers always get PCM. */
export function loadCassetteDeskMechanicalAsset(): Promise<CassetteDeskMechanicalAsset | null> {
  if (mechanicalAssetPromise) return mechanicalAssetPromise;
  mechanicalAssetPromise = (async () => {
    if (typeof window === "undefined" || !window.AudioContext) return null;
    const response = await fetch(CASSETTE_DESK_MECHANICAL_SFX_URL);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) return null;
    const context = new window.AudioContext();
    try {
      const decoded = await context.decodeAudioData(bytes.slice(0));
      if (!decoded.length || !decoded.numberOfChannels) return null;
      return {
        sampleRate: decoded.sampleRate,
        channelData: Array.from({ length: decoded.numberOfChannels }, (_, channel) => new Float32Array(decoded.getChannelData(channel))),
        sourceUrl: CASSETTE_DESK_MECHANICAL_SFX_URL
      };
    } finally {
      await context.close();
    }
  })().catch(() => null);
  return mechanicalAssetPromise;
}

const deterministicNoise = (index: number) => {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

function addProceduralMechanicalLayer(
  data: Float32Array,
  sampleRate: number,
  channels: number,
  frames: number,
  event: CassetteDeskMechanicalEvent,
  eventIndex: number,
  amount: number
): void {
  const start = Math.max(0, Math.floor(event.timeSeconds * sampleRate));
  const duration = event.kind === "slide" ? .92 : event.kind === "door" ? .43 : .31;
  const length = Math.floor(sampleRate * duration);
  for (let frame = 0; frame < length && start + frame < frames; frame += 1) {
    const t = frame / sampleRate;
    const progress = frame / Math.max(1, length - 1);
    const noise = deterministicNoise(frame + eventIndex * 97_531);
    let sample = 0;
    if (event.kind === "slide") {
      const frictionEnvelope = Math.sin(Math.PI * Math.min(1, progress)) ** .7;
      const friction = noise * (.055 + .035 * Math.sin(t * Math.PI * 2 * 7.3)) * frictionEnvelope;
      const plasticBody = (Math.sin(t * Math.PI * 2 * 82) * .05 + Math.sin(t * Math.PI * 2 * 173) * .025) * (1 - progress) ** .65;
      const seatingImpact = Math.exp(-Math.max(0, t - .68) * 38) * (t >= .68 ? Math.sin((t - .68) * Math.PI * 2 * 118) * .15 : 0);
      sample = friction + plasticBody + seatingImpact;
    } else if (event.kind === "door") {
      const attack = Math.exp(-t * 31);
      const latch = Math.exp(-Math.max(0, t - .075) * 52) * (t >= .075 ? 1 : 0);
      sample = attack * (Math.sin(t * Math.PI * 2 * 128) * .25 + Math.sin(t * Math.PI * 2 * 286) * .11 + noise * .07)
        + latch * (Math.sin((t - .075) * Math.PI * 2 * 470) * .12 + noise * .035);
    } else {
      const click = Math.exp(-t * 78) * (noise * .13 + Math.sin(t * Math.PI * 2 * 1_080) * .17);
      const transport = t >= .055 ? Math.exp(-(t - .055) * 25) * (Math.sin((t - .055) * Math.PI * 2 * 142) * .11 + Math.sin((t - .055) * Math.PI * 2 * 612) * .045) : 0;
      sample = click + transport;
    }
    for (let channel = 0; channel < channels; channel += 1) {
      const stereoWidth = channels === 1 ? 1 : channel % 2 === 0 ? .98 : 1.02;
      const target = (start + frame) * channels + channel;
      data[target] = (data[target] ?? 0) + sample * amount * stereoWidth;
    }
  }
}

function assetSample(asset: CassetteDeskMechanicalAsset, channel: number, position: number): number {
  const source = asset.channelData[Math.min(channel, asset.channelData.length - 1)] ?? asset.channelData[0];
  if (!source || position < 0 || position >= source.length - 1) return 0;
  const left = Math.floor(position);
  const fraction = position - left;
  return (source[left] ?? 0) * (1 - fraction) + (source[left + 1] ?? 0) * fraction;
}

function addRecordedMechanicalLayer(
  data: Float32Array,
  sampleRate: number,
  channels: number,
  frames: number,
  event: CassetteDeskMechanicalEvent,
  asset: CassetteDeskMechanicalAsset
): void {
  const clip = ASSET_CLIPS[event.kind];
  const start = Math.max(0, Math.floor(event.timeSeconds * sampleRate));
  const length = Math.floor(clip.durationSeconds * sampleRate);
  const fadeInFrames = Math.max(1, Math.floor(sampleRate * .008));
  const fadeOutFrames = Math.max(1, Math.floor(sampleRate * .035));
  for (let frame = 0; frame < length && start + frame < frames; frame += 1) {
    const sourcePosition = (clip.offsetSeconds + frame / sampleRate) * asset.sampleRate;
    const fadeIn = Math.min(1, frame / fadeInFrames);
    const fadeOut = Math.min(1, (length - frame - 1) / fadeOutFrames);
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
    for (let channel = 0; channel < channels; channel += 1) {
      const target = (start + frame) * channels + channel;
      data[target] = (data[target] ?? 0) + assetSample(asset, channel, sourcePosition) * clip.gain * envelope;
    }
  }
}

/**
 * Renders the complete intro as deterministic, interleaved PCM. Preview and
 * export call this exact function. The real CC0 recording is the main layer;
 * the procedural foley is a quiet support layer and the complete fallback.
 */
export function renderCassetteDeskMechanicalLeadIn(
  sampleRate: number,
  channels: number,
  durationSeconds: number,
  events: readonly CassetteDeskMechanicalEvent[],
  asset: CassetteDeskMechanicalAsset | null = null
): Float32Array {
  const safeRate = Math.max(1, Math.round(sampleRate));
  const safeChannels = Math.max(1, Math.round(channels));
  const frames = Math.max(1, Math.ceil(Math.max(0, durationSeconds) * safeRate));
  const data = new Float32Array(frames * safeChannels);
  events.forEach((event, eventIndex) => {
    addProceduralMechanicalLayer(data, safeRate, safeChannels, frames, event, eventIndex, asset ? .16 : 1);
    if (asset) addRecordedMechanicalLayer(data, safeRate, safeChannels, frames, event, asset);
  });
  // Soft limiting keeps layered transients professional and prevents AAC clips.
  const drive = 1.22;
  const normalization = .94 / Math.tanh(drive);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.tanh(data[index]! * drive) * normalization;
  return data;
}

function copyInterleavedToAudioBuffer(data: Float32Array, buffer: AudioBuffer): void {
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const target = buffer.getChannelData(channel);
    for (let frame = 0; frame < target.length; frame += 1) target[frame] = data[frame * buffer.numberOfChannels + channel] ?? 0;
  }
}

export function playCassetteDeskIntro(durationSeconds: number, onTime?: (time: number) => void): CassetteDeskIntroPlayback {
  const Context = window.AudioContext;
  const context = new Context();
  const safeDuration = Math.max(.01, durationSeconds);
  const events = cassetteDeskMechanicalEvents(safeDuration);
  const startedAt = performance.now();
  let cancelled = false;
  let settled = false;
  let frame = 0;
  let source: AudioBufferSourceNode | null = null;
  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });

  const tick = () => {
    if (cancelled) return;
    const elapsed = (performance.now() - startedAt) / 1_000;
    onTime?.(Math.min(safeDuration, elapsed));
    if (elapsed < safeDuration) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  void loadCassetteDeskMechanicalAsset().then((asset) => {
    if (cancelled || context.state === "closed") return;
    const elapsed = Math.max(0, (performance.now() - startedAt) / 1_000);
    if (elapsed >= safeDuration) return;
    const channels = 2;
    const data = renderCassetteDeskMechanicalLeadIn(context.sampleRate, channels, safeDuration, events, asset);
    const buffer = context.createBuffer(channels, Math.floor(data.length / channels), context.sampleRate);
    copyInterleavedToAudioBuffer(data, buffer);
    source = context.createBufferSource();
    source.buffer = buffer;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -7;
    compressor.knee.value = 9;
    compressor.ratio.value = 3;
    compressor.attack.value = .004;
    compressor.release.value = .12;
    source.connect(compressor);
    compressor.connect(context.destination);
    void context.resume();
    source.start(0, elapsed);
  });

  const settle = (completed: boolean) => {
    if (settled) return;
    settled = true;
    cancelled = !completed;
    cancelAnimationFrame(frame);
    if (completed) onTime?.(safeDuration);
    try { source?.stop(); } catch { /* already stopped */ }
    void context.close();
    resolveFinished();
  };
  const timer = window.setTimeout(() => settle(true), safeDuration * 1_000);
  return {
    startedAt,
    finished,
    cancel: () => {
      window.clearTimeout(timer);
      settle(false);
    }
  };
}
