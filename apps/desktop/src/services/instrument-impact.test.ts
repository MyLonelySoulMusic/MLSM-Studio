import { describe, expect, it } from "vitest";
import { instrumentImpactPose } from "./instrument-impact";

describe("instrument impact response", () => {
  it("smorza rapidamente la vibrazione delle pelli", () => { const contact = instrumentImpactPose("snare", 0, 1); const later = instrumentImpactPose("snare", .25, 1); expect(contact.headCompression).toBeGreaterThan(.05); expect(Math.abs(later.offsetY)).toBeLessThan(Math.abs(contact.offsetY)); expect(instrumentImpactPose("snare", .7, 1)).toEqual({ offsetY: 0, rotationX: 0, rotationZ: 0, headCompression: 0 }); });
  it("fa oscillare il piatto più a lungo e rispetta l'intensità", () => { const strong = instrumentImpactPose("cymbal", .08, 1); const soft = instrumentImpactPose("cymbal", .08, .4); expect(Math.abs(strong.rotationX)).toBeGreaterThan(Math.abs(soft.rotationX)); expect(Math.abs(instrumentImpactPose("cymbal", .8, 1).rotationZ)).toBeGreaterThan(0); expect(instrumentImpactPose("cymbal", 2, 1).rotationX).toBe(0); });
  it("non anima gli elementi non percussivi", () => { expect(instrumentImpactPose("piano", .1, 1)).toEqual({ offsetY: 0, rotationX: 0, rotationZ: 0, headCompression: 0 }); });
});
