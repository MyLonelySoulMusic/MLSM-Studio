export interface TeddyWalkMotion {
  phase: number;
  stride: number;
  bob: number;
  lean: number;
  roadTravel: number;
  danceSpin: number;
  danceHop: number;
  danceArmLift: number;
  danceLegTuck: number;
  danceNod: number;
}

export const teddyWalkHeading = -.68;
export const teddyRoadScrollDirection = -1;

export function resolveTeddyWalkMotion(timeSeconds: number, bpm: number, walkIntensity: number, danceEnabled = false, rhythmPulse = 0): TeddyWalkMotion {
  const safeTime = Math.max(0, timeSeconds); const safeBpm = Math.max(40, Number.isFinite(bpm) ? bpm : 120); const beatRate = safeBpm / 60; const phase = safeTime * Math.PI * 2 * beatRate / 4; const pulse = Math.max(0, Math.min(1, rhythmPulse)); const beatPosition = safeTime * beatRate; const beatIndex = Math.floor(beatPosition / 2); const beatPhase = (beatPosition % 2) / 2; const cycleBeat = beatPosition % 16;
  const smoothstep = (value: number) => { const clamped = Math.max(0, Math.min(1, value)); return clamped * clamped * (3 - 2 * clamped); };
  const hopActive = beatIndex % 8 === 5; const hopArc = hopActive ? Math.pow(Math.sin(Math.PI * beatPhase), .88) : 0; const spinProgress = smoothstep((cycleBeat - 8) / 4); const spinWindow = Math.sin(Math.PI * Math.max(0, Math.min(1, (cycleBeat - 7) / 6))); const armAccent = Math.max(hopArc, spinWindow * .82, pulse * .28); const dance = (value: number) => danceEnabled ? value : 0;
  return {
    phase,
    stride: Math.sin(phase) * .38 * walkIntensity,
    bob: Math.abs(Math.sin(phase)) * .025 * walkIntensity,
    lean: Math.sin(phase) * .016 * walkIntensity,
    roadTravel: safeTime * beatRate * .42 * walkIntensity,
    danceSpin: dance(Math.PI * 2 * spinProgress),
    danceHop: dance(hopArc * (.34 + pulse * .08)),
    danceArmLift: dance(smoothstep(armAccent)),
    danceLegTuck: dance(hopArc * .42),
    danceNod: dance(Math.sin(phase) * .012 + pulse * .022)
  };
}
