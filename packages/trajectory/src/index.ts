export interface Vector3Data { x: number; y: number; z: number; }
export type MotionKind = "bounce" | "slide" | "roll" | "freeFall" | "sewerDrop";
export interface ScheduledImpact { eventId: string; timeSeconds: number; objectId: string; contactPoint: Vector3Data; contactNormal: Vector3Data; impactStrength: number; motionToNext?: MotionKind; }
export type AssistanceKind = "none" | "localGravity" | "impulseObject" | "invisibleGuide" | "spatialScale";
export interface TrajectorySegment { id: string; startEventId: string; endEventId: string; startTime: number; endTime: number; startPosition: Vector3Data; endPosition: Vector3Data; initialVelocity: Vector3Data; gravity: Vector3Data; motionKind: MotionKind; assisted: boolean; assistanceKind: AssistanceKind; }
export interface BallState { timeSeconds: number; position: Vector3Data; velocity: Vector3Data; segmentId: string | null; atImpact: boolean; }
export interface TrajectoryConstraints { gravity: Vector3Data; maxSpeed: number; maxArcHeight: number; minimumDuration: number; minimumBounceHeight?: number; }
export const defaultTrajectoryConstraints: TrajectoryConstraints = { gravity: { x: 0, y: -9.81, z: 0 }, maxSpeed: 24, maxArcHeight: 12, minimumDuration: .035, minimumBounceHeight: .48 };
export const slideBounceHeight = .38;
export function slideHeightOffset(progress: number): number { const ratio = Math.max(0, Math.min(1, progress)); return 4 * slideBounceHeight * ratio * (1 - ratio); }
const terminalBounceDuration = .46;
const terminalBounceHeight = .16;
const add = (a: Vector3Data, b: Vector3Data): Vector3Data => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (vector: Vector3Data, scalar: number): Vector3Data => ({ x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar });
const subtract = (a: Vector3Data, b: Vector3Data): Vector3Data => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const magnitude = (vector: Vector3Data): number => Math.hypot(vector.x, vector.y, vector.z);

export function planTrajectory(impacts: ScheduledImpact[], constraints: TrajectoryConstraints = defaultTrajectoryConstraints): TrajectorySegment[] {
  const ordered = [...impacts].sort((a, b) => a.timeSeconds - b.timeSeconds || a.eventId.localeCompare(b.eventId)); const segments: TrajectorySegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index]; const end = ordered[index + 1]; if (!start || !end) continue; const duration = end.timeSeconds - start.timeSeconds;
    if (duration < constraints.minimumDuration) throw new Error(`Eventi troppo vicini: ${start.eventId} → ${end.eventId}`);
    const delta = subtract(end.contactPoint, start.contactPoint); const motionKind = start.motionToNext ?? "bounce"; let gravity: Vector3Data; let initialVelocity: Vector3Data;
    if (motionKind === "roll") {
      gravity = { x: 0, y: 0, z: 0 };
      initialVelocity = { x: delta.x / duration, y: delta.y / duration, z: delta.z / duration };
    } else if (motionKind === "slide") {
      gravity = { x: 0, y: -8 * slideBounceHeight / (duration * duration), z: 0 };
      initialVelocity = { x: delta.x / duration, y: delta.y / duration - .5 * gravity.y * duration, z: delta.z / duration };
    } else if (motionKind === "sewerDrop") {
      gravity = { x: 0, y: 2 * delta.y / (duration * duration), z: 0 };
      initialVelocity = { x: delta.x / duration, y: 0, z: delta.z / duration };
    } else if (motionKind === "freeFall") {
      const drop = Math.max(.01, -delta.y); const reboundHeight = .14 + start.impactStrength * .05; const fallAcceleration = Math.pow((Math.sqrt(2 * reboundHeight) + Math.sqrt(2 * (reboundHeight + drop))) / duration, 2); const fallGravity = -fallAcceleration;
      const linearDepthMidpoint = (start.contactPoint.z + end.contactPoint.z) / 2; const frontDepthTarget = Math.max(start.contactPoint.z, end.contactPoint.z) + 1.05; const depthGravity = 8 * (linearDepthMidpoint - frontDepthTarget) / (duration * duration);
      gravity = { x: constraints.gravity.x, y: fallGravity, z: depthGravity };
      initialVelocity = { x: delta.x / duration, y: delta.y / duration - .5 * gravity.y * duration, z: delta.z / duration - .5 * gravity.z * duration };
    } else {
      const baseBounce = (constraints.minimumBounceHeight ?? .48) + start.impactStrength * .18; const bounceHeight = Math.max(baseBounce, Math.max(0, -delta.y + .18) / 4);
      gravity = { x: constraints.gravity.x, y: Math.min(-7.5, -8 * bounceHeight / (duration * duration)), z: constraints.gravity.z };
      initialVelocity = { x: delta.x / duration, y: delta.y / duration - .5 * gravity.y * duration, z: delta.z / duration };
    }
    let assistanceKind: AssistanceKind = "none";
    if (magnitude(initialVelocity) > constraints.maxSpeed) assistanceKind = "invisibleGuide";
    const apexTime = Math.max(0, Math.min(duration, gravity.y === 0 ? 0 : -initialVelocity.y / gravity.y)); const apexY = start.contactPoint.y + initialVelocity.y * apexTime + .5 * gravity.y * apexTime * apexTime;
    if (apexY - Math.max(start.contactPoint.y, end.contactPoint.y) > constraints.maxArcHeight) assistanceKind = "invisibleGuide";
    segments.push({ id: `segment-${start.eventId}-${end.eventId}`, startEventId: start.eventId, endEventId: end.eventId, startTime: start.timeSeconds, endTime: end.timeSeconds, startPosition: { ...start.contactPoint }, endPosition: { ...end.contactPoint }, initialVelocity, gravity, motionKind, assisted: assistanceKind !== "none", assistanceKind });
  }
  return segments;
}

