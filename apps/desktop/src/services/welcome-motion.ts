/** Seconds on a single, pausable presentation clock. No wall-clock catch-up. */
export const WELCOME_INTRO_SECONDS = 5.6;
export const WELCOME_FPS = 24;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (t: number) => { const p = clamp(t); return p * p * (3 - 2 * p); };
const between = (t: number, from: number, to: number) => ease((t - from) / (to - from));

export function welcomeMotion(seconds: number, reducedMotion = false) {
  const t = reducedMotion ? WELCOME_INTRO_SECONDS : Math.max(0, seconds);
  const reveal = between(t, .75, 1.85);
  const orbit = between(t, 1.65, 3.75);
  const dock = between(t, 3.35, WELCOME_INTRO_SECONDS);
  const arc = Math.sin(orbit * Math.PI);
  const idle = Math.max(0, t - WELCOME_INTRO_SECONDS);
  const sway = reducedMotion ? 0 : between(idle, 0, 1.4);
  return {
    dock, reveal,
    draw: between(t, .05, .95),
    wave: 1 - between(t, 1.55, 2.05),
    copy: between(t, 3.95, 5.25),
    settled: t >= WELCOME_INTRO_SECONDS,
    x: Math.sin(orbit * Math.PI * 2) * .19,
    y: -.16 * (1 - reveal) + arc * .16 + Math.sin(idle * .65) * .038 * sway,
    z: -.8 * (1 - reveal) + arc * .3,
    rx: .035 + .2 * (1 - reveal) + Math.sin(orbit * Math.PI * 2) * .1 + Math.sin(idle * .3) * .045 * sway,
    // A controlled banked orbit: never expose the back of the portrait relief.
    ry: -.12 - .5 * (1 - reveal) + Math.sin(orbit * Math.PI * 2) * .56 + Math.sin(idle * .32) * .21 * sway,
    rz: Math.sin(orbit * Math.PI * 2) * -.1 + Math.sin(idle * .22) * .012 * sway,
    scale: 1 + arc * .035,
    pointer: dock,
  };
}
