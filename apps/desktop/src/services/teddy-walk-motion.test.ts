import { describe, expect, it } from "vitest";
import { resolveTeddyWalkMotion, teddyRoadScrollDirection, teddyWalkHeading } from "./teddy-walk-motion";

describe("teddy walk motion", () => {
  it("alterna lentamente il passo e mantiene continuo lo scorrimento stradale", () => {
    const before = resolveTeddyWalkMotion(1, 120, 1); const after = resolveTeddyWalkMotion(1.01, 120, 1);
    expect(Math.abs(after.roadTravel - before.roadTravel)).toBeLessThan(.02); expect(resolveTeddyWalkMotion(1.125, 120, 1).stride).not.toBe(resolveTeddyWalkMotion(1.625, 120, 1).stride);
  });
  it("non contiene alcuna componente di salto", () => {
    const motion = resolveTeddyWalkMotion(2, 100, 1);
    expect(motion).not.toHaveProperty("jump"); expect(motion.bob).toBeLessThanOrEqual(.025);
  });
  it("definisce un unico orientamento condiviso da personaggio e strada", () => {
    expect(teddyWalkHeading).toBeLessThan(0); expect(Math.abs(teddyWalkHeading)).toBeLessThan(Math.PI / 2);
  });
  it("fa scorrere il terreno in senso opposto all'avanzamento del personaggio", () => {
    expect(teddyRoadScrollDirection).toBe(-1);
  });
  it("sovrappone una danza morbida soltanto quando il flag è attivo", () => {
    const walking = resolveTeddyWalkMotion(.65, 112, 1, false, .8); const dancing = resolveTeddyWalkMotion(.65, 112, 1, true, .8);
    expect(walking.danceHop).toBe(0); expect(walking.danceArmLift).toBe(0); expect(dancing.danceArmLift).toBeGreaterThan(0); expect(dancing.danceSpin).toBeGreaterThanOrEqual(0);
  });
  it("esegue salto e giro su finestre musicali distinte senza deriva laterale", () => {
    const jump = resolveTeddyWalkMotion(5.5, 120, 1, true, 1); const spinStart = resolveTeddyWalkMotion(4, 120, 1, true, .5); const spinEnd = resolveTeddyWalkMotion(6, 120, 1, true, .5);
    expect(jump.danceHop).toBeGreaterThan(.3); expect(jump.danceLegTuck).toBeGreaterThan(0); expect(spinEnd.danceSpin).toBeGreaterThan(spinStart.danceSpin); expect(jump).not.toHaveProperty("danceSway");
  });
});
