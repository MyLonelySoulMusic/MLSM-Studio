import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { WaveformCanvas } from "./WaveformCanvas";

interface TimelineEvent {
  id: string;
  timeSeconds: number;
  eventType: string;
  strength: number;
  enabled: boolean;
  action: string;
}

interface TimelinePhoneme {
  id: string;
  startSeconds: number;
  endSeconds: number;
  viseme: "A" | "EI" | "OU" | "MBP" | "LT" | "S";
  confidence: number;
  manual: boolean;
}

interface TimelineSubtitle {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  verified: boolean;
  manual: boolean;
  animationLabel?: string;
  accentColors?: readonly string[];
}

interface TimelineProps {
  peaks: number[];
  events: TimelineEvent[];
  beats: number[];
  subtitleOnly?: boolean;
  showPhonemes?: boolean;
  phonemes?: TimelinePhoneme[];
  selectedPhonemeId?: string | null;
  subtitles?: TimelineSubtitle[];
  selectedSubtitleId?: string | null;
  selectedEventId: string | null;
  selectedEventIds: string[];
  currentTime: number;
  duration: number;
  playing: boolean;
  looping: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onLoop: (enabled: boolean) => void;
  onSelectPhoneme?: (id: string | null) => void;
  onDeletePhoneme?: (id: string) => void;
  onSplitPhoneme?: (id: string, time: number) => void;
  onAddSubtitle?: (time: number) => void;
  onSelectSubtitle?: (id: string | null) => void;
  onMoveSubtitle?: (id: string, time: number) => void;
  onResizeSubtitle?: (id: string, startSeconds: number, endSeconds: number) => void;
  onDeleteSubtitle?: (id: string) => void;
  onSplitSubtitle?: (id: string, time: number) => void;
  onSelectEvent: (id: string | null, additive?: boolean) => void;
  onAddEvent: (time: number) => void;
  onMoveEvent: (id: string, time: number) => void;
  onDeleteEvent: (id: string) => void;
  onDeleteEvents: (ids: readonly string[]) => void;
}

type SubtitleTrimEdge = "start" | "end";
interface SubtitleRange { startSeconds: number; endSeconds: number; }
interface PointerSessionHandlers {
  move: (event: PointerEvent) => void;
  end: (event: PointerEvent) => void;
  cancel?: () => void;
}
interface SubtitleLaneLayout {
  laneByCueId: Map<string, number>;
  laneCount: number;
}

const subtitleFrameSeconds = 1 / 30;
const timelineRowHeight = 27;

function formatTime(time: number): string {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  const milliseconds = Math.floor((time % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function snapTime(time: number, beats: number[]): number {
  let nearest = time;
  let distance = .08;
  for (const beat of beats) {
    const candidate = Math.abs(beat - time);
    if (candidate < distance) {
      distance = candidate;
      nearest = beat;
    }
  }
  return nearest;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function subtitleTrimRange(cue: TimelineSubtitle, edge: SubtitleTrimEdge, requestedTime: number, duration: number): SubtitleRange {
  const projectDuration = Math.max(0, duration);
  const minimumDuration = Math.min(subtitleFrameSeconds, projectDuration);
  if (edge === "start") {
    const endSeconds = clamp(cue.endSeconds, minimumDuration, projectDuration);
    return {
      startSeconds: clamp(requestedTime, 0, Math.max(0, endSeconds - minimumDuration)),
      endSeconds
    };
  }
  const startSeconds = clamp(cue.startSeconds, 0, Math.max(0, projectDuration - minimumDuration));
  return {
    startSeconds,
    endSeconds: clamp(requestedTime, startSeconds + minimumDuration, projectDuration)
  };
}

function applySubtitleRangePreview(element: HTMLElement, range: SubtitleRange, duration: number): void {
  const safeDuration = Math.max(.0001, duration);
  element.style.left = `${range.startSeconds / safeDuration * 100}%`;
  element.style.width = `${Math.max(.4, (range.endSeconds - range.startSeconds) / safeDuration * 100)}%`;
}

function isInteractiveTimelineTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable=\"false\"])"));
}

function layoutSubtitleLanes(subtitles: readonly TimelineSubtitle[]): SubtitleLaneLayout {
  const ordered = subtitles
    .map((cue, sourceIndex) => ({ cue, sourceIndex }))
    .sort((left, right) => left.cue.startSeconds - right.cue.startSeconds || left.cue.endSeconds - right.cue.endSeconds || left.sourceIndex - right.sourceIndex);
  const laneEnds: number[] = [];
  const laneByCueId = new Map<string, number>();
  for (const { cue } of ordered) {
    const start = Number.isFinite(cue.startSeconds) ? cue.startSeconds : 0;
    const end = Math.max(start, Number.isFinite(cue.endSeconds) ? cue.endSeconds : start);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start + 1e-6);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    laneByCueId.set(cue.id, lane);
  }
  return { laneByCueId, laneCount: Math.max(1, laneEnds.length) };
}

