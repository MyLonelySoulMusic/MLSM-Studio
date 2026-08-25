import { create } from "zustand";
import { createProject, type CassetteDeskSettings, type RhythmBallProject, type SongPlayerAsset, type SongPlayerMatch, type SongPlayerSettings } from "@rbs/project-schema";
import type { AudioMetadata } from "../services/audio-import";
import type { AudioAnalysisResult } from "@rbs/audio-analysis";
import {
  directProSubtitleAnimation,
  resolveProSubtitlePaletteColor
} from "../services/pro-subtitles";
import {
  videoEditorAppendPlacement,
  videoEditorAsset as findVideoEditorAsset,
  videoEditorAssetIsStill,
  videoEditorClip as findVideoEditorClip,
  videoEditorClipEnd,
  videoEditorClipMaximumDuration,
  videoEditorCloseGaps,
  videoEditorCompositionForAsset,
  videoEditorAlignClipsByFrame,
  videoEditorQuantizeTime,
  videoEditorDefaultImageSeconds,
  videoEditorMinimumClipSeconds,
  videoEditorMoveClip,
  videoEditorReorderTracks,
  videoEditorSplitClip,
  videoEditorSyncClips,
  videoEditorTrimClip,
  type VideoEditorAsset,
  type VideoEditorClip,
  type VideoEditorEffectClip,
  type VideoEditorTrack
} from "../services/video-editor";
import { videoEditorClipSourceDuration, videoEditorClipTimelineDurationForSource } from "../services/video-editor-speed";
import { defaultVideoEditorImageShadow } from "../services/video-editor-image-shadow";
import { videoEditorClampEffect, videoEditorMoveEffect, videoEditorPlaceEffect, videoEditorTrimEffect } from "../services/video-editor-effects";
import { upsertVideoEditorKeyframe, removeVideoEditorKeyframe, type VideoEditorAutomationTarget, type VideoEditorKeyframe } from "../services/video-editor-automation";
import type { VideoEditorToolArtifact } from "../services/video-editor-tools";
import { songPlayerPersistedOffsetMs } from "../services/song-player-playback";

interface AttachAudioOptions {
  preserveSubtitleTrack?: boolean;
}

interface ProjectState {
  project: RhythmBallProject;
  filePath: string | null;
  dirty: boolean;
  status: string;
  eventHistory: RhythmBallProject["events"][];
  eventFuture: RhythmBallProject["events"][];
  videoEditorHistory: RhythmBallProject["animation"]["videoEditor"][];
  videoEditorFuture: RhythmBallProject["animation"]["videoEditor"][];
  selectedEventId: string | null;
  selectedEventIds: string[];
  newProject: () => void;
  setProject: (project: RhythmBallProject, filePath: string | null) => void;
  renameProject: (name: string) => void;
  attachAudio: (metadata: AudioMetadata, waveform: number[], options?: AttachAudioOptions) => void;
  applyAnalysis: (result: AudioAnalysisResult) => void;
  setAspectRatio: (ratio: RhythmBallProject["canvas"]["aspectRatio"]) => void;
  setCanvasFormat: (format: { aspectRatio: RhythmBallProject["canvas"]["aspectRatio"]; width?: number; height?: number }) => void;
  registerSongPlayerFullTrack: (asset: SongPlayerAsset) => void;
  removeSongPlayerAsset: (assetId: string) => void;
  updateSongPlayer: (patch: Partial<SongPlayerSettings>) => void;
  updateCassetteDesk: (patch: Partial<CassetteDeskSettings>) => void;
  applyCassetteDeskExtractedPalette: (colors: readonly string[]) => void;
  setSongPlayerPalette: (colors: readonly string[]) => void;
  applySongPlayerExtractedPalette: (colors: readonly string[]) => void;
  setSongPlayerMatch: (match: SongPlayerMatch) => void;
  cancelSongPlayerMatch: (owner: { projectId: string; fragmentHash?: string; fullTrackHash?: string }) => void;
  setSongPlayerManualOffset: (offsetMs: number) => void;
  setAnimationMode: (modeId: string, baseObjectTypes: RhythmBallProject["animation"]["baseObjectTypes"]) => void;
  setBaseObjectEnabled: (type: RhythmBallProject["animation"]["baseObjectTypes"][number], enabled: boolean) => void;
  setNewYorkMarbleCount: (count: number) => void;
  setNewYorkGroupColor: (color: string) => void;
  setNewYorkMarbleColor: (index: number, color: string) => void;
  addNewYorkFlyers: (imageUrls: readonly string[]) => void;
  removeNewYorkFlyer: (index: number) => void;
  updateCoverSphere: (patch: Partial<RhythmBallProject["animation"]["coverSphere"]>) => void;
  setCoverSphereAutoPalette: (enabled: boolean) => void;
  setCoverSpherePalette: (colors: readonly string[]) => void;
  addCoverSphereFlyers: (imageUrls: readonly string[]) => void;
  removeCoverSphereFlyer: (index: number) => void;
  updateStereoUnfold: (patch: Partial<RhythmBallProject["animation"]["stereoUnfold"]>) => void;
  setStereoUnfoldPalette: (colors: readonly string[]) => void;
  setStereoUnfoldAutoPalette: (enabled: boolean) => void;
  updateWalkingCube: (patch: Partial<RhythmBallProject["animation"]["walkingCube"]>) => void;
  setWalkingCubePalette: (colors: readonly string[]) => void;
  updatePortraitLandscape: (patch: Partial<RhythmBallProject["animation"]["portraitLandscape"]>) => void;
  setPortraitLandscapePalette: (colors: readonly string[]) => void;
  updateTeddyWalk: (patch: Partial<RhythmBallProject["animation"]["teddyWalk"]>) => void;
  setTeddyWalkPalette: (colors: readonly string[]) => void;
  updateTeddySing: (patch: Partial<RhythmBallProject["animation"]["teddySing"]>) => void;
  updateProSubtitles: (patch: Partial<RhythmBallProject["animation"]["proSubtitles"]>) => void;
  setProSubtitlesPalette: (colors: readonly string[]) => void;
  updatePixelsSub: (patch: Partial<RhythmBallProject["animation"]["pixelsSub"]>) => void;
  setPixelsSubPalette: (colors: readonly string[]) => void;
  updateBackgroundAuto: (patch: Partial<RhythmBallProject["animation"]["backgroundAuto"]>) => void;
  setBackgroundAutoPalette: (colors: readonly string[]) => void;
  setBackgroundAutoDetections: (detections: readonly BackgroundAutoDetectionInput[]) => void;
  patchBackgroundAutoDetection: (id: string, patch: Partial<Omit<BackgroundAutoDetection, "id">>) => void;
  toggleBackgroundAutoDetectionAnimation: (id: string) => void;
  addBackgroundAutoEffect: () => void;
  removeBackgroundAutoEffect: (id: string) => void;
  updateBackgroundAutoEffect: (id: string, patch: Partial<RhythmBallProject["animation"]["backgroundAuto"]["effects"][number]>) => void;
  updateStaticWatermark: (patch: Partial<RhythmBallProject["animation"]["staticWatermark"]>) => void;
  updateUpscaler: (patch: Partial<RhythmBallProject["animation"]["upscaler"]>) => void;
  updateFrameBooster: (patch: Partial<RhythmBallProject["animation"]["frameBooster"]>) => void;
  updateVideoEditor: (patch: Partial<Omit<RhythmBallProject["animation"]["videoEditor"], "assets" | "tracks" | "clips" | "selectedClipIds" | "effectClips" | "selectedEffectClipIds">>) => void;
  addVideoEditorAssets: (assets: readonly VideoEditorAsset[]) => void;
  removeVideoEditorAsset: (assetId: string) => void;
  updateVideoEditorAsset: (assetId: string, patch: Partial<VideoEditorAsset>) => void;
  addVideoEditorClip: (assetId: string, options?: { trackId?: string; startSeconds?: number; strictTrack?: boolean }) => string | null;
  updateVideoEditorClip: (clipId: string, patch: Partial<Omit<VideoEditorClip, "id" | "assetId">>) => void;
  updateVideoEditorClipAdjustments: (clipId: string, patch: Partial<VideoEditorClip["adjustments"]>) => void;
  moveVideoEditorClip: (clipId: string, startSeconds: number, playheadSeconds?: number) => void;
  moveVideoEditorClipToTrack: (clipId: string, trackId: string) => void;
  trimVideoEditorClip: (clipId: string, edge: "start" | "end", timeSeconds: number, playheadSeconds?: number) => void;
  splitVideoEditorClip: (clipId: string, timeSeconds: number) => void;
  duplicateVideoEditorClip: (clipId: string) => void;
  deleteVideoEditorClips: (clipIds: readonly string[]) => void;
  selectVideoEditorClip: (clipId: string | null, additive?: boolean) => void;
  selectVideoEditorClips: (clipIds: readonly string[]) => void;
  syncVideoEditorClips: (referenceClipId: string, targetClipIds: readonly string[]) => void;
  alignVideoEditorClipsByFrame: (referenceClipId: string, targetClipIds: readonly string[]) => void;
  upsertVideoEditorKeyframe: (target: VideoEditorAutomationTarget, keyframe: VideoEditorKeyframe) => void;
  removeVideoEditorKeyframe: (target: VideoEditorAutomationTarget, frame: number) => void;
  insertVideoEditorArtifact: (artifact: VideoEditorToolArtifact, sourceClipId: string) => string | null;
  undoVideoEditor: () => void;
  redoVideoEditor: () => void;
  closeVideoEditorGaps: (trackId: string) => void;
  updateVideoEditorTrack: (trackId: string, patch: Partial<Omit<VideoEditorTrack, "id" | "kind">>) => void;
  addVideoEditorTrack: (kind: VideoEditorTrack["kind"]) => void;
  reorderVideoEditorTrack: (trackId: string, destinationIndex: number) => void;
  removeVideoEditorTrack: (trackId: string) => void;
  setVideoEditorAssetAnalysis: (assetId: string, analysis: { bpm: number | null; beats: readonly number[]; downbeats: readonly number[] }) => void;
  addVideoEditorEffectClip: (effectId: string, options?: { targetClipId?: string; startSeconds?: number; durationSeconds?: number }) => string | null;
  updateVideoEditorEffectClip: (effectId: string, patch: Partial<Omit<VideoEditorEffectClip, "id">>) => void;
  moveVideoEditorEffectClip: (effectId: string, startSeconds: number) => void;
  trimVideoEditorEffectClip: (effectId: string, edge: "start" | "end", timeSeconds: number) => void;
  deleteVideoEditorEffectClips: (effectIds: readonly string[]) => void;
  selectVideoEditorEffectClip: (effectId: string | null, additive?: boolean) => void;
  updateProSubtitleCueStyle: (cueId: string, patch: Partial<Omit<RhythmBallProject["animation"]["proSubtitles"]["cueStyles"][number], "cueId" | "wordStyles">>) => void;
  updateProSubtitleWordStyle: (cueId: string, wordIndex: number, patch: Partial<Omit<RhythmBallProject["animation"]["proSubtitles"]["cueStyles"][number]["wordStyles"][number], "index">>) => void;
  setTeddySingPalette: (colors: readonly string[]) => void;
  setTeddySingPhonemes: (cues: RhythmBallProject["animation"]["teddySing"]["phonemeCues"]) => void;
  deleteTeddySingPhoneme: (id: string) => void;
  splitTeddySingPhoneme: (id: string, timeSeconds: number) => void;
  updateSubtitles: (patch: Partial<Omit<RhythmBallProject["subtitles"], "cues">>) => void;
  addSubtitleCue: (timeSeconds: number) => string;
  setSubtitleCues: (cues: RhythmBallProject["subtitles"]["cues"]) => void;
  updateSubtitleCue: (id: string, patch: Partial<RhythmBallProject["subtitles"]["cues"][number]>) => void;
  moveSubtitleCue: (id: string, startSeconds: number) => void;
  resizeSubtitleCue: (id: string, startSeconds: number, endSeconds: number) => void;
  deleteSubtitleCue: (id: string) => void;
  splitSubtitleCue: (id: string, timeSeconds: number) => void;
  selectEvent: (id: string | null, additive?: boolean) => void;
  addEvent: (timeSeconds: number) => void;
  moveEvent: (id: string, timeSeconds: number) => void;
  deleteEvent: (id: string) => void;
  deleteEvents: (ids: readonly string[]) => void;
  updateEvent: (id: string, patch: Partial<RhythmBallProject["events"][number]>) => void;
  undoEvents: () => void;
  redoEvents: () => void;
  markSaved: (project: RhythmBallProject, filePath: string) => void;
  setStatus: (status: string) => void;
}
const instrumentLabels: Record<string, string> = { kick: "grancassa", snare: "rullante", hihat: "piatti", piano: "piano", guitar: "chitarra", strings: "violini", percussion: "percussioni" };
const harmonicTypes = new Set(["piano", "guitar", "strings"]);
export function buildPrimaryBeatEvents(result: AudioAnalysisResult): RhythmBallProject["events"] {
  const clearEvents = result.events.filter((event) => !harmonicTypes.has(event.type) || event.confidence >= .82 && event.strength >= .38);
  const rawBeatTimes = result.beats.length ? result.globalBpm !== null && result.globalBpm > 155 ? result.beats.filter((_, index) => index % 2 === 0) : result.beats : clearEvents.map((event) => event.timeSeconds);
  const beatTimes = rawBeatTimes.reduce<number[]>((times, beat) => beat - (times.at(-1) ?? -Infinity) >= .32 ? [...times, beat] : times, []);
  return beatTimes.map((beat, index) => {
    const previous = beatTimes[index - 1]; const next = beatTimes[index + 1]; const localPeriod = Math.min(1, Math.max(.25, Math.min(previous === undefined ? Infinity : beat - previous, next === undefined ? Infinity : next - beat))); const window = Math.min(.14, localPeriod * .3);
    const candidate = clearEvents.filter((event) => Math.abs(event.timeSeconds - beat) <= window).sort((a, b) => b.confidence * b.strength - a.confidence * a.strength)[0];
    const timeSamples = Math.max(0, Math.round(beat * result.sampleRate)); const timeSeconds = timeSamples / result.sampleRate; const downbeat = result.downbeats.some((time) => Math.abs(time - beat) <= window);
    const lowEnergy = result.lowEnergySegments.some((segment) => beat >= segment.startSeconds && beat <= segment.endSeconds);
    const protectedBeat = index === 0 || index === beatTimes.length - 1 || downbeat || (candidate?.strength ?? 0) >= .86;
    const skip = !protectedBeat && (lowEnergy ? index % 4 !== 0 : index % 3 !== 0);
    const action = skip ? lowEnergy ? "freeFall" as const : "nearMiss" as const : downbeat ? "accentedCollision" as const : "collision" as const;
    return { id: `beat-${timeSamples}-${index}`, timeSeconds, timeSamples, eventType: candidate?.type ?? "percussion", confidence: candidate?.confidence ?? result.bpmConfidence, strength: candidate?.strength ?? (downbeat ? .78 : .62), frequencyBand: candidate?.frequencyBand ?? "full", assignedObjectType: null, assignedObjectId: null, enabled: true, accent: downbeat, manualOverride: false, action, expectedBallPosition: { x: 0, y: 0, z: 0 }, expectedBallVelocity: { x: 0, y: 0, z: 0 }, expectedImpactNormal: { x: 0, y: 1, z: 0 } };
  });
}
function analysisSummary(result: AudioAnalysisResult, events: RhythmBallProject["events"]): string { const impacts = events.filter((event) => event.action !== "nearMiss" && event.action !== "freeFall"); const counts = impacts.reduce<Record<string, number>>((totals, event) => ({ ...totals, [event.eventType]: (totals[event.eventType] ?? 0) + 1 }), {}); const detected = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([type, count]) => `${instrumentLabels[type] ?? type} ${count}`).join(" · "); const gaps = events.length - impacts.length; return `${impacts.length} rimbalzi · ${gaps} passaggi fluidi/cadute · ${result.globalBpm?.toFixed(1) ?? "—"} BPM${detected ? ` · ${detected}` : ""}`; }
type ProSubtitleSettings = RhythmBallProject["animation"]["proSubtitles"];
type ProSubtitleCueStyle = ProSubtitleSettings["cueStyles"][number];
type SubtitleCue = RhythmBallProject["subtitles"]["cues"][number];
type BackgroundAutoSettings = RhythmBallProject["animation"]["backgroundAuto"];
type BackgroundAutoEffect = BackgroundAutoSettings["effects"][number];
type BackgroundAutoDetection = BackgroundAutoSettings["detections"][number];
type BackgroundAutoPalette = [string, string, string];
type BackgroundAutoDetectionInput = Omit<BackgroundAutoDetection, "alias" | "palette" | "paletteMode"> & { alias?: string | undefined; palette?: readonly string[] | null | undefined; paletteMode?: "auto" | "manual" | undefined };

