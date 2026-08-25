import type { RhythmBallProject } from "@rbs/project-schema";
import { videoEditorClipSourceDuration, videoEditorClipSourceTimeAtLocalSeconds, videoEditorClipTimelineDurationForSource, videoEditorClipTimelineTimeForSourceTime, videoEditorSpeedAtFrame, videoEditorSplitSpeed, videoEditorTrimSpeed } from "./video-editor-speed";

type SchemaVideoEditorSettings = RhythmBallProject["animation"]["videoEditor"];
type SchemaVideoEditorAsset = SchemaVideoEditorSettings["assets"][number];
type SchemaVideoEditorClip = SchemaVideoEditorSettings["clips"][number];
export type VideoEditorSettings = Omit<SchemaVideoEditorSettings, "assets" | "clips"> & { assets: VideoEditorAsset[]; clips: VideoEditorClip[] };
// Imported assets created by older callers may omit the optional frame metadata;
// the store hydrates them before persistence while UI helpers remain source-compatible.
export type VideoEditorAsset = Omit<SchemaVideoEditorAsset, "sourceFrameCount" | "sourceRate" | "frameIdentityId" | "timingMode"> & Partial<Pick<SchemaVideoEditorAsset, "sourceFrameCount" | "sourceRate" | "frameIdentityId" | "timingMode">>;
export type VideoEditorTrack = VideoEditorSettings["tracks"][number];
export type VideoEditorClip = Omit<SchemaVideoEditorClip, "speed" | "imageShadow" | "reversed"> & Partial<Pick<SchemaVideoEditorClip, "speed" | "imageShadow" | "reversed">>;
export type VideoEditorEffectClip = VideoEditorSettings["effectClips"][number];
export type VideoEditorAdjustments = VideoEditorClip["adjustments"];
export type VideoEditorBlendMode = VideoEditorClip["blendMode"];
export type VideoEditorFadeCurve = VideoEditorClip["fadeCurve"];

/** Il fotogramma minimo manipolabile: allineato al passo dei sottotitoli del resto dello studio. */
export const videoEditorFrameSeconds = 1 / 60;
/** Una clip non può scendere sotto due fotogrammi: sotto questa soglia il trim diventa impossibile da annullare a mano. */
export const videoEditorMinimumClipSeconds = videoEditorFrameSeconds * 2;
/** Le immagini non hanno durata propria: entrano in timeline con una durata editoriale standard ed estendibile a piacere. */
export const videoEditorDefaultImageSeconds = 4;
/** Limite superiore per l’estensione di un’immagine ferma (un’ora). Il limite è
 * applicato solo alle clip immagine nel service/store: video e audio restano
 * liberi di superare un’ora quando la sorgente lo consente. */
export const videoEditorMaximumImageSeconds = 3_600;

export interface VideoEditorTimebase {
  fpsNumerator: number;
  fpsDenominator: number;
  dropFrame: boolean;
}

export function videoEditorFrameRate(timebase: VideoEditorTimebase): number {
  const numerator = Number.isFinite(timebase.fpsNumerator) && timebase.fpsNumerator > 0 ? timebase.fpsNumerator : 60;
  const denominator = Number.isFinite(timebase.fpsDenominator) && timebase.fpsDenominator > 0 ? timebase.fpsDenominator : 1;
  return numerator / denominator;
}

export function videoEditorSecondsToFrame(seconds: number, timebase: VideoEditorTimebase, rounding: "floor" | "round" | "ceil" = "round"): number {
  const value = Math.max(0, seconds) * videoEditorFrameRate(timebase);
  return rounding === "floor" ? Math.floor(value) : rounding === "ceil" ? Math.ceil(value) : Math.round(value);
}

export function videoEditorFrameToSeconds(frame: number, timebase: VideoEditorTimebase): number {
  return Math.max(0, frame) / videoEditorFrameRate(timebase);
}

export function videoEditorQuantizeTime(seconds: number, timebase: VideoEditorTimebase): number {
  return round(videoEditorFrameToSeconds(videoEditorSecondsToFrame(seconds, timebase), timebase));
}

