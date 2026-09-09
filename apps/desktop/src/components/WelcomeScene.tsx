import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArtistLogoFallback } from "./ArtistLogoFallback";
import type { UiTheme } from "../services/ui-preferences";
import type { WelcomeSceneController } from "../services/welcome-scene";
import { welcomeMotion, WELCOME_FPS, WELCOME_INTRO_SECONDS } from "../services/welcome-motion";

export function WelcomeScene({ animated, theme, reducedMotion = false, stage }: { animated: boolean; theme: UiTheme; reducedMotion?: boolean; stage?: RefObject<HTMLElement | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const sculpture = useRef<HTMLDivElement>(null);
  const controller = useRef<WelcomeSceneController | null>(null);
  const current = useRef({ animated, theme, reducedMotion });
  const elapsed = useRef(reducedMotion ? WELCOME_INTRO_SECONDS : 0);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => { current.current = { animated, theme, reducedMotion }; controller.current?.setAnimating(animated); controller.current?.setTheme(theme); }, [animated, theme, reducedMotion]);
  useLayoutEffect(() => {
    const root = stage?.current ?? sculpture.current?.closest<HTMLElement>(".welcome-splash--3d");
    const art = sculpture.current?.parentElement;
    const fallback = sculpture.current?.querySelector<SVGElement>(".intro-sculpture__fallback");
    let frame = 0, previous: number | undefined, offsetX = 0, offsetY = 0, centerScale = 1;
    let cameraDistance = 7.5, pixelsPerWorldUnit = 0;
    let presentationFinished = false;
    if (reducedMotion) elapsed.current = Math.max(elapsed.current, WELCOME_INTRO_SECONDS);
    const present = () => {
      const pose = welcomeMotion(elapsed.current, reducedMotion);
      controller.current?.setTime(elapsed.current, reducedMotion);
      // Keep the hidden fallback current too: context loss can happen while paused.
      const depthScale = cameraDistance / (cameraDistance - pose.z);
      if (fallback) fallback.style.transform = `translate3d(${pose.x * pixelsPerWorldUnit * depthScale}px, ${-pose.y * pixelsPerWorldUnit * depthScale}px, 0) rotateX(${-pose.rx}rad) rotateY(${pose.ry}rad) rotateZ(${-pose.rz}rad) scale(${pose.scale * depthScale})`;
      if (!root || presentationFinished) return;
      root.dataset.intro = pose.settled ? "settled" : "playing";
      root.dataset.copyReady = pose.copy > .02 ? "true" : "false";
      const values = {
        "--intro-copy": pose.copy.toFixed(4),
        "--intro-copy-y": `${(1 - pose.copy) * 24}px`,
        "--intro-reveal": `${(1 - pose.reveal) * 100}%`,
        "--intro-logo-opacity": Math.min(1, pose.reveal * 3).toFixed(4),
        "--intro-wave": pose.wave.toFixed(4),
        "--intro-wave-dash": (1 - pose.draw).toFixed(4),
        "--intro-wave-y": `${-460 * (1 - pose.reveal)}px`,
        "--intro-flight-x": `${offsetX * (1 - pose.dock)}px`,
        "--intro-flight-y": `${offsetY * (1 - pose.dock)}px`,
        "--intro-flight-scale": String(1 + (centerScale - 1) * (1 - pose.dock)),
        "--intro-shadow": pose.reveal.toFixed(4),
      };
      Object.entries(values).forEach(([key, value]) => root.style.setProperty(key, value));
      presentationFinished = pose.settled;
    };
    const measure = () => {
      if (!art || !sculpture.current) return;
      const bounds = art.getBoundingClientRect();
      const width = sculpture.current.clientWidth, height = sculpture.current.clientHeight;
      cameraDistance = 7.5 / Math.min(1, Math.max(1, width) / Math.max(1, height));
      pixelsPerWorldUnit = height / (2 * Math.tan(34 * Math.PI / 360) * cameraDistance);
      sculpture.current.style.setProperty("--intro-perspective", `${Math.max(1, cameraDistance * pixelsPerWorldUnit)}px`);
      const headerBottom = root?.querySelector(".intro-header")?.getBoundingClientRect().bottom ?? 100;
      const room = Math.max(180, window.innerHeight - headerBottom - 90);
      offsetX = window.innerWidth / 2 - bounds.left - width / 2;
      offsetY = headerBottom + room / 2 - bounds.top - height / 2;
      centerScale = Math.min(1.18, (window.innerWidth - 40) / Math.max(1, width), room / Math.max(1, height));
      presentationFinished = false;
      present();
    };
    const tick = (time: number) => {
      if (previous === undefined) previous = time;
      const delta = time - previous;
      if (delta >= 1000 / WELCOME_FPS) {
        elapsed.current += Math.min(delta, 100) / 1000;
        previous = time;
        present();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      previous = undefined;
      if (animated && !reducedMotion && !document.hidden) frame = requestAnimationFrame(tick);
      present();
    };
    measure(); sync();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (art) observer?.observe(art);
    window.addEventListener("resize", measure);
    // Recalculate the docking point if the welcome screen is scrolled on mobile.
    root?.addEventListener("scroll", measure, { passive: true });
    document.addEventListener("visibilitychange", sync);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", measure); root?.removeEventListener("scroll", measure); document.removeEventListener("visibilitychange", sync); };
  }, [animated, reducedMotion, stage]);
  useEffect(() => {
    if (typeof WebGL2RenderingContext === "undefined") return;
    const abort = new AbortController();
    void import("../services/welcome-scene").then(async ({ createWelcomeScene }) => {
      if (abort.signal.aborted || !host.current) return;
      const scene = await createWelcomeScene(host.current, { theme: current.current.theme, signal: abort.signal, onContextLost: () => { if (!abort.signal.aborted) setReady(false); } });
      if (abort.signal.aborted) { scene.dispose(); return; }
      controller.current = scene;
      scene.setAnimating(current.current.animated);
      scene.setTheme(current.current.theme);
      // Loading WebGL late must join the ongoing motion, not replay its entrance.
      scene.setTime(elapsed.current, current.current.reducedMotion);
      setReady(true);
    }).catch(() => { if (!abort.signal.aborted) setReady(false); });
    return () => { abort.abort(); controller.current?.dispose(); controller.current = null; };
  }, []);

  return <div ref={sculpture} className="intro-sculpture intro-artist-logo intro-flight" role="img" aria-label="My Lonely Soul Music" data-renderer={ready ? "webgl" : "static"}>
    <div className="intro-sculpture__halo" />
    <div className="intro-artist-logo__shadow" />
    <svg className="intro-sound-origin" viewBox="0 0 1254 1254" aria-hidden="true"><path pathLength="1" d="M296 1089H560L574 1077L592 1107L613 1056L637 1136L656 1074L671 1089H966" /></svg>
    <div className="intro-logo-reveal">
      <ArtistLogoFallback />
      <div className="intro-sculpture__canvas" ref={host} aria-hidden="true" />
    </div>
  </div>;
}
