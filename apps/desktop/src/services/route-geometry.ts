import type { RailType } from "../store/scene-store";

export const railTrimStart = .14;
export const railTrimEnd = .8;

export function railGauge(ballRadius: number, railType: RailType): number {
  if (railType === "bricks") return 0;
  return ballRadius * (railType === "glassTube" ? .5 : .56);
}

export function railBarRadius(railType: RailType): number {
  if (railType === "glassTube") return .065;
  if (railType === "pinball") return .035;
  return .08;
}

/** Distanza verticale fra il centro della biglia e il supporto che la tocca dal basso. */
export function railSupportDrop(ballRadius: number, railType: RailType): number {
  if (railType === "bricks") return ballRadius + railBarRadius(railType);
  const gauge = Math.min(ballRadius * .92, railGauge(ballRadius, railType));
  const contactDistance = ballRadius + railBarRadius(railType);
  return Math.sqrt(Math.max(0, contactDistance * contactDistance - gauge * gauge));
}