function completeBackgroundAutoPalette(colors: readonly string[], fallback: readonly string[]): BackgroundAutoPalette {
  return [colors[0] ?? fallback[0] ?? "#63f0d1", colors[1] ?? fallback[1] ?? colors[0] ?? "#7657ff", colors[2] ?? fallback[2] ?? colors[1] ?? colors[0] ?? "#ff4f9a"];
}

function detectionPalette(detection: BackgroundAutoDetection, fallback: readonly string[]): BackgroundAutoPalette {
  return completeBackgroundAutoPalette(detection.palette ?? [], fallback);
}

function normalizeBackgroundAutoDetection(detection: BackgroundAutoDetectionInput, fallback: readonly string[]): BackgroundAutoDetection {
  const palette = completeBackgroundAutoPalette(detection.palette ?? [], fallback);
  return { ...detection, alias: detection.alias?.trim() || detection.label, paletteMode: detection.paletteMode ?? "auto", palette };
}

function normalizeBackgroundAutoSettings(settings: BackgroundAutoSettings): BackgroundAutoSettings {
  return {
    ...settings,
    effects: settings.effects.map((effect) => ({
      ...effect,
      centerSpectrumEnabled: effect.centerSpectrumEnabled ?? true,
      stereoSidesEnabled: effect.stereoSidesEnabled ?? true,
      subtitlesEnabled: effect.subtitlesEnabled ?? false
    }))
  };
}

function normalizeBackgroundAutoGeometryValue(value: number | undefined, fallback: number, minimum: number): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : minimum;
  return Number.isFinite(value) ? Math.max(minimum, Math.min(1, value as number)) : Math.max(minimum, Math.min(1, safeFallback));
}

function autoBackgroundEffect(effect: BackgroundAutoEffect, settings: BackgroundAutoSettings, effectIndex: number): BackgroundAutoEffect {
  const target = effect.detectionId ? settings.detections.find((detection) => detection.id === effect.detectionId) : undefined;
  const palette = target ? detectionPalette(target, settings.palette) : completeBackgroundAutoPalette(settings.palette, settings.palette);
  return { ...effect, placementMode: effect.placementMode ?? (effect.detectionId ? "detected" : "manual"), centerX: effect.centerX ?? .5, centerY: effect.centerY ?? .5, diameter: effect.diameter ?? .42, radialSpectrumEnabled: effect.radialSpectrumEnabled ?? true, centerSpectrumEnabled: effect.centerSpectrumEnabled ?? true, stereoSidesEnabled: effect.stereoSidesEnabled ?? true, subtitlesEnabled: effect.subtitlesEnabled ?? false, palette, color: palette[effectIndex % palette.length] ?? palette[0] };
}

/** Keeps effect foreign keys valid after a new detection snapshot. Null is
 * accepted only as a legacy input and is assigned deterministically to the
 * first detection; explicit dangling references are cascaded out. */