export function evaluateSegment(segment: TrajectorySegment, timeSeconds: number): BallState {
  const localTime = Math.max(0, Math.min(segment.endTime - segment.startTime, timeSeconds - segment.startTime)); const position = add(add(segment.startPosition, scale(segment.initialVelocity, localTime)), scale(segment.gravity, .5 * localTime * localTime)); const velocity = add(segment.initialVelocity, scale(segment.gravity, localTime)); const atImpact = Math.abs(timeSeconds - segment.endTime) <= 1e-9;
  if (atImpact) return { timeSeconds, position: { ...segment.endPosition }, velocity, segmentId: segment.id, atImpact: true };
  return { timeSeconds, position, velocity, segmentId: segment.id, atImpact: false };
}

export function createTrajectoryEvaluator(segments: readonly TrajectorySegment[]): (timeSeconds: number) => BallState {
  const ordered = [...segments].sort((a, b) => a.startTime - b.startTime);
  return (timeSeconds) => {
    if (ordered.length === 0) return { timeSeconds, position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, segmentId: null, atImpact: false };
    let low = 0; let high = ordered.length - 1; let candidate = ordered.length;
    while (low <= high) { const middle = (low + high) >> 1; const segment = ordered[middle]; if (!segment) break; if (segment.endTime >= timeSeconds) { candidate = middle; high = middle - 1; } else low = middle + 1; }
    const segment = ordered[candidate]; if (segment && timeSeconds >= segment.startTime) return evaluateSegment(segment, timeSeconds);
    const finalSegment = ordered.at(-1); if (finalSegment && timeSeconds > finalSegment.endTime && timeSeconds < finalSegment.endTime + terminalBounceDuration) { const progress = (timeSeconds - finalSegment.endTime) / terminalBounceDuration; const height = 4 * terminalBounceHeight * progress * (1 - progress); const velocityY = 4 * terminalBounceHeight * (1 - 2 * progress) / terminalBounceDuration; return { timeSeconds, position: { ...finalSegment.endPosition, y: finalSegment.endPosition.y + height }, velocity: { x: 0, y: velocityY, z: 0 }, segmentId: finalSegment.id, atImpact: false }; }
    const endpoint = timeSeconds < (ordered[0]?.startTime ?? 0) ? ordered[0] : ordered.at(-1); if (!endpoint) throw new Error("Traiettoria non disponibile"); const atStart = timeSeconds < endpoint.startTime; return { timeSeconds, position: { ...(atStart ? endpoint.startPosition : endpoint.endPosition) }, velocity: { x: 0, y: 0, z: 0 }, segmentId: endpoint.id, atImpact: false };
  };
}
