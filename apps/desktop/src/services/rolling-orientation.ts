import type { TrajectorySegment } from "@rbs/trajectory";

export interface QuaternionData { x: number; y: number; z: number; w: number; }

const identity = (): QuaternionData => ({ x: 0, y: 0, z: 0, w: 1 });

function multiply(left: QuaternionData, right: QuaternionData): QuaternionData {
  return { x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y, y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x, z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w, w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z };
}

function normalized(value: QuaternionData): QuaternionData { const length = Math.hypot(value.x, value.y, value.z, value.w) || 1; return { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length }; }

function integrateSegment(orientation: QuaternionData, segment: TrajectorySegment, localDuration: number, radius: number): QuaternionData {
  const fullDuration = segment.endTime - segment.startTime; const duration = Math.max(0, Math.min(fullDuration, localDuration)); if (duration <= 0) return orientation; const steps = segment.motionKind === "slide" || segment.motionKind === "roll" ? 4 : 2; let result = orientation; let previousTime = 0;
  for (let step = 1; step <= steps; step += 1) { const currentTime = duration * step / steps; const dt = currentTime - previousTime; const middle = (previousTime + currentTime) / 2; const surfaceConstrained = segment.motionKind === "slide" || segment.motionKind === "roll"; const vx = segment.initialVelocity.x + (surfaceConstrained ? segment.gravity.x * middle : 0); const vz = segment.initialVelocity.z + (surfaceConstrained ? segment.gravity.z * middle : 0); const dx = vx * dt; const dz = vz * dt; const distance = Math.hypot(dx, dz); if (distance > 1e-7) { const halfAngle = distance / Math.max(.08, radius) / 2; const sine = Math.sin(halfAngle); const delta = { x: dz / distance * sine, y: 0, z: -dx / distance * sine, w: Math.cos(halfAngle) }; result = normalized(multiply(delta, result)); } previousTime = currentTime; }
  return result;
}

export function createRollingOrientationEvaluator(segments: readonly TrajectorySegment[], radius: number): (timeSeconds: number) => QuaternionData {
  const ordered = [...segments].sort((first, second) => first.startTime - second.startTime); const starts: QuaternionData[] = []; let orientation = identity(); for (const segment of ordered) { starts.push(orientation); orientation = integrateSegment(orientation, segment, segment.endTime - segment.startTime, radius); }
  return (timeSeconds) => { if (!ordered.length) return identity(); const index = ordered.findIndex((segment) => timeSeconds <= segment.endTime); if (index < 0) return orientation; const segment = ordered[index]; if (!segment || timeSeconds <= segment.startTime) return starts[index] ?? identity(); return integrateSegment(starts[index] ?? identity(), segment, timeSeconds - segment.startTime, radius); };
}