export function reconcileBackgroundAutoEffects(settings: BackgroundAutoSettings): BackgroundAutoEffect[] {
  const eligible = settings.detections;
  const eligibleIds = new Set(eligible.map((detection) => detection.id));
  return settings.effects.flatMap((effect) => {
    if (effect.detectionId && !eligibleIds.has(effect.detectionId)) return [];
    // Null targets remain disabled editor placeholders; never infer a target
    // from array position because animation is an explicit user choice.
    const placementMode = effect.placementMode ?? (effect.detectionId ? "detected" : "manual");
    return [{ ...effect, placementMode, centerX: effect.centerX ?? .5, centerY: effect.centerY ?? .5, diameter: effect.diameter ?? .42, radialSpectrumEnabled: effect.radialSpectrumEnabled ?? true, centerSpectrumEnabled: effect.centerSpectrumEnabled ?? true, stereoSidesEnabled: effect.stereoSidesEnabled ?? true, subtitlesEnabled: effect.subtitlesEnabled ?? false, detectionId: placementMode === "manual" ? null : effect.detectionId ?? null, enabled: placementMode === "manual" ? effect.enabled : effect.detectionId ? effect.enabled : false }];
  });
}
function defaultProSubtitleCueStyle(
  settings: ProSubtitleSettings,
  cue: Pick<SubtitleCue, "id" | "text" | "startSeconds" | "endSeconds">,
  cueIndex = 0,
  previousAnimation?: ProSubtitleCueStyle["animation"]
): ProSubtitleCueStyle {
  const animation = settings.autoVaryAnimations
    ? directProSubtitleAnimation(cue, cueIndex, previousAnimation)
    : settings.defaultAnimation;
  return {
    cueId: cue.id,
    animation,
    animationAutomatic: true,
    fontFamily: settings.defaultFontFamily,
    fontFamilyAutomatic: true,
    fontSize: settings.defaultFontSize,
    fontSizeAutomatic: true,
    positionX: settings.positionX,
    positionY: settings.positionY,
    positionAutomatic: true,
    opacity: settings.opacity,
    opacityAutomatic: true,
    shadowEnabled: settings.shadowEnabled,
    shadowColor: settings.shadowColor,
    wordStyles: []
  };
}
function ensureProSubtitleCueStyles(settings: ProSubtitleSettings, cues: RhythmBallProject["subtitles"]["cues"]): ProSubtitleCueStyle[] {
  let previousAnimation: ProSubtitleCueStyle["animation"] | undefined;
  return cues.map((cue, index) => {
    const fallback = defaultProSubtitleCueStyle(settings, cue, index, previousAnimation);
    const source = settings.cueStyles.find((candidate) => candidate.cueId === cue.id);
    const style = source ? { ...fallback, ...source } : fallback;
    previousAnimation = style.animation;
    return style;
  });
}
function mixHexColor(source: string, target: string, amount: number): string {
  const parse = (value: string) => /^#[0-9a-f]{6}$/i.test(value)
    ? [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)]
    : null;
  const left = parse(source); const right = parse(target);
  if (!left || !right) return source;
  return `#${left.map((channel, index) => Math.round(channel + ((right[index] ?? channel) - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}
function completeProSubtitlePalette(colors: readonly string[], fallback: readonly [string, string, string]): [string, string, string] {
  const primary = colors[0] ?? fallback[0];
  const primaryChannels = /^#[0-9a-f]{6}$/i.test(primary)
    ? [Number.parseInt(primary.slice(1, 3), 16), Number.parseInt(primary.slice(3, 5), 16), Number.parseInt(primary.slice(5, 7), 16)]
    : [0, 0, 0];
  const contrast = primaryChannels.reduce((sum, channel) => sum + channel, 0) / 3 > 145 ? "#080a12" : "#f6f7fb";
  const secondary = colors[1] ?? mixHexColor(primary, contrast, .34);
  const accent = colors[2] ?? mixHexColor(colors[1] ?? primary, contrast, colors[1] ? .38 : .62);
  return [primary, secondary, accent];
}

type VideoEditorSettings = import("../services/video-editor").VideoEditorSettings;
/** Ogni mutazione del Video Editor passa da qui: un solo punto in cui il progetto resta coerente. */
function normalizeVideoEditorForProject(videoEditor: VideoEditorSettings): RhythmBallProject["animation"]["videoEditor"] {
  return {
    ...videoEditor,
    assets: videoEditor.assets.map((asset) => ({
      ...asset,
      sourceFrameCount: asset.sourceFrameCount ?? (asset.kind === "video" && asset.durationSeconds > 0 ? Math.max(1, Math.round(asset.durationSeconds * (asset.sourceRate?.numerator ?? 60) / (asset.sourceRate?.denominator ?? 1))) : 0),
      sourceRate: asset.sourceRate ?? { numerator: 60, denominator: 1 },
      frameIdentityId: asset.frameIdentityId ?? null,
      timingMode: asset.timingMode ?? "constant"
    })),
    clips: videoEditor.clips.map((clip) => ({
      ...clip,
      reversed: clip.reversed ?? false,
      speed: clip.speed ?? { mode: "constant" as const, constant: 1, points: [], preservePitch: false },
      imageShadow: { ...defaultVideoEditorImageShadow, ...(clip.imageShadow ?? {}) }
    }))
  };
}

function videoEditorState(state: ProjectState, videoEditor: VideoEditorSettings, status?: string): Partial<ProjectState> {
  const normalized = normalizeVideoEditorForProject(videoEditor);
  return {
    project: { ...state.project, animation: { ...state.project.animation, videoEditor: normalized } },
    videoEditorHistory: [...state.videoEditorHistory, state.project.animation.videoEditor].slice(-100),
    videoEditorFuture: [],
    dirty: true,
    ...(status ? { status } : {})
  };
}
function videoEditorTrackIsLocked(settings: VideoEditorSettings, trackId: string): boolean {
  return settings.tracks.find((track) => track.id === trackId)?.locked === true;
}
function videoEditorClipIsLocked(settings: VideoEditorSettings, clipId: string): boolean {
  const clip = findVideoEditorClip(settings, clipId);
  return clip ? videoEditorTrackIsLocked(settings, clip.trackId) : false;
}
function videoEditorEffectIsLocked(settings: VideoEditorSettings, effect: VideoEditorEffectClip): boolean {
  return effect.target.kind === "clip" && videoEditorClipIsLocked(settings, effect.target.clipId);
}
function defaultVideoEditorClip(id: string, asset: VideoEditorAsset, placement: { trackId: string; startSeconds: number; durationSeconds: number }): VideoEditorClip {
  return {
    id, assetId: asset.id, trackId: placement.trackId,
    startSeconds: placement.startSeconds, durationSeconds: placement.durationSeconds, sourceInSeconds: 0,
    reversed: false,
    fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth",
    audioFadeInSeconds: 0, audioFadeOutSeconds: 0,
    blendMode: "normal", blendIntensity: 1,
    speed: { mode: "constant", constant: 1, points: [], preservePitch: false },
    adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1 },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    imageShadow: { ...defaultVideoEditorImageShadow },
    // Un fermo immagine trasparente deve mostrare tutto il canvas senza crop:
    // i video conservano il comportamento storico cover.
    fit: asset.kind === "image" ? "contain" : "cover", muted: false, volume: 1
  };
}

function hydrateVideoEditorAsset(asset: VideoEditorAsset): RhythmBallProject["animation"]["videoEditor"]["assets"][number] {
  return {
    ...asset,
    sourceFrameCount: asset.sourceFrameCount ?? (asset.kind === "video" && asset.durationSeconds > 0 ? Math.max(1, Math.round(asset.durationSeconds * (asset.sourceRate?.numerator ?? 60) / (asset.sourceRate?.denominator ?? 1))) : 0),
    sourceRate: asset.sourceRate ?? { numerator: 60, denominator: 1 },
    frameIdentityId: asset.frameIdentityId ?? null,
    timingMode: asset.timingMode ?? "constant"
  };
}
/** Riporta la clip dentro i limiti dello schema: durata utile, sorgente disponibile, dissolvenze compatibili. */
function clampVideoEditorClip(clip: VideoEditorClip, asset: VideoEditorAsset | null, timebase: VideoEditorSettings["timebase"] = { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false }): VideoEditorClip {
  const still = videoEditorAssetIsStill(asset);
  const sourceInSeconds = still ? 0 : Math.max(0, Math.min(asset!.durationSeconds - videoEditorMinimumClipSeconds, clip.sourceInSeconds));
  const maximum = videoEditorClipMaximumDuration({ ...clip, sourceInSeconds }, asset, timebase);
  const durationSeconds = Math.max(videoEditorMinimumClipSeconds, Math.min(maximum, clip.durationSeconds || videoEditorDefaultImageSeconds));
  const limitFades = (inSeconds: number, outSeconds: number): [number, number] => {
    const fadeIn = Math.max(0, Math.min(durationSeconds, inSeconds));
    // La coda non può invadere la testa: insieme devono stare nella clip.
    const fadeOut = Math.max(0, Math.min(durationSeconds - fadeIn, outSeconds));
    return [fadeIn, fadeOut];
  };
  const [fadeInSeconds, fadeOutSeconds] = limitFades(clip.fadeInSeconds, clip.fadeOutSeconds);
  const [audioFadeInSeconds, audioFadeOutSeconds] = limitFades(clip.audioFadeInSeconds, clip.audioFadeOutSeconds);
  return {
    ...clip,
    startSeconds: Math.max(0, clip.startSeconds),
    durationSeconds, sourceInSeconds,
    fadeInSeconds, fadeOutSeconds, audioFadeInSeconds, audioFadeOutSeconds,
    blendIntensity: Math.max(0, Math.min(1, clip.blendIntensity)),
    volume: Math.max(0, Math.min(2, clip.volume))
  };
}

function reconcileVideoEditorEffects(settings: VideoEditorSettings, effects: readonly VideoEditorEffectClip[]): VideoEditorEffectClip[] {
  const candidate = { ...settings, effectClips: [...effects] };
  return effects.map((effect) => videoEditorClampEffect(candidate, effect)).filter((effect): effect is VideoEditorEffectClip => effect !== null);
}

function moveTargetEffects(settings: VideoEditorSettings, clips: readonly VideoEditorClip[]): VideoEditorEffectClip[] {
  const starts = new Map(clips.map((clip) => [clip.id, clip.startSeconds]));
  const shifted = settings.effectClips.map((effect) => {
    if (effect.target.kind !== "clip") return effect;
    const targetClipId = effect.target.clipId;
    const before = settings.clips.find((clip) => clip.id === targetClipId);
    const after = starts.get(targetClipId);
    return before && typeof after === "number" ? { ...effect, startSeconds: effect.startSeconds + after - before.startSeconds } : effect;
  });
  return reconcileVideoEditorEffects({ ...settings, clips: [...clips] }, shifted);
}

function clampSongPlayerOffset(offsetMs: number, fullTrackDurationSeconds: number | null, fragmentDurationSeconds: number): number {
  return songPlayerPersistedOffsetMs(offsetMs, fragmentDurationSeconds, fullTrackDurationSeconds);
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createProject(), filePath: null, dirty: false, status: "Pronto", eventHistory: [], eventFuture: [], videoEditorHistory: [], videoEditorFuture: [], selectedEventId: null, selectedEventIds: [],
  newProject: () => set({ project: createProject(), filePath: null, dirty: false, status: "Nuovo progetto creato", eventHistory: [], eventFuture: [], videoEditorHistory: [], videoEditorFuture: [], selectedEventId: null, selectedEventIds: [] }),
  setProject: (project, filePath) => set({ project: { ...project, animation: { ...project.animation, backgroundAuto: normalizeBackgroundAutoSettings(project.animation.backgroundAuto) } }, filePath, dirty: false, status: "Progetto caricato", eventHistory: [], eventFuture: [], videoEditorHistory: [], videoEditorFuture: [], selectedEventId: null, selectedEventIds: [] }),
  renameProject: (name) => set((state) => ({ project: { ...state.project, project: { ...state.project.project, name } }, dirty: true })),
  attachAudio: (metadata, waveform, options = {}) => set((state) => {
    const preserveSubtitleTrack = options.preserveSubtitleTrack === true;
    const songPlayer = state.project.animation.songPlayer;
    const selectedFullTrack = songPlayer.fullTrackAssetId ? songPlayer.assets.find((asset) => asset.id === songPlayer.fullTrackAssetId) : undefined;
    const selectedOffsetMs = clampSongPlayerOffset(songPlayer.match.selectedOffsetMs, selectedFullTrack?.durationSeconds ?? null, metadata.durationSeconds);
    const fragmentChanged = Boolean(songPlayer.match.fragmentHash) && songPlayer.match.fragmentHash !== metadata.hash;
    const songPlayerMatch = fragmentChanged
      ? { ...songPlayer.match, selectedOffsetMs, state: "idle" as const, resolution: "auto" as const, fragmentHash: "", fullTrackHash: "", confidence: 0, candidates: [], error: "Il frammento audio è cambiato." }
      : { ...songPlayer.match, selectedOffsetMs };
    return {
      project: {
        ...state.project,
        audio: { sourcePath: metadata.path, storage: "external", hash: metadata.hash, durationSeconds: metadata.durationSeconds, sampleRate: metadata.sampleRate, channels: metadata.channels, globalOffsetMs: 0 },
        analysis: { ...state.project.analysis, waveform },
        animation: {
          ...state.project.animation,
          songPlayer: { ...songPlayer, match: songPlayerMatch },
          teddySing: { ...state.project.animation.teddySing, phonemesGenerated: false, phonemeCues: [] },
          proSubtitles: preserveSubtitleTrack
            ? state.project.animation.proSubtitles
            : { ...state.project.animation.proSubtitles, cueStyles: [] }
        },
        subtitles: preserveSubtitleTrack
          ? state.project.subtitles
          : { ...state.project.subtitles, cues: [] }
      },
      dirty: true,
      status: `${metadata.fileName} importato`
    };
  }),
  applyAnalysis: (result) => set((state) => { const events = buildPrimaryBeatEvents(result); return {
    project: { ...state.project, analysis: { ...state.project.analysis, analyzerVersion: result.analyzerVersion, cacheKey: `${state.project.audio.hash}:${result.analyzerVersion}`, globalBpm: result.globalBpm, localTempo: result.localTempo, segments: result.lowEnergySegments }, events },
    dirty: true, status: analysisSummary(result, events), eventHistory: [...state.eventHistory, state.project.events], eventFuture: []
  }; }),
  setAspectRatio: (aspectRatio) => set((state) => { const presets: Record<string,[number,number,number,number]>={"9:16":[540,960,1080,1920],"16:9":[960,540,1920,1080],"1:1":[720,720,1080,1080],"4:5":[648,810,1080,1350]};const preset=presets[aspectRatio]??[state.project.canvas.previewWidth,state.project.canvas.previewHeight,state.project.canvas.exportWidth,state.project.canvas.exportHeight];return { project: { ...state.project, canvas: { ...state.project.canvas, aspectRatio, previewWidth:preset[0],previewHeight:preset[1],exportWidth:preset[2],exportHeight:preset[3] } }, dirty: true };}),
  setCanvasFormat: ({ aspectRatio, width, height }) => set((state) => {
    const presets: Record<string, [number, number, number, number]> = { "9:16": [540, 960, 1080, 1920], "16:9": [960, 540, 1920, 1080], "1:1": [720, 720, 1080, 1080], "4:5": [648, 810, 1080, 1350] };
    const preset = presets[aspectRatio]; const previewWidth = width ?? preset?.[0] ?? state.project.canvas.previewWidth; const previewHeight = height ?? preset?.[1] ?? state.project.canvas.previewHeight; const exportWidth = preset?.[2] ?? Math.max(64, width ?? state.project.canvas.exportWidth); const exportHeight = preset?.[3] ?? Math.max(64, height ?? state.project.canvas.exportHeight);
    return { project: { ...state.project, canvas: { ...state.project.canvas, aspectRatio, previewWidth, previewHeight, exportWidth, exportHeight } }, dirty: true };
  }),
  registerSongPlayerFullTrack: (asset) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...state.project.animation.songPlayer, assets: [...state.project.animation.songPlayer.assets.filter((item) => item.id !== asset.id), asset].slice(-8), fullTrackAssetId: asset.id, match: { ...state.project.animation.songPlayer.match, selectedOffsetMs: clampSongPlayerOffset(state.project.animation.songPlayer.match.selectedOffsetMs, asset.durationSeconds, state.project.audio.durationSeconds), state: "idle", resolution: "auto", fragmentHash: "", fullTrackHash: "", confidence: 0, candidates: [], error: null } } } }, dirty: true, status: `${asset.fileName} registrata come traccia completa` })),
  removeSongPlayerAsset: (assetId) => set((state) => { const settings = state.project.animation.songPlayer; const assets = settings.assets.filter((asset) => asset.id !== assetId); const selected = settings.fullTrackAssetId === assetId; return { project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...settings, assets, fullTrackAssetId: selected ? null : settings.fullTrackAssetId, match: selected ? { ...settings.match, selectedOffsetMs: 0, state: "idle", resolution: "auto", fragmentHash: "", fullTrackHash: "", confidence: 0, candidates: [], error: null } : settings.match } } }, dirty: true }; }),
  updateSongPlayer: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...state.project.animation.songPlayer, ...patch } } }, dirty: true })),
  updateCassetteDesk: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, cassetteDesk: { ...state.project.animation.cassetteDesk, ...patch } } }, dirty: true })),
  applyCassetteDeskExtractedPalette: (colors) => set((state) => { const settings = state.project.animation.cassetteDesk; if (!settings.autoPalette) return state; const palette = [colors[0] ?? settings.palette[0], colors[1] ?? settings.palette[1], colors[2] ?? settings.palette[2]] as [string, string, string]; return { project: { ...state.project, animation: { ...state.project.animation, cassetteDesk: { ...settings, palette } } }, dirty: true }; }),
  setSongPlayerPalette: (colors) => set((state) => { const settings = state.project.animation.songPlayer; const palette = [colors[0] ?? settings.palette[0], colors[1] ?? settings.palette[1], colors[2] ?? settings.palette[2]] as [string, string, string]; return { project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...settings, palette, autoPalette: false } } }, dirty: true }; }),
  applySongPlayerExtractedPalette: (colors) => set((state) => { const settings = state.project.animation.songPlayer; if (!settings.autoPalette) return state; const palette = [colors[0] ?? settings.palette[0], colors[1] ?? settings.palette[1], colors[2] ?? settings.palette[2]] as [string, string, string]; return { project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...settings, palette } } }, dirty: true }; }),
  setSongPlayerMatch: (match) => set((state) => { const settings = state.project.animation.songPlayer; const asset = settings.fullTrackAssetId ? settings.assets.find((item) => item.id === settings.fullTrackAssetId) : undefined; if ((match.fragmentHash && match.fragmentHash !== state.project.audio.hash) || (match.fullTrackHash && match.fullTrackHash !== asset?.hash)) return { status: "Matching ignorato: hash non coerenti" }; const selectedOffsetMs = clampSongPlayerOffset(match.selectedOffsetMs, asset?.durationSeconds ?? null, state.project.audio.durationSeconds); return { project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...settings, match: { ...match, selectedOffsetMs } } } }, dirty: true }; }),
  cancelSongPlayerMatch: (owner) => set((state) => {
    const settings = state.project.animation.songPlayer; const asset = settings.fullTrackAssetId ? settings.assets.find((item) => item.id === settings.fullTrackAssetId) : undefined;
    if (state.project.project.id !== owner.projectId || owner.fragmentHash !== state.project.audio.hash || owner.fullTrackHash !== asset?.hash || settings.match.state !== "running") return state;
    return { project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...settings, match: { ...settings.match, state: "idle", resolution: "auto", confidence: 0, candidates: [], error: null } } } }, dirty: true, status: "Matching Song Player annullato" };
  }),
  setSongPlayerManualOffset: (offsetMs) => set((state) => { const settings = state.project.animation.songPlayer; const selected = settings.fullTrackAssetId ? settings.assets.find((asset) => asset.id === settings.fullTrackAssetId) : null; const clamped = clampSongPlayerOffset(offsetMs, selected?.durationSeconds ?? null, state.project.audio.durationSeconds); return { project: { ...state.project, animation: { ...state.project.animation, songPlayer: { ...settings, match: { ...settings.match, state: "manual", resolution: "manual", selectedOffsetMs: clamped, confidence: 0, candidates: [], error: null, fragmentHash: state.project.audio.hash, fullTrackHash: selected?.hash ?? "" } } } }, dirty: true, status: `Offset manuale ${clamped} ms` }; }),
  setAnimationMode: (modeId, baseObjectTypes) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, modeId, baseObjectTypes: [...baseObjectTypes] } }, dirty: true, status: `Modalità ${modeId} configurata · rigenera la base` })),
  setBaseObjectEnabled: (type, enabled) => set((state) => { const current = state.project.animation.baseObjectTypes; const next = enabled ? current.includes(type) ? current : [...current, type] : current.length > 1 ? current.filter((item) => item !== type) : current; return { project: { ...state.project, animation: { ...state.project.animation, baseObjectTypes: next } }, dirty: true, status: "Elementi base aggiornati · rigenera la scena per applicarli" }; }),
  setNewYorkMarbleCount: (secondaryMarbleCount) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, newYorkStreets: { ...state.project.animation.newYorkStreets, secondaryMarbleCount: Math.max(1, Math.min(13, Math.round(secondaryMarbleCount))) } } }, dirty: true })),
  setNewYorkGroupColor: (secondaryGroupColor) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, newYorkStreets: { ...state.project.animation.newYorkStreets, secondaryGroupColor, secondaryColors: Array.from({ length: 13 }, () => secondaryGroupColor) } } }, dirty: true })),
  setNewYorkMarbleColor: (index, color) => set((state) => { const settings = state.project.animation.newYorkStreets; const secondaryColors = Array.from({ length: 13 }, (_, itemIndex) => settings.secondaryColors[itemIndex] ?? settings.secondaryGroupColor); if (index >= 0 && index < secondaryColors.length) secondaryColors[index] = color; return { project: { ...state.project, animation: { ...state.project.animation, newYorkStreets: { ...settings, secondaryColors } } }, dirty: true }; }),
  addNewYorkFlyers: (imageUrls) => set((state) => { const settings = state.project.animation.newYorkStreets; return { project: { ...state.project, animation: { ...state.project.animation, newYorkStreets: { ...settings, flyerImageUrls: [...settings.flyerImageUrls, ...imageUrls].slice(0, 8) } } }, dirty: true, status: "Volantini aggiunti a strada e fognature" }; }),
  removeNewYorkFlyer: (index) => set((state) => { const settings = state.project.animation.newYorkStreets; return { project: { ...state.project, animation: { ...state.project.animation, newYorkStreets: { ...settings, flyerImageUrls: settings.flyerImageUrls.filter((_, itemIndex) => itemIndex !== index) } } }, dirty: true }; }),
  updateCoverSphere: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, coverSphere: { ...state.project.animation.coverSphere, ...patch } } }, dirty: true })),
  setCoverSphereAutoPalette: (enabled) => set((state) => { const settings = state.project.animation.coverSphere; const coverSphere = { ...settings, autoPalette: enabled, ...(enabled ? { spectrumColor: settings.palettePrimary, effectColor: settings.paletteSecondary } : {}) }; return { project: { ...state.project, animation: { ...state.project.animation, coverSphere } }, dirty: true, status: enabled ? "Palette automatica riapplicata alle 48 bande" : "Colori delle bande sbloccati per la modifica manuale" }; }),
  setCoverSpherePalette: (colors) => set((state) => { const primary = colors[0]; const secondary = colors[1] ?? primary; const settings = state.project.animation.coverSphere; const subtitles = state.project.subtitles.autoPalette && primary ? { ...state.project.subtitles, color: primary, glowColor: secondary ?? primary } : state.project.subtitles; const coverSphere = primary ? { ...settings, palettePrimary: primary, paletteSecondary: secondary ?? primary, ...(settings.autoPalette ? { spectrumColor: primary, effectColor: secondary ?? primary } : {}) } : settings; return { project: { ...state.project, animation: { ...state.project.animation, coverSphere }, subtitles }, dirty: true, status: settings.autoPalette ? "Palette cover applicata alle 48 bande e agli effetti" : "Palette cover memorizzata · colori manuali conservati" }; }),
  addCoverSphereFlyers: (imageUrls) => set((state) => { const settings = state.project.animation.coverSphere; return { project: { ...state.project, animation: { ...state.project.animation, coverSphere: { ...settings, flyerImageUrls: [...settings.flyerImageUrls, ...imageUrls].slice(0, 8), effects: { ...settings.effects, flyers: true } } } }, dirty: true, status: "Volantini aggiunti al visualizer" }; }),
  removeCoverSphereFlyer: (index) => set((state) => { const settings = state.project.animation.coverSphere; return { project: { ...state.project, animation: { ...state.project.animation, coverSphere: { ...settings, flyerImageUrls: settings.flyerImageUrls.filter((_, itemIndex) => itemIndex !== index) } } }, dirty: true }; }),
  updateStereoUnfold: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, stereoUnfold: { ...state.project.animation.stereoUnfold, ...patch } } }, dirty: true })),
  setStereoUnfoldPalette: (colors) => set((state) => { const settings = state.project.animation.stereoUnfold; const primary = colors[0] ?? settings.palettePrimary; const secondary = colors[1] ?? colors[2] ?? primary; const stereoUnfold = { ...settings, palettePrimary: primary, paletteSecondary: secondary, ...(settings.autoPalette ? { primaryColor: primary, secondaryColor: secondary } : {}) }; const subtitles = state.project.subtitles.autoPalette ? { ...state.project.subtitles, color: primary, glowColor: secondary } : state.project.subtitles; return { project: { ...state.project, animation: { ...state.project.animation, stereoUnfold }, subtitles }, dirty: true, status: settings.autoPalette ? "Palette cover applicata alla scena Stereo Unfold" : "Palette Stereo Unfold memorizzata" }; }),
  setStereoUnfoldAutoPalette: (enabled) => set((state) => { const settings = state.project.animation.stereoUnfold; const stereoUnfold = { ...settings, autoPalette: enabled, ...(enabled ? { primaryColor: settings.palettePrimary, secondaryColor: settings.paletteSecondary } : {}) }; return { project: { ...state.project, animation: { ...state.project.animation, stereoUnfold } }, dirty: true }; }),
  updateWalkingCube: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, walkingCube: { ...state.project.animation.walkingCube, ...patch } } }, dirty: true })),
  setWalkingCubePalette: (colors) => set((state) => {
    const settings = state.project.animation.walkingCube; const primary = colors[0] ?? settings.palettePrimary; const secondary = colors[1] ?? colors[2] ?? primary; const accent = colors[2] ?? colors[3] ?? secondary;
    const walkingCube = { ...settings, palettePrimary: primary, paletteSecondary: secondary, paletteAccent: accent };
    const subtitles = state.project.subtitles.autoPalette ? { ...state.project.subtitles, color: primary, glowColor: accent } : state.project.subtitles;
    return { project: { ...state.project, animation: { ...state.project.animation, walkingCube }, subtitles }, dirty: true, status: "Palette immagine applicata a cubo, vetro e campo audiovisivo" };
  }),
  updatePortraitLandscape: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, portraitLandscape: { ...state.project.animation.portraitLandscape, ...patch } } }, dirty: true })),
  setPortraitLandscapePalette: (colors) => set((state) => {
    const settings = state.project.animation.portraitLandscape;
    const palette = [colors[0] ?? settings.palette[0], colors[1] ?? settings.palette[1], colors[2] ?? settings.palette[2]] as [string, string, string];
    const effectColors = settings.autoPalette ? { ...settings.effectColors, lightning: palette[0], particles: palette[0] } : settings.effectColors;
    return { project: { ...state.project, animation: { ...state.project.animation, portraitLandscape: { ...settings, palette, effectColors } } }, dirty: true, status: "Palette cover applicata a cubo, spettrogramma ed effetti" };
  }),
  updateTeddyWalk: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, teddyWalk: { ...state.project.animation.teddyWalk, ...patch } } }, dirty: true })),
  setTeddyWalkPalette: (colors) => set((state) => { const settings = state.project.animation.teddyWalk; return { project: { ...state.project, animation: { ...state.project.animation, teddyWalk: { ...settings, furColor: colors[0] ?? settings.furColor, patchColor: colors[1] ?? colors[0] ?? settings.patchColor, roadColor: colors[2] ?? colors[1] ?? settings.roadColor } } }, dirty: true }; }),
  updateTeddySing: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, teddySing: { ...state.project.animation.teddySing, ...patch } } }, dirty: true })),
  updateProSubtitles: (patch) => set((state) => {
    const settings = state.project.animation.proSubtitles;
    const nextSettings = { ...settings, ...patch };
    const fontFamilyChanged = Object.prototype.hasOwnProperty.call(patch, "defaultFontFamily");
    const fontSizeChanged = Object.prototype.hasOwnProperty.call(patch, "defaultFontSize");
    const positionChanged = Object.prototype.hasOwnProperty.call(patch, "positionX")
      || Object.prototype.hasOwnProperty.call(patch, "positionY");
    const opacityChanged = Object.prototype.hasOwnProperty.call(patch, "opacity");
    const cueStyles = (patch.cueStyles ?? settings.cueStyles).map((style) => ({
      ...style,
      fontFamilyAutomatic: style.fontFamilyAutomatic ?? true,
      fontSizeAutomatic: style.fontSizeAutomatic ?? true,
      positionX: style.positionX ?? nextSettings.positionX,
      positionY: style.positionY ?? nextSettings.positionY,
      positionAutomatic: style.positionAutomatic ?? true,
      opacity: style.opacity ?? nextSettings.opacity,
      opacityAutomatic: style.opacityAutomatic ?? true,
      ...(fontFamilyChanged && style.fontFamilyAutomatic !== false
        ? { fontFamily: nextSettings.defaultFontFamily }
        : {}),
      ...(fontSizeChanged && style.fontSizeAutomatic !== false
        ? { fontSize: nextSettings.defaultFontSize }
        : {}),
      ...(positionChanged && style.positionAutomatic !== false
        ? { positionX: nextSettings.positionX, positionY: nextSettings.positionY }
        : {}),
      ...(opacityChanged && style.opacityAutomatic !== false
        ? { opacity: nextSettings.opacity }
        : {})
    }));
    return {
      project: {
        ...state.project,
        animation: {
          ...state.project.animation,
          proSubtitles: { ...nextSettings, cueStyles }
        }
      },
      dirty: true
    };
  }),
  setProSubtitlesPalette: (colors) => set((state) => {
    const settings = state.project.animation.proSubtitles;
    const palette = completeProSubtitlePalette(colors, settings.palette);
    const cueStyles = settings.cueStyles.map((cueStyle) => ({
      ...cueStyle,
      wordStyles: cueStyle.wordStyles.map((wordStyle) => {
        const paletteIndex = settings.palette.findIndex((color) => color.trim().toLowerCase() === wordStyle.color.trim().toLowerCase());
        return paletteIndex < 0 ? wordStyle : { ...wordStyle, color: palette[paletteIndex] ?? palette[0] };
      })
    }));
    return { project: { ...state.project, animation: { ...state.project.animation, proSubtitles: { ...settings, palette, cueStyles } } }, dirty: true, status: "Palette a 3 colori applicata a Pro Subtitles" };
  }),
  updatePixelsSub: (patch) => set((state) => ({
    project: { ...state.project, animation: { ...state.project.animation, pixelsSub: { ...state.project.animation.pixelsSub, ...patch } } },
    dirty: true
  })),
  setPixelsSubPalette: (colors) => set((state) => {
    const settings = state.project.animation.pixelsSub;
    const current = settings.palette;
    const palette = [colors[0] ?? current[0], colors[1] ?? colors[0] ?? current[1], colors[2] ?? colors[1] ?? colors[0] ?? current[2]] as [string, string, string];
    const shadowFollowedPalette = settings.subtitleShadowColor.trim().toLowerCase() === current[0].trim().toLowerCase();
    return { project: { ...state.project, animation: { ...state.project.animation, pixelsSub: { ...settings, palette, subtitleShadowColor: shadowFollowedPalette ? palette[0] : settings.subtitleShadowColor } } }, dirty: true, status: "Palette a 3 colori applicata a Pixels Subtitles" };
  }),
  updateBackgroundAuto: (patch) => set((state) => {
    const current = state.project.animation.backgroundAuto;
    const next = {
      ...current,
      ...patch,
      detections: "detections" in patch
        ? patch.detections.map((detection) => normalizeBackgroundAutoDetection(detection, current.palette))
        : current.detections
    };
    const shouldReconcile = Object.prototype.hasOwnProperty.call(patch, "detections");
    const backgroundAuto = shouldReconcile ? { ...next, effects: reconcileBackgroundAutoEffects(next).map((effect, index) => effect.paletteMode === "auto" ? autoBackgroundEffect(effect, next, index) : effect) } : next;
    return { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto } }, dirty: true };
  }),
  setBackgroundAutoPalette: (colors) => set((state) => {
    const settings = state.project.animation.backgroundAuto;
    const palette = completeBackgroundAutoPalette(colors, settings.palette);
    const detections = settings.detections.map((detection) => detection.paletteMode === "manual" ? detection : { ...detection, paletteMode: "auto" as const, palette });
    const next = { ...settings, palette, detections };
    const effects = settings.effects.map((effect, index) => effect.paletteMode === "auto" ? autoBackgroundEffect(effect, next, index) : effect);
    return { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto: { ...next, effects } } }, dirty: true, status: "Palette applicata agli oggetti automatici e ai Circular Spectrum" };
  }),
  setBackgroundAutoDetections: (detections) => set((state) => {
    const current = state.project.animation.backgroundAuto;
    const normalizedDetections: BackgroundAutoSettings["detections"] = detections.map((detection) => normalizeBackgroundAutoDetection(detection, current.palette));
    const next = { ...current, detections: normalizedDetections, personAnimationEnabled: false };
    const effects = reconcileBackgroundAutoEffects(next).map((effect, index) => effect.paletteMode === "auto" ? autoBackgroundEffect(effect, next, index) : effect);
    return { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto: { ...next, effects } } }, dirty: true };
  }),
  patchBackgroundAutoDetection: (id, patch) => set((state) => {
    const settings = state.project.animation.backgroundAuto;
    if (!settings.detections.some((detection) => detection.id === id)) return state;
    const detections = settings.detections.map((detection) => detection.id === id
      ? (() => {
        const paletteWasEdited = patch.palette !== undefined;
        const paletteMode = patch.paletteMode ?? (paletteWasEdited ? "manual" : detection.paletteMode ?? "auto");
        const palette = paletteMode === "auto"
          ? settings.palette
          : completeBackgroundAutoPalette(patch.palette ?? detection.palette ?? settings.palette, settings.palette);
        return { ...detection, ...patch, alias: patch.alias === undefined ? detection.alias || detection.label : patch.alias.trim() || detection.label, paletteMode, palette };
      })()
      : detection);
    const next = { ...settings, detections };
    const effects = settings.effects.map((effect, index) => effect.paletteMode === "auto" && effect.detectionId === id ? autoBackgroundEffect(effect, next, index) : effect);
    return { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto: { ...next, effects } } }, dirty: true };
  }),
  toggleBackgroundAutoDetectionAnimation: (id) => set((state) => {
    const settings = state.project.animation.backgroundAuto;
    if (!settings.detections.some((detection) => detection.id === id)) return state;
    const matching = settings.effects.filter((effect) => effect.detectionId === id);
    let effects = settings.effects;
    if (matching.length) {
      const enable = !matching.some((effect) => effect.enabled);
      effects = settings.effects.map((effect) => effect.detectionId === id ? { ...effect, enabled: enable } : effect);
    } else {
      const placeholderIndex = settings.effects.findIndex((effect) => effect.detectionId === null);
      if (placeholderIndex >= 0) {
        effects = settings.effects.map((effect, index) => index === placeholderIndex
          ? autoBackgroundEffect({ ...effect, detectionId: id, enabled: true }, settings, index)
          : effect);
      }
      else if (settings.effects.length < 16) {
      const index = settings.effects.length;
      const target = settings.detections.find((detection) => detection.id === id);
      const targetPalette = target ? detectionPalette(target, settings.palette) : settings.palette;
      const color = targetPalette[index % targetPalette.length] ?? targetPalette[0];
      effects = [...settings.effects, { id: `circular-spectrum-${index + 1}-${crypto.randomUUID()}`, type: "circularSpectrum" as const, label: "Circular Spectrum" as const, enabled: true, placementMode: "detected" as const, detectionId: id, centerX: .5, centerY: .5, diameter: .42, paletteMode: "auto" as const, color, palette: targetPalette, intensity: 1, scale: 1, opacity: .9, rotationSpeed: .08, collisionParticles: true, centerSpectrumEnabled: true, stereoSidesEnabled: true, subtitlesEnabled: false, radialSpectrumEnabled: true }];
    }
    }
    return effects === settings.effects ? state : { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto: { ...settings, effects, personAnimationEnabled: false } } }, dirty: true };
  }),
  addBackgroundAutoEffect: () => set((state) => {
    const settings = state.project.animation.backgroundAuto; if (settings.effects.length >= 16) return state;
    const index = settings.effects.length; const color = settings.palette[index % settings.palette.length] ?? settings.palette[0];
    const effect = { id: `circular-spectrum-${index + 1}-${crypto.randomUUID()}`, type: "circularSpectrum" as const, label: "Circular Spectrum" as const, enabled: false, placementMode: "manual" as const, detectionId: null, centerX: .5, centerY: .5, diameter: .42, paletteMode: "auto" as const, color, palette: settings.palette, intensity: 1, scale: 1, opacity: .9, rotationSpeed: .08, collisionParticles: true, centerSpectrumEnabled: true, stereoSidesEnabled: true, subtitlesEnabled: false, radialSpectrumEnabled: true };
    return { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto: { ...settings, effects: [...settings.effects, effect] } } }, dirty: true };
  }),
  removeBackgroundAutoEffect: (id) => set((state) => {
    const settings = state.project.animation.backgroundAuto; if (settings.effects.length <= 1) return state;
    return { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto: { ...settings, effects: settings.effects.filter((effect) => effect.id !== id) } } }, dirty: true };
  }),
  updateBackgroundAutoEffect: (id, patch) => set((state) => {
    const settings = state.project.animation.backgroundAuto;
    const allowed = new Set(settings.detections.map((detection) => detection.id));
    const safePatch = patch.detectionId && !allowed.has(patch.detectionId) ? { ...patch, detectionId: null } : patch;
    const effects = settings.effects.map((effect) => {
      if (effect.id !== id) return effect;
      const paletteMode = safePatch.paletteMode ?? effect.paletteMode;
      const automatic = paletteMode === "auto" ? autoBackgroundEffect({ ...effect, ...safePatch, paletteMode }, settings, settings.effects.indexOf(effect)) : {};
      const next = { ...effect, ...safePatch, ...automatic, paletteMode, label: "Circular Spectrum" as const, type: "circularSpectrum" as const };
      return {
        ...next,
        centerX: normalizeBackgroundAutoGeometryValue(next.centerX, effect.centerX ?? .5, 0),
        centerY: normalizeBackgroundAutoGeometryValue(next.centerY, effect.centerY ?? .5, 0),
        diameter: normalizeBackgroundAutoGeometryValue(next.diameter, effect.diameter ?? .42, .05)
      };
    });
    return { project: { ...state.project, animation: { ...state.project.animation, backgroundAuto: { ...settings, effects } } }, dirty: true };
  }),
  updateStaticWatermark: (patch) => set((state) => ({
    project: { ...state.project, animation: { ...state.project.animation, staticWatermark: { ...state.project.animation.staticWatermark, ...patch } } },
    dirty: true
  })),
  updateUpscaler: (patch) => set((state) => ({
    project: { ...state.project, animation: { ...state.project.animation, upscaler: { ...state.project.animation.upscaler, ...patch } } },
    dirty: true
  })),
  updateFrameBooster: (patch) => set((state) => {
    const current = state.project.animation.frameBooster;
    const sourceChanged = patch.sourceUrl !== undefined && patch.sourceUrl !== current.sourceUrl;
    const next = {
      ...current,
      ...patch,
      ...(sourceChanged ? { sourceFps: null, sourceFrameCount: null, lastOutput: null } : {})
    };
    return { project: { ...state.project, animation: { ...state.project.animation, frameBooster: next } }, dirty: true };
  }),
  updateVideoEditor: (patch) => set((state) => videoEditorState(state, { ...state.project.animation.videoEditor, ...patch })),
  addVideoEditorAssets: (assets) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const known = new Set(settings.assets.map((asset) => asset.id));
    const added = assets.filter((asset) => !known.has(asset.id)).map(hydrateVideoEditorAsset);
    if (!added.length) return state;
    return videoEditorState(state, { ...settings, assets: [...settings.assets, ...added].slice(0, 200) }, `${added.length === 1 ? added[0]!.name : `${added.length} file`} nel pool media`);
  }),
  removeVideoEditorAsset: (assetId) => set((state) => {
    const settings = state.project.animation.videoEditor;
    // Un media non può essere rimosso aggirando il lucchetto: se alimenta anche
    // una sola clip protetta, resta nel pool insieme a tutte le sue istanze.
    if (settings.clips.some((clip) => clip.assetId === assetId && videoEditorTrackIsLocked(settings, clip.trackId))) return state;
    // Rimuovere un media dal pool elimina anche le clip che lo usano: il progetto
    // non deve mai contenere una clip senza sorgente.
    const clips = settings.clips.filter((clip) => clip.assetId !== assetId);
    const clipIds = new Set(clips.map((clip) => clip.id));
    const effectClips = settings.effectClips.filter((effect) => effect.target.kind !== "clip" || clipIds.has(effect.target.clipId));
    return videoEditorState(state, {
      ...settings,
      assets: settings.assets.filter((asset) => asset.id !== assetId),
      clips,
      effectClips,
      selectedClipIds: settings.selectedClipIds.filter((id) => clipIds.has(id)),
      selectedEffectClipIds: settings.selectedEffectClipIds.filter((id) => effectClips.some((effect) => effect.id === id))
    }, "Media rimosso dal pool con le clip collegate");
  }),
  updateVideoEditorAsset: (assetId, patch) => set((state) => {
    const settings = state.project.animation.videoEditor;
    return videoEditorState(state, { ...settings, assets: settings.assets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset) });
  }),
  addVideoEditorClip: (assetId, options = {}) => {
    const id = `video-editor-clip-${crypto.randomUUID()}`;
    let created = false;
    set((state) => {
      const settings = state.project.animation.videoEditor;
      const asset = findVideoEditorAsset(settings, assetId);
      if (!asset) return state;
      if (options.strictTrack && !options.trackId) return state;
      if (options.trackId && videoEditorTrackIsLocked(settings, options.trackId)) return state;
      // A drop onto a concrete lane must never silently jump to another one.
      // Button/keyboard insertion can omit strictTrack and retain append's
      // normal compatible-track selection; timeline DnD opts into strictness.
      if (options.strictTrack && options.trackId) {
        const requestedTrack = settings.tracks.find((track) => track.id === options.trackId);
        const requestedKind = asset.kind === "audio" ? "audio" : "video";
        if (!requestedTrack || requestedTrack.locked || requestedTrack.kind !== requestedKind) return state;
      }
      const placement = videoEditorAppendPlacement(settings, asset, options.trackId);
      if (!placement) return state;
      created = true;
      const clip = defaultVideoEditorClip(id, asset, {
        ...placement,
        ...(typeof options.startSeconds === "number" ? { startSeconds: Math.max(0, options.startSeconds) } : {})
      });
      const firstVisualClip = asset.kind !== "audio" && !settings.clips.some((item) => findVideoEditorAsset(settings, item.assetId)?.kind !== "audio");
      const composition = firstVisualClip ? videoEditorCompositionForAsset(asset) : null;
      return videoEditorState(state, {
        ...settings,
        ...(composition ? { outputWidth: composition.width, outputHeight: composition.height } : {}),
        clips: [...settings.clips, clip], selectedClipIds: [id], selectedEffectClipIds: []
      }, `${asset.name} inserito a ${clip.startSeconds.toFixed(2)} s${composition ? ` · formato ${composition.label}` : ""}`);
    });
    return created ? id : null;
  },
  updateVideoEditorClip: (clipId, patch) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const clip = findVideoEditorClip(settings, clipId);
    if (!clip || videoEditorTrackIsLocked(settings, clip.trackId)) return state;
    // Il cambio di livello passa esclusivamente da moveVideoEditorClipToTrack,
    // che valida tipo e lucchetti di entrambe le tracce. In questo modo una patch
    // generica non può aggirare la protezione del livello di destinazione.
    if (patch.trackId !== undefined && patch.trackId !== clip.trackId) return state;
    const asset = findVideoEditorAsset(settings, clip.assetId);
    let candidate = { ...clip, ...patch };
    if (patch.speed && patch.durationSeconds === undefined && patch.sourceInSeconds === undefined && !videoEditorAssetIsStill(asset)) {
      const sourceDuration = videoEditorClipSourceDuration(clip, settings.timebase);
      candidate = { ...candidate, durationSeconds: videoEditorClipTimelineDurationForSource(sourceDuration, patch.speed, settings.timebase) };
    }
    if (clip.reversed && patch.durationSeconds !== undefined && patch.sourceInSeconds === undefined && !videoEditorAssetIsStill(asset)) {
      const sourceEnd = Math.min(asset!.durationSeconds, clip.sourceInSeconds + videoEditorClipSourceDuration(clip, settings.timebase));
      const requestedSource = videoEditorClipSourceDuration(candidate, settings.timebase);
      candidate = requestedSource > sourceEnd
        ? { ...candidate, sourceInSeconds: 0, durationSeconds: videoEditorClipTimelineDurationForSource(sourceEnd, candidate.speed, settings.timebase) }
        : { ...candidate, sourceInSeconds: Math.max(0, sourceEnd - requestedSource) };
    }
    const next = clampVideoEditorClip(candidate, asset, settings.timebase);
    const clips = settings.clips.map((item) => item.id === clipId ? next : item);
    const delta = next.startSeconds - clip.startSeconds;
    const shifted = settings.effectClips.map((effect) => effect.target.kind === "clip" && effect.target.clipId === clipId ? { ...effect, startSeconds: effect.startSeconds + delta } : effect);
    return videoEditorState(state, { ...settings, clips, effectClips: reconcileVideoEditorEffects({ ...settings, clips }, shifted) });
  }),
  updateVideoEditorClipAdjustments: (clipId, patch) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (videoEditorClipIsLocked(settings, clipId)) return state;
    return videoEditorState(state, { ...settings, clips: settings.clips.map((clip) => clip.id === clipId ? { ...clip, adjustments: { ...clip.adjustments, ...patch } } : clip) });
  }),
  moveVideoEditorClip: (clipId, startSeconds, playheadSeconds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (videoEditorClipIsLocked(settings, clipId)) return state;
    const moved = videoEditorMoveClip(settings, clipId, startSeconds, playheadSeconds);
    if (!moved) return state;
    const clips = settings.clips.map((clip) => clip.id === clipId ? moved : clip);
    return videoEditorState(state, { ...settings, clips, effectClips: moveTargetEffects(settings, clips) });
  }),
  moveVideoEditorClipToTrack: (clipId, trackId) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const clip = findVideoEditorClip(settings, clipId);
    const track = settings.tracks.find((item) => item.id === trackId);
    if (!clip || !track || track.locked || videoEditorTrackIsLocked(settings, clip.trackId)) return state;
    const asset = findVideoEditorAsset(settings, clip.assetId);
    // Una traccia audio accetta solo suono e una traccia video solo immagini in
    // movimento: mescolarle produrrebbe clip invisibili o mute senza spiegazione.
    const clipKind = asset?.kind === "audio" ? "audio" : "video";
    if (track.kind !== clipKind) return state;
    return videoEditorState(state, { ...settings, clips: settings.clips.map((item) => item.id === clipId ? { ...item, trackId } : item) }, `Clip spostata su ${track.name}`);
  }),
  trimVideoEditorClip: (clipId, edge, timeSeconds, playheadSeconds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (videoEditorClipIsLocked(settings, clipId)) return state;
    const trimmed = videoEditorTrimClip(settings, clipId, edge, timeSeconds, playheadSeconds);
    if (!trimmed) return state;
    const asset = findVideoEditorAsset(settings, trimmed.assetId);
    const next = clampVideoEditorClip(trimmed, asset, settings.timebase);
    const clips = settings.clips.map((clip) => clip.id === clipId ? next : clip);
    const oldEnd = videoEditorClipEnd(findVideoEditorClip(settings, clipId)!);
    const newEnd = videoEditorClipEnd(next);
    const shifted = settings.effectClips.map((effect) => {
      if (effect.target.kind !== "clip" || effect.target.clipId !== clipId) return effect;
      if (effect.effectId === "fade-in" && Math.abs(effect.startSeconds - findVideoEditorClip(settings, clipId)!.startSeconds) < 1e-4) return { ...effect, startSeconds: next.startSeconds };
      if (effect.effectId === "fade-out" && Math.abs(effect.startSeconds + effect.durationSeconds - oldEnd) < 1e-4) return { ...effect, startSeconds: newEnd - effect.durationSeconds };
      return effect;
    });
    return videoEditorState(state, { ...settings, clips, effectClips: reconcileVideoEditorEffects({ ...settings, clips }, shifted) });
  }),
  splitVideoEditorClip: (clipId, timeSeconds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const clip = findVideoEditorClip(settings, clipId);
    if (!clip || videoEditorTrackIsLocked(settings, clip.trackId)) return state;
    const halves = videoEditorSplitClip(clip, videoEditorQuantizeTime(timeSeconds, settings.timebase), `video-editor-clip-${crypto.randomUUID()}`, settings.timebase);
    if (!halves) return state;
    const clips = settings.clips.flatMap((item) => item.id === clipId ? [halves[0], halves[1]] : [item]);
    const retargeted = settings.effectClips.map((effect) => {
      if (effect.target.kind !== "clip" || effect.target.clipId !== clipId) return effect;
      const targetId = effect.startSeconds + effect.durationSeconds / 2 < timeSeconds ? halves[0].id : halves[1].id;
      return { ...effect, target: { kind: "clip" as const, clipId: targetId } };
    });
    return videoEditorState(state, { ...settings, clips, effectClips: reconcileVideoEditorEffects({ ...settings, clips }, retargeted), selectedClipIds: [halves[1].id], selectedEffectClipIds: [] }, `Clip tagliata a ${timeSeconds.toFixed(3)} s`);
  }),
  duplicateVideoEditorClip: (clipId) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const clip = findVideoEditorClip(settings, clipId);
    if (!clip || videoEditorTrackIsLocked(settings, clip.trackId)) return state;
    const id = `video-editor-clip-${crypto.randomUUID()}`;
    // Il duplicato nasce subito dopo l’originale: nessun vuoto, nessuna sovrapposizione.
    const copy: VideoEditorClip = { ...clip, id, startSeconds: videoEditorClipEnd(clip) };
    const delta = copy.startSeconds - clip.startSeconds;
    const duplicatedEffects = settings.effectClips.filter((effect) => effect.target.kind === "clip" && effect.target.clipId === clipId).map((effect) => ({ ...effect, id: `video-editor-effect-${crypto.randomUUID()}`, target: { kind: "clip" as const, clipId: id }, startSeconds: effect.startSeconds + delta }));
    return videoEditorState(state, { ...settings, clips: [...settings.clips, copy], effectClips: [...settings.effectClips, ...duplicatedEffects], selectedClipIds: [id], selectedEffectClipIds: [] }, "Clip duplicata in coda all’originale");
  }),
  deleteVideoEditorClips: (clipIds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const targets = new Set(clipIds.filter((clipId) => !videoEditorClipIsLocked(settings, clipId)));
    if (!targets.size) return state;
    const effectClips = settings.effectClips.filter((effect) => effect.target.kind !== "clip" || !targets.has(effect.target.clipId));
    return videoEditorState(state, {
      ...settings,
      clips: settings.clips.filter((clip) => !targets.has(clip.id)),
      effectClips,
      selectedClipIds: settings.selectedClipIds.filter((id) => !targets.has(id)),
      selectedEffectClipIds: settings.selectedEffectClipIds.filter((id) => effectClips.some((effect) => effect.id === id))
    }, `${targets.size} clip rimosse dalla timeline`);
  }),
  selectVideoEditorClip: (clipId, additive = false) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (!clipId) return videoEditorState(state, { ...settings, selectedClipIds: [] });
    const selectedClipIds = additive
      ? settings.selectedClipIds.includes(clipId) ? settings.selectedClipIds.filter((id) => id !== clipId) : [...settings.selectedClipIds, clipId]
      : [clipId];
    return videoEditorState(state, { ...settings, selectedClipIds, selectedEffectClipIds: [] });
  }),
  selectVideoEditorClips: (clipIds) => set((state) => videoEditorState(state, { ...state.project.animation.videoEditor, selectedClipIds: [...clipIds], selectedEffectClipIds: [] })),
  syncVideoEditorClips: (referenceClipId, targetClipIds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    // La clip bloccata può essere usata come riferimento (sola lettura), ma non
    // può mai figurare fra i target che vengono riposizionati.
    const editableTargets = targetClipIds.filter((clipId) => !videoEditorClipIsLocked(settings, clipId));
    const result = videoEditorSyncClips(settings, referenceClipId, editableTargets);
    if (!result) return state;
    const status = result.strategy === "beatGrid"
      ? `Sincronizzazione ritmica · ${result.matchedBeats} battute allineate`
      : `Attacchi allineati · scarto ${result.offsetSeconds >= 0 ? "+" : ""}${result.offsetSeconds.toFixed(3)} s`;
    return videoEditorState(state, { ...settings, clips: result.clips, effectClips: moveTargetEffects(settings, result.clips) }, status);
  }),
  alignVideoEditorClipsByFrame: (referenceClipId, targetClipIds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const editableTargets = targetClipIds.filter((clipId) => !videoEditorClipIsLocked(settings, clipId));
    const result = videoEditorAlignClipsByFrame(settings, referenceClipId, editableTargets);
    if (!result) return videoEditorState(state, settings, "Allineamento per frame non disponibile: i video devono avere stesso numero di frame e frame rate costante.");
    return videoEditorState(state, { ...settings, clips: result.clips, effectClips: moveTargetEffects(settings, result.clips) }, `${result.alignedClipIds.length} clip allineate per frame (${result.referenceFrameCount} frame)`);
  }),
  upsertVideoEditorKeyframe: (target, keyframe) => set((state) => {
    const settings = state.project.animation.videoEditor;
    return videoEditorState(state, { ...settings, automationLanes: upsertVideoEditorKeyframe(settings.automationLanes, target, keyframe) }, "Keyframe automazione aggiunto");
  }),
  removeVideoEditorKeyframe: (target, frame) => set((state) => {
    const settings = state.project.animation.videoEditor;
    return videoEditorState(state, { ...settings, automationLanes: removeVideoEditorKeyframe(settings.automationLanes, target, frame) }, "Keyframe automazione rimosso");
  }),
  insertVideoEditorArtifact: (artifact, sourceClipId) => {
    let insertedId: string | null = null;
    set((state) => {
      const settings = state.project.animation.videoEditor;
      const source = settings.clips.find((clip) => clip.id === sourceClipId);
      const asset = settings.assets.find((item) => item.id === source?.assetId);
      const track = source ? settings.tracks.find((item) => item.id === source.trackId && !item.locked) : null;
      if (!source || !asset || !track || !artifact.url) return state;
      const assetId = `video-editor-asset-${crypto.randomUUID()}`;
      const clipId = `video-editor-clip-${crypto.randomUUID()}`;
      const sourceDuration = artifact.sourceDurationSeconds ?? videoEditorClipSourceDuration(source, settings.timebase);
      const nextAsset: VideoEditorAsset = { id: assetId, name: artifact.name, kind: artifact.kind, url: artifact.url, durationSeconds: sourceDuration, width: asset.width, height: asset.height, sourceFrameCount: artifact.sourceFrameCount ?? asset.sourceFrameCount, sourceRate: artifact.sourceRate ?? asset.sourceRate, frameIdentityId: artifact.id, timingMode: "constant", thumbnailUrl: null, hasAudio: asset.hasAudio, bpm: null, beats: [], downbeats: [], waveform: [] };
      const trackId = `video-editor-track-${crypto.randomUUID()}`;
      const artifactTrack = { id: trackId, name: `${artifact.name} · risultato`, kind: artifact.kind === "audio" ? "audio" as const : "video" as const, hidden: false, muted: false, locked: false, volume: 1 };
      const sourceTrackIndex = settings.tracks.findIndex((item) => item.id === track.id);
      const tracks = [...settings.tracks];
      tracks.splice(Math.max(0, sourceTrackIndex), 0, artifactTrack);
      const nextClip = { ...source, id: clipId, assetId, trackId, sourceInSeconds: 0 };
      insertedId = clipId;
      return videoEditorState(state, { ...settings, assets: [...settings.assets, nextAsset], tracks, clips: [...settings.clips, nextClip], selectedClipIds: [clipId], selectedEffectClipIds: [] }, `${artifact.name} inserito come nuova clip`);
    });
    return insertedId;
  },
  undoVideoEditor: () => set((state) => {
    const previous = state.videoEditorHistory.at(-1);
    if (!previous) return state;
    return {
      project: { ...state.project, animation: { ...state.project.animation, videoEditor: previous } },
      videoEditorHistory: state.videoEditorHistory.slice(0, -1),
      videoEditorFuture: [state.project.animation.videoEditor, ...state.videoEditorFuture].slice(0, 100),
      dirty: true,
      status: "Modifica Video Editor annullata"
    };
  }),
  redoVideoEditor: () => set((state) => {
    const next = state.videoEditorFuture[0];
    if (!next) return state;
    return {
      project: { ...state.project, animation: { ...state.project.animation, videoEditor: next } },
      videoEditorHistory: [...state.videoEditorHistory, state.project.animation.videoEditor].slice(-100),
      videoEditorFuture: state.videoEditorFuture.slice(1),
      dirty: true,
      status: "Modifica Video Editor ripristinata"
    };
  }),
  closeVideoEditorGaps: (trackId) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (videoEditorTrackIsLocked(settings, trackId)) return state;
    const clips = videoEditorCloseGaps(settings.clips, trackId);
    return videoEditorState(state, { ...settings, clips, effectClips: moveTargetEffects(settings, clips) }, "Vuoti chiusi: le clip sono a contatto");
  }),
  updateVideoEditorTrack: (trackId, patch) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const current = settings.tracks.find((track) => track.id === trackId);
    if (!current) return state;
    // Nome e controlli di monitoraggio (visibilità, mute e volume) restano
    // operativi anche a traccia bloccata, come nei NLE professionali. Il lock
    // protegge clip, effetti e struttura, non il mixer o il monitor di traccia.
    return videoEditorState(state, { ...settings, tracks: settings.tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track) });
  }),
  addVideoEditorTrack: (kind) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (settings.tracks.length >= 24) return state;
    const count = settings.tracks.filter((track) => track.kind === kind).length + 1;
    const track: VideoEditorTrack = { id: `video-editor-track-${crypto.randomUUID()}`, name: `${kind === "audio" ? "Audio" : "Livello video"} ${count}`, kind, hidden: false, muted: false, locked: false, volume: 1 };
    // I nuovi livelli video nascono sopra gli altri, ma restano completamente
    // riordinabili: non esistono ruoli impliciti di principale o overlay.
    const tracks = kind === "audio" ? [...settings.tracks, track] : [track, ...settings.tracks];
    return videoEditorState(state, { ...settings, tracks }, `Traccia ${track.name} aggiunta`);
  }),
  reorderVideoEditorTrack: (trackId, destinationIndex) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const track = settings.tracks.find((item) => item.id === trackId);
    const destination = settings.tracks[Math.max(0, Math.min(settings.tracks.length - 1, destinationIndex))];
    if (!track || track.locked || destination?.locked) return state;
    const tracks = videoEditorReorderTracks(settings.tracks, trackId, destinationIndex);
    if (tracks.every((track, index) => track.id === settings.tracks[index]?.id)) return state;
    return videoEditorState(state, { ...settings, tracks }, "Ordine livelli aggiornato");
  }),
  removeVideoEditorTrack: (trackId) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (settings.tracks.length <= 1 || videoEditorTrackIsLocked(settings, trackId)) return state;
    const clips = settings.clips.filter((clip) => clip.trackId !== trackId);
    const clipIds = new Set(clips.map((clip) => clip.id));
    const effectClips = settings.effectClips.filter((effect) => effect.target.kind !== "clip" || clipIds.has(effect.target.clipId));
    return videoEditorState(state, {
      ...settings,
      tracks: settings.tracks.filter((track) => track.id !== trackId),
      clips,
      effectClips,
      selectedClipIds: settings.selectedClipIds.filter((id) => clipIds.has(id)),
      selectedEffectClipIds: settings.selectedEffectClipIds.filter((id) => effectClips.some((effect) => effect.id === id))
    }, "Traccia eliminata con le sue clip");
  }),
  addVideoEditorEffectClip: (effectId, options = {}) => {
    let result: string | null = null;
    set((state) => {
      const settings = state.project.animation.videoEditor;
      const targetClipId = options.targetClipId ?? settings.selectedClipIds.at(-1);
      if (!targetClipId || videoEditorClipIsLocked(settings, targetClipId)) return state;
      const placement = videoEditorPlaceEffect(settings, effectId, targetClipId, options.startSeconds);
      if (!placement) return state;
      const id = `video-editor-effect-${crypto.randomUUID()}`;
      const effect: VideoEditorEffectClip = {
        id, effectId, target: { kind: "clip", clipId: targetClipId }, startSeconds: placement.startSeconds,
        durationSeconds: typeof options.durationSeconds === "number" ? options.durationSeconds : placement.durationSeconds,
        enabled: true, mix: 1, parameters: { ...placement.definition.defaultParameters }
      };
      const clamped = videoEditorClampEffect(settings, effect);
      if (!clamped) return state;
      result = id;
      return videoEditorState(state, { ...settings, effectClips: [...settings.effectClips, clamped], selectedClipIds: [], selectedEffectClipIds: [id] }, `${placement.definition.label} aggiunto alla timeline`);
    });
    return result;
  },
  updateVideoEditorEffectClip: (effectId, patch) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const current = settings.effectClips.find((effect) => effect.id === effectId);
    if (!current || videoEditorEffectIsLocked(settings, current)) return state;
    if (patch.target?.kind === "clip" && videoEditorClipIsLocked(settings, patch.target.clipId)) return state;
    const next = videoEditorClampEffect(settings, { ...current, ...patch });
    return next ? videoEditorState(state, { ...settings, effectClips: settings.effectClips.map((effect) => effect.id === effectId ? next : effect) }) : state;
  }),
  moveVideoEditorEffectClip: (effectId, startSeconds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const current = settings.effectClips.find((effect) => effect.id === effectId);
    if (!current || videoEditorEffectIsLocked(settings, current)) return state;
    const moved = videoEditorMoveEffect(settings, effectId, startSeconds);
    return moved ? videoEditorState(state, { ...settings, effectClips: settings.effectClips.map((effect) => effect.id === effectId ? moved : effect) }) : state;
  }),
  trimVideoEditorEffectClip: (effectId, edge, timeSeconds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const current = settings.effectClips.find((effect) => effect.id === effectId);
    if (!current || videoEditorEffectIsLocked(settings, current)) return state;
    const trimmed = videoEditorTrimEffect(settings, effectId, edge, timeSeconds);
    return trimmed ? videoEditorState(state, { ...settings, effectClips: settings.effectClips.map((effect) => effect.id === effectId ? trimmed : effect) }) : state;
  }),
  deleteVideoEditorEffectClips: (effectIds) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const targets = new Set(effectIds.filter((effectId) => {
      const effect = settings.effectClips.find((item) => item.id === effectId);
      return effect ? !videoEditorEffectIsLocked(settings, effect) : false;
    }));
    if (!targets.size) return state;
    return videoEditorState(state, { ...settings, effectClips: settings.effectClips.filter((effect) => !targets.has(effect.id)), selectedEffectClipIds: settings.selectedEffectClipIds.filter((id) => !targets.has(id)) }, `${targets.size} effetti rimossi`);
  }),
  selectVideoEditorEffectClip: (effectId, additive = false) => set((state) => {
    const settings = state.project.animation.videoEditor;
    if (!effectId) return videoEditorState(state, { ...settings, selectedEffectClipIds: [] });
    const selectedEffectClipIds = additive
      ? settings.selectedEffectClipIds.includes(effectId) ? settings.selectedEffectClipIds.filter((id) => id !== effectId) : [...settings.selectedEffectClipIds, effectId]
      : [effectId];
    return videoEditorState(state, { ...settings, selectedClipIds: [], selectedEffectClipIds });
  }),
  setVideoEditorAssetAnalysis: (assetId, analysis) => set((state) => {
    const settings = state.project.animation.videoEditor;
    const asset = findVideoEditorAsset(settings, assetId);
    if (!asset) return state;
    const assets = settings.assets.map((item) => item.id === assetId
      ? { ...item, bpm: analysis.bpm, beats: [...analysis.beats].slice(0, 4_000), downbeats: [...analysis.downbeats].slice(0, 1_000) }
      : item);
    return videoEditorState(state, { ...settings, assets }, `${asset.name} · ${analysis.beats.length} battute${analysis.bpm ? ` · ${analysis.bpm.toFixed(1)} BPM` : ""}`);
  }),
  updateProSubtitleCueStyle: (cueId, patch) => set((state) => {
    const settings = state.project.animation.proSubtitles;
    const cueIndex = Math.max(0, state.project.subtitles.cues.findIndex((cue) => cue.id === cueId));
    const cue = state.project.subtitles.cues[cueIndex] ?? { id: cueId, text: "", startSeconds: 0, endSeconds: 1 };
    const previousCue = state.project.subtitles.cues[cueIndex - 1];
    const previousAnimation = previousCue
      ? settings.cueStyles.find((style) => style.cueId === previousCue.id)?.animation
      : undefined;
    const fallback = defaultProSubtitleCueStyle(settings, cue, cueIndex, previousAnimation);
    const source = settings.cueStyles.find((style) => style.cueId === cueId);
    const existing = source ? { ...fallback, ...source } : fallback;
    const animationWasEdited = Object.prototype.hasOwnProperty.call(patch, "animation")
      && !Object.prototype.hasOwnProperty.call(patch, "animationAutomatic");
    const fontFamilyWasEdited = Object.prototype.hasOwnProperty.call(patch, "fontFamily")
      && !Object.prototype.hasOwnProperty.call(patch, "fontFamilyAutomatic");
    const fontSizeWasEdited = Object.prototype.hasOwnProperty.call(patch, "fontSize")
      && !Object.prototype.hasOwnProperty.call(patch, "fontSizeAutomatic");
    const positionWasEdited = (
      Object.prototype.hasOwnProperty.call(patch, "positionX")
      || Object.prototype.hasOwnProperty.call(patch, "positionY")
    ) && !Object.prototype.hasOwnProperty.call(patch, "positionAutomatic");
    const opacityWasEdited = Object.prototype.hasOwnProperty.call(patch, "opacity")
      && !Object.prototype.hasOwnProperty.call(patch, "opacityAutomatic");
    const nextStyle: ProSubtitleCueStyle = {
      ...existing,
      ...patch,
      ...(animationWasEdited ? { animationAutomatic: false } : {}),
      ...(fontFamilyWasEdited ? { fontFamilyAutomatic: false } : {}),
      ...(fontSizeWasEdited ? { fontSizeAutomatic: false } : {}),
      ...(positionWasEdited ? { positionAutomatic: false } : {}),
      ...(opacityWasEdited ? { opacityAutomatic: false } : {}),
      ...(patch.fontFamilyAutomatic === true
        ? { fontFamily: settings.defaultFontFamily, fontFamilyAutomatic: true }
        : {}),
      ...(patch.fontSizeAutomatic === true
        ? { fontSize: settings.defaultFontSize, fontSizeAutomatic: true }
        : {}),
      ...(patch.positionAutomatic === true
        ? { positionX: settings.positionX, positionY: settings.positionY, positionAutomatic: true }
        : {}),
      ...(patch.opacityAutomatic === true
        ? { opacity: settings.opacity, opacityAutomatic: true }
        : {}),
      cueId
    };
    const cueStyles = [...settings.cueStyles.filter((style) => style.cueId !== cueId), nextStyle];
    return { project: { ...state.project, animation: { ...state.project.animation, proSubtitles: { ...settings, cueStyles } } }, dirty: true };
  }),
  updateProSubtitleWordStyle: (cueId, wordIndex, patch) => set((state) => {
    const settings = state.project.animation.proSubtitles;
    const cueIndex = Math.max(0, state.project.subtitles.cues.findIndex((cue) => cue.id === cueId));
    const cue = state.project.subtitles.cues[cueIndex] ?? { id: cueId, text: "", startSeconds: 0, endSeconds: 1 };
    const previousCue = state.project.subtitles.cues[cueIndex - 1];
    const previousAnimation = previousCue
      ? settings.cueStyles.find((style) => style.cueId === previousCue.id)?.animation
      : undefined;
    const fallback = defaultProSubtitleCueStyle(settings, cue, cueIndex, previousAnimation);
    const source = settings.cueStyles.find((style) => style.cueId === cueId);
    const existingCue = source ? { ...fallback, ...source } : fallback;
    const existingWord = existingCue.wordStyles.find((style) => style.index === wordIndex) ?? { index: wordIndex, color: resolveProSubtitlePaletteColor(settings.palette, cueIndex, wordIndex), fontSizeScale: 1, animation: null };
    const wordStyles = [...existingCue.wordStyles.filter((style) => style.index !== wordIndex), { ...existingWord, ...patch, index: wordIndex }].sort((left, right) => left.index - right.index);
    const cueStyles = [...settings.cueStyles.filter((style) => style.cueId !== cueId), { ...existingCue, cueId, wordStyles }]; return { project: { ...state.project, animation: { ...state.project.animation, proSubtitles: { ...settings, cueStyles } } }, dirty: true };
  }),
  setTeddySingPalette: (colors) => set((state) => { const settings = state.project.animation.teddySing; return { project: { ...state.project, animation: { ...state.project.animation, teddySing: { ...settings, furColor: colors[0] ?? settings.furColor, patchColor: colors[1] ?? colors[0] ?? settings.patchColor, ledColor: colors[2] ?? colors[1] ?? settings.ledColor, roomColor: colors[3] ?? settings.roomColor } } }, dirty: true }; }),
  setTeddySingPhonemes: (phonemeCues) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, teddySing: { ...state.project.animation.teddySing, phonemeCues, phonemesGenerated: true } } }, dirty: true, status: `${phonemeCues.length} fonemi/visemi vocali identificati` })),
  deleteTeddySingPhoneme: (id) => set((state) => { const settings = state.project.animation.teddySing; return { project: { ...state.project, animation: { ...state.project.animation, teddySing: { ...settings, phonemeCues: settings.phonemeCues.filter((cue) => cue.id !== id), phonemesGenerated: true } } }, dirty: true, status: "Fonema eliminato · il muso resterà chiuso in quell’intervallo" }; }),
  splitTeddySingPhoneme: (id, requestedTime) => set((state) => { const settings = state.project.animation.teddySing; const cue = settings.phonemeCues.find((item) => item.id === id); if (!cue) return state; const minimumSide = .025; const fallback = (cue.startSeconds + cue.endSeconds) / 2; const split = requestedTime > cue.startSeconds + minimumSide && requestedTime < cue.endSeconds - minimumSide ? requestedTime : fallback; if (split <= cue.startSeconds + minimumSide || split >= cue.endSeconds - minimumSide) return state; const phonemeCues = settings.phonemeCues.flatMap((item) => item.id !== id ? [item] : [{ ...item, endSeconds: split, manual: true }, { ...item, id: `phoneme-${crypto.randomUUID()}`, startSeconds: split, manual: true }]); return { project: { ...state.project, animation: { ...state.project.animation, teddySing: { ...settings, phonemeCues, phonemesGenerated: true } } }, dirty: true, status: `Fonema ${cue.viseme} diviso a ${split.toFixed(3)} s` }; }),
  updateSubtitles: (patch) => set((state) => ({ project: { ...state.project, subtitles: { ...state.project.subtitles, ...patch } }, dirty: true })),
  addSubtitleCue: (requestedTime) => { const id = `subtitle-${crypto.randomUUID()}`; set((state) => { const projectDuration = state.project.audio.durationSeconds; const startSeconds = Math.max(0, Math.min(Math.max(0, projectDuration - .05), requestedTime)); const endSeconds = Math.min(projectDuration || startSeconds + 2, startSeconds + 2); const cue = { id, startSeconds, endSeconds: Math.max(startSeconds + .05, endSeconds), text: "Nuovo sottotitolo", confidence: 1, verified: false, manual: true }; const cues = [...state.project.subtitles.cues, cue].sort((left, right) => left.startSeconds - right.startSeconds); const proSubtitleMode = state.project.animation.modeId === "proSubtitles" || state.project.animation.modeId === "portraitLandscape"; const proSubtitles = proSubtitleMode ? { ...state.project.animation.proSubtitles, cueStyles: ensureProSubtitleCueStyles(state.project.animation.proSubtitles, cues) } : state.project.animation.proSubtitles; return { project: { ...state.project, animation: { ...state.project.animation, proSubtitles }, subtitles: { ...state.project.subtitles, enabled: true, cues } }, dirty: true, status: `Blocco sottotitolo inserito a ${startSeconds.toFixed(2)} s` }; }); return id; },
  setSubtitleCues: (cues) => set((state) => {
    const sorted = [...cues].sort((left, right) => left.startSeconds - right.startSeconds); const proSubtitleMode = state.project.animation.modeId === "proSubtitles" || state.project.animation.modeId === "portraitLandscape"; const proSubtitles = proSubtitleMode ? { ...state.project.animation.proSubtitles, cueStyles: ensureProSubtitleCueStyles(state.project.animation.proSubtitles, sorted) } : state.project.animation.proSubtitles;
    return { project: { ...state.project, animation: { ...state.project.animation, proSubtitles }, subtitles: { ...state.project.subtitles, cues: sorted, enabled: sorted.length > 0 || state.project.subtitles.enabled } }, dirty: true, status: `${sorted.length} blocchi sottotitoli inseriti` };
  }),
  updateSubtitleCue: (id, patch) => set((state) => {
    const duration = state.project.audio.durationSeconds; const cues = state.project.subtitles.cues.map((cue) => {
      if (cue.id !== id) return cue; const next = { ...cue, ...patch, manual: true }; const startSeconds = Math.max(0, Math.min(Math.max(0, duration - .03), next.startSeconds)); const endSeconds = Math.max(startSeconds + .03, Math.min(duration || next.endSeconds, next.endSeconds)); return { ...next, startSeconds, endSeconds };
    }).sort((left, right) => left.startSeconds - right.startSeconds);
    const settings = state.project.animation.proSubtitles; const cueText = cues.find((cue) => cue.id === id)?.text ?? ""; const wordCount = cueText.trim().split(/\s+/).filter(Boolean).length; const cueStyles = settings.cueStyles.map((style) => style.cueId === id ? { ...style, wordStyles: style.wordStyles.filter((word) => word.index < wordCount) } : style);
    return { project: { ...state.project, animation: { ...state.project.animation, proSubtitles: { ...settings, cueStyles } }, subtitles: { ...state.project.subtitles, cues } }, dirty: true };
  }),
  moveSubtitleCue: (id, startSeconds) => set((state) => { const cue = state.project.subtitles.cues.find((item) => item.id === id); if (!cue) return state; const duration = cue.endSeconds - cue.startSeconds; const start = Math.max(0, Math.min(Math.max(0, state.project.audio.durationSeconds - duration), startSeconds)); const cues = state.project.subtitles.cues.map((item) => item.id === id ? { ...item, startSeconds: start, endSeconds: start + duration, manual: true } : item).sort((left, right) => left.startSeconds - right.startSeconds); return { project: { ...state.project, subtitles: { ...state.project.subtitles, cues } }, dirty: true }; }),
  resizeSubtitleCue: (id, requestedStart, requestedEnd) => set((state) => {
    const source = state.project.subtitles.cues.find((cue) => cue.id === id); if (!source) return state; const maximum = state.project.audio.durationSeconds || Math.max(source.endSeconds, requestedEnd); const startSeconds = Math.max(0, Math.min(maximum - 1 / 30, requestedStart)); const endSeconds = Math.max(startSeconds + 1 / 30, Math.min(maximum, requestedEnd));
    const cues = state.project.subtitles.cues.map((cue) => cue.id === id ? { ...cue, startSeconds, endSeconds, manual: true } : cue).sort((left, right) => left.startSeconds - right.startSeconds); return { project: { ...state.project, subtitles: { ...state.project.subtitles, cues } }, dirty: true };
  }),
  deleteSubtitleCue: (id) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, proSubtitles: { ...state.project.animation.proSubtitles, cueStyles: state.project.animation.proSubtitles.cueStyles.filter((style) => style.cueId !== id) } }, subtitles: { ...state.project.subtitles, cues: state.project.subtitles.cues.filter((cue) => cue.id !== id) } }, dirty: true, status: "Frase sottotitolo eliminata" })),
  splitSubtitleCue: (id, requestedTime) => set((state) => {
    const cue = state.project.subtitles.cues.find((item) => item.id === id); if (!cue) return state; const midpoint = (cue.startSeconds + cue.endSeconds) / 2; const split = requestedTime > cue.startSeconds + .08 && requestedTime < cue.endSeconds - .08 ? requestedTime : midpoint; const words = cue.text.trim().split(/\s+/); const wordIndex = Math.max(1, Math.min(words.length - 1, Math.round(words.length * (split - cue.startSeconds) / Math.max(.001, cue.endSeconds - cue.startSeconds)))); if (words.length < 2 || split <= cue.startSeconds + .05 || split >= cue.endSeconds - .05) return state;
    const nextId = `subtitle-${crypto.randomUUID()}`; const cues = state.project.subtitles.cues.flatMap((item) => item.id !== id ? [item] : [{ ...item, text: words.slice(0, wordIndex).join(" "), endSeconds: split, manual: true }, { ...item, id: nextId, text: words.slice(wordIndex).join(" "), startSeconds: split, manual: true }]).sort((left, right) => left.startSeconds - right.startSeconds);
    const settings = state.project.animation.proSubtitles; const cueIndex = Math.max(0, state.project.subtitles.cues.findIndex((item) => item.id === id)); const previousCue = state.project.subtitles.cues[cueIndex - 1]; const previousAnimation = previousCue ? settings.cueStyles.find((style) => style.cueId === previousCue.id)?.animation : undefined; const original = settings.cueStyles.find((style) => style.cueId === id) ?? defaultProSubtitleCueStyle(settings, cue, cueIndex, previousAnimation); const leftStyle = { ...original, wordStyles: original.wordStyles.filter((word) => word.index < wordIndex) }; const rightStyle = { ...original, cueId: nextId, wordStyles: original.wordStyles.filter((word) => word.index >= wordIndex).map((word) => ({ ...word, index: word.index - wordIndex })) }; const cueStyles = [...settings.cueStyles.filter((style) => style.cueId !== id), leftStyle, rightStyle];
    return { project: { ...state.project, animation: { ...state.project.animation, proSubtitles: { ...settings, cueStyles } }, subtitles: { ...state.project.subtitles, cues } }, dirty: true, status: "Frase sottotitolo divisa" };
  }),
  selectEvent: (id, additive = false) => set((state) => { if (!id) return { selectedEventId: null, selectedEventIds: [] }; if (!additive) return { selectedEventId: id, selectedEventIds: [id] }; const selectedEventIds = state.selectedEventIds.includes(id) ? state.selectedEventIds.filter((item) => item !== id) : [...state.selectedEventIds, id]; return { selectedEventIds, selectedEventId: selectedEventIds.at(-1) ?? null }; }),
  addEvent: (timeSeconds) => set((state) => { const time = Math.max(0, Math.min(state.project.audio.durationSeconds, timeSeconds)); const event = { id: `manual-${crypto.randomUUID()}`, timeSeconds: time, timeSamples: Math.round(time * state.project.audio.sampleRate), eventType: "manual" as const, confidence: 1, strength: .75, frequencyBand: "full" as const, assignedObjectType: null, assignedObjectId: null, enabled: true, accent: false, manualOverride: true, action: "collision" as const, expectedBallPosition: { x: 0, y: 0, z: 0 }, expectedBallVelocity: { x: 0, y: 0, z: 0 }, expectedImpactNormal: { x: 0, y: 1, z: 0 } }; return { project: { ...state.project, events: [...state.project.events, event].sort((a, b) => a.timeSeconds - b.timeSeconds) }, eventHistory: [...state.eventHistory, state.project.events], eventFuture: [], selectedEventId: event.id, selectedEventIds: [event.id], dirty: true }; }),
  moveEvent: (id, timeSeconds) => set((state) => { const time = Math.max(0, Math.min(state.project.audio.durationSeconds, timeSeconds)); const events = state.project.events.map((event) => event.id === id ? { ...event, timeSeconds: time, timeSamples: Math.round(time * state.project.audio.sampleRate), manualOverride: true } : event).sort((a, b) => a.timeSeconds - b.timeSeconds); return { project: { ...state.project, events }, eventHistory: [...state.eventHistory, state.project.events], eventFuture: [], dirty: true }; }),
  deleteEvent: (id) => set((state) => ({ project: { ...state.project, events: state.project.events.filter((event) => event.id !== id) }, eventHistory: [...state.eventHistory, state.project.events], eventFuture: [], selectedEventId: state.selectedEventId === id ? null : state.selectedEventId, selectedEventIds: state.selectedEventIds.filter((item) => item !== id), dirty: true })),
  deleteEvents: (ids) => set((state) => { const targets = new Set(ids); if (!targets.size) return state; return { project: { ...state.project, events: state.project.events.filter((event) => !targets.has(event.id)) }, eventHistory: [...state.eventHistory, state.project.events], eventFuture: [], selectedEventId: null, selectedEventIds: [], dirty: true, status: `${targets.size} eventi rimossi · il percorso resta collegato` }; }),
  updateEvent: (id, patch) => set((state) => ({ project: { ...state.project, events: state.project.events.map((event) => event.id === id ? { ...event, ...patch, manualOverride: true } : event) }, eventHistory: [...state.eventHistory, state.project.events], eventFuture: [], dirty: true })),
  undoEvents: () => set((state) => { const previous = state.eventHistory.at(-1); if (!previous) return state; return { project: { ...state.project, events: previous }, eventHistory: state.eventHistory.slice(0, -1), eventFuture: [state.project.events, ...state.eventFuture], selectedEventId: null, selectedEventIds: [], dirty: true }; }),
  redoEvents: () => set((state) => { const next = state.eventFuture[0]; if (!next) return state; return { project: { ...state.project, events: next }, eventHistory: [...state.eventHistory, state.project.events], eventFuture: state.eventFuture.slice(1), selectedEventId: null, selectedEventIds: [], dirty: true }; }),
  markSaved: (project, filePath) => set({ project, filePath, dirty: false, status: "Progetto salvato" }),
  setStatus: (status) => set({ status })
}));
