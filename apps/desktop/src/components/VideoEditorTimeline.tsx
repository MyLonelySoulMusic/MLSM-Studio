import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { requestVideoEditorTransport, useVideoEditorPlayback } from "../store/video-editor-playback-store";
import {
  videoEditorAsset,
  videoEditorClip,
  videoEditorClipEnd,
  videoEditorFrameSeconds,
  videoEditorSnap,
  videoEditorSnapCandidates,
  videoEditorTimelineDuration,
  videoEditorFrameAlignmentReason,
  videoEditorFrameToSeconds,
  videoEditorQuantizeTime,
  videoEditorTrimClip,
  type VideoEditorClip,
  type VideoEditorEffectClip,
  type VideoEditorTrack
} from "../services/video-editor";
import {
  videoEditorEffectClipEnd,
  videoEditorEffectDefinition,
  videoEditorEffectDragType,
  videoEditorEffectTimelineIcon,
  videoEditorMoveEffect,
  videoEditorTrimEffect
} from "../services/video-editor-effects";
import { VideoEditorClipWaveform } from "./VideoEditorClipWaveform";
import { videoEditorAssetDragType, videoEditorAssetKindDragType } from "../services/video-editor-import";

/** Altezza di una traccia in timeline: le clip video mostrano etichetta e onda, quelle audio la sola onda. */
const trackHeight = 52;
/** Altezza di ogni sottocorsia: gli effetti coincidenti restano entrambi visibili e manipolabili. */
const effectSublaneHeight = 44;
/** Coda di timeline sempre visibile oltre l’ultima clip: dà spazio per allungare o aggiungere. */
const tailSeconds = 4;
/** Larghezza di base della timeline in secondi quando il montaggio è ancora vuoto. */
const emptySpanSeconds = 12;
/** Formato interno del drag dei livelli: distinto dai media e dagli effetti. */
const videoEditorTrackDragType = "application/x-mlsm-video-editor-track";

interface ContextMenuState { x: number; y: number; clipId: string }
interface DragPreview { clipId: string; startSeconds: number; durationSeconds: number; snapped: boolean }
interface EffectDragPreview { effectId: string; startSeconds: number; durationSeconds: number; snapped: boolean }
interface EffectSublaneLayout { rows: ReadonlyMap<string, number>; count: number }

/**
 * Interval partitioning stabile: effetti che si toccano possono condividere una riga,
 * quelli che si sovrappongono vengono impilati. L'indice originale risolve in modo
 * deterministico le istanze con gli stessi identici bordi senza dipendere dal UUID.
 */
function effectSublaneLayout(effects: readonly VideoEditorEffectClip[]): EffectSublaneLayout {
  const ordered = effects
    .map((effect, index) => ({ effect, index }))
    .sort((left, right) => left.effect.startSeconds - right.effect.startSeconds
      || videoEditorEffectClipEnd(left.effect) - videoEditorEffectClipEnd(right.effect)
      || left.index - right.index);
  const rowEnds: number[] = [];
  const rows = new Map<string, number>();
  for (const { effect } of ordered) {
    const start = effect.startSeconds;
    let row = rowEnds.findIndex((end) => end <= start + 1e-6);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = videoEditorEffectClipEnd(effect);
    rows.set(effect.id, row);
  }
  return { rows, count: Math.max(1, rowEnds.length) };
}

function formatTime(time: number): string {
  const safe = Math.max(0, time);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe % 1) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function automationMarkerPosition(settings: ReturnType<typeof useProjectStore.getState>["project"]["animation"]["videoEditor"], frame: number): string {
  const fps = settings.timebase.fpsNumerator / settings.timebase.fpsDenominator;
  const totalFrames = Math.max(1, Math.ceil(videoEditorTimelineDuration(settings) * fps));
  return `${Math.min(100, Math.max(0, frame / totalFrames * 100))}%`;
}

interface PointerSessionHandlers { move: (event: PointerEvent) => void; end: (event: PointerEvent) => void; cancel?: () => void }

