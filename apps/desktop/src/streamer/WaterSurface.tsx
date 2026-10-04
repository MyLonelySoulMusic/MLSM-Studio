import { useEffect, useRef, useState } from "react";
import type { UiTheme } from "../services/ui-preferences";
import type { StreamerAudioRuntime } from "./streamer-audio";
import { createGpuWaterRenderer, createSoftwareWaterRenderer } from "./water-renderer";
import { maxWaterImpacts, rippleLifetime, RippleDetector, type WaterImpact } from "./water-ripples";

/** One surface for the whole grid. Coordinates are CSS pixels in scrollable
 * content, so origins stay attached after scrolling, resizing or dragging. */
export function WaterSurface({ runtime, theme, resetKey }: { runtime: StreamerAudioRuntime; theme: UiTheme; resetKey: string }) {
  const gpuRef = useRef<HTMLCanvasElement>(null), softwareRef = useRef<HTMLCanvasElement>(null);
  const [motionAllowed, setMotionAllowed] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotionAllowed(!media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const gpu = gpuRef.current, software = softwareRef.current, surface = gpu?.parentElement;
    if (!gpu || !software || !surface || !motionAllowed) return;
    const detector = new RippleDetector(); let impacts: WaterImpact[] = [], animation = 0, lastDraw = 0, visible = true, cleared = true;
    const gpuRenderer = createGpuWaterRenderer(gpu, theme === "night");
    const initialRenderer = gpuRenderer ?? createSoftwareWaterRenderer(software, theme === "night");
    if (!initialRenderer) return;
    let renderer = initialRenderer, softwareMode = !gpuRenderer;
    gpu.style.display = softwareMode ? "none" : "block"; software.style.display = softwareMode ? "block" : "none";
    const resizeSurface = () => { const rect = surface.getBoundingClientRect(); if (rect.width && rect.height) renderer.resize(rect.width, rect.height); impacts = []; detector.reset(); renderer.clear(); };
    const resize = new ResizeObserver(resizeSurface);
    resize.observe(surface);
    resizeSurface();
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }); intersection.observe(surface);
    const start = performance.now();
    const clear = () => { impacts = []; detector.reset(); renderer.clear(); cleared = true; };
    const animate = (now: number) => {
      animation = requestAnimationFrame(animate);
      if (!visible || document.hidden) { if (!cleared) clear(); return; }
      const frame = runtime.frame, time = (now - start) / 1000;
      if (frame && now - runtime.receivedAt < 400) {
        for (const trigger of detector.observe(frame, time)) {
          const origin = surface.querySelector<HTMLCanvasElement>(`[data-ripple-source="${trigger.source}"]`);
          if (!origin) continue;
          const rect = origin.getBoundingClientRect(), bounds = surface.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          impacts.push({ x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height * (trigger.source === "stereo" ? .48 : .5), born: time, strength: trigger.strength });
          if (impacts.length > maxWaterImpacts) impacts.shift();
        }
      } else detector.reset();
      impacts = impacts.filter(impact => time - impact.born < rippleLifetime);
      if (impacts.length) {
        if (softwareMode && now - lastDraw < 33) return;
        renderer.draw(time, impacts); lastDraw = now; cleared = false;
      } else if (!cleared) { renderer.clear(); cleared = true; }
    };
    // Losing the GPU must not affect audio or leave a frozen decorative layer.
    const lost = (event: Event) => {
      event.preventDefault(); cancelAnimationFrame(animation); gpu.style.display = "none";
      if (softwareMode) return;
      const fallback = createSoftwareWaterRenderer(software, theme === "night");
      if (!fallback) return;
      renderer.dispose(); renderer = fallback; softwareMode = true; software.style.display = "block";
      resizeSurface(); animation = requestAnimationFrame(animate);
    };
    gpu.addEventListener("webglcontextlost", lost);
    animation = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(animation); resize.disconnect(); intersection.disconnect(); gpu.removeEventListener("webglcontextlost", lost); renderer.dispose(); };
  }, [runtime, theme, resetKey, motionAllowed]);
  return <><canvas ref={gpuRef} className="sav-water-surface" aria-hidden="true" /><canvas ref={softwareRef} className="sav-water-surface sav-water-software" aria-hidden="true" /></>;
}
