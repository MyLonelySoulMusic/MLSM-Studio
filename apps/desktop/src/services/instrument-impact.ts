import type { SceneObjectType } from "../store/scene-store";

export interface InstrumentImpactPose { offsetY: number; rotationX: number; rotationZ: number; headCompression: number; }
const stillPose: InstrumentImpactPose = { offsetY: 0, rotationX: 0, rotationZ: 0, headCompression: 0 };

export function instrumentImpactPose(type: SceneObjectType, elapsedSeconds: number, strength: number): InstrumentImpactPose {
  if (elapsedSeconds < 0) return stillPose; const intensity = Math.max(.35, Math.min(1, strength));
  if (type === "kick" || type === "snare" || type === "drum") {
    if (elapsedSeconds > .52) return stillPose; const envelope = Math.exp(-elapsedSeconds * 9.5); const pulse = Math.cos(elapsedSeconds * 76);
    return { offsetY: pulse * envelope * .018 * intensity, rotationX: Math.sin(elapsedSeconds * 61) * envelope * .009 * intensity, rotationZ: Math.sin(elapsedSeconds * 69 + .35) * envelope * .012 * intensity, headCompression: Math.max(0, pulse) * envelope * .065 * intensity };
  }
  if (type === "cymbal") {
    if (elapsedSeconds > 1.8) return stillPose; const attack = 1 - Math.exp(-elapsedSeconds * 42); const envelope = Math.exp(-elapsedSeconds * 2.45) * attack;
    return { offsetY: Math.sin(elapsedSeconds * 22 + .3) * envelope * .035 * intensity, rotationX: Math.sin(elapsedSeconds * 18 + .5) * envelope * .19 * intensity, rotationZ: Math.sin(elapsedSeconds * 15 + 1.1) * envelope * .13 * intensity, headCompression: 0 };
  }
  return stillPose;
}