export function Timeline(props: TimelineProps) {
  const {
    peaks,
    events,
    beats,
    subtitleOnly = false,
    showPhonemes = false,
    phonemes = [],
    selectedPhonemeId = null,
    subtitles = [],
    selectedSubtitleId = null,
    selectedEventId,
    selectedEventIds,
    currentTime,
    duration,
    playing,
    looping,
    onPlayPause,
    onStop,
    onSeek,
    onLoop,
    onSelectPhoneme,
    onDeletePhoneme,
    onSplitPhoneme,
    onAddSubtitle,
    onSelectSubtitle,
    onMoveSubtitle,
    onResizeSubtitle,
    onDeleteSubtitle,
    onSplitSubtitle,
    onSelectEvent,
    onAddEvent,
    onMoveEvent,
    onDeleteEvent,
    onDeleteEvents
  } = props;
  const ready = duration > 0;
  const [zoom, setZoom] = useState(1);
  const selectedPhoneme = phonemes.find((cue) => cue.id === selectedPhonemeId);
  const selectedSubtitle = subtitles.find((cue) => cue.id === selectedSubtitleId);
  const showSubtitles = true;
  const subtitleLaneLayout = layoutSubtitleLanes(subtitles);
  const subtitleLaneHeight = subtitleLaneLayout.laneCount * timelineRowHeight;
  const fixedTrackHeight = 90 + (subtitleOnly ? 0 : timelineRowHeight * 2) + (showPhonemes ? timelineRowHeight : 0);
  const trackContentHeight = fixedTrackHeight + subtitleLaneHeight;
  const trackLabelRows = subtitleOnly
    ? showPhonemes
      ? `90px ${timelineRowHeight}px ${subtitleLaneHeight}px`
      : `90px ${subtitleLaneHeight}px`
    : showPhonemes
      ? `90px ${timelineRowHeight}px ${timelineRowHeight}px ${timelineRowHeight}px ${subtitleLaneHeight}px`
      : `90px ${timelineRowHeight}px ${timelineRowHeight}px ${subtitleLaneHeight}px`;
  const pointerSessionCleanups = useRef(new Set<() => void>());

  useEffect(() => () => {
    for (const cleanupSession of [...pointerSessionCleanups.current]) cleanupSession();
    pointerSessionCleanups.current.clear();
  }, []);

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
        try { target.releasePointerCapture(pointerId); } catch { /* The browser may already have released it. */ }
      }
    };
    const move = (pointer: PointerEvent) => {
      if (active && matchesSession(pointer)) handlers.move(pointer);
    };
    const end = (pointer: PointerEvent) => {
      if (!active || !matchesSession(pointer)) return;
      cleanupSession();
      handlers.end(pointer);
    };
    const cancel = (pointer: PointerEvent) => {
      if (!active || !matchesSession(pointer)) return;
      cleanupSession();
      handlers.cancel?.();
    };
    const lostPointerCapture = (lost: Event) => cancel(lost as PointerEvent);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    target.addEventListener("lostpointercapture", lostPointerCapture);
    pointerSessionCleanups.current.add(cleanupSession);
    if (pointerId !== null && typeof target.setPointerCapture === "function") {
      try { target.setPointerCapture(pointerId); } catch { /* Window listeners remain the fallback. */ }
    }
  };

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, marker: TimelineEvent) => {
    event.preventDefault();
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (additive || !selectedEventIds.includes(marker.id) || selectedEventIds.length <= 1) onSelectEvent(marker.id, additive);
    const button = event.currentTarget;
    const lane = button.parentElement;
    if (!lane) return;
    const originalLeft = button.style.left;
    let moved = false;
    startPointerSession(event, {
      move: (pointer) => {
        moved = true;
        const bounds = lane.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (pointer.clientX - bounds.left) / Math.max(1, bounds.width)));
        button.style.left = `${progress * 100}%`;
      },
      end: (pointer) => {
        if (!moved || selectedEventIds.length > 1) {
          button.style.left = originalLeft;
          return;
        }
        const bounds = lane.getBoundingClientRect();
        const raw = Math.min(duration, Math.max(0, (pointer.clientX - bounds.left) / Math.max(1, bounds.width) * duration));
        onMoveEvent(marker.id, snapTime(raw, beats));
      },
      cancel: () => { button.style.left = originalLeft; }
    });
  };

  const beginSubtitleDrag = (event: ReactPointerEvent<HTMLButtonElement>, cue: TimelineSubtitle) => {
    event.preventDefault();
    onSelectSubtitle?.(cue.id);
    const button = event.currentTarget;
    const cueElement = button.parentElement;
    const lane = button.closest<HTMLElement>(".subtitle-lane");
    if (!cueElement || !lane) return;
    const originalLeft = cueElement.style.left;
    const cueBounds = cueElement.getBoundingClientRect();
    const pointerOffset = event.clientX - cueBounds.left;
    const cueDuration = Math.max(0, cue.endSeconds - cue.startSeconds);
    let moved = false;
    const requestedStart = (pointer: PointerEvent) => {
      const bounds = lane.getBoundingClientRect();
      const raw = (pointer.clientX - bounds.left - pointerOffset) / Math.max(1, bounds.width) * duration;
      return Math.min(Math.max(0, duration - cueDuration), Math.max(0, raw));
    };
    startPointerSession(event, {
      move: (pointer) => {
        moved = true;
        cueElement.style.left = `${requestedStart(pointer) / Math.max(.0001, duration) * 100}%`;
      },
      end: (pointer) => {
        if (moved) onMoveSubtitle?.(cue.id, requestedStart(pointer));
        else cueElement.style.left = originalLeft;
      },
      cancel: () => { cueElement.style.left = originalLeft; }
    });
  };

  const resizeSubtitle = (cue: TimelineSubtitle, edge: SubtitleTrimEdge, requestedTime: number, previewElement?: HTMLElement) => {
    const range = subtitleTrimRange(cue, edge, requestedTime, duration);
    if (previewElement) applySubtitleRangePreview(previewElement, range, duration);
    onResizeSubtitle?.(cue.id, range.startSeconds, range.endSeconds);
  };

  const beginSubtitleResize = (event: ReactPointerEvent<HTMLButtonElement>, cue: TimelineSubtitle, edge: SubtitleTrimEdge) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectSubtitle?.(cue.id);
    const handle = event.currentTarget;
    const cueElement = handle.parentElement;
    const lane = handle.closest<HTMLElement>(".subtitle-lane");
    if (!cueElement || !lane || !onResizeSubtitle) return;
    const originalRange = { startSeconds: cue.startSeconds, endSeconds: cue.endSeconds };
    let latestRange = subtitleTrimRange(cue, edge, edge === "start" ? cue.startSeconds : cue.endSeconds, duration);
    const rangeAtPointer = (pointer: PointerEvent) => {
      const bounds = lane.getBoundingClientRect();
      const requestedTime = (pointer.clientX - bounds.left) / Math.max(1, bounds.width) * duration;
      latestRange = subtitleTrimRange(cue, edge, requestedTime, duration);
      applySubtitleRangePreview(cueElement, latestRange, duration);
    };
    startPointerSession(event, {
      move: rangeAtPointer,
      end: (pointer) => {
        rangeAtPointer(pointer);
        onResizeSubtitle(cue.id, latestRange.startSeconds, latestRange.endSeconds);
      },
      cancel: () => applySubtitleRangePreview(cueElement, originalRange, duration)
    });
  };

  const trimWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, cue: TimelineSubtitle, edge: SubtitleTrimEdge) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const current = edge === "start" ? cue.startSeconds : cue.endSeconds;
    resizeSubtitle(cue, edge, current + (event.key === "ArrowRight" ? subtitleFrameSeconds : -subtitleFrameSeconds), event.currentTarget.parentElement ?? undefined);
  };

  return <section className="timeline" aria-label="Timeline musicale" tabIndex={0} onKeyDown={(event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (isInteractiveTimelineTarget(event.target)) return;
      let deleted = false;
      if (selectedSubtitleId && onDeleteSubtitle) { onDeleteSubtitle(selectedSubtitleId); deleted = true; }
      else if (selectedPhonemeId && onDeletePhoneme) { onDeletePhoneme(selectedPhonemeId); deleted = true; }
      else if (selectedEventIds.length > 1) { onDeleteEvents(selectedEventIds); deleted = true; }
      else if (selectedEventId) { onDeleteEvent(selectedEventId); deleted = true; }
      if (deleted) event.preventDefault();
    }
  }}>
    <div className="transport">
      <button onClick={() => onSeek(Math.max(0, currentTime - 5))} disabled={!ready}>↶ 5</button>
      <button onClick={() => onSeek(0)} disabled={!ready}>◀</button>
      <button className="play" onClick={onPlayPause} disabled={!ready} aria-keyshortcuts="Space" title="Play/Pausa (Spazio)">{playing ? "❚❚" : "▶"}</button>
      <button onClick={onStop} disabled={!ready}>■</button>
      <button aria-label="Frame precedente" onClick={() => onSeek(Math.max(0, currentTime - subtitleFrameSeconds))} disabled={!ready || playing}>‹|</button>
      <button aria-label="Frame successivo" onClick={() => onSeek(Math.min(duration, currentTime + subtitleFrameSeconds))} disabled={!ready || playing}>|›</button>
      <button className={looping ? "active-control" : ""} aria-pressed={looping} onClick={() => onLoop(!looping)} disabled={!ready}>Loop</button>
      {subtitleOnly ? null : <button onClick={() => onAddEvent(currentTime)} disabled={!ready}>+ Marker</button>}
      <button className="add-subtitle-block" onClick={() => onAddSubtitle?.(currentTime)} disabled={!ready}>+ Sottotitolo</button>
      {selectedSubtitle ? <>
        <button className="split-phoneme" onClick={() => onSplitSubtitle?.(selectedSubtitle.id, currentTime)}>Dividi frase</button>
        <button className="delete-selection" onClick={() => onDeleteSubtitle?.(selectedSubtitle.id)}>Elimina frase</button>
      </> : selectedPhoneme ? <>
        <button className="split-phoneme" onClick={() => onSplitPhoneme?.(selectedPhoneme.id, currentTime)}>Dividi {selectedPhoneme.viseme}</button>
        <button className="delete-selection" onClick={() => onDeletePhoneme?.(selectedPhoneme.id)}>Elimina fonema</button>
      </> : selectedEventIds.length > 1 ? <button className="delete-selection" onClick={() => onDeleteEvents(selectedEventIds)}>Elimina {selectedEventIds.length}</button> : null}
      <div className="timecode">{formatTime(currentTime)} / {formatTime(duration)}</div>
      <span className="master-clock">AUDIO MASTER</span>
      <label className="zoom">Zoom <input aria-label="Zoom timeline" type="range" min="1" max="6" step=".25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
    </div>
    <div className={`tracks${subtitleOnly ? " subtitle-only" : ""}${showPhonemes ? " has-phonemes" : ""}${showSubtitles ? " has-subtitles" : ""}${subtitleLaneLayout.laneCount > 1 ? " has-stacked-subtitles" : ""}`} style={{ overflowY: trackContentHeight > 201 ? "auto" : "hidden", alignItems: "start" }}>
      <div className="track-labels" style={{ gridTemplateRows: trackLabelRows, minHeight: trackContentHeight }}>
        <strong>Audio</strong>
        {subtitleOnly ? null : <><span>Beat</span><span>Eventi</span></>}
        {showPhonemes ? <span>Fonemi</span> : null}
        {showSubtitles ? <span>Sottotitoli</span> : null}
      </div>
      <div className="track-scroll" style={{ minHeight: trackContentHeight }}>
        <div className="track-content" style={{ width: `${zoom * 100}%` }}>
          <div className="ruler">0:00 <i>{formatTime(duration / 3)}</i><i>{formatTime(duration * 2 / 3)}</i><i>{formatTime(duration)}</i></div>
          {ready ? <WaveformCanvas peaks={peaks} progress={currentTime / duration} onSeek={(progress) => onSeek(progress * duration)} /> : <div className="empty-waveform">Importa un MP3, WAV o video</div>}
          {subtitleOnly ? null : <>
            <div className="marker-lane beat-lane">{beats.map((time, index) => {
              const occupied = events.some((marker) => Math.abs(marker.timeSeconds - time) < .035 && marker.enabled && marker.action !== "nearMiss" && marker.action !== "freeFall");
              return occupied ? <i key={`${time}-${index}`} style={{ left: `${time / duration * 100}%` }} /> : <button type="button" className="beat-add" aria-label={`Aggiungi elemento sul beat ${index + 1}`} title={`Aggiungi elemento · ${time.toFixed(3)} s`} key={`${time}-${index}`} style={{ left: `${time / duration * 100}%` }} onClick={() => onAddEvent(time)}>+</button>;
            })}</div>
            <div className="marker-lane event-lane" onDoubleClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              onAddEvent(snapTime((event.clientX - bounds.left) / bounds.width * duration, beats));
            }}>{events.map((marker) => {
              const motion = marker.action === "nearMiss" ? "scorrimento" : marker.action === "freeFall" ? "caduta nel vuoto" : "rimbalzo";
              return <button type="button" aria-label={`${marker.eventType}, ${motion}, a ${marker.timeSeconds.toFixed(3)} secondi`} title={`${motion} · ${marker.eventType} · ${(marker.strength * 100).toFixed(0)}% · Shift/Cmd per selezione multipla`} className={`event-marker marker-${marker.eventType}${marker.action === "nearMiss" ? " sliding-marker" : ""}${marker.action === "freeFall" ? " falling-marker" : ""}${selectedEventIds.includes(marker.id) ? " selected" : ""}${marker.enabled ? "" : " disabled-marker"}`} key={marker.id} style={{ left: `${marker.timeSeconds / duration * 100}%` }} onPointerDown={(event) => beginDrag(event, marker)} />;
            })}</div>
          </>}
          {showPhonemes ? <div className="marker-lane phoneme-lane">{phonemes.map((cue) =>
            <button type="button" key={cue.id} aria-label={`Fonema ${cue.viseme} da ${cue.startSeconds.toFixed(3)} a ${cue.endSeconds.toFixed(3)} secondi`} title={`${cue.viseme} · ${(cue.confidence * 100).toFixed(0)}% · doppio clic per dividere`} className={`phoneme-cue viseme-${cue.viseme.toLowerCase()}${selectedPhonemeId === cue.id ? " selected" : ""}${cue.manual ? " manual" : ""}`} style={{ left: `${cue.startSeconds / duration * 100}%`, width: `${Math.max(.12, (cue.endSeconds - cue.startSeconds) / duration * 100)}%` }} onClick={() => onSelectPhoneme?.(cue.id)} onDoubleClick={(event) => {
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              const split = cue.startSeconds + Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width))) * (cue.endSeconds - cue.startSeconds);
              onSplitPhoneme?.(cue.id, split);
            }}><span>{cue.viseme}</span></button>
          )}</div> : null}
          {showSubtitles ? <div className="marker-lane subtitle-lane" style={{ height: subtitleLaneHeight }} title="Doppio clic per inserire un blocco" onDoubleClick={(event) => {
            if (!ready || event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            onAddSubtitle?.(Math.min(duration, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width) * duration)));
          }}>{subtitles.map((cue) => {
            const colors = cue.accentColors?.slice(0, 3) ?? [];
            const selected = selectedSubtitleId === cue.id;
            const safeDuration = Math.max(.0001, duration);
            const subtitleLane = subtitleLaneLayout.laneByCueId.get(cue.id) ?? 0;
            return <div
              key={cue.id}
              className={`subtitle-cue${selected ? " selected" : ""}${cue.verified ? " verified" : ""}`}
              style={{ left: `${ready ? cue.startSeconds / safeDuration * 100 : 0}%`, width: `${ready ? Math.max(.4, (cue.endSeconds - cue.startSeconds) / safeDuration * 100) : .4}%`, minWidth: selected ? 52 : 24, top: subtitleLane * timelineRowHeight + 3, bottom: "auto", height: timelineRowHeight - 6 }}
              title={`${cue.text} · trascina il corpo, usa le maniglie per il trim, doppio clic per dividere`}
            >
              <button
                type="button"
                className="subtitle-cue-body"
                aria-label={`Sottotitolo ${cue.text}, da ${cue.startSeconds.toFixed(3)} a ${cue.endSeconds.toFixed(3)} secondi`}
                aria-selected={selected}
                style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden", padding: "0 25px", border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "grab" }}
                onPointerDown={(event) => beginSubtitleDrag(event, cue)}
                onClick={() => onSelectSubtitle?.(cue.id)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onSplitSubtitle?.(cue.id, cue.startSeconds + (event.clientX - bounds.left) / Math.max(1, bounds.width) * (cue.endSeconds - cue.startSeconds));
                }}
              >
                <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis" }}>{cue.text}</span>
                {cue.animationLabel ? <span className="subtitle-animation-badge" aria-label={`Animazione ${cue.animationLabel}`} style={{ flex: "0 1 auto", maxWidth: "38%", overflow: "hidden", padding: "0 3px", borderRadius: 3, background: "#060914aa", color: "#b9f6ff", fontSize: 7, lineHeight: "12px", textOverflow: "ellipsis" }}>{cue.animationLabel}</span> : null}
                {colors.length ? <span className="subtitle-accent-swatches" aria-label="Palette accenti sottotitolo" style={{ display: "inline-flex", flex: "0 0 auto", gap: 2 }}>
                  {colors.map((color, index) => <span key={`${color}-${index}`} role="img" aria-label={`Colore accento ${index + 1}: ${color}`} style={{ width: 6, height: 6, border: "1px solid #ffffff99", borderRadius: 2, backgroundColor: color }} />)}
                </span> : null}
              </button>
              <button
                type="button"
                className="subtitle-trim-handle subtitle-trim-start"
                aria-label={`Ridimensiona inizio sottotitolo ${cue.text}`}
                title="Trim inizio · frecce per un frame"
                disabled={!onResizeSubtitle}
                tabIndex={selected ? 0 : -1}
                style={{ position: "absolute", zIndex: 3, inset: "0 auto 0 0", width: 24, padding: 0, border: 0, borderRight: "2px solid #e9ffff", borderRadius: "3px 0 0 3px", background: "#07101899", cursor: onResizeSubtitle ? "ew-resize" : "default" }}
                onPointerDown={(event) => beginSubtitleResize(event, cue, "start")}
                onKeyDown={(event) => trimWithKeyboard(event, cue, "start")}
              />
              <button
                type="button"
                className="subtitle-trim-handle subtitle-trim-end"
                aria-label={`Ridimensiona fine sottotitolo ${cue.text}`}
                title="Trim fine · frecce per un frame"
                disabled={!onResizeSubtitle}
                tabIndex={selected ? 0 : -1}
                style={{ position: "absolute", zIndex: 3, inset: "0 0 0 auto", width: 24, padding: 0, border: 0, borderLeft: "2px solid #e9ffff", borderRadius: "0 3px 3px 0", background: "#07101899", cursor: onResizeSubtitle ? "ew-resize" : "default" }}
                onPointerDown={(event) => beginSubtitleResize(event, cue, "end")}
                onKeyDown={(event) => trimWithKeyboard(event, cue, "end")}
              />
            </div>;
          })}</div> : null}
          <div className="playhead" style={{ left: `${ready ? currentTime / duration * 100 : 0}%` }} />
        </div>
      </div>
    </div>
  </section>;
}
