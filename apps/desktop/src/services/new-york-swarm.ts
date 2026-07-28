import type { Vector3Data } from "@rbs/trajectory";

const fragmentGravity = 9.81;
const fragmentLifeSeconds = 2.4;

export function secondaryMarbleBreakStartSeconds(index: number, secondaryCount: number, durationSeconds: number): number {
  if (secondaryCount <= 0 || durationSeconds <= 0) return Number.POSITIVE_INFINITY; const safeIndex = Math.max(0, Math.min(secondaryCount - 1, index)); return (.24 + (secondaryCount - 1 - safeIndex) / secondaryCount * .56) * durationSeconds;
}

export function secondaryMarbleBreakElapsed(index: number, secondaryCount: number, timeSeconds: number, durationSeconds: number): number {
  return Math.max(0, timeSeconds - secondaryMarbleBreakStartSeconds(index, secondaryCount, durationSeconds));
}

export function secondaryMarbleBreakProgress(index: number, secondaryCount: number, timeSeconds: number, durationSeconds: number): number {
  return Math.max(0, Math.min(1, secondaryMarbleBreakElapsed(index, secondaryCount, timeSeconds, durationSeconds) / fragmentLifeSeconds));
}

export interface FallingFragmentPose { position: Vector3Data; rotation: Vector3Data; settled: boolean; }

export function fallingFragmentPose(direction: Vector3Data, shardIndex: number, elapsedSeconds: number, radius: number): FallingFragmentPose {
  const time = Math.max(0, elapsedSeconds); const ground = -Math.max(.12, radius * .9); let y = direction.y * radius * .28; let velocityY = 1.05 + Math.max(0, direction.y) * 1.2 + shardIndex % 4 * .09; let velocityX = direction.x * (1.05 + shardIndex % 3 * .18); let velocityZ = direction.z * (.9 + shardIndex % 5 * .1); let remaining = time; let x = direction.x * radius * .22; let z = direction.z * radius * .22; let rotationTime = 0; let angularFactor = 1; let settled = false;
  for (let bounce = 0; bounce < 6 && remaining > 0; bounce += 1) {
    const discriminant = Math.max(0, velocityY * velocityY + 2 * fragmentGravity * Math.max(0, y - ground)); const hitTime = (velocityY + Math.sqrt(discriminant)) / fragmentGravity; const step = Math.min(remaining, hitTime);
    x += velocityX * step; z += velocityZ * step; y += velocityY * step - .5 * fragmentGravity * step * step; rotationTime += step * angularFactor; remaining -= step;
    if (step < hitTime - 1e-7) break;
    y = ground; velocityY = Math.max(0, Math.abs(velocityY - fragmentGravity * hitTime) * .32); velocityX *= .48; velocityZ *= .48; angularFactor *= .42;
    if (velocityY < .12) { x += velocityX * Math.min(.32, remaining); z += velocityZ * Math.min(.32, remaining); y = ground; settled = true; remaining = 0; }
  }
  if (y < ground) y = ground;
  return { position: { x, y, z }, rotation: { x: rotationTime * (4.5 + shardIndex * .31) * direction.z, y: rotationTime * (3.8 + shardIndex * .23) * direction.x, z: rotationTime * (4.1 + shardIndex * .27) * direction.y }, settled };
}