export function videoEditorFormatTimecode(frame: number, timebase: VideoEditorTimebase): string {
  const fps = Math.max(1, Math.round(videoEditorFrameRate(timebase)));
  const safe = Math.max(0, Math.round(frame));
  const dropFrames = timebase.dropFrame && timebase.fpsNumerator === 30_000 && timebase.fpsDenominator === 1_001 ? 2
    : timebase.dropFrame && timebase.fpsNumerator === 60_000 && timebase.fpsDenominator === 1_001 ? 4 : 0;
  const framesPerTenMinutes = fps * 600 - dropFrames * 9;
  const tenMinuteBlocks = dropFrames ? Math.floor(safe / framesPerTenMinutes) : 0;
  const remainder = dropFrames ? safe % framesPerTenMinutes : safe;
  const dropped = dropFrames ? dropFrames * 9 * tenMinuteBlocks + dropFrames * Math.max(0, Math.floor((remainder - dropFrames) / (fps * 60 - dropFrames))) : 0;
  const timecodeFrame = safe + dropped;
  const frames = timecodeFrame % fps;
  const totalSeconds = Math.floor(timecodeFrame / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${dropFrames ? ";" : ":"}${String(frames).padStart(2, "0")}`;
}

export interface VideoEditorComposition { width: number; height: number; label: string }

/**
 * Ricava una composizione dal media senza forzarlo nel 16:9. Conservare le dimensioni
 * della sorgente evita sia deformazioni sia upscaling impliciti; l'etichetta rende
 * immediatamente leggibili i rapporti editoriali più comuni.
 */
export function videoEditorCompositionForAsset(asset: VideoEditorAsset): VideoEditorComposition | null {
  if (asset.kind === "audio" || asset.width <= 0 || asset.height <= 0) return null;
  const width = Math.max(64, Math.min(7680, Math.round(asset.width / 2) * 2));
  const height = Math.max(64, Math.min(7680, Math.round(asset.height / 2) * 2));
  const ratio = width / height;
  const known = [
    { ratio: 16 / 9, label: "16:9" },
    { ratio: 9 / 16, label: "9:16" },
    { ratio: 1, label: "1:1" },
    { ratio: 4 / 5, label: "4:5" },
    { ratio: 5 / 4, label: "5:4" },
    { ratio: 4 / 3, label: "4:3" },
    { ratio: 3 / 4, label: "3:4" }
  ];
  const match = known.find((item) => Math.abs(item.ratio - ratio) <= .012);
  return { width, height, label: match?.label ?? `${width}:${height}` };
}

/** Etichetta compatta della composizione attiva, usata in pannello e monitor. */
export function videoEditorAspectLabel(width: number, height: number): string {
  const composition = videoEditorCompositionForAsset({ kind: "image", width, height } as VideoEditorAsset);
  return composition?.label ?? `${width}:${height}`;
}

export interface VideoEditorRange { startSeconds: number; endSeconds: number }
export interface VideoEditorSnapResult { timeSeconds: number; snapped: boolean; reason: "clipEdge" | "playhead" | "beat" | "origin" | "none" }

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  // Le posizioni vengono arrotondate al microsecondo: evita che il drag accumuli
  // errori in virgola mobile e produca micro-buchi invisibili fra due clip.
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function videoEditorClipEnd(clip: VideoEditorClip): number {
  return round(clip.startSeconds + clip.durationSeconds);
}

/** Durata reale del montaggio: il bordo destro della clip più lontana. */
export function videoEditorTimelineDuration(settings: VideoEditorSettings): number {
  return settings.clips.reduce((duration, clip) => Math.max(duration, videoEditorClipEnd(clip)), 0);
}

/**
 * Le clip seguono intervalli [start, end): a un taglio esatto appartiene soltanto
 * la clip che comincia in quel punto. Quando il trasporto e fermo esattamente alla
 * fine complessiva, campioniamo un epsilon prima per lasciare visibile l'ultimo frame.
 */
export function videoEditorPresentationTime(settings: VideoEditorSettings, timeSeconds: number): number {
  const duration = videoEditorTimelineDuration(settings);
  return duration > 0 && Math.abs(timeSeconds - duration) <= 1e-6
    ? Math.max(0, duration - 1e-6)
    : timeSeconds;
}

export function videoEditorAsset(settings: VideoEditorSettings, assetId: string): VideoEditorAsset | null {
  return settings.assets.find((asset) => asset.id === assetId) ?? null;
}

export function videoEditorClip(settings: VideoEditorSettings, clipId: string): VideoEditorClip | null {
  return settings.clips.find((clip) => clip.id === clipId) ?? null;
}

/**
 * Riordina un livello senza attribuirgli un ruolo speciale. L'indice zero è il
 * livello visivo più in alto: il compositor usa già questo stesso ordinamento.
 * La funzione è pura per condividere la semantica tra drag, pulsanti e store.
 */
export function videoEditorReorderTracks(tracks: readonly VideoEditorTrack[], trackId: string, requestedIndex: number): VideoEditorTrack[] {
  const sourceIndex = tracks.findIndex((track) => track.id === trackId);
  if (sourceIndex < 0 || tracks.length < 2) return [...tracks];
  const destinationIndex = Math.max(0, Math.min(tracks.length - 1, Math.round(requestedIndex)));
  if (sourceIndex === destinationIndex) return [...tracks];
  const reordered = [...tracks];
  const [track] = reordered.splice(sourceIndex, 1);
  reordered.splice(destinationIndex, 0, track!);
  return reordered;
}

/** Solo un’immagine è un fermo immagine. Un audio privo di durata valida non deve
 * essere promosso accidentalmente a still, altrimenti finirebbe su una traccia
 * video e riceverebbe il limite editoriale delle immagini. */
export function videoEditorAssetIsStill(asset: VideoEditorAsset | null): boolean {
  return asset === null || asset.kind === "image";
}

export function videoEditorClipMaximumDuration(clip: VideoEditorClip, asset: VideoEditorAsset | null, timebase: VideoEditorTimebase = { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false }): number {
  if (videoEditorAssetIsStill(asset)) return videoEditorMaximumImageSeconds;
  const availableSource = clip.reversed
    ? Math.min(asset!.durationSeconds, clip.sourceInSeconds + videoEditorClipSourceDuration(clip, timebase))
    : asset!.durationSeconds - clip.sourceInSeconds;
  return Math.max(videoEditorMinimumClipSeconds, round(videoEditorClipTimelineDurationForSource(availableSource, clip.speed, timebase)));
}

/**
 * Punti magnetici della timeline: i bordi delle altre clip, il playhead, l’origine e
 * — quando richiesto — la griglia ritmica dei media analizzati. È questa raccolta che
 * consente di accostare due video senza lasciare un vuoto al centro.
 */
export function videoEditorSnapCandidates(settings: VideoEditorSettings, options: { excludeClipIds?: readonly string[]; playheadSeconds?: number } = {}): { timeSeconds: number; reason: VideoEditorSnapResult["reason"] }[] {
  const excluded = new Set(options.excludeClipIds ?? []);
  const candidates: { timeSeconds: number; reason: VideoEditorSnapResult["reason"] }[] = [{ timeSeconds: 0, reason: "origin" }];
  for (const clip of settings.clips) {
    if (excluded.has(clip.id)) continue;
    candidates.push({ timeSeconds: round(clip.startSeconds), reason: "clipEdge" });
    candidates.push({ timeSeconds: videoEditorClipEnd(clip), reason: "clipEdge" });
  }
  if (typeof options.playheadSeconds === "number" && Number.isFinite(options.playheadSeconds)) candidates.push({ timeSeconds: round(options.playheadSeconds), reason: "playhead" });
  if (settings.snapToBeats) {
    for (const clip of settings.clips) {
      if (excluded.has(clip.id)) continue;
      const asset = videoEditorAsset(settings, clip.assetId);
      if (!asset?.beats.length) continue;
      const clipEnd = videoEditorClipEnd(clip);
      for (const beat of asset.beats) {
        // Le battute appartengono al materiale sorgente: vanno riportate sul tempo
        // di timeline tenendo conto del punto di attacco scelto con il trim.
        const timelineTime = videoEditorClipTimelineTimeForSourceTime(clip, beat, settings.timebase);
        if (timelineTime === null) continue;
        if (timelineTime >= clip.startSeconds && timelineTime <= clipEnd) candidates.push({ timeSeconds: timelineTime, reason: "beat" });
      }
    }
  }
  return candidates;
}

export function videoEditorSnap(requestedTime: number, candidates: readonly { timeSeconds: number; reason: VideoEditorSnapResult["reason"] }[], thresholdSeconds: number): VideoEditorSnapResult {
  let best: VideoEditorSnapResult = { timeSeconds: round(requestedTime), snapped: false, reason: "none" };
  let distance = thresholdSeconds;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate.timeSeconds - requestedTime);
    if (gap <= distance) { distance = gap; best = { timeSeconds: candidate.timeSeconds, snapped: true, reason: candidate.reason }; }
  }
  return best;
}

/** Sposta una clip mantenendone la durata, applicando la calamita a entrambi i bordi. */
export function videoEditorMoveClip(settings: VideoEditorSettings, clipId: string, requestedStart: number, playheadSeconds?: number): VideoEditorClip | null {
  const clip = videoEditorClip(settings, clipId);
  if (!clip) return null;
  // Keep pointer drags continuous for legacy projects; explicit cut/split and
  // alignment operations use the rational timebase helpers below.
  const rawStart = Math.max(0, requestedStart);
  if (!settings.snapEnabled) return { ...clip, startSeconds: round(rawStart) };
  const candidates = videoEditorSnapCandidates(settings, { excludeClipIds: [clipId], ...(typeof playheadSeconds === "number" ? { playheadSeconds } : {}) });
  const startSnap = videoEditorSnap(rawStart, candidates, settings.snapThresholdSeconds);
  const endSnap = videoEditorSnap(rawStart + clip.durationSeconds, candidates, settings.snapThresholdSeconds);
  // Vince il bordo più vicino: accostare la testa o la coda deve costare lo stesso gesto.
  const useEnd = endSnap.snapped && (!startSnap.snapped || Math.abs(endSnap.timeSeconds - (rawStart + clip.durationSeconds)) < Math.abs(startSnap.timeSeconds - rawStart));
  const startSeconds = useEnd ? Math.max(0, round(endSnap.timeSeconds - clip.durationSeconds)) : startSnap.timeSeconds;
  return { ...clip, startSeconds: round(startSeconds) };
}

/**
 * Trascina un bordo della clip. Sul bordo sinistro si muovono insieme posizione e punto
 * di attacco nella sorgente, così il fotogramma sotto il cursore resta lo stesso.
 */
export function videoEditorTrimClip(settings: VideoEditorSettings, clipId: string, edge: "start" | "end", requestedTime: number, playheadSeconds?: number): VideoEditorClip | null {
  const clip = videoEditorClip(settings, clipId);
  if (!clip) return null;
  const asset = videoEditorAsset(settings, clip.assetId);
  const still = videoEditorAssetIsStill(asset);
  const candidates = settings.snapEnabled ? videoEditorSnapCandidates(settings, { excludeClipIds: [clipId], ...(typeof playheadSeconds === "number" ? { playheadSeconds } : {}) }) : [];
  const snapped = settings.snapEnabled ? videoEditorSnap(requestedTime, candidates, settings.snapThresholdSeconds).timeSeconds : round(requestedTime);
  const clipEnd = videoEditorClipEnd(clip);
  if (edge === "start") {
    // Un fermo immagine può crescere fino all’origine della timeline; un video si
    // ferma dove finisce il materiale già consumato dal punto di attacco.
    const consumedSource = videoEditorClipSourceDuration(clip, settings.timebase);
    const sourceRoom = clip.reversed
      ? Math.max(0, (asset?.durationSeconds ?? consumedSource) - clip.sourceInSeconds - consumedSource)
      : clip.sourceInSeconds;
    const upstreamTimeline = sourceRoom / videoEditorSpeedAtFrame(clip.speed, .5);
    const earliest = still ? Math.max(0, clipEnd - videoEditorMaximumImageSeconds) : Math.max(0, clip.startSeconds - upstreamTimeline);
    const startSeconds = clamp(snapped, earliest, clipEnd - videoEditorMinimumClipSeconds);
    const frameRate = videoEditorFrameRate(settings.timebase);
    const startFrame = (startSeconds - clip.startSeconds) * frameRate;
    const durationFrames = (clipEnd - startSeconds) * frameRate;
    const speed = videoEditorTrimSpeed(clip.speed, startFrame, durationFrames);
    return {
      ...clip,
      startSeconds: round(startSeconds),
      durationSeconds: round(clipEnd - startSeconds),
      sourceInSeconds: still || clip.reversed ? clip.sourceInSeconds : round(Math.max(0, startSeconds < clip.startSeconds
        ? clip.sourceInSeconds + (startSeconds - clip.startSeconds) * videoEditorSpeedAtFrame(clip.speed, 0)
        : videoEditorSourceTime(clip, startSeconds, settings.timebase))),
      ...(speed ? { speed } : {})
    };
  }
  const maximumEnd = round(clip.startSeconds + videoEditorClipMaximumDuration(clip, asset, settings.timebase));
  const endSeconds = clamp(snapped, clip.startSeconds + videoEditorMinimumClipSeconds, maximumEnd);
  const durationSeconds = round(endSeconds - clip.startSeconds);
  const durationFrames = durationSeconds * videoEditorFrameRate(settings.timebase);
  const speed = videoEditorTrimSpeed(clip.speed, 0, durationFrames);
  const sourceInSeconds = clip.reversed
    ? round(Math.max(0, clip.sourceInSeconds + videoEditorClipSourceDuration(clip, settings.timebase)
      - videoEditorClipSourceDuration({ ...clip, durationSeconds, ...(speed ? { speed } : {}) }, settings.timebase)))
    : clip.sourceInSeconds;
  return { ...clip, durationSeconds, sourceInSeconds, ...(speed ? { speed } : {}) };
}

/** Taglia la clip nel punto richiesto e restituisce le due metà, dissolvenze incluse. */
export function videoEditorSplitClip(clip: VideoEditorClip, requestedTime: number, newClipId: string, timebase: VideoEditorTimebase = { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false }): readonly [VideoEditorClip, VideoEditorClip] | null {
  const clipEnd = videoEditorClipEnd(clip);
  if (requestedTime <= clip.startSeconds + videoEditorMinimumClipSeconds || requestedTime >= clipEnd - videoEditorMinimumClipSeconds) return null;
  const cut = round(requestedTime);
  const leftDuration = round(cut - clip.startSeconds);
  const rightDuration = round(clipEnd - cut);
  // La dissolvenza in entrata resta a sinistra e quella in uscita a destra: ciascuna
  // metà viene poi limitata alla propria durata per non superare il taglio.
  const sourceAtCut = videoEditorSourceTime(clip, cut, timebase);
  const localFrame = leftDuration * videoEditorFrameRate(timebase);
  const [leftSpeed, rightSpeed] = videoEditorSplitSpeed(clip.speed, localFrame);
  const left: VideoEditorClip = {
    ...clip,
    sourceInSeconds: clip.reversed ? sourceAtCut : clip.sourceInSeconds,
    durationSeconds: leftDuration,
    fadeInSeconds: Math.min(clip.fadeInSeconds, leftDuration),
    fadeOutSeconds: 0,
    audioFadeInSeconds: Math.min(clip.audioFadeInSeconds, leftDuration),
    audioFadeOutSeconds: 0,
    ...(leftSpeed ? { speed: leftSpeed } : {})
  };
  const right: VideoEditorClip = {
    ...clip,
    id: newClipId,
    startSeconds: cut,
    durationSeconds: rightDuration,
    sourceInSeconds: clip.reversed ? clip.sourceInSeconds : sourceAtCut,
    fadeInSeconds: 0,
    fadeOutSeconds: Math.min(clip.fadeOutSeconds, rightDuration),
    audioFadeInSeconds: 0,
    audioFadeOutSeconds: Math.min(clip.audioFadeOutSeconds, rightDuration),
    ...(rightSpeed ? { speed: rightSpeed } : {})
  };
  return [left, right];
}

/** Impacchetta le clip di una traccia contro l’origine, azzerando ogni vuoto residuo. */
export function videoEditorCloseGaps(clips: readonly VideoEditorClip[], trackId: string): VideoEditorClip[] {
  const ordered = clips.filter((clip) => clip.trackId === trackId).slice().sort((left, right) => left.startSeconds - right.startSeconds);
  let cursor = 0;
  const moved = new Map<string, number>();
  for (const clip of ordered) { moved.set(clip.id, round(cursor)); cursor = round(cursor + clip.durationSeconds); }
  return clips.map((clip) => moved.has(clip.id) ? { ...clip, startSeconds: moved.get(clip.id)! } : clip);
}

export interface VideoEditorSyncResult { clips: VideoEditorClip[]; offsetSeconds: number; matchedBeats: number; strategy: "beatGrid" | "clipStart" }

export interface VideoEditorFrameAlignmentResult {
  clips: VideoEditorClip[];
  referenceFrameCount: number;
  alignedClipIds: string[];
  strategy: "sourceOrdinal";
}

export function videoEditorFrameAlignmentReason(settings: VideoEditorSettings, referenceClipId: string, targetClipIds: readonly string[]): string | null {
  if (targetClipIds.length === 0) return "Seleziona almeno due clip video.";
  const ids = [referenceClipId, ...targetClipIds];
  const metadata = ids.map((id) => {
    const clip = videoEditorClip(settings, id);
    return clip ? videoEditorAsset(settings, clip.assetId) : null;
  });
  if (metadata.some((asset) => !asset || asset.kind === "audio")) return "L’allineamento per frame richiede clip video valide.";
  const first = metadata[0]!;
  if (!first.sourceFrameCount || !first.sourceRate) return "Metadati frame non disponibili per la clip di riferimento.";
  if (metadata.some((asset) => asset!.sourceFrameCount !== first.sourceFrameCount)) return "Le clip devono avere lo stesso numero di frame.";
  if (metadata.some((asset) => !asset!.sourceRate || asset!.sourceRate.numerator * first.sourceRate!.denominator !== first.sourceRate!.numerator * asset!.sourceRate.denominator)) return "Le clip devono avere lo stesso frame rate.";
  const sourceRate = first.sourceRate.numerator / first.sourceRate.denominator;
  if (!Number.isInteger(videoEditorFrameRate(settings.timebase) / sourceRate)) return "Il frame rate sorgente non è rappresentabile esattamente nel timebase del progetto.";
  const reference = videoEditorClip(settings, referenceClipId)!;
  if (Math.abs(videoEditorQuantizeTime(reference.startSeconds, settings.timebase) - reference.startSeconds) > 1e-7) return "La clip di riferimento non è sulla griglia frame del progetto: quantizzala prima dell’allineamento esatto.";
  const referenceOrdinal = Math.min(first.sourceFrameCount - 1, Math.round(videoEditorSourceTime(reference, reference.startSeconds, settings.timebase) * sourceRate));
  for (const id of targetClipIds) {
    const target = videoEditorClip(settings, id)!;
    const targetOrdinal = Math.min(first.sourceFrameCount - 1, Math.round(videoEditorSourceTime(target, target.startSeconds, settings.timebase) * sourceRate));
    if (reference.startSeconds + (targetOrdinal - referenceOrdinal) / sourceRate < 0) return "L’allineamento esatto richiederebbe una posizione negativa in timeline.";
  }
  return null;
}

/**
 * Aligns clips by source frame ordinal rather than floating-point duration. This is
 * intentionally strict: an exact frame merge is only claimed when every selected
 * source has the same frame count and constant frame rate. Upscaled/restored media
 * can therefore be composited without ghosting, while incompatible material gets a
 * truthful no-op instead of a plausible-looking but wrong offset.
 */
export function videoEditorAlignClipsByFrame(settings: VideoEditorSettings, referenceClipId: string, targetClipIds: readonly string[]): VideoEditorFrameAlignmentResult | null {
  const reference = videoEditorClip(settings, referenceClipId);
  if (!reference) return null;
  const referenceAsset = videoEditorAsset(settings, reference.assetId);
  const frameCount = referenceAsset?.sourceFrameCount ?? 0;
  const sourceRate = referenceAsset?.sourceRate ?? { numerator: 60, denominator: 1 };
  if (!referenceAsset || frameCount <= 0 || !sourceRate || videoEditorFrameAlignmentReason(settings, referenceClipId, targetClipIds)) return null;
  const rate = sourceRate.numerator / sourceRate.denominator;
  if (!(rate > 0)) return null;
  const targets = targetClipIds
    .map((id) => videoEditorClip(settings, id))
    .filter((clip): clip is VideoEditorClip => Boolean(clip && clip.id !== referenceClipId));
  if (!targets.length) return null;
  const metadata = targets.map((clip) => videoEditorAsset(settings, clip.assetId));
  if (metadata.some((asset) => !asset || asset.sourceFrameCount !== frameCount || !asset.sourceRate || Math.abs((asset.sourceRate.numerator / asset.sourceRate.denominator) - rate) > 1e-6)) return null;
  const timebase = settings.timebase;
  const projectRate = videoEditorFrameRate(timebase);
  if (!Number.isInteger(projectRate / rate)) return null;
  const sourceOrdinal = (clip: VideoEditorClip, asset: VideoEditorAsset): number => {
    const rate = asset.sourceRate ?? sourceRate;
    return Math.max(0, Math.min(frameCount - 1, Math.round(videoEditorSourceTime(clip, clip.startSeconds, settings.timebase) * rate.numerator / rate.denominator)));
  };
  const referenceOrdinal = sourceOrdinal(reference, referenceAsset);
  const targetOrdinals = targets.map((target, index) => sourceOrdinal(target, metadata[index]!));
  if (targetOrdinals.some((targetOrdinal) => reference.startSeconds + (targetOrdinal - referenceOrdinal) / rate < 0)) return null;
  const clips = settings.clips.slice();
  const alignedClipIds: string[] = [];
  targets.forEach((target, index) => {
    const targetOrdinal = targetOrdinals[index]!;
    const rawStart = reference.startSeconds + (targetOrdinal - referenceOrdinal) / rate;
    const start = videoEditorQuantizeTime(rawStart, timebase);
    const clipIndex = clips.findIndex((candidate) => candidate.id === target.id);
    if (clipIndex >= 0) {
      clips[clipIndex] = { ...target, startSeconds: start };
      alignedClipIds.push(target.id);
    }
  });
  return { clips, referenceFrameCount: frameCount, alignedClipIds, strategy: "sourceOrdinal" };
}

/**
 * Sincronizza le clip selezionate su una clip di riferimento come fa CapCut: quando
 * entrambe portano una griglia ritmica analizzata, allinea le battute cercando lo
 * scarto che ne fa combaciare il maggior numero; altrimenti allinea gli attacchi.
 */
export function videoEditorSyncClips(settings: VideoEditorSettings, referenceClipId: string, targetClipIds: readonly string[]): VideoEditorSyncResult | null {
  const reference = videoEditorClip(settings, referenceClipId);
  if (!reference) return null;
  const referenceAsset = videoEditorAsset(settings, reference.assetId);
  const targets = targetClipIds.map((id) => videoEditorClip(settings, id)).filter((clip): clip is VideoEditorClip => clip !== null && clip.id !== referenceClipId);
  if (!targets.length) return null;

  const timelineBeats = (clip: VideoEditorClip, asset: VideoEditorAsset | null): number[] => {
    if (!asset?.beats.length) return [];
    const clipEnd = videoEditorClipEnd(clip);
    return asset.beats
      .map((beat) => videoEditorClipTimelineTimeForSourceTime(clip, beat, settings.timebase))
      .filter((time): time is number => time !== null)
      .filter((time) => time >= clip.startSeconds && time <= clipEnd);
  };

  const referenceBeats = timelineBeats(reference, referenceAsset);
  const tolerance = .045;
  let matchedBeats = 0;
  let strategy: VideoEditorSyncResult["strategy"] = "clipStart";
  const clips = settings.clips.slice();
  let lastOffset = 0;

  for (const target of targets) {
    const targetAsset = videoEditorAsset(settings, target.assetId);
    const candidateBeats = timelineBeats(target, targetAsset);
    let offsetSeconds = round(reference.startSeconds - target.startSeconds);
    if (referenceBeats.length && candidateBeats.length) {
      // Ogni coppia di battute propone uno scarto; vince quello che allinea più battute.
      let bestScore = -1;
      let bestOffset = offsetSeconds;
      for (const referenceBeat of referenceBeats) {
        for (const candidateBeat of candidateBeats) {
          const offset = round(referenceBeat - candidateBeat);
          if (target.startSeconds + offset < 0) continue;
          let score = 0;
          for (const beat of candidateBeats) {
            const shifted = beat + offset;
            if (referenceBeats.some((value) => Math.abs(value - shifted) <= tolerance)) score += 1;
          }
          // A pari punteggio si preferisce lo spostamento più piccolo: la sincronizzazione
          // non deve teletrasportare la clip lontano da dove l’utente l’ha messa.
          if (score > bestScore || (score === bestScore && Math.abs(offset) < Math.abs(bestOffset))) { bestScore = score; bestOffset = offset; }
        }
      }
      if (bestScore > 0) { offsetSeconds = bestOffset; matchedBeats = Math.max(matchedBeats, bestScore); strategy = "beatGrid"; }
    }
    const startSeconds = round(Math.max(0, target.startSeconds + offsetSeconds));
    lastOffset = round(startSeconds - target.startSeconds);
    const index = clips.findIndex((clip) => clip.id === target.id);
    if (index >= 0) clips[index] = { ...target, startSeconds };
  }
  return { clips, offsetSeconds: lastOffset, matchedBeats, strategy };
}

export function videoEditorFadeCurveValue(progress: number, curve: VideoEditorFadeCurve): number {
  const value = clamp(progress, 0, 1);
  // "smooth" usa una smoothstep: è la dissolvenza percettivamente lineare usata dai
  // montatori professionali, senza lo scatto iniziale della rampa lineare pura.
  if (curve === "smooth") return value * value * (3 - 2 * value);
  if (curve === "exponential") return value === 0 ? 0 : Math.pow(value, 2.2);
  return value;
}

/** Opacità della clip nel tempo di timeline, dissolvenze e opacità manuale incluse. */
export function videoEditorClipOpacity(clip: VideoEditorClip, timeSeconds: number): number {
  const local = timeSeconds - clip.startSeconds;
  if (local < 0 || local >= clip.durationSeconds) return 0;
  let opacity = clip.adjustments.opacity;
  if (clip.fadeInSeconds > 0 && local < clip.fadeInSeconds) opacity *= videoEditorFadeCurveValue(local / clip.fadeInSeconds, clip.fadeCurve);
  const fromEnd = clip.durationSeconds - local;
  if (clip.fadeOutSeconds > 0 && fromEnd < clip.fadeOutSeconds) opacity *= videoEditorFadeCurveValue(fromEnd / clip.fadeOutSeconds, clip.fadeCurve);
  return clamp(opacity, 0, 1);
}

/** Guadagno audio della clip: silenzio se mutata, dissolvenze audio indipendenti dal video. */
export function videoEditorClipGain(clip: VideoEditorClip, track: VideoEditorTrack | null, timeSeconds: number): number {
  if (clip.muted || track?.muted) return 0;
  const local = timeSeconds - clip.startSeconds;
  if (local < 0 || local >= clip.durationSeconds) return 0;
  let gain = clip.volume * (track?.volume ?? 1);
  if (clip.audioFadeInSeconds > 0 && local < clip.audioFadeInSeconds) gain *= videoEditorFadeCurveValue(local / clip.audioFadeInSeconds, clip.fadeCurve);
  const fromEnd = clip.durationSeconds - local;
  if (clip.audioFadeOutSeconds > 0 && fromEnd < clip.audioFadeOutSeconds) gain *= videoEditorFadeCurveValue(fromEnd / clip.audioFadeOutSeconds, clip.fadeCurve);
  return clamp(gain, 0, 2);
}

/** Tempo nella sorgente corrispondente a un istante di timeline. */
export function videoEditorSourceTime(clip: VideoEditorClip, timeSeconds: number, timebase?: VideoEditorTimebase): number {
  const base = timebase ?? { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false };
  return videoEditorClipSourceTimeAtLocalSeconds(clip, timeSeconds - clip.startSeconds, base);
}

export interface VideoEditorLayer { clip: VideoEditorClip; track: VideoEditorTrack; opacity: number; sourceTimeSeconds: number }

/**
 * Livelli visibili a un dato istante, dal fondo verso l’alto: l’ordine delle tracce
 * in timeline viene invertito, così la traccia in cima resta quella disegnata per ultima.
 */
export function videoEditorVisibleLayers(settings: VideoEditorSettings, timeSeconds: number): VideoEditorLayer[] {
  const presentationTime = videoEditorPresentationTime(settings, timeSeconds);
  const layers: VideoEditorLayer[] = [];
  for (let index = settings.tracks.length - 1; index >= 0; index -= 1) {
    const track = settings.tracks[index]!;
    if (track.kind !== "video" || track.hidden) continue;
    for (const clip of settings.clips) {
      if (clip.trackId !== track.id) continue;
      const legacyOpacity = videoEditorClipOpacity(clip, presentationTime);
      const opacity = legacyOpacity * settings.effectClips.reduce((value, effect) => {
        if (!effect.enabled || effect.target.kind !== "clip" || effect.target.clipId !== clip.id) return value;
        if (effect.effectId !== "fade-in" && effect.effectId !== "fade-out") return value;
        const progress = clamp((presentationTime - effect.startSeconds) / Math.max(videoEditorFrameSeconds, effect.durationSeconds), 0, 1);
        const curve = effect.parameters.curve === "linear" || effect.parameters.curve === "exponential" ? effect.parameters.curve : "smooth";
        const shaped = videoEditorFadeCurveValue(progress, curve);
        const envelope = effect.effectId === "fade-in"
          ? presentationTime < effect.startSeconds ? 0 : presentationTime >= effect.startSeconds + effect.durationSeconds ? 1 : shaped
          : presentationTime < effect.startSeconds ? 1 : presentationTime >= effect.startSeconds + effect.durationSeconds ? 0 : 1 - shaped;
        return value * (1 - effect.mix + envelope * effect.mix);
      }, 1);
      if (opacity <= 0) continue;
      layers.push({ clip, track, opacity, sourceTimeSeconds: videoEditorSourceTime(clip, presentationTime, settings.timebase) });
    }
  }
  return layers;
}

/** Clip audibili a un dato istante: tracce audio più audio dei video non mutati. */
export function videoEditorAudibleClips(settings: VideoEditorSettings, timeSeconds: number): { clip: VideoEditorClip; gain: number; sourceTimeSeconds: number }[] {
  const audible: { clip: VideoEditorClip; gain: number; sourceTimeSeconds: number }[] = [];
  for (const clip of settings.clips) {
    const track = settings.tracks.find((item) => item.id === clip.trackId) ?? null;
    const asset = videoEditorAsset(settings, clip.assetId);
    if (!asset || (asset.kind !== "audio" && !asset.hasAudio)) continue;
    const gain = videoEditorClipGain(clip, track, timeSeconds);
    if (gain <= 0) continue;
    audible.push({ clip, gain, sourceTimeSeconds: videoEditorSourceTime(clip, timeSeconds, settings.timebase) });
  }
  return audible;
}

export interface VideoEditorPlacement { trackId: string; startSeconds: number; durationSeconds: number }

/** Aggiunge un media in coda alla traccia adatta, senza sovrapposizioni e senza vuoti. */
export function videoEditorAppendPlacement(settings: VideoEditorSettings, asset: VideoEditorAsset, preferredTrackId?: string): VideoEditorPlacement | null {
  const kind = asset.kind === "audio" ? "audio" : "video";
  const track = settings.tracks.find((item) => item.id === preferredTrackId && !item.locked && item.kind === kind)
    ?? [...settings.tracks].reverse().find((item) => item.kind === kind && !item.locked)
    ?? null;
  if (!track) return null;
  const startSeconds = settings.clips
    .filter((clip) => clip.trackId === track.id)
    .reduce((cursor, clip) => Math.max(cursor, videoEditorClipEnd(clip)), 0);
  const durationSeconds = videoEditorAssetIsStill(asset) ? videoEditorDefaultImageSeconds : round(Math.max(videoEditorMinimumClipSeconds, asset.durationSeconds));
  return { trackId: track.id, startSeconds: round(startSeconds), durationSeconds };
}

export function videoEditorBlendModeLabel(mode: VideoEditorBlendMode): string {
  const labels: Record<VideoEditorBlendMode, string> = {
    normal: "Normale", multiply: "Moltiplica", screen: "Scolora", overlay: "Sovrapponi",
    darken: "Scurisci", lighten: "Schiarisci", "color-dodge": "Scolora colore", "color-burn": "Brucia colore",
    "hard-light": "Luce intensa", "soft-light": "Luce soffusa", difference: "Differenza", exclusion: "Esclusione",
    hue: "Tonalità", saturation: "Saturazione", color: "Colore", luminosity: "Luminosità"
  };
  return labels[mode];
}
