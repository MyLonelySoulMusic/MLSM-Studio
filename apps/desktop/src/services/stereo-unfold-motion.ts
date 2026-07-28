export interface StereoUnfoldMotion {
  arrival: number;
  unfold: number;
  coverY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  foldCompression: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const easeOutCubic = (value: number): number => 1 - Math.pow(1 - clamp01(value), 3);

export function resolveStereoUnfoldMotion(timeSeconds: number, unfoldDuration: number): StereoUnfoldMotion {
  const duration = Math.max(.8, unfoldDuration); const arrivalDuration = Math.min(1.05, duration * .42);
  const arrival = easeOutCubic(timeSeconds / arrivalDuration);
  const unfoldStart = arrivalDuration * .62; const unfold = smoothstep((timeSeconds - unfoldStart) / Math.max(.35, duration - unfoldStart));
  const settle = Math.exp(-Math.max(0, timeSeconds - arrivalDuration) * 2.35) * Math.sin(Math.max(0, timeSeconds - arrivalDuration) * 8.4);
  return {
    arrival,
    unfold,
    coverY: 6.4 + (.34 - 6.4) * arrival + settle * .13,
    rotationX: (1 - arrival) * -.82 + settle * .055,
    rotationY: (1 - arrival) * .48 - settle * .035,
    rotationZ: (1 - arrival) * -.34 + settle * .065,
    foldCompression: .24 + unfold * .76
  };
}

export function deformStereoCoverVertex(baseX: number, baseY: number, unfold: number, residualCrease: number, pulse: number): { x: number; y: number; z: number } {
  const open = clamp01(unfold); const compression = .24 + open * .76; const remaining = Math.max(.08, Math.min(1, residualCrease)) * (.28 + (1 - open) * 1.35);
  const diagonal = Math.sin(baseX * 4.7 + baseY * 5.6) * .105 + Math.sin(baseX * 9.2 - baseY * 3.7) * .052;
  const largeFold = Math.sin(baseX * 2.2 + .8) * Math.cos(baseY * 2.7 - .4) * .16;
  const crumple = Math.sin(baseY * 7.5 + baseX * 1.8) * (1 - open) * .22;
  const edgeCurl = Math.pow(Math.abs(baseX) / 2.3, 3) * Math.sign(baseX) * .09 + Math.pow(Math.abs(baseY) / 2.3, 3) * .055;
  return {
    x: baseX * compression + Math.sin(baseY * 3.3) * (1 - open) * .18,
    y: baseY * (.52 + open * .48) + Math.sin(baseX * 2.5) * (1 - open) * .14,
    z: (diagonal + largeFold + crumple + edgeCurl) * remaining + Math.sin(baseX * 2.1 + baseY * 1.7) * pulse * .012
  };
}
