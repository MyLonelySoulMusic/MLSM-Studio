import type { SceneLightAppearance } from "../store/scene-store";

export type LightPoint = [number, number, number];

export interface ResolvedSceneLightFrame {
  active: boolean;
  origin: LightPoint;
  target: LightPoint;
  beamEnd: LightPoint;
}

function add(a: LightPoint, b: LightPoint): LightPoint { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subtract(a: LightPoint, b: LightPoint): LightPoint { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(point: LightPoint, multiplier: number): LightPoint { return [point[0] * multiplier, point[1] * multiplier, point[2] * multiplier]; }

export function resolveSceneLightFrame(light: SceneLightAppearance, marblePosition: LightPoint, timeSeconds: number): ResolvedSceneLightFrame {
  const activeUntil = light.activeUntilSeconds;
  const active = light.enabled && timeSeconds >= light.activeFromSeconds && (activeUntil === null || timeSeconds <= activeUntil);
  const direction = subtract(light.target, light.origin);
  const target = light.followBall ? [...marblePosition] as LightPoint : [...light.target] as LightPoint;
  const origin = light.followBall ? subtract(target, direction) : [...light.origin] as LightPoint;
  const beamEnd = add(origin, scale(direction, light.beamLengthMultiplier));
  return { active, origin, target, beamEnd };
}