export function VideoEditorTimeline({ timelineHeight = 300, onResizeHeight }: { timelineHeight?: number; onResizeHeight?: (height: number) => void }) {
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const moveClip = useProjectStore((state) => state.moveVideoEditorClip);
  const moveClipToTrack = useProjectStore((state) => state.moveVideoEditorClipToTrack);
  const trimClip = useProjectStore((state) => state.trimVideoEditorClip);
  const splitClip = useProjectStore((state) => state.splitVideoEditorClip);
  const duplicateClip = useProjectStore((state) => state.duplicateVideoEditorClip);
  const deleteClips = useProjectStore((state) => state.deleteVideoEditorClips);
  const selectClip = useProjectStore((state) => state.selectVideoEditorClip);
  const selectClips = useProjectStore((state) => state.selectVideoEditorClips);
  const syncClips = useProjectStore((state) => state.syncVideoEditorClips);
  const alignClipsByFrame = useProjectStore((state) => state.alignVideoEditorClipsByFrame);
  const closeGaps = useProjectStore((state) => state.closeVideoEditorGaps);
  const updateClip = useProjectStore((state) => state.updateVideoEditorClip);
  const updateSettings = useProjectStore((state) => state.updateVideoEditor);
  const updateTrack = useProjectStore((state) => state.updateVideoEditorTrack);
  const reorderTrack = useProjectStore((state) => state.reorderVideoEditorTrack);
  const addTrack = useProjectStore((state) => state.addVideoEditorTrack);
  const addClip = useProjectStore((state) => state.addVideoEditorClip);
  const addEffect = useProjectStore((state) => state.addVideoEditorEffectClip);
  const moveEffect = useProjectStore((state) => state.moveVideoEditorEffectClip);
  const trimEffect = useProjectStore((state) => state.trimVideoEditorEffectClip);
  const deleteEffects = useProjectStore((state) => state.deleteVideoEditorEffectClips);
  const selectEffect = useProjectStore((state) => state.selectVideoEditorEffectClip);
  const upsertKeyframe = useProjectStore((state) => state.upsertVideoEditorKeyframe);
  const removeKeyframe = useProjectStore((state) => state.removeVideoEditorKeyframe);

  const currentTime = useVideoEditorPlayback((state) => state.currentTime);
  const playing = useVideoEditorPlayback((state) => state.playing);
  const looping = useVideoEditorPlayback((state) => state.looping);
  const zoom = useVideoEditorPlayback((state) => state.zoom);
  const setCurrentTime = useVideoEditorPlayback((state) => state.setCurrentTime);
  const setLooping = useVideoEditorPlayback((state) => state.setLooping);
  const setZoom = useVideoEditorPlayback((state) => state.setZoom);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [effectPreview, setEffectPreview] = useState<EffectDragPreview | null>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const pointerSessionCleanups = useRef(new Set<() => void>());

  const duration = useMemo(() => videoEditorTimelineDuration(settings), [settings]);
  // La scala include sempre una coda: senza di essa una clip trascinata oltre la fine
  // uscirebbe dall’area visibile proprio mentre la si sta posizionando.
  const span = Math.max(emptySpanSeconds, duration + tailSeconds);
  const selected = settings.selectedClipIds;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedEffects = settings.selectedEffectClipIds;
  const selectedEffectSet = useMemo(() => new Set(selectedEffects), [selectedEffects]);
  const activeClipId = selected[selected.length - 1] ?? null;
  const effectLayout = useMemo(() => effectSublaneLayout(settings.effectClips), [settings.effectClips]);
  const effectLaneHeight = effectLayout.count * effectSublaneHeight;
  const totalLanesHeight = effectLaneHeight + settings.tracks.length * trackHeight;

  useEffect(() => () => {
    for (const cleanupSession of [...pointerSessionCleanups.current]) cleanupSession();
    pointerSessionCleanups.current.clear();
  }, []);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", dismiss);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("blur", dismiss); };
  }, [menu]);

  const startPointerSession = (sourceEvent: ReactPointerEvent<HTMLElement>, handlers: PointerSessionHandlers) => {
    const target = sourceEvent.currentTarget;
    const pointerId = Number.isFinite(sourceEvent.pointerId) ? sourceEvent.pointerId : null;
    let active = true;
    const matchesSession = (pointer: PointerEvent) => pointerId === null || !Number.isFinite(pointer.pointerId) || pointer.pointerId === pointerId;
    const cleanupSession = () => {
      if (!active) return;
      active = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      target.removeEventListener("lostpointercapture", lostPointerCapture);
      pointerSessionCleanups.current.delete(cleanupSession);
      if (pointerId !== null && typeof target.hasPointerCapture === "function" && target.hasPointerCapture(pointerId)) {
        try { target.releasePointerCapture(pointerId); } catch { /* Il browser può averlo già rilasciato. */ }
      }
    };
    const move = (pointer: PointerEvent) => { if (active && matchesSession(pointer)) handlers.move(pointer); };
    const end = (pointer: PointerEvent) => { if (!active || !matchesSession(pointer)) return; cleanupSession(); handlers.end(pointer); };
    const cancel = (pointer: PointerEvent) => { if (!active || !matchesSession(pointer)) return; cleanupSession(); handlers.cancel?.(); };
    const lostPointerCapture = (lost: Event) => cancel(lost as PointerEvent);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    target.addEventListener("lostpointercapture", lostPointerCapture);
    pointerSessionCleanups.current.add(cleanupSession);
    if (pointerId !== null && typeof target.setPointerCapture === "function") {
      try { target.setPointerCapture(pointerId); } catch { /* I listener su window restano il fallback. */ }
    }
  };

  const timeAtPointer = (clientX: number): number => {
    const element = lanes.current;
    if (!element) return 0;
    const bounds = element.getBoundingClientRect();
    return Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width) * span);
  };

  /** La traccia sotto il cursore: consente di spostare una clip da una traccia all’altra durante il drag. */
  const trackAtPointer = (clientY: number): VideoEditorTrack | null => {
    const element = lanes.current;
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    const mediaOffset = clientY - bounds.top - effectLaneHeight;
    if (mediaOffset < 0) return null;
    const index = Math.floor(mediaOffset / trackHeight);
    return settings.tracks[Math.max(0, Math.min(settings.tracks.length - 1, index))] ?? null;
  };

  const beginTimelineResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (!onResizeHeight) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = timelineHeight;
    startPointerSession(event, {
      move: (pointer) => onResizeHeight(startHeight + startY - pointer.clientY),
      end: (pointer) => onResizeHeight(startHeight + startY - pointer.clientY)
    });
  };

  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    setCurrentTime(Math.min(span, timeAtPointer(event.clientX)));
    startPointerSession(event, {
      move: (pointer) => setCurrentTime(Math.min(span, timeAtPointer(pointer.clientX))),
      end: (pointer) => setCurrentTime(Math.min(span, timeAtPointer(pointer.clientX)))
    });
  };

  const dropAsset = (event: ReactDragEvent<HTMLDivElement>, track: VideoEditorTrack) => {
    event.preventDefault();
    if (track.locked) return;
    const assetId = event.dataTransfer.getData(videoEditorAssetDragType);
    if (!assetId) return;
    const asset = videoEditorAsset(settings, assetId);
    if (!asset) return;
    const draggedKind = event.dataTransfer.getData(videoEditorAssetKindDragType);
    const expectedKind = asset.kind === "audio" ? "audio" : "video";
    // The kind travels with the drag so a stale/forged payload cannot be used to
    // route a media item to an incompatible lane. Legacy drags without the
    // secondary type are accepted only after validating the asset in the store.
    if ((draggedKind && draggedKind !== asset.kind) || track.kind !== expectedKind) return;
    // WebViews/JSDOM possono consegnare un DragEvent senza clientX: in quel
    // caso il playhead è il riferimento deterministico, mai NaN.
    const requestedTime = Number.isFinite(event.clientX) ? timeAtPointer(event.clientX) : currentTime;
    addClip(assetId, { trackId: track.id, startSeconds: Math.min(span, videoEditorQuantizeTime(requestedTime, settings.timebase)), strictTrack: true });
  };

  const canDropAsset = (event: ReactDragEvent<HTMLDivElement>, track: VideoEditorTrack): boolean => {
    if (track.locked || !event.dataTransfer.types.includes(videoEditorAssetDragType)) return false;
    const assetId = event.dataTransfer.getData(videoEditorAssetDragType);
    const draggedKind = event.dataTransfer.getData(videoEditorAssetKindDragType);
    // Alcuni WebView oscurano getData durante dragover: autorizziamo il gesto
    // sulla corsia sbloccata e demandiamo la validazione definitiva a dropAsset.
    // Se il tipo secondario è disponibile possiamo comunque filtrare subito la
    // corsia sbagliata, evitando feedback positivo per audio/video incompatibili.
    if (!assetId) return !draggedKind || track.kind === (draggedKind === "audio" ? "audio" : "video");
    const asset = videoEditorAsset(settings, assetId);
    return Boolean(asset && (!draggedKind || draggedKind === asset.kind) && track.kind === (asset.kind === "audio" ? "audio" : "video"));
  };

  const visualClipAtTime = (timeSeconds: number, trackId?: string): VideoEditorClip | null => {
    const tracks = trackId ? settings.tracks.filter((track) => track.id === trackId) : settings.tracks;
    for (const track of tracks) {
      if (track.kind !== "video" || track.locked) continue;
      const match = settings.clips
        .filter((clip) => clip.trackId === track.id && clip.startSeconds <= timeSeconds && videoEditorClipEnd(clip) > timeSeconds)
        .sort((left, right) => right.startSeconds - left.startSeconds)
        .find((clip) => videoEditorAsset(settings, clip.assetId)?.kind !== "audio");
      if (match) return match;
    }
    return null;
  };

  /** Drop dalla libreria: vince sempre la clip realmente sotto il punto di rilascio. */
  const dropEffect = (event: ReactDragEvent<HTMLDivElement>, track?: VideoEditorTrack) => {
    const effectId = event.dataTransfer.getData(videoEditorEffectDragType);
    if (!effectId) return;
    event.preventDefault();
    event.stopPropagation();
    // JSDOM e alcuni WebView degradano DragEvent a Event e non espongono clientX:
    // in quel caso il playhead è l'unico riferimento temporale non ambiguo.
    const requestedTime = Number.isFinite(event.clientX)
      ? Math.min(span, timeAtPointer(event.clientX))
      : Math.min(span, currentTime);
    const droppedElement = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("[data-video-editor-clip-id]")
      : null;
    const droppedTarget = droppedElement ? videoEditorClip(settings, droppedElement.dataset.videoEditorClipId ?? "") : null;
    const droppedAsset = droppedTarget ? videoEditorAsset(settings, droppedTarget.assetId) : null;
    const exactTarget = droppedTarget
      && droppedAsset?.kind !== "audio"
      && (!track || droppedTarget.trackId === track.id)
      ? droppedTarget
      : null;
    const target = exactTarget ?? visualClipAtTime(requestedTime, track?.id);
    if (target) addEffect(effectId, { targetClipId: target.id, startSeconds: requestedTime });
  };

  const beginEffectDrag = (event: ReactPointerEvent<HTMLElement>, effect: VideoEditorEffectClip) => {
    event.preventDefault();
    event.stopPropagation();
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (additive || !selectedEffectSet.has(effect.id)) selectEffect(effect.id, additive);
    const grabOffset = timeAtPointer(event.clientX) - effect.startSeconds;
    const candidates = videoEditorSnapCandidates(settings, { playheadSeconds: currentTime });
    let latestStart = effect.startSeconds;
    let moved = false;
    const resolve = (pointer: PointerEvent) => {
      const requested = Math.max(0, timeAtPointer(pointer.clientX) - grabOffset);
      const snapped = settings.snapEnabled ? videoEditorSnap(requested, candidates, settings.snapThresholdSeconds) : { timeSeconds: requested, snapped: false };
      const next = videoEditorMoveEffect(settings, effect.id, snapped.timeSeconds);
      return next ? { startSeconds: next.startSeconds, durationSeconds: next.durationSeconds, snapped: snapped.snapped } : null;
    };
    startPointerSession(event, {
      move: (pointer) => {
        moved = true;
        const next = resolve(pointer);
        if (!next) return;
        latestStart = next.startSeconds;
        setEffectPreview({ effectId: effect.id, ...next });
      },
      end: () => {
        setEffectPreview(null);
        if (moved) moveEffect(effect.id, latestStart);
      },
      cancel: () => setEffectPreview(null)
    });
  };

  const beginEffectTrim = (event: ReactPointerEvent<HTMLElement>, effect: VideoEditorEffectClip, edge: "start" | "end") => {
    event.preventDefault();
    event.stopPropagation();
    selectEffect(effect.id);
    let latestTime = edge === "start" ? effect.startSeconds : videoEditorEffectClipEnd(effect);
    const candidates = videoEditorSnapCandidates(settings, { playheadSeconds: currentTime });
    startPointerSession(event, {
      move: (pointer) => {
        const requested = timeAtPointer(pointer.clientX);
        const snapped = settings.snapEnabled ? videoEditorSnap(requested, candidates, settings.snapThresholdSeconds) : { timeSeconds: requested, snapped: false };
        latestTime = snapped.timeSeconds;
        const next = videoEditorTrimEffect(settings, effect.id, edge, latestTime);
        if (next) setEffectPreview({ effectId: effect.id, startSeconds: next.startSeconds, durationSeconds: next.durationSeconds, snapped: snapped.snapped });
      },
      end: () => { setEffectPreview(null); trimEffect(effect.id, edge, latestTime); },
      cancel: () => setEffectPreview(null)
    });
  };

  /**
   * Trascinamento del corpo della clip. L’anteprima è puramente locale finché il
   * puntatore è giù: lo store viene aggiornato una sola volta al rilascio, così la
   * calamita è visibile durante il gesto senza inondare la cronologia del progetto.
   */
  const beginClipDrag = (event: ReactPointerEvent<HTMLElement>, clip: VideoEditorClip, track: VideoEditorTrack) => {
    if (track.locked) return;
    event.preventDefault();
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (additive || !selectedSet.has(clip.id)) selectClip(clip.id, additive);
    const grabOffset = timeAtPointer(event.clientX) - clip.startSeconds;
    const candidates = videoEditorSnapCandidates(settings, { excludeClipIds: [clip.id], playheadSeconds: currentTime });
    let latestStart = clip.startSeconds;
    let latestTrackId = clip.trackId;
    let moved = false;
    const resolve = (pointer: PointerEvent) => {
      const requested = Math.max(0, timeAtPointer(pointer.clientX) - grabOffset);
      if (!settings.snapEnabled) return { startSeconds: requested, snapped: false };
      const startSnap = videoEditorSnap(requested, candidates, settings.snapThresholdSeconds);
      const endSnap = videoEditorSnap(requested + clip.durationSeconds, candidates, settings.snapThresholdSeconds);
      const useEnd = endSnap.snapped && (!startSnap.snapped || Math.abs(endSnap.timeSeconds - (requested + clip.durationSeconds)) < Math.abs(startSnap.timeSeconds - requested));
      if (useEnd) return { startSeconds: Math.max(0, endSnap.timeSeconds - clip.durationSeconds), snapped: true };
      return { startSeconds: startSnap.timeSeconds, snapped: startSnap.snapped };
    };
    startPointerSession(event, {
      move: (pointer) => {
        moved = true;
        const resolved = resolve(pointer);
        latestStart = resolved.startSeconds;
        const overTrack = trackAtPointer(pointer.clientY);
        if (overTrack && overTrack.kind === track.kind && !overTrack.locked) latestTrackId = overTrack.id;
        setPreview({ clipId: clip.id, startSeconds: latestStart, durationSeconds: clip.durationSeconds, snapped: resolved.snapped });
      },
      end: () => {
        setPreview(null);
        if (!moved) return;
        if (latestTrackId !== clip.trackId) moveClipToTrack(clip.id, latestTrackId);
        moveClip(clip.id, latestStart, currentTime);
      },
      cancel: () => setPreview(null)
    });
  };

  /** Trascinamento di un bordo: estende o accorcia la clip, immagini incluse. */
  const beginClipTrim = (event: ReactPointerEvent<HTMLElement>, clip: VideoEditorClip, track: VideoEditorTrack, edge: "start" | "end") => {
    if (track.locked) return;
    event.preventDefault();
    event.stopPropagation();
    selectClip(clip.id);
    let latest = edge === "start" ? clip.startSeconds : videoEditorClipEnd(clip);
    const candidates = videoEditorSnapCandidates(settings, { excludeClipIds: [clip.id], playheadSeconds: currentTime });
    startPointerSession(event, {
      move: (pointer) => {
        const requested = timeAtPointer(pointer.clientX);
        const resolved = settings.snapEnabled ? videoEditorSnap(requested, candidates, settings.snapThresholdSeconds) : { timeSeconds: requested, snapped: false };
        latest = resolved.timeSeconds;
        // L’anteprima usa esattamente la stessa funzione pura del commit nello
        // store. È importante per i fermi immagine: il bordo destro può crescere
        // fino a un’ora anche se la sorgente ha durata zero, mentre video e audio
        // restano limitati al materiale disponibile.
        const next = videoEditorTrimClip(settings, clip.id, edge, latest, currentTime);
        if (next) setPreview({ clipId: clip.id, startSeconds: next.startSeconds, durationSeconds: next.durationSeconds, snapped: resolved.snapped });
      },
      end: () => { setPreview(null); trimClip(clip.id, edge, latest, currentTime); },
      cancel: () => setPreview(null)
    });
  };

  const openMenu = (event: ReactMouseEvent<HTMLElement>, clip: VideoEditorClip) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedSet.has(clip.id)) selectClip(clip.id);
    setMenu({ x: event.clientX, y: event.clientY, clipId: clip.id });
  };

  const menuClip = menu ? settings.clips.find((clip) => clip.id === menu.clipId) ?? null : null;
  const menuAsset = menuClip ? videoEditorAsset(settings, menuClip.assetId) : null;
  const syncTargets = menuClip ? selected.filter((id) => id !== menuClip.id) : [];
  const frameAlignmentReason = menuClip ? videoEditorFrameAlignmentReason(settings, menuClip.id, syncTargets) : "Seleziona almeno due clip video.";

  const runMenu = (action: () => void) => { action(); setMenu(null); };

  const togglePlay = () => {
    if (duration <= 0) return;
    requestVideoEditorTransport("toggle");
  };

  const clipStyle = (clip: VideoEditorClip): CSSProperties => {
    const active = preview?.clipId === clip.id ? preview : null;
    const startSeconds = active?.startSeconds ?? clip.startSeconds;
    const durationSeconds = active?.durationSeconds ?? clip.durationSeconds;
    return { left: `${startSeconds / span * 100}%`, width: `${Math.max(.4, durationSeconds / span * 100)}%` };
  };

  const effectStyle = (effect: VideoEditorEffectClip): CSSProperties => {
    const active = effectPreview?.effectId === effect.id ? effectPreview : null;
    const startSeconds = active?.startSeconds ?? effect.startSeconds;
    const durationSeconds = active?.durationSeconds ?? effect.durationSeconds;
    const row = effectLayout.rows.get(effect.id) ?? 0;
    return {
      left: `${startSeconds / span * 100}%`,
      width: `${Math.max(.55, durationSeconds / span * 100)}%`,
      top: row * effectSublaneHeight + 4,
      bottom: "auto",
      height: effectSublaneHeight - 8
    };
  };

  const ruler = [0, .25, .5, .75, 1].map((fraction) => span * fraction);

  return <section className="timeline video-editor-timeline" aria-label="Timeline Video Editor" tabIndex={0} style={{ height: `${Math.max(140, timelineHeight)}px`, minHeight: "140px" }} onKeyDown={(event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])")) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selectedEffects.length) { event.preventDefault(); deleteEffects(selectedEffects); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && selected.length) { event.preventDefault(); deleteClips(selected); return; }
    if (event.key === "s" && activeClipId) { event.preventDefault(); splitClip(activeClipId, currentTime); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); setCurrentTime(Math.max(0, currentTime - (event.shiftKey ? 1 : videoEditorFrameSeconds))); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); setCurrentTime(Math.min(span, currentTime + (event.shiftKey ? 1 : videoEditorFrameSeconds))); }
  }}>
    {onResizeHeight ? <div className="timeline-resize-handle" role="separator" aria-label="Ridimensiona altezza timeline" aria-orientation="horizontal" aria-valuemin={140} aria-valuenow={Math.round(timelineHeight)} tabIndex={0} title="Trascina per allargare o stringere la timeline · doppio clic per ripristinare" onPointerDown={beginTimelineResize} onDoubleClick={() => onResizeHeight(300)} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); onResizeHeight(timelineHeight + 20); } else if (event.key === "ArrowDown") { event.preventDefault(); onResizeHeight(timelineHeight - 20); } }}><span /></div> : null}
    <div className="transport">
      <button type="button" onClick={() => setCurrentTime(Math.max(0, currentTime - 5))} disabled={duration <= 0}>↶ 5</button>
      <button type="button" onClick={() => setCurrentTime(0)} disabled={duration <= 0}>◀</button>
      <button type="button" className="play" onClick={togglePlay} disabled={duration <= 0} aria-keyshortcuts="Space" title="Play/Pausa (Spazio)">{playing ? "❚❚" : "▶"}</button>
      <button type="button" onClick={() => requestVideoEditorTransport("stop")} disabled={duration <= 0}>■</button>
      <button type="button" aria-label="Frame precedente" onClick={() => setCurrentTime(Math.max(0, currentTime - videoEditorFrameSeconds))} disabled={playing}>‹|</button>
      <button type="button" aria-label="Frame successivo" onClick={() => setCurrentTime(currentTime + videoEditorFrameSeconds)} disabled={playing}>|›</button>
      <button type="button" className={looping ? "active-control" : ""} aria-pressed={looping} onClick={() => setLooping(!looping)} disabled={duration <= 0}>Loop</button>
      <button type="button" className="split-phoneme" onClick={() => { if (activeClipId) splitClip(activeClipId, currentTime); }} disabled={!activeClipId} title="Taglia la clip selezionata sul playhead (S)">✂ Taglia</button>
      <button type="button" className={settings.snapEnabled ? "active-control" : ""} aria-pressed={settings.snapEnabled} onClick={() => updateSettings({ snapEnabled: !settings.snapEnabled })} title="Calamita: accosta le clip senza vuoti">🧲 Calamita</button>
      {selectedEffects.length ? <button type="button" className="delete-selection" onClick={() => deleteEffects(selectedEffects)}>Elimina {selectedEffects.length} effetti</button> : null}
      {selected.length ? <button type="button" className="delete-selection" onClick={() => deleteClips(selected)}>Elimina {selected.length}</button> : null}
      <div className="timecode">{formatTime(currentTime)} / {formatTime(duration)}</div>
      <span className="master-clock">MONTAGGIO</span>
      <label className="zoom">Zoom <input aria-label="Zoom timeline Video Editor" type="range" min="1" max="24" step=".5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
    </div>
    <div className="tracks video-editor-tracks" style={{ overflowY: "scroll", alignItems: "start" }}>
      <div className="track-labels video-editor-track-labels" style={{ gridTemplateRows: [`${effectLaneHeight}px`, ...settings.tracks.map(() => `${trackHeight}px`)].join(" "), minHeight: totalLanesHeight }}>
        <span className="video-editor-track-label video-editor-effect-track-label">
          <strong title="Effetti video montabili">✦ Effetti</strong>
          <small>{settings.effectClips.length}</small>
        </span>
        {settings.tracks.map((track, trackIndex) => <span
          key={track.id}
          className={`video-editor-track-label${track.locked ? " locked" : ""}`}
          draggable={!track.locked}
          title={`${track.name} · trascina per cambiare l'ordine dei livelli`}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(videoEditorTrackDragType, track.id);
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(videoEditorTrackDragType)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            const trackId = event.dataTransfer.getData(videoEditorTrackDragType);
            if (!trackId) return;
            event.preventDefault();
            reorderTrack(trackId, trackIndex);
          }}
        >
          <strong><i aria-hidden="true">⋮⋮</i><span title={track.name}>{track.name}</span></strong>
          <span className="track-label-toggles">
            {track.kind === "video" ? <button type="button" aria-label={`${track.hidden ? "Mostra" : "Nascondi"} ${track.name}`} aria-pressed={track.hidden} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>{track.hidden ? "◌" : "◉"}</button> : null}
            <button type="button" aria-label={`${track.muted ? "Riattiva" : "Muta"} ${track.name}`} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? "🔇" : "🔊"}</button>
            <button type="button" aria-label={`${track.locked ? "Sblocca" : "Blocca"} ${track.name}`} aria-pressed={track.locked} onClick={() => updateTrack(track.id, { locked: !track.locked })}>{track.locked ? "🔒" : "🔓"}</button>
          </span>
        </span>)}
      </div>
      <div className="track-scroll" style={{ minHeight: totalLanesHeight }}>
        <div className="track-content" style={{ width: `${zoom * 100}%` }}>
          <div className="ruler video-editor-ruler" onPointerDown={scrub}>{ruler.map((time, index) => <i key={index} style={{ left: `${index / (ruler.length - 1) * 100}%` }}>{formatTime(time)}</i>)}</div>
          <div ref={lanes} className="video-editor-lanes" style={{ height: totalLanesHeight }} onPointerDown={(event) => { if (event.target === event.currentTarget) { selectClips([]); selectEffect(null); scrub(event); } }}>
            <div
              className="video-editor-lane video-editor-effect-lane"
              style={{ top: 0, height: effectLaneHeight }}
              onDragOver={(event) => { if (event.dataTransfer.types.includes(videoEditorEffectDragType)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
              onDrop={(event) => dropEffect(event)}
              onPointerDown={(event) => { if (event.target === event.currentTarget) { selectEffect(null); scrub(event); } }}
            >
              {settings.effectClips.map((effect) => {
                const definition = videoEditorEffectDefinition(effect.effectId);
                const isSelected = selectedEffectSet.has(effect.id);
                const dragging = effectPreview?.effectId === effect.id;
                const target = effect.target.kind === "clip" ? videoEditorClip(settings, effect.target.clipId) : null;
                const targetAsset = target ? videoEditorAsset(settings, target.assetId) : null;
                return <div
                  key={effect.id}
                  data-video-editor-effect-id={effect.id}
                  data-effect-sublane={effectLayout.rows.get(effect.id) ?? 0}
                  className={`video-editor-effect-clip effect-${effect.effectId}${isSelected ? " selected" : ""}${dragging ? " dragging" : ""}${dragging && effectPreview?.snapped ? " snapped" : ""}${effect.enabled ? "" : " disabled-effect"}`}
                  style={effectStyle(effect)}
                  title={`${definition?.label ?? effect.effectId} · ${effect.startSeconds.toFixed(2)} → ${videoEditorEffectClipEnd(effect).toFixed(2)} s${targetAsset ? ` · ${targetAsset.name}` : ""}`}
                >
                  <button type="button" className="effect-clip-body" aria-label={`Effetto ${definition?.label ?? effect.effectId}`} aria-pressed={isSelected} onPointerDown={(event) => beginEffectDrag(event, effect)}>
                    <i aria-hidden="true">{videoEditorEffectTimelineIcon(effect.effectId)}</i>
                    <strong>{definition?.label ?? effect.effectId}</strong>
                    <small>{effect.durationSeconds.toFixed(2)}s</small>
                  </button>
                  <button type="button" className="clip-trim clip-trim-start" aria-label={`Ridimensiona inizio ${definition?.label ?? effect.effectId}`} onPointerDown={(event) => beginEffectTrim(event, effect, "start")} />
                  <button type="button" className="clip-trim clip-trim-end" aria-label={`Ridimensiona fine ${definition?.label ?? effect.effectId}`} onPointerDown={(event) => beginEffectTrim(event, effect, "end")} />
                </div>;
              })}
              {settings.effectClips.length ? null : <span className="effect-lane-placeholder">Trascina qui un effetto dalla libreria</span>}
            </div>
            {settings.tracks.map((track, trackIndex) => <div key={track.id} className={`video-editor-lane lane-${track.kind}${track.locked ? " locked" : ""}${track.hidden ? " hidden-track" : ""}`} style={{ top: effectLaneHeight + trackIndex * trackHeight, height: trackHeight }} onDragOver={(event) => {
              const effectDrop = track.kind === "video" && event.dataTransfer.types.includes(videoEditorEffectDragType) && !track.locked;
              if (effectDrop || canDropAsset(event, track)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
            }} onDrop={(event) => event.dataTransfer.getData(videoEditorEffectDragType) ? dropEffect(event, track) : dropAsset(event, track)}>
              {settings.clips.filter((clip) => clip.trackId === track.id).map((clip) => {
                const asset = videoEditorAsset(settings, clip.assetId);
                if (!asset) return null;
                const isSelected = selectedSet.has(clip.id);
                const dragging = preview?.clipId === clip.id;
                return <div
                  key={clip.id}
                  data-video-editor-clip-id={clip.id}
                  className={`video-editor-clip clip-${asset.kind}${isSelected ? " selected" : ""}${dragging ? " dragging" : ""}${dragging && preview?.snapped ? " snapped" : ""}${clip.muted ? " muted-clip" : ""}`}
                  style={clipStyle(clip)}
                  title={`${asset.name} · ${clip.startSeconds.toFixed(2)} → ${videoEditorClipEnd(clip).toFixed(2)} s · trascina il corpo, i bordi per estendere, tasto destro per sincronizzare`}
                  onContextMenu={(event) => openMenu(event, clip)}
                >
                  <button type="button" className="clip-body" aria-label={`Clip ${asset.name} da ${clip.startSeconds.toFixed(2)} a ${videoEditorClipEnd(clip).toFixed(2)} secondi`} aria-pressed={isSelected} onPointerDown={(event) => beginClipDrag(event, clip, track)} onDoubleClick={(event) => { event.stopPropagation(); splitClip(clip.id, currentTime); }}>
                    {asset.thumbnailUrl ? <span className="clip-thumbnail-strip" style={{ backgroundImage: `url(${asset.thumbnailUrl})` }} aria-hidden="true" /> : null}
                    {asset.waveform.length && asset.durationSeconds > 0 ? <VideoEditorClipWaveform waveform={asset.waveform} sourceInSeconds={clip.sourceInSeconds} durationSeconds={clip.durationSeconds} assetDurationSeconds={asset.durationSeconds} color={asset.kind === "audio" ? "#7ce7c1" : "#8fb6ff"} /> : null}
                    <span className="clip-name">{asset.name}</span>
                    <span className="clip-badges">
                      {clip.blendMode === "normal" ? null : <i className="clip-badge-blend" aria-hidden="true">◐</i>}
                      {clip.audioFadeInSeconds > 0 || clip.audioFadeOutSeconds > 0 ? <i className="clip-badge-fade" aria-hidden="true">◺</i> : null}
                      {clip.muted ? <i className="clip-badge-muted" aria-hidden="true">🔇</i> : null}
                      {asset.beats.length ? <i className="clip-badge-beats" aria-hidden="true">♪</i> : null}
                    </span>
                  </button>
                  <button type="button" className="clip-trim clip-trim-start" aria-label={`Estendi o accorcia l’inizio di ${asset.name}`} title="Trascina per estendere o accorciare l’inizio" onPointerDown={(event) => beginClipTrim(event, clip, track, "start")} />
                  <button type="button" className="clip-trim clip-trim-end" aria-label={`Estendi o accorcia la fine di ${asset.name}`} title="Trascina per estendere o accorciare la fine" onPointerDown={(event) => beginClipTrim(event, clip, track, "end")} />
                </div>;
              })}
            </div>)}
            <div className="playhead" style={{ left: `${currentTime / span * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
    {settings.clips.length ? null : <p className="video-editor-timeline-hint">Carica i media nel pool a sinistra e usa “Aggiungi in timeline”: poi trascina i bordi per estenderli e il corpo per spostarli.</p>}
    <div className="video-editor-timeline-footer">
      <button type="button" onClick={() => addTrack("video")}>+ Livello video</button>
      <button type="button" onClick={() => addTrack("audio")}>+ Traccia audio</button>
      <span className="muted">Tasto destro su una clip per sincronizzare audio e video, tagliare o chiudere i vuoti.</span>
    </div>
    {settings.automationLanes.length ? <div className="video-editor-automation-lanes" aria-label="Lane automazioni">{settings.automationLanes.map((lane) => <div key={lane.id} className="video-editor-automation-lane"><strong>{lane.target.property}</strong><span>{lane.keyframes.map((point) => <span key={point.id} className="video-editor-keyframe-editor" style={{ left: automationMarkerPosition(settings, point.frame) }}><button type="button" aria-label={`Vai al keyframe ${lane.target.property} frame ${point.frame}`} title={`${point.curve} · frame ${point.frame}`} onClick={() => setCurrentTime(videoEditorFrameToSeconds(point.frame, settings.timebase))}>◆</button><input aria-label={`Valore keyframe ${lane.target.property} frame ${point.frame}`} type="number" step=".01" value={point.value} onChange={(event) => upsertKeyframe(lane.target, { ...point, value: Number(event.target.value) })} /><button type="button" aria-label={`Elimina keyframe ${lane.target.property} frame ${point.frame}`} onClick={() => removeKeyframe(lane.target, point.frame)}>×</button></span>)}</span></div>)}</div> : null}
    {menu && menuClip
      ? <div className="video-editor-context-menu" role="menu" aria-label="Azioni clip" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
        <button type="button" role="menuitem" disabled={syncTargets.length === 0} onClick={() => runMenu(() => syncClips(menuClip.id, syncTargets))}>
          {syncTargets.length ? `Sincronizza audio e video (${syncTargets.length})` : "Sincronizza audio e video"}
        </button>
        <button type="button" role="menuitem" disabled={Boolean(frameAlignmentReason)} title={frameAlignmentReason ?? "Allinea i frame sorgente"} onClick={() => runMenu(() => alignClipsByFrame(menuClip.id, syncTargets))}>
          {syncTargets.length ? `Allinea per frame (${syncTargets.length})` : "Allinea per frame"}
        </button>
        {frameAlignmentReason ? <span className="context-menu-note">{frameAlignmentReason}</span> : null}
        {syncTargets.length ? null : <span className="context-menu-note">Seleziona anche le altre clip con Shift o Cmd, poi tasto destro sul riferimento.</span>}
        <hr />
        <button type="button" role="menuitem" onClick={() => runMenu(() => splitClip(menuClip.id, currentTime))}>Taglia sul playhead</button>
        <button type="button" role="menuitem" onClick={() => runMenu(() => duplicateClip(menuClip.id))}>Duplica clip</button>
        <button type="button" role="menuitem" onClick={() => runMenu(() => moveClip(menuClip.id, currentTime, currentTime))}>Sposta sul playhead</button>
        <button type="button" role="menuitem" onClick={() => runMenu(() => closeGaps(menuClip.trackId))}>Chiudi i vuoti della traccia</button>
        <hr />
        <button type="button" role="menuitem" onClick={() => runMenu(() => updateClip(menuClip.id, { muted: !menuClip.muted }))}>{menuClip.muted ? "Riattiva audio della clip" : "Disattiva audio della clip"}</button>
        <button type="button" role="menuitem" disabled={menuAsset?.kind === "audio"} onClick={() => runMenu(() => { addEffect("fade-in", { targetClipId: menuClip.id }); })}>＋ Aggiungi Fade In alla corsia Effetti</button>
        <button type="button" role="menuitem" disabled={menuAsset?.kind === "audio"} onClick={() => runMenu(() => { addEffect("fade-out", { targetClipId: menuClip.id }); })}>＋ Aggiungi Fade Out alla corsia Effetti</button>
        <hr />
        <button type="button" role="menuitem" className="delete-selection" onClick={() => runMenu(() => deleteClips(selectedSet.has(menuClip.id) ? selected : [menuClip.id]))}>Elimina {selectedSet.has(menuClip.id) && selected.length > 1 ? `${selected.length} clip` : "clip"}</button>
      </div>
      : null}
  </section>;
}
