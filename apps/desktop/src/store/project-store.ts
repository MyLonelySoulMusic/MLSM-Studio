import { create } from "zustand";
import { createProject, type RhythmBallProject } from "@rbs/project-schema";
import type { AudioMetadata } from "../services/audio-import";
import type { AudioAnalysisResult } from "@rbs/audio-analysis";
import {
  directProSubtitleAnimation,
  resolveProSubtitlePaletteColor
} from "../services/pro-subtitles";

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
  selectedEventId: string | null;
  selectedEventIds: string[];
  newProject: () => void;
  setProject: (project: RhythmBallProject, filePath: string | null) => void;
  renameProject: (name: string) => void;
  attachAudio: (metadata: AudioMetadata, waveform: number[], options?: AttachAudioOptions) => void;
  applyAnalysis: (result: AudioAnalysisResult) => void;
  setAspectRatio: (ratio: "9:16" | "16:9") => void;
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
  updatePixelArt: (patch: Partial<RhythmBallProject["animation"]["pixelArt"]>) => void;
  setPixelArtPalette: (colors: readonly string[]) => void;
  updateTeddyWalk: (patch: Partial<RhythmBallProject["animation"]["teddyWalk"]>) => void;
  setTeddyWalkPalette: (colors: readonly string[]) => void;
  updateTeddySing: (patch: Partial<RhythmBallProject["animation"]["teddySing"]>) => void;
  updateAddSubtitles: (patch: Partial<RhythmBallProject["animation"]["addSubtitles"]>) => void;
  updateProSubtitles: (patch: Partial<RhythmBallProject["animation"]["proSubtitles"]>) => void;
  setProSubtitlesPalette: (colors: readonly string[]) => void;
  updatePixelsSub: (patch: Partial<RhythmBallProject["animation"]["pixelsSub"]>) => void;
  setPixelsSubPalette: (colors: readonly string[]) => void;
  updateStaticWatermark: (patch: Partial<RhythmBallProject["animation"]["staticWatermark"]>) => void;
  updateUpscaler: (patch: Partial<RhythmBallProject["animation"]["upscaler"]>) => void;
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

export const useProjectStore = create<ProjectState>((set) => ({
  project: createProject(), filePath: null, dirty: false, status: "Pronto", eventHistory: [], eventFuture: [], selectedEventId: null, selectedEventIds: [],
  newProject: () => set({ project: createProject(), filePath: null, dirty: false, status: "Nuovo progetto creato", eventHistory: [], eventFuture: [], selectedEventId: null, selectedEventIds: [] }),
  setProject: (project, filePath) => set({ project, filePath, dirty: false, status: "Progetto caricato", eventHistory: [], eventFuture: [], selectedEventId: null, selectedEventIds: [] }),
  renameProject: (name) => set((state) => ({ project: { ...state.project, project: { ...state.project.project, name } }, dirty: true })),
  attachAudio: (metadata, waveform, options = {}) => set((state) => {
    const preserveSubtitleTrack = options.preserveSubtitleTrack === true;
    return {
      project: {
        ...state.project,
        audio: { sourcePath: metadata.path, storage: "external", hash: metadata.hash, durationSeconds: metadata.durationSeconds, sampleRate: metadata.sampleRate, channels: metadata.channels, globalOffsetMs: 0 },
        analysis: { ...state.project.analysis, waveform },
        animation: {
          ...state.project.animation,
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
  setAspectRatio: (aspectRatio) => set((state) => ({ project: { ...state.project, canvas: { ...state.project.canvas, aspectRatio, previewWidth: aspectRatio === "9:16" ? 540 : 960, previewHeight: aspectRatio === "9:16" ? 960 : 540, exportWidth: aspectRatio === "9:16" ? 1080 : 1920, exportHeight: aspectRatio === "9:16" ? 1920 : 1080 } }, dirty: true })),
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
  updatePixelArt: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, pixelArt: { ...state.project.animation.pixelArt, ...patch, hoodieColor: "#08090e" } } }, dirty: true })),
  setPixelArtPalette: (colors) => set((state) => {
    const settings = state.project.animation.pixelArt; const primary = colors[0] ?? settings.palettePrimary; const secondary = colors[1] ?? colors[2] ?? primary; const neonPrimary = colors[2] ?? primary; const neonSecondary = colors[3] ?? secondary;
    const pixelArt = { ...settings, palettePrimary: primary, paletteSecondary: secondary, hoodieColor: "#08090e", pantsColor: secondary, neonPrimary, neonSecondary };
    const subtitles = state.project.subtitles.autoPalette ? { ...state.project.subtitles, color: neonPrimary, glowColor: neonSecondary } : state.project.subtitles;
    return { project: { ...state.project, animation: { ...state.project.animation, pixelArt }, subtitles }, dirty: true, status: "Palette cover applicata a pantaloni e neon · felpa nera fissa" };
  }),
  updateTeddyWalk: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, teddyWalk: { ...state.project.animation.teddyWalk, ...patch } } }, dirty: true })),
  setTeddyWalkPalette: (colors) => set((state) => { const settings = state.project.animation.teddyWalk; return { project: { ...state.project, animation: { ...state.project.animation, teddyWalk: { ...settings, furColor: colors[0] ?? settings.furColor, patchColor: colors[1] ?? colors[0] ?? settings.patchColor, roadColor: colors[2] ?? colors[1] ?? settings.roadColor } } }, dirty: true }; }),
  updateTeddySing: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, teddySing: { ...state.project.animation.teddySing, ...patch } } }, dirty: true })),
  updateAddSubtitles: (patch) => set((state) => ({ project: { ...state.project, animation: { ...state.project.animation, addSubtitles: { ...state.project.animation.addSubtitles, ...patch } } }, dirty: true })),
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
  updateStaticWatermark: (patch) => set((state) => ({
    project: { ...state.project, animation: { ...state.project.animation, staticWatermark: { ...state.project.animation.staticWatermark, ...patch } } },
    dirty: true
  })),
  updateUpscaler: (patch) => set((state) => ({
    project: { ...state.project, animation: { ...state.project.animation, upscaler: { ...state.project.animation.upscaler, ...patch } } },
    dirty: true
  })),
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
