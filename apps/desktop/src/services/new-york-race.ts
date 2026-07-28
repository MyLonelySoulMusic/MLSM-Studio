import { createTrajectoryEvaluator, type TrajectorySegment, type Vector3Data } from "@rbs/trajectory";
import { secondaryMarbleBreakElapsed, secondaryMarbleBreakProgress, secondaryMarbleBreakStartSeconds } from "./new-york-swarm";

export interface NewYorkRacerState {
  position: Vector3Data;
  velocity: Vector3Data;
  rotation: Vector3Data;
  breakProgress: number;
  breakElapsedSeconds: number;
  constrainedToManhole: boolean;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

function seededUnit(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d); value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4_294_967_296;
}

export function newYorkRacerTakesBounce(seed: number, racerIndex: number, segmentIndex: number): boolean {
  return seededUnit(seed, racerIndex, 1000 + segmentIndex) > .62;
}

function routeFrame(velocity: Vector3Data, segments: readonly TrajectorySegment[], timeSeconds: number): { forward: Vector3Data; right: Vector3Data } {
  let x = velocity.x; let z = velocity.z; let length = Math.hypot(x, z);
  if (length < .05) {
    const segment = segments.find((item) => timeSeconds >= item.startTime && timeSeconds <= item.endTime) ?? segments.at(-1);
    if (segment) { x = segment.endPosition.x - segment.startPosition.x; z = segment.endPosition.z - segment.startPosition.z; length = Math.hypot(x, z); }
  }
  if (length < .05) { x = 0; z = -1; length = 1; }
  const forward = { x: x / length, y: 0, z: z / length }; return { forward, right: { x: -forward.z, y: 0, z: forward.x } };
}

function separateRacers(states: NewYorkRacerState[], primaryPosition: Vector3Data, radius: number): void {
  const minimumDistance = Math.max(.34, radius * 1.72); const bodies: { position: Vector3Data; state?: NewYorkRacerState }[] = [{ position: primaryPosition }, ...states.filter((state) => state.breakElapsedSeconds <= 0 && !state.constrainedToManhole).map((state) => ({ position: state.position, state }))];
  for (let pass = 0; pass < 12; pass += 1) {
    for (let first = 0; first < bodies.length; first += 1) for (let second = first + 1; second < bodies.length; second += 1) {
      const firstBody = bodies[first]; const secondBody = bodies[second]; const a = firstBody?.position; const b = secondBody?.position; if (!a || !b || Math.abs(a.y - b.y) > radius * 1.5) continue;
      let dx = b.x - a.x; let dz = b.z - a.z; let distance = Math.hypot(dx, dz); if (distance >= minimumDistance) continue;
      if (distance < .0001) { const angle = (first + 1) * (second + 2) * 1.618; dx = Math.cos(angle); dz = Math.sin(angle); distance = 1; }
      const overlap = minimumDistance - distance; const nx = dx / distance; const nz = dz / distance;
      if (firstBody.state) { a.x -= nx * overlap * .5; a.z -= nz * overlap * .5; firstBody.state.velocity.x -= nx * overlap * 2.2; firstBody.state.velocity.z -= nz * overlap * 2.2; }
      b.x += nx * overlap * (firstBody.state ? .5 : 1); b.z += nz * overlap * (firstBody.state ? .5 : 1); if (secondBody.state) { secondBody.state.velocity.x += nx * overlap * 2.2; secondBody.state.velocity.z += nz * overlap * 2.2; }
    }
  }
}

