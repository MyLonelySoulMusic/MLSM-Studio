import { describe, expect, it } from "vitest";
import { resolveVideoEditorAutomationValue, upsertVideoEditorKeyframe } from "./video-editor-automation";

const target = { kind: "clip" as const, clipId: "clip", property: "adjustments.exposure" };
describe("Video Editor automation", () => {
  it("interpolates linearly and supports easing", () => {
    let lanes = upsertVideoEditorKeyframe([], target, { id: "a", frame: 0, value: 0, curve: "linear" });
    lanes = upsertVideoEditorKeyframe(lanes, target, { id: "b", frame: 60, value: 2, curve: "easeInOut" });
    expect(resolveVideoEditorAutomationValue(lanes, target, 30, 9)).toBeCloseTo(1, 6);
    expect(resolveVideoEditorAutomationValue(lanes, target, 100, 9)).toBe(2);
  });

  it("implements distinct exponential/logarithmic curves and custom tangent handles", () => {
    const evaluate = (curve: "exponential" | "logarithmic" | "custom") => {
      let lanes = upsertVideoEditorKeyframe([], target, { id: "a", frame: 0, value: 0, curve: "linear", outTangent: { x: 25, y: 0 } });
      lanes = upsertVideoEditorKeyframe(lanes, target, { id: "b", frame: 60, value: 1, curve, inTangent: { x: 45, y: .1 } });
      return resolveVideoEditorAutomationValue(lanes, target, 30, 9);
    };
    expect(evaluate("exponential")).toBeLessThan(.5);
    expect(evaluate("logarithmic")).toBeGreaterThan(.5);
    expect(evaluate("custom")).toBeLessThan(.5);
  });

  it("keeps a normalized custom segment invariant across frame and value spans", () => {
    const bezier = { x1: .12, y1: .72, x2: .81, y2: .24 };
    const evaluate = (startFrame: number, frameSpan: number, startValue: number, valueSpan: number) => {
      let lanes = upsertVideoEditorKeyframe([], target, { id: "left", frame: startFrame, value: startValue, curve: "linear" });
      lanes = upsertVideoEditorKeyframe(lanes, target, { id: "right", frame: startFrame + frameSpan, value: startValue + valueSpan, curve: "custom", bezier });
      return (resolveVideoEditorAutomationValue(lanes, target, startFrame + frameSpan * .37, 0) - startValue) / valueSpan;
    };
    expect(evaluate(0, 100, 0, 1)).toBeCloseTo(evaluate(400, 1_000, -80, 240), 10);
  });
});
