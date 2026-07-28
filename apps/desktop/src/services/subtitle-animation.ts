import type { RhythmBallProject } from "@rbs/project-schema";
import type { SubtitleLayout } from "./subtitle-layout";

type SubtitleAnimation = RhythmBallProject["subtitles"]["animation"];

export interface SubtitleAnimationPose {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number, edge0: number, edge1: number): number {
  const ratio = clamp((value - edge0) / Math.max(.0001, edge1 - edge0));
  return ratio * ratio * (3 - 2 * ratio);
}

export function resolveSubtitleAnimation(animation: SubtitleAnimation, progress: number, layout: SubtitleLayout, fallSpeed: number): SubtitleAnimationPose {
  const phase = clamp(progress);
  const fadeIn = smoothstep(phase, 0, .12);
  const fadeOut = 1 - smoothstep(phase, .82, 1);
  const opacity = Math.min(fadeIn, fadeOut) * .98;

  if (animation === "cinematicFade") return { x: 0, y: -layout.safeTop * .48, scale: .92, opacity };
  if (animation === "wordPop") {
    const spring = 1 - Math.exp(-phase * 14) * Math.cos(phase * 22);
    return { x: 0, y: 0, scale: Math.max(.72, Math.min(1.08, spring)), opacity };
  }
  if (animation === "karaokeGlow") return { x: 0, y: -layout.safeTop * .55, scale: 1 + Math.sin(phase * Math.PI * 6) * .018, opacity };
  if (animation === "slideUp") {
    const entry = smoothstep(phase, 0, .2);
    return { x: 0, y: -layout.safeTop * .62 - (1 - entry) * .72, scale: 1, opacity };
  }
  const travel = Math.min(1.3, fallSpeed * .48);
  return { x: 0, y: layout.startY - phase * travel, scale: 1, opacity };
}
