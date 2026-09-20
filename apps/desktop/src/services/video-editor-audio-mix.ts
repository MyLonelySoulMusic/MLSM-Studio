import type { VideoEditorClip } from "./video-editor";

export type VideoEditorAudioMixSettings = NonNullable<VideoEditorClip["audioMix"]>;

export const defaultVideoEditorAudioMix: VideoEditorAudioMixSettings = {
  pan: 0,
  fadeMode: "manual",
  eq: {
    enabled: false,
    lowGainDb: 0,
    lowFrequencyHz: 120,
    midGainDb: 0,
    midFrequencyHz: 1_000,
    midQ: 1,
    highGainDb: 0,
    highFrequencyHz: 8_000
  },
  compressor: {
    enabled: false,
    thresholdDb: -18,
    ratio: 4,
    attackMs: 10,
    releaseMs: 180,
    kneeDb: 8,
    makeupGainDb: 0
  }
};

export interface VideoEditorAudioAutomationProperty {
  key: string;
  label: string;
  section: "Livello" | "Equalizzatore" | "Compressore";
  minimum: number;
  maximum: number;
  step: number;
  unit: string;
  defaultValue: number;
}

export const videoEditorAudioAutomationProperties: readonly VideoEditorAudioAutomationProperty[] = [
  { key: "volume", label: "Volume", section: "Livello", minimum: 0, maximum: 2, step: .01, unit: "%", defaultValue: 1 },
  { key: "audioMix.pan", label: "Pan", section: "Livello", minimum: -1, maximum: 1, step: .01, unit: "", defaultValue: 0 },
  { key: "audioMix.eq.lowGainDb", label: "EQ bassi", section: "Equalizzatore", minimum: -24, maximum: 24, step: .5, unit: "dB", defaultValue: 0 },
  { key: "audioMix.eq.lowFrequencyHz", label: "Frequenza bassi", section: "Equalizzatore", minimum: 40, maximum: 500, step: 5, unit: "Hz", defaultValue: 120 },
  { key: "audioMix.eq.midGainDb", label: "EQ medi", section: "Equalizzatore", minimum: -24, maximum: 24, step: .5, unit: "dB", defaultValue: 0 },
  { key: "audioMix.eq.midFrequencyHz", label: "Frequenza medi", section: "Equalizzatore", minimum: 200, maximum: 8_000, step: 10, unit: "Hz", defaultValue: 1_000 },
  { key: "audioMix.eq.midQ", label: "Ampiezza medi (Q)", section: "Equalizzatore", minimum: .1, maximum: 12, step: .1, unit: "", defaultValue: 1 },
  { key: "audioMix.eq.highGainDb", label: "EQ alti", section: "Equalizzatore", minimum: -24, maximum: 24, step: .5, unit: "dB", defaultValue: 0 },
  { key: "audioMix.eq.highFrequencyHz", label: "Frequenza alti", section: "Equalizzatore", minimum: 2_000, maximum: 18_000, step: 50, unit: "Hz", defaultValue: 8_000 },
  { key: "audioMix.compressor.thresholdDb", label: "Soglia", section: "Compressore", minimum: -80, maximum: 0, step: 1, unit: "dB", defaultValue: -18 },
  { key: "audioMix.compressor.ratio", label: "Ratio", section: "Compressore", minimum: 1, maximum: 20, step: .1, unit: ":1", defaultValue: 4 },
  { key: "audioMix.compressor.attackMs", label: "Attack", section: "Compressore", minimum: 0, maximum: 1_000, step: 1, unit: "ms", defaultValue: 10 },
  { key: "audioMix.compressor.releaseMs", label: "Release", section: "Compressore", minimum: 10, maximum: 1_000, step: 5, unit: "ms", defaultValue: 180 },
  { key: "audioMix.compressor.kneeDb", label: "Knee", section: "Compressore", minimum: 0, maximum: 40, step: 1, unit: "dB", defaultValue: 8 },
  { key: "audioMix.compressor.makeupGainDb", label: "Make-up gain", section: "Compressore", minimum: -12, maximum: 24, step: .5, unit: "dB", defaultValue: 0 }
] as const;

export function videoEditorAudioMix(clip: VideoEditorClip): VideoEditorAudioMixSettings {
  const source = clip.audioMix;
  if (!source) return defaultVideoEditorAudioMix;
  return {
    ...defaultVideoEditorAudioMix,
    ...source,
    eq: { ...defaultVideoEditorAudioMix.eq, ...source.eq },
    compressor: { ...defaultVideoEditorAudioMix.compressor, ...source.compressor }
  };
}

export function videoEditorAudioProperty(key: string): VideoEditorAudioAutomationProperty | null {
  return videoEditorAudioAutomationProperties.find((property) => property.key === key) ?? null;
}

export function videoEditorAudioMixValue(clip: VideoEditorClip, key: string): number {
  if (key === "volume") return clip.volume;
  const mix = videoEditorAudioMix(clip);
  const path = key.replace(/^audioMix\./, "").split(".");
  let value: unknown = mix;
  for (const part of path) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : videoEditorAudioProperty(key)?.defaultValue ?? 0;
}

export function videoEditorAudioMixWithValue(clip: VideoEditorClip, key: string, value: number): { volume: number; audioMix: VideoEditorAudioMixSettings } {
  const definition = videoEditorAudioProperty(key);
  const safeValue = definition ? Math.min(definition.maximum, Math.max(definition.minimum, value)) : value;
  value = Number.isFinite(safeValue) ? safeValue : definition?.defaultValue ?? 0;
  if (key === "volume") return { volume: value, audioMix: videoEditorAudioMix(clip) };
  const mix = videoEditorAudioMix(clip);
  if (key === "audioMix.pan") return { volume: clip.volume, audioMix: { ...mix, pan: value } };
  const [group, property] = key.replace(/^audioMix\./, "").split(".");
  if (group === "eq" && property) return { volume: clip.volume, audioMix: { ...mix, eq: { ...mix.eq, [property]: value } } };
  if (group === "compressor" && property) return { volume: clip.volume, audioMix: { ...mix, compressor: { ...mix.compressor, [property]: value } } };
  return { volume: clip.volume, audioMix: mix };
}

export function videoEditorAutomaticAudioFadeSeconds(durationSeconds: number): number {
  return Math.min(.75, Math.max(.08, durationSeconds * .04), Math.max(0, durationSeconds / 2));
}

export function videoEditorDbToGain(decibels: number): number {
  return Math.pow(10, decibels / 20);
}
