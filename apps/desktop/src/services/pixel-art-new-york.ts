export type PixelArtNewYorkPhase = "street" | "trafficLight" | "venueApproach" | "barEntry" | "bar";

export interface PixelArtNewYorkTimeline {
  phase: PixelArtNewYorkPhase;
  entranceTimeSeconds: number;
  trafficStopStartSeconds: number;
  trafficStopEndSeconds: number;
  barEntryProgress: number;
  walking: boolean;
  walkingElapsedSeconds: number;
  worldDistancePixels: number;
  venueDistancePixels: number;
  walkFrame: number;
}

export const pixelArtWalkSpeedPixelsPerSecond = 24;
export const pixelArtWalkCycleSeconds = 1.15;

export interface PixelArtWalkRig {
  phaseRadians: number;
  bodyBob: number;
  torsoLean: number;
  frontThigh: number;
  backThigh: number;
  frontKnee: number;
  backKnee: number;
  frontFootOffset: number;
  backFootOffset: number;
  frontFootLift: number;
  backFootLift: number;
  frontArm: number;
  backArm: number;
}

export interface PixelArtRigPoint { x: number; y: number; }

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolvePixelArtWalkRig(walkingElapsedSeconds: number, walking: boolean): PixelArtWalkRig {
  if (!walking) return { phaseRadians: 0, bodyBob: 0, torsoLean: .035, frontThigh: 0, backThigh: 0, frontKnee: .08, backKnee: .08, frontFootOffset: 0, backFootOffset: 0, frontFootLift: 0, backFootLift: 0, frontArm: 0, backArm: 0 };
  const phaseRadians = walkingElapsedSeconds / pixelArtWalkCycleSeconds * Math.PI * 2;
  const stride = Math.sin(phaseRadians); const frontLift = Math.max(0, Math.cos(phaseRadians)); const backLift = Math.max(0, -Math.cos(phaseRadians));
  return {
    phaseRadians,
    bodyBob: Math.abs(Math.sin(phaseRadians)) * .46,
    torsoLean: .042 + Math.sin(phaseRadians * 2) * .008,
    frontThigh: stride * .42,
    backThigh: -stride * .42,
    frontKnee: .08 + frontLift * .42,
    backKnee: .08 + backLift * .42,
    frontFootOffset: stride * 5.8,
    backFootOffset: -stride * 5.8,
    frontFootLift: frontLift * 2.7,
    backFootLift: backLift * 2.7,
    frontArm: -stride * .31,
    backArm: stride * .31
  };
}

export function solvePixelArtKnee(hip: PixelArtRigPoint, foot: PixelArtRigPoint, upperLength: number, lowerLength: number, facing: number): PixelArtRigPoint {
  const dx = foot.x - hip.x; const dy = foot.y - hip.y; const rawDistance = Math.hypot(dx, dy); const distance = Math.max(.001, Math.min(upperLength + lowerLength - .001, rawDistance)); const unitX = dx / Math.max(.001, rawDistance); const unitY = dy / Math.max(.001, rawDistance);
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance); const perpendicular = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const centerX = hip.x + unitX * along; const centerY = hip.y + unitY * along; const first = { x: centerX - unitY * perpendicular, y: centerY + unitX * perpendicular }; const second = { x: centerX + unitY * perpendicular, y: centerY - unitX * perpendicular };
  return first.x * facing >= second.x * facing ? first : second;
}

export function solvePixelArtElbow(shoulder: PixelArtRigPoint, hand: PixelArtRigPoint, upperLength: number, lowerLength: number, facing: number): PixelArtRigPoint {
  const dx = hand.x - shoulder.x; const dy = hand.y - shoulder.y; const rawDistance = Math.hypot(dx, dy); const distance = Math.max(.001, Math.min(upperLength + lowerLength - .001, rawDistance)); const unitX = dx / Math.max(.001, rawDistance); const unitY = dy / Math.max(.001, rawDistance);
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance); const perpendicular = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const centerX = shoulder.x + unitX * along; const centerY = shoulder.y + unitY * along; const first = { x: centerX - unitY * perpendicular, y: centerY + unitX * perpendicular }; const second = { x: centerX + unitY * perpendicular, y: centerY - unitX * perpendicular };
  // Il gomito umano punta verso il retro del corpo: per un personaggio rivolto
  // a destra scegliamo quindi la soluzione posteriore (e viceversa a sinistra).
  return first.x * facing <= second.x * facing ? first : second;
}

export function resolvePixelArtNewYorkTimeline(timeSeconds: number, durationSeconds: number): PixelArtNewYorkTimeline {
  const duration = durationSeconds > 0 ? durationSeconds : 30;
  const time = clamp(timeSeconds, 0, duration);
  const entranceTimeSeconds = duration / 2;
  const requestedStopDuration = clamp(entranceTimeSeconds * .12, .75, 4.5);
  const trafficStopStartSeconds = clamp(entranceTimeSeconds * .42, 1.1, Math.max(1.1, entranceTimeSeconds - 1.65));
  const trafficStopEndSeconds = Math.min(trafficStopStartSeconds + requestedStopDuration, Math.max(trafficStopStartSeconds, entranceTimeSeconds - .8));
  const completedPause = clamp(time - trafficStopStartSeconds, 0, trafficStopEndSeconds - trafficStopStartSeconds);
  const walkingElapsedSeconds = Math.min(time, entranceTimeSeconds) - completedPause;
  const worldDistancePixels = walkingElapsedSeconds * pixelArtWalkSpeedPixelsPerSecond;
  const venueDistancePixels = (entranceTimeSeconds - (trafficStopEndSeconds - trafficStopStartSeconds)) * pixelArtWalkSpeedPixelsPerSecond;
  const entryDuration = clamp(duration * .018, .55, 1.1);
  const barEntryProgress = clamp((time - entranceTimeSeconds) / entryDuration, 0, 1);
  const phase: PixelArtNewYorkPhase = time >= entranceTimeSeconds
    ? barEntryProgress < 1 ? "barEntry" : "bar"
    : time >= trafficStopStartSeconds && time < trafficStopEndSeconds
      ? "trafficLight"
      : time >= trafficStopEndSeconds ? "venueApproach" : "street";
  const walking = time < entranceTimeSeconds && phase !== "trafficLight";
  const walkFrame = walking ? Math.floor(walkingElapsedSeconds / pixelArtWalkCycleSeconds * 8) % 8 : 0;
  return { phase, entranceTimeSeconds, trafficStopStartSeconds, trafficStopEndSeconds, barEntryProgress, walking, walkingElapsedSeconds, worldDistancePixels, venueDistancePixels, walkFrame };
}
