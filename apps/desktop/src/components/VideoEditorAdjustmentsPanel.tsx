import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoEditorAdjustments } from "../services/video-editor";
import { videoEditorAdjustmentControls, type VideoEditorAdjustmentControl } from "../services/video-editor-adjustments";

function formatAdjustmentValue(control: VideoEditorAdjustmentControl, value: number): string {
  const formatted = control.step < 1 ? value.toFixed(2) : Math.round(value).toString();
  return `${value > 0 && control.minimum < 0 ? "+" : ""}${formatted}${control.unit ?? ""}`;
}

function VideoEditorAdjustmentSlider({ control, value, disabled, ariaLabelSuffix, onChange, onKeyframe }: {
  control: VideoEditorAdjustmentControl;
  value: number;
  disabled: boolean;
  ariaLabelSuffix: string;
  onChange: (value: number) => void;
  onKeyframe?: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const draggingRef = useRef(false);
  const pendingValueRef = useRef<number | null>(null);
  const updateTimerRef = useRef<number | null>(null);

  const publishPendingValue = useCallback(() => {
    if (updateTimerRef.current !== null) {
      window.clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    const pendingValue = pendingValueRef.current;
    pendingValueRef.current = null;
    if (pendingValue !== null) onChange(pendingValue);
  }, [onChange]);

  const scheduleValue = (nextValue: number) => {
    setDraftValue(nextValue);
    pendingValueRef.current = nextValue;
    if (updateTimerRef.current === null) updateTimerRef.current = window.setTimeout(publishPendingValue, 32);
  };

  useEffect(() => {
    if (!draggingRef.current) setDraftValue(value);
  }, [value]);
  useEffect(() => () => {
    if (updateTimerRef.current !== null) window.clearTimeout(updateTimerRef.current);
  }, []);

  const finishDrag = () => {
    draggingRef.current = false;
    publishPendingValue();
  };

  return <label className="video-editor-adjustment-control">
    <span className="video-editor-adjustment-heading"><span>{control.label}</span><output>{formatAdjustmentValue(control, draftValue)}</output></span>
    <span className={`video-editor-automation-control${onKeyframe ? "" : " no-keyframe"}`}>
      <input
        aria-label={`${control.label} ${ariaLabelSuffix}`}
        type="range"
        min={control.minimum}
        max={control.maximum}
        step={control.step}
        value={draftValue}
        disabled={disabled}
        onPointerDown={() => { draggingRef.current = true; }}
        onChange={(event) => scheduleValue(Number(event.currentTarget.value))}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onBlur={finishDrag}
      />
      {onKeyframe ? <button type="button" className="video-editor-keyframe" aria-label={`Aggiungi keyframe ${control.label}`} disabled={disabled} onClick={() => { publishPendingValue(); onKeyframe(draftValue); }}>◆</button> : null}
    </span>
  </label>;
}

export function VideoEditorAdjustmentsPanel({ adjustments, disabled = false, ariaLabelSuffix, onChange, onAddKeyframe }: {
  adjustments: VideoEditorAdjustments;
  disabled?: boolean;
  ariaLabelSuffix: string;
  onChange: (patch: Partial<VideoEditorAdjustments>) => void;
  onAddKeyframe?: (key: Exclude<keyof VideoEditorAdjustments, "opacity">, value: number) => void;
}) {
  return <div className="video-editor-adjustments">
    {videoEditorAdjustmentControls.map((control) => <VideoEditorAdjustmentSlider
      key={control.key}
      control={control}
      value={adjustments[control.key]}
      disabled={disabled}
      ariaLabelSuffix={ariaLabelSuffix}
      onChange={(value) => onChange({ [control.key]: value })}
      {...(onAddKeyframe ? { onKeyframe: (value: number) => onAddKeyframe(control.key, value) } : {})}
    />)}
  </div>;
}
