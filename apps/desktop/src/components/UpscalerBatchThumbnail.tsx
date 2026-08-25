import { useEffect, useMemo, useRef, useState } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { renderUpscalerThumbnail, resolveUpscalerPreviewSize } from "../services/upscaler-renderer";
import type { UpscalerBatchItem } from "../services/upscaler-batch";

type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

function scheduleFrame(callback: FrameRequestCallback): number {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") return window.requestAnimationFrame(callback);
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

export function UpscalerBatchThumbnail({ item, settings }: { item: UpscalerBatchItem; settings: UpscalerSettings }) {
  const host = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const token = useRef(0);
  const frame = useRef<number | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [error, setError] = useState(!item.thumbnailUrl);
  const [loadedRevision, setLoadedRevision] = useState(0);
  const adjustmentKey = useMemo(() => Object.values(settings.adjustments).join(":"), [settings.adjustments]);

  useEffect(() => {
    const element = host.current;
    if (!element || typeof IntersectionObserver === "undefined") { setVisible(true); return () => undefined; }
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), { rootMargin: "96px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = image.current;
    const currentToken = ++token.current;
    setError(!item.thumbnailUrl);
    setLoadedRevision(0);
    if (!element) return () => undefined;
    if (!visible || !item.thumbnailUrl) {
      element.src = "";
      const surface = canvas.current;
      if (surface) { surface.width = 0; surface.height = 0; }
      return () => undefined;
    }
    const handleLoad = () => {
      if (token.current !== currentToken) return;
      setError(false);
      setLoadedRevision((revision) => revision + 1);
    };
    const handleError = () => {
      if (token.current !== currentToken) return;
      setError(true);
      setLoadedRevision((revision) => revision + 1);
    };
    // Properties (rather than a React onLoad prop) also make late decoder
    // callbacks easy to invalidate when a card switches source URL.
    element.onload = handleLoad;
    element.onerror = handleError;
    element.src = item.thumbnailUrl;
    if (element.complete && element.naturalWidth > 0) handleLoad();
    return () => {
      token.current += 1;
      if (element.onload === handleLoad) element.onload = null;
      if (element.onerror === handleError) element.onerror = null;
      element.src = "";
    };
  }, [item.thumbnailUrl, visible]);

  useEffect(() => {
    if (frame.current !== null) cancelFrame(frame.current);
    frame.current = null;
    const currentToken = token.current;
    const source = image.current;
    const surface = canvas.current;
    if (!visible || !source || !surface || error || !source.complete || source.naturalWidth <= 0) return () => undefined;
    frame.current = scheduleFrame(() => {
      frame.current = null;
      if (token.current !== currentToken || !source.complete || source.naturalWidth <= 0) return;
      const sourceWidth = source.naturalWidth;
      const sourceHeight = source.naturalHeight;
      const size = resolveUpscalerPreviewSize(sourceWidth, sourceHeight, 192);
      surface.width = size.width;
      surface.height = size.height;
      const context = surface.getContext("2d", { alpha: false });
      if (context) renderUpscalerThumbnail(context, source, settings);
    });
    return () => {
      if (frame.current !== null) cancelFrame(frame.current);
      frame.current = null;
    };
  }, [adjustmentKey, error, loadedRevision, settings, visible]);

  useEffect(() => () => {
    token.current += 1;
    if (frame.current !== null) cancelFrame(frame.current);
  }, []);

  return <div ref={host} className={`upscaler-batch-thumbnail${error ? " is-error" : ""}`} aria-label={error ? `Anteprima non disponibile per ${item.name}` : `Anteprima ${item.name}`}>
    <img ref={image} alt="" aria-hidden="true" draggable={false} />
    {error ? <span className="upscaler-batch-thumbnail-placeholder">Anteprima non disponibile</span> : <canvas ref={canvas} aria-hidden="true" />}
  </div>;
}
