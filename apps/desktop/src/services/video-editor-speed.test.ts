import { describe, expect, it } from "vitest";
import { videoEditorClipSourceDuration, videoEditorClipSourceTimeAtFrame, videoEditorClipSourceTimeAtLocalSeconds, videoEditorClipTimelineDurationForSource, videoEditorClipTimelineTimeForSourceTime, videoEditorSampledSpeedAtFrame, videoEditorSpeedAtFrame, videoEditorSpeedPointWithBezier, videoEditorSpeedPointWithCurve, videoEditorSpeedWithPointCurve, videoEditorSplitSpeed, videoEditorTrimSpeed } from "./video-editor-speed";
import type { VideoEditorClip } from "./video-editor";

describe("Video Editor speed mapping", () => {
  it("mappa una clip inversa dal bordo alto al bordo basso anche con una rampa", () => {
    const timebase = { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false };
    const clip = {
      id: "reverse-ramp", startSeconds: 2, sourceInSeconds: 3, durationSeconds: 1,
      reversed: true,
      speed: { mode: "ramp", constant: 1, preservePitch: false, points: [
        { id: "a", frame: 0, speed: 1, curve: "linear" },
        { id: "b", frame: 60, speed: 2, curve: "linear" }
      ] }
    } as VideoEditorClip;
    const consumed = videoEditorClipSourceDuration(clip, timebase);
    const start = videoEditorClipSourceTimeAtLocalSeconds(clip, 0, timebase);
    const middle = videoEditorClipSourceTimeAtLocalSeconds(clip, .5, timebase);
    const end = videoEditorClipSourceTimeAtLocalSeconds(clip, 1, timebase);

    expect(start).toBeCloseTo(3 + consumed, 12);
    expect(middle).toBeLessThan(start);
    expect(end).toBeCloseTo(3, 12);
    expect(videoEditorClipTimelineTimeForSourceTime(clip, start, timebase)).toBeCloseTo(2, 12);
    expect(videoEditorClipTimelineTimeForSourceTime(clip, end, timebase)).toBeCloseTo(3, 12);
  });

  it("treats an authored curve change as a clean replacement of subdivision metadata", () => {
    const derived = {
      id: "derived", frame: 30, speed: 2, curve: "exponential" as const,
      bezier: { x1: .1, y1: .2, x2: .8, y2: .9 },
      segment: { curve: "exponential" as const, fromProgress: .5, toProgress: 1 },
      inTangent: { x: 25, y: 1.7 }, outTangent: { x: 35, y: 2.2 }
    };
    expect(videoEditorSpeedPointWithCurve(derived, "linear")).toEqual({ id: "derived", frame: 30, speed: 2, curve: "linear" });
    expect(videoEditorSpeedPointWithCurve(derived, "custom", { x1: .2, y1: .1, x2: .7, y2: .95 })).toEqual({
      id: "derived", frame: 30, speed: 2, curve: "custom", bezier: { x1: .2, y1: .1, x2: .7, y2: .95 }
    });
    expect(videoEditorSpeedPointWithBezier({ ...derived, curve: "custom" }, { x1: .25, y1: .15, x2: .75, y2: .85 })).toEqual({
      id: "derived", frame: 30, speed: 2, curve: "custom", bezier: { x1: .25, y1: .15, x2: .75, y2: .85 }
    });

    const splitSpeed = {
      mode: "ramp" as const, constant: 1, preservePitch: false, sampleOriginFrame: 30.8,
      leadingRate: 1.75, trailingRate: 2.75,
      points: [{ id: "left", frame: 0, speed: 1.5, curve: "linear" as const }, derived]
    };
    const authored = videoEditorSpeedWithPointCurve(splitSpeed, "derived", "linear");
    expect(authored.sampleOriginFrame).toBe(30.8);
    expect(authored).not.toHaveProperty("leadingRate");
    expect(authored).not.toHaveProperty("trailingRate");
    expect(authored.points[1]).toEqual({ id: "derived", frame: 30, speed: 2, curve: "linear" });
  });

  it("maps constant speed to source time deterministically", () => {
    const clip = { id: "clip", assetId: "asset", trackId: "track", startSeconds: 0, sourceInSeconds: 0, durationSeconds: 2, fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth" as const, audioFadeInSeconds: 0, audioFadeOutSeconds: 0, blendMode: "normal" as const, blendIntensity: 1, adjustments: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, blur: 0, grayscale: 0, sepia: 0, fade: 0, vignette: 0, opacity: 1 }, fit: "cover" as const, muted: false, volume: 1, speed: { mode: "constant" as const, constant: 2, points: [], preservePitch: true } } as VideoEditorClip;
    expect(videoEditorClipSourceTimeAtFrame(clip, 30, { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false })).toBe(1);
    expect(videoEditorClipTimelineDurationForSource(4, clip.speed, { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false })).toBe(2);
  });

  it("integrates and inverses a ramp instead of multiplying by one sampled speed", () => {
    const speed = { mode: "ramp" as const, constant: 1, preservePitch: false, points: [{ id: "a", frame: 0, speed: 1, curve: "linear" as const }, { id: "b", frame: 60, speed: 2, curve: "linear" as const }] };
    const clip = { id: "clip", assetId: "asset", trackId: "track", startSeconds: 2, sourceInSeconds: 3, durationSeconds: 2, speed } as VideoEditorClip;
    const source = videoEditorClipSourceTimeAtFrame(clip, 180, { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false });
    expect(source).toBeCloseTo(4.5, 1);
    expect(videoEditorClipTimelineTimeForSourceTime(clip, source, { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false })).toBeCloseTo(3, 1);
    const [, right] = videoEditorSplitSpeed(speed, 30);
    expect(right?.points[0]?.frame).toBe(0);
  });

  it("uses the clip-local interval when a legacy move leaves a .010 s frame phase", () => {
    const timebase = { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false };
    const speed = { mode: "ramp" as const, constant: 1, preservePitch: false, points: [{ id: "a", frame: 0, speed: 1, curve: "linear" as const }, { id: "b", frame: 60, speed: 2, curve: "linear" as const }] };
    const clip = { id: "phase", assetId: "asset", trackId: "track", startSeconds: .010, sourceInSeconds: 2, durationSeconds: 1.01, speed } as VideoEditorClip;
    const firstGlobalBoundary = videoEditorClipSourceTimeAtFrame(clip, 1, timebase);
    const firstLocalSpan = 1 / 60 - clip.startSeconds;
    expect(firstGlobalBoundary).toBeCloseTo(clip.sourceInSeconds + videoEditorSpeedAtFrame(speed, .5) * firstLocalSpan, 12);
    // The old global-rounding implementation jumped by one complete source frame.
    expect(firstGlobalBoundary - clip.sourceInSeconds).toBeLessThan(1 / 60);
    expect(videoEditorClipSourceDuration(clip, timebase)).toBeCloseTo(videoEditorClipSourceTimeAtLocalSeconds(clip, 1.01, timebase) - clip.sourceInSeconds, 12);
  });

  it("slices and rebases ramp points on start/end trim without changing the source mapping", () => {
    const speed = { mode: "ramp" as const, constant: 1, preservePitch: false, points: [{ id: "a", frame: 0, speed: 1, curve: "linear" as const }, { id: "b", frame: 60, speed: 2, curve: "linear" as const, inTangent: { x: 50, y: 1.8 } }, { id: "c", frame: 120, speed: 1, curve: "linear" as const }] };
    const rebased = videoEditorTrimSpeed(speed, 30, 60)!;
    expect(rebased.points[0]).toMatchObject({ frame: 0, speed: 1.5 });
    expect(rebased.points.at(-1)?.frame).toBe(60);
    expect(rebased.points.find((point) => point.id === "b")?.segment).toMatchObject({ curve: "linear", fromProgress: .5, toProgress: 1 });
    const original = { id: "old", startSeconds: 0, sourceInSeconds: 0, durationSeconds: 2, speed } as VideoEditorClip;
    const trimmed = { ...original, startSeconds: .5, sourceInSeconds: videoEditorClipSourceTimeAtFrame(original, 30, { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false }), durationSeconds: 1, speed: rebased };
    expect(videoEditorClipSourceTimeAtFrame(trimmed, 60, { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false })).toBeCloseTo(videoEditorClipSourceTimeAtFrame(original, 60, { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false }), 6);
  });

  it("keeps normalized custom speed curves invariant across frame and speed spans", () => {
    const bezier = { x1: .18, y1: .04, x2: .62, y2: .91 };
    const normalized = (startFrame: number, frameSpan: number, startSpeed: number, speedSpan: number) => {
      const speed = { mode: "ramp" as const, constant: 1, preservePitch: false, points: [
        { id: "left", frame: startFrame, speed: startSpeed, curve: "linear" as const },
        { id: "right", frame: startFrame + frameSpan, speed: startSpeed + speedSpan, curve: "custom" as const, bezier }
      ] };
      return (videoEditorSpeedAtFrame(speed, startFrame + frameSpan * .41) - startSpeed) / speedSpan;
    };
    expect(normalized(0, 100, 1, 2)).toBeCloseTo(normalized(500, 2_000, .2, 7), 10);
  });

  it.each([
    ["easeIn", undefined],
    ["easeOut", undefined],
    ["easeInOut", undefined],
    ["exponential", undefined],
    ["logarithmic", undefined],
    ["custom", { x1: .13, y1: .04, x2: .74, y2: .92 }]
  ] as const)("subdivides %s without changing speed or source integrals at a fractional cut", (curve, bezier) => {
    const timebase = { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false };
    const speed = { mode: "ramp" as const, constant: 1, preservePitch: false, points: [
      { id: "a", frame: 0, speed: .75, curve: "linear" as const },
      { id: "b", frame: 80, speed: 3, curve, ...(bezier ? { bezier } : {}) },
      { id: "c", frame: 150, speed: 1.2, curve: "easeOut" as const }
    ] };
    const cutFrame = 37.4;
    const durationFrames = 121.2;
    const [left, right] = videoEditorSplitSpeed(speed, cutFrame);
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    for (const frame of [0, .125, 11.75, cutFrame - .001, cutFrame]) {
      expect(videoEditorSpeedAtFrame(left, frame)).toBeCloseTo(videoEditorSpeedAtFrame(speed, frame), 10);
    }
    for (const frame of [0, .125, 11.75, cutFrame - .001]) {
      expect(videoEditorSampledSpeedAtFrame(left, frame)).toBeCloseTo(videoEditorSampledSpeedAtFrame(speed, frame), 12);
    }
    for (const frame of [0, .125, 7.75, 41.25, durationFrames - cutFrame]) {
      expect(videoEditorSpeedAtFrame(right, frame)).toBeCloseTo(videoEditorSpeedAtFrame(speed, cutFrame + frame), 10);
    }
    for (const frame of [0, .001, .125, .6, 7.75, 41.25, durationFrames - cutFrame]) {
      expect(videoEditorSampledSpeedAtFrame(right, frame)).toBeCloseTo(videoEditorSampledSpeedAtFrame(speed, cutFrame + frame), 12);
    }
    const original = { id: "original", startSeconds: .010, sourceInSeconds: 2, durationSeconds: durationFrames / 60, speed } as VideoEditorClip;
    const cutSeconds = cutFrame / 60;
    const sourceAtCut = videoEditorClipSourceTimeAtLocalSeconds(original, cutSeconds, timebase);
    const leftClip = { ...original, durationSeconds: cutSeconds, speed: left } as VideoEditorClip;
    const rightClip = { ...original, startSeconds: original.startSeconds + cutSeconds, sourceInSeconds: sourceAtCut, durationSeconds: original.durationSeconds - cutSeconds, speed: right } as VideoEditorClip;
    const leftDuration = videoEditorClipSourceDuration(leftClip, timebase);
    const rightDuration = videoEditorClipSourceDuration(rightClip, timebase);
    const originalDuration = videoEditorClipSourceDuration(original, timebase);
    expect(leftDuration + rightDuration).toBeCloseTo(originalDuration, 12);
    for (const localSeconds of [0, .003, .2, rightClip.durationSeconds]) {
      expect(videoEditorClipSourceTimeAtLocalSeconds(rightClip, localSeconds, timebase)).toBeCloseTo(videoEditorClipSourceTimeAtLocalSeconds(original, cutSeconds + localSeconds, timebase), 12);
    }

    const trimmed = videoEditorTrimSpeed(speed, cutFrame, durationFrames - cutFrame)!;
    for (const frame of [0, .125, 9.5, durationFrames - cutFrame]) {
      expect(videoEditorSpeedAtFrame(trimmed, frame)).toBeCloseTo(videoEditorSpeedAtFrame(speed, cutFrame + frame), 10);
    }
    const trimmedClip = { ...rightClip, speed: trimmed } as VideoEditorClip;
    expect(videoEditorClipSourceDuration(trimmedClip, timebase)).toBeCloseTo(videoEditorClipSourceDuration(rightClip, timebase), 12);

    const integerCut = 37;
    const [integerLeft, integerRight] = videoEditorSplitSpeed(speed, integerCut);
    for (const frame of [0, .25, 9.5, durationFrames - integerCut]) {
      expect(videoEditorSpeedAtFrame(integerRight, frame)).toBeCloseTo(videoEditorSpeedAtFrame(speed, integerCut + frame), 10);
      expect(videoEditorSampledSpeedAtFrame(integerRight, frame)).toBeCloseTo(videoEditorSampledSpeedAtFrame(speed, integerCut + frame), 12);
    }
    const integerCutSeconds = integerCut / 60;
    const integerLeftClip = { ...original, durationSeconds: integerCutSeconds, speed: integerLeft } as VideoEditorClip;
    const integerRightClip = {
      ...original,
      startSeconds: original.startSeconds + integerCutSeconds,
      sourceInSeconds: videoEditorClipSourceTimeAtLocalSeconds(original, integerCutSeconds, timebase),
      durationSeconds: original.durationSeconds - integerCutSeconds,
      speed: integerRight
    } as VideoEditorClip;
    expect(videoEditorClipSourceDuration(integerLeftClip, timebase) + videoEditorClipSourceDuration(integerRightClip, timebase)).toBeCloseTo(videoEditorClipSourceDuration(original, timebase), 12);
  });
});
