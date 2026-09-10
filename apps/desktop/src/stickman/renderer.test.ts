import { describe, expect, it } from "vitest";
import { bivioLegPose, bivioLoopClock, bivioRouteHeading, bivioWalkers, wrapBivioText } from "./renderer";
import { defaultBivioColors, defaultBivioSettings, normalizeBivioSettings } from "./settings";

describe("Bivio cyclic motion", () => {
  it("keeps legs aligned from behind through the entire walking cycle", () => {
    for (let step = 0; step < 60; step += 1) {
      for (const side of [-1, 1] as const) {
        const leg = bivioLegPose(step / 60 * Math.PI * 2, 0, side);
        expect(leg.hip.x).toBe(leg.knee.x);
        expect(leg.knee.x).toBe(leg.ankle.x);
        expect(leg.hip.y).toBeLessThan(leg.knee.y);
        expect(leg.knee.y).toBeLessThan(leg.ankle.y);
      }
    }
  });

  it("reveals knee flexion on curves in the correct direction, without a sudden switch", () => {
    const leftHeading = bivioRouteHeading(.8, false);
    const rightHeading = bivioRouteHeading(.8, true);
    expect(leftHeading).toBeLessThan(-.7);
    expect(rightHeading).toBeGreaterThan(.7);
    expect(Math.abs(bivioRouteHeading(.3, false))).toBeLessThan(.1);
    const bent = bivioLegPose(Math.PI / 2, rightHeading, -1);
    const crossProduct = (bent.knee.x - bent.hip.x) * (bent.ankle.y - bent.hip.y) - (bent.knee.y - bent.hip.y) * (bent.ankle.x - bent.hip.x);
    expect(Math.abs(crossProduct)).toBeGreaterThan(100);
    for (const right of [false, true]) {
      for (let i = 1; i < 1000; i += 1) expect(Math.abs(bivioRouteHeading(i / 1000, right) - bivioRouteHeading((i - 1) / 1000, right))).toBeLessThan(.02);
    }
  });

  it("migrates saved settings without colors and safely merges a partial palette", () => {
    const legacy = normalizeBivioSettings({ leftText: "MESSAGGIO PERSONALE" });
    expect(legacy.leftText).toBe("MESSAGGIO PERSONALE");
    expect(legacy.colors).toEqual(defaultBivioColors);
    const custom = normalizeBivioSettings({ colors: { crowd: "#3366FF", solo: "invalid", paper: "#121314" } });
    expect(custom.colors).toEqual({ ...defaultBivioColors, crowd: "#3366ff", paper: "#121314" });
    expect(normalizeBivioSettings({ colors: null }).colors).toEqual(defaultBivioColors);
  });

  it.each([.51, 8.04, 183.47, 241.913])("closes position and gait exactly after a %ss song", (duration) => {
    for (const pace of [.5, 1, 1.5]) {
      const settings = { ...defaultBivioSettings, pace };
      expect(bivioWalkers(duration, duration, settings)).toEqual(bivioWalkers(0, duration, settings));
      const before = bivioWalkers(duration - .000001, duration, settings);
      const after = bivioWalkers(.000001, duration, settings);
      for (const a of before) {
        const b = after.find((value) => value.id === a.id)!;
        if (a.progress > .999 && b.progress < .001) continue; // Both ends offscreen.
        expect(Math.abs(a.x - b.x)).toBeLessThan(.01);
        expect(Math.abs(a.y - b.y)).toBeLessThan(.02);
        expect(Math.abs(Math.sin(a.gait) - Math.sin(b.gait))).toBeLessThan(.001);
      }
    }
  });

  it("walks forward, with one right-branch figure, wrapping only beyond the frame", () => {
    const settings = defaultBivioSettings;
    for (let frame = 0; frame < 800; frame += 1) {
      const first = bivioWalkers(frame / 30, 183.47, settings);
      const second = bivioWalkers((frame + 1) / 30, 183.47, settings);
      expect(first.filter((walker) => walker.side === "right")).toHaveLength(1);
      expect(first.filter((walker) => walker.side === "left")).toHaveLength(36);
      for (const a of first) {
        const b = second.find((walker) => walker.id === a.id)!;
        if (b.progress > a.progress) expect(b.y).toBeLessThan(a.y);
        else {
          expect(a.x < -25 || a.x > 745).toBe(true);
          expect(b.y - b.scale * 115).toBeGreaterThan(1280);
        }
      }
    }
  });

  it("is deterministic across seek order and keeps integer loop counts", () => {
    const first = bivioWalkers(43.65, 183.47, defaultBivioSettings);
    bivioWalkers(92, 183.47, defaultBivioSettings);
    expect(bivioWalkers(43.65, 183.47, defaultBivioSettings)).toEqual(first);
    const clock = bivioLoopClock(4, 183.47, 1.3);
    expect(Number.isInteger(clock.laps)).toBe(true);
    expect(Number.isInteger(clock.strides)).toBe(true);
    expect(bivioLoopClock(Infinity, 0)).toMatchObject({ route: 0, gait: 0, duration: 24 });
  });

  it("preserves line breaks and bounds malformed saved preferences", () => {
    expect(wrapBivioText("hello world\nmy soul", 9, (value) => value.length)).toEqual(["HELLO", "WORLD", "MY SOUL"]);
    expect(normalizeBivioSettings({ crowdCount: 999, pace: NaN, grain: -9, leftText: "<script>user text</script>" })).toMatchObject({ crowdCount: 60, pace: 1, grain: 0, leftText: "<script>user text</script>" });
  });
});
