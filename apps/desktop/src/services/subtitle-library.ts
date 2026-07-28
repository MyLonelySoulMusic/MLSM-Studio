import type { RhythmBallProject } from "@rbs/project-schema";

type SubtitleSettings = RhythmBallProject["subtitles"];
type SubtitleCue = SubtitleSettings["cues"][number];

export type SubtitleTrackPlacement = "replace" | "stretch" | "insert";

export interface SubtitleTrackStyle {
  animation: SubtitleSettings["animation"];
  fontFamily: string;
  fontSize: number;
  color: string;
  glowColor: string;
  fallSpeed: number;
}

export interface SavedSubtitleTrack {
  id: string;
  name: string;
  createdAt: string;
  sourceDuration: number;
  style: SubtitleTrackStyle;
  cues: SubtitleCue[];
}

interface SubtitleLibraryFile {
  format: "dynamic-sound-subtitle-library";
  version: 1;
  tracks: SavedSubtitleTrack[];
}

const storageKey = "dynamic-sound-animation-studio.subtitle-library.v1";
const animations = new Set<SubtitleTrackStyle["animation"]>(["ledFall", "cinematicFade", "wordPop", "karaokeGlow", "slideUp"]);

function finite(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function cueFromUnknown(value: unknown, index: number): SubtitleCue | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>; const text = typeof source.text === "string" ? source.text.trim() : "";
  const startSeconds = Math.max(0, finite(source.startSeconds)); const endSeconds = Math.max(startSeconds + .05, finite(source.endSeconds, startSeconds + 2));
  if (!text) return null;
  return { id: typeof source.id === "string" && source.id ? source.id : `subtitle-import-${index}`, startSeconds, endSeconds, text: text.slice(0, 500), confidence: Math.max(0, Math.min(1, finite(source.confidence, 1))), verified: source.verified === true, manual: source.manual !== false };
}
function styleFromUnknown(value: unknown): SubtitleTrackStyle | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>; const animation = source.animation;
  if (typeof animation !== "string" || !animations.has(animation as SubtitleTrackStyle["animation"])) return null;
  if (typeof source.fontFamily !== "string" || typeof source.color !== "string" || typeof source.glowColor !== "string") return null;
  return { animation: animation as SubtitleTrackStyle["animation"], fontFamily: source.fontFamily.slice(0, 100), fontSize: Math.max(18, Math.min(180, Math.round(finite(source.fontSize, 64)))), color: source.color, glowColor: source.glowColor, fallSpeed: Math.max(.2, Math.min(4, finite(source.fallSpeed, 1))) };
}
function trackFromUnknown(value: unknown, index: number): SavedSubtitleTrack | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>; const style = styleFromUnknown(source.style); const cues = Array.isArray(source.cues) ? source.cues.map(cueFromUnknown).filter((cue): cue is SubtitleCue => Boolean(cue)).sort((left, right) => left.startSeconds - right.startSeconds) : [];
  if (!style || !cues.length) return null;
  return { id: typeof source.id === "string" && source.id ? source.id : `subtitle-track-${index}`, name: typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 120) : `Traccia ${index + 1}`, createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date(0).toISOString(), sourceDuration: Math.max(.05, finite(source.sourceDuration, cues.at(-1)?.endSeconds ?? 1)), style, cues };
}
function parseLibrary(value: unknown): SavedSubtitleTrack[] {
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  if (source.format !== "dynamic-sound-subtitle-library" || source.version !== 1 || !Array.isArray(source.tracks)) return [];
  return source.tracks.map(trackFromUnknown).filter((track): track is SavedSubtitleTrack => Boolean(track));
}

export function createSavedSubtitleTrack(name: string, subtitles: SubtitleSettings, sourceDuration: number): SavedSubtitleTrack {
  const cleanName = name.trim() || "Traccia sottotitoli";
  return { id: `subtitle-track-${crypto.randomUUID()}`, name: cleanName.slice(0, 120), createdAt: new Date().toISOString(), sourceDuration: Math.max(.05, sourceDuration, subtitles.cues.at(-1)?.endSeconds ?? 0), style: { animation: subtitles.animation, fontFamily: subtitles.fontFamily, fontSize: subtitles.fontSize, color: subtitles.color, glowColor: subtitles.glowColor, fallSpeed: subtitles.fallSpeed }, cues: subtitles.cues.map((cue) => ({ ...cue })) };
}

export function loadSubtitleLibrary(storage: Pick<Storage, "getItem"> = window.localStorage): SavedSubtitleTrack[] {
  try { const raw = storage.getItem(storageKey); return raw ? parseLibrary(JSON.parse(raw)) : []; } catch { return []; }
}

export function persistSubtitleLibrary(tracks: readonly SavedSubtitleTrack[], storage: Pick<Storage, "setItem"> = window.localStorage): void {
  const file: SubtitleLibraryFile = { format: "dynamic-sound-subtitle-library", version: 1, tracks: [...tracks] };
  storage.setItem(storageKey, JSON.stringify(file));
}

export function exportSubtitleLibrary(tracks: readonly SavedSubtitleTrack[]): string {
  const file: SubtitleLibraryFile = { format: "dynamic-sound-subtitle-library", version: 1, tracks: [...tracks] };
  return JSON.stringify(file, null, 2);
}

export function importSubtitleLibrary(serialized: string): SavedSubtitleTrack[] {
  const tracks = parseLibrary(JSON.parse(serialized));
  if (!tracks.length) throw new Error("Il file non contiene tracce sottotitoli valide.");
  return tracks.map((track) => ({ ...track, id: `subtitle-track-${crypto.randomUUID()}` }));
}

export function instantiateSubtitleTrack(track: SavedSubtitleTrack, targetDuration: number, placement: SubtitleTrackPlacement, playheadSeconds = 0): SubtitleCue[] {
  const safeDuration = Math.max(.05, targetDuration);
  const firstStart = track.cues[0]?.startSeconds ?? 0;
  const scale = placement === "stretch" ? safeDuration / Math.max(.05, track.sourceDuration) : 1;
  const shift = placement === "insert" ? Math.max(0, playheadSeconds) - firstStart : 0;
  return track.cues.flatMap((cue) => {
    const startSeconds = placement === "stretch" ? cue.startSeconds * scale : cue.startSeconds + shift;
    const rawEnd = placement === "stretch" ? cue.endSeconds * scale : cue.endSeconds + shift;
    if (startSeconds >= safeDuration) return [];
    const endSeconds = Math.min(safeDuration, Math.max(startSeconds + .05, rawEnd));
    return [{ ...cue, id: `subtitle-${crypto.randomUUID()}`, startSeconds: Math.max(0, startSeconds), endSeconds, manual: true }];
  }).sort((left, right) => left.startSeconds - right.startSeconds);
}