export function createNewYorkRaceEvaluator(segments: readonly TrajectorySegment[], secondaryCount: number, seed: number, radius: number, durationSeconds: number): (timeSeconds: number) => NewYorkRacerState[] {
  const evaluateRoute = createTrajectoryEvaluator(segments); const count = Math.max(0, Math.min(13, Math.round(secondaryCount))); const duration = Math.max(.001, durationSeconds);
  const evaluateIndependentRoute = (timeSeconds: number, racerIndex: number) => {
    const base = evaluateRoute(timeSeconds); const segmentIndex = segments.findIndex((segment) => timeSeconds >= segment.startTime && timeSeconds <= segment.endTime); const segment = segments[segmentIndex]; if (!segment || segment.motionKind === "sewerDrop") return base;
    const segmentDuration = Math.max(.001, segment.endTime - segment.startTime); const progress = clamp((timeSeconds - segment.startTime) / segmentDuration, 0, 1); const startRoadY = segment.startPosition.y; const endRoadY = segment.endPosition.y; const roadVelocityY = (endRoadY - startRoadY) / segmentDuration; let hopHeight = 0; let hopVelocity = 0;
    const independentBounce = segment.motionKind === "bounce" && newYorkRacerTakesBounce(seed, racerIndex, segmentIndex);
    if (independentBounce) { const height = .1 + seededUnit(seed, racerIndex, 2000 + segmentIndex) * .13; hopHeight = 4 * height * progress * (1 - progress); hopVelocity = 4 * height * (1 - 2 * progress) / segmentDuration; }
    return { ...base, position: { ...base.position, y: startRoadY + (endRoadY - startRoadY) * progress + hopHeight }, velocity: { ...base.velocity, y: roadVelocityY + hopVelocity } };
  };
  return (timeSeconds) => {
    const primary = evaluateRoute(timeSeconds); const states: NewYorkRacerState[] = [];
    for (let index = 0; index < count; index += 1) {
      const breakStart = secondaryMarbleBreakStartSeconds(index, count, duration); const motionTime = Math.min(timeSeconds, breakStart); const progress = clamp(motionTime / duration, 0, 1); const startEndBlend = Math.sin(progress * Math.PI); const phase = seededUnit(seed, index, 0) * Math.PI * 2; const temperament = seededUnit(seed, index, 1); const pace = .32 + seededUnit(seed, index, 2) * .3;
      const timingLead = (Math.sin(motionTime * pace + phase) * .38 + (temperament - .5) * .62) * startEndBlend; const racerTime = clamp(motionTime + timingLead, 0, duration);
      const base = evaluateIndependentRoute(racerTime, index); const frame = routeFrame(base.velocity, segments, racerTime); const laneCount = Math.min(7, Math.max(3, count)); const laneSlot = index % laneCount; const laneCenter = (laneSlot - (laneCount - 1) / 2) * .64; const rank = Math.floor(index / laneCount);
      const weave = Math.sin(motionTime * (.58 + temperament * .25) + phase) * (.18 + seededUnit(seed, index, 3) * .18); const rawOvertake = (Math.sin(motionTime * (.34 + temperament * .17) + phase * .7) * 2.35 + (temperament - .5) * 2.4 - rank * .48) * startEndBlend; const segmentIndex = segments.findIndex((segment) => racerTime >= segment.startTime && racerTime <= segment.endTime); const segment = segments[segmentIndex]; const segmentProgress = segment ? clamp((racerTime - segment.startTime) / Math.max(.001, segment.endTime - segment.startTime), 0, 1) : 0; const smoothstep = (value: number) => value * value * (3 - 2 * value); let laneScale = 1; if (segment?.motionKind === "sewerDrop") laneScale = 0; else if (segments[segmentIndex + 1]?.motionKind === "sewerDrop") laneScale = 1 - smoothstep(clamp((segmentProgress - .35) / .65, 0, 1)); else if (segments[segmentIndex - 1]?.motionKind === "sewerDrop") laneScale = smoothstep(clamp(segmentProgress / .55, 0, 1)); const constrainedToManhole = laneScale < .22; const queueOffset = segment?.motionKind === "sewerDrop" ? (index % 3 - 1) * .07 : 0;
      const lateral = (laneCenter + weave) * laneScale + queueOffset; const overtake = rawOvertake * laneScale; const position = { x: base.position.x + frame.right.x * lateral + frame.forward.x * overtake, y: base.position.y, z: base.position.z + frame.right.z * lateral + frame.forward.z * overtake };
      const lateralVelocity = Math.cos(motionTime * (.72 + temperament * .24) + phase) * (.12 + seededUnit(seed, index, 3) * .12) * laneScale; const velocity = { x: base.velocity.x + frame.right.x * lateralVelocity, y: base.velocity.y, z: base.velocity.z + frame.right.z * lateralVelocity };
      const travelled = racerTime * (2.8 + temperament * .9) / Math.max(.12, radius); states.push({ position, velocity, rotation: { x: frame.forward.z * travelled, y: phase + travelled * .08, z: -frame.forward.x * travelled }, breakProgress: secondaryMarbleBreakProgress(index, count, timeSeconds, duration), breakElapsedSeconds: secondaryMarbleBreakElapsed(index, count, timeSeconds, duration), constrainedToManhole });
    }
    separateRacers(states, primary.position, radius); return states;
  };
}
