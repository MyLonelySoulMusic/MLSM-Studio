import { describe, expect, it, vi } from "vitest";
import { createMlsmPostLipsyncAnalysis, evaluateMlsmPostLipsyncHardGate, mlsmPostLipsyncAnchorReport, replaceMlsmPostLipsyncAnchors } from "./mlsm-post-lipsync-analysis";
import { MlsmPostLipsyncCache, mlsmPostLipsyncCacheKey, parseMlsmPostLipsyncAnalysis, serializeMlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-cache";
import { createManualLipsyncAnchor, editLipsyncAnchor, buildLipsyncTimeMap, lipsyncPhoneticPointCount, lipsyncSourceToTarget, lipsyncTargetToSource, shiftLipsyncAnchors } from "./mlsm-post-lipsync-time-map";
import { auditLipsyncRenderPlan, buildLipsyncRenderPlan } from "./mlsm-post-lipsync-render-plan";
import { applyMlsmPostLipsyncRefinements, refineMlsmPostLipsyncAlignment, type RefinedAnchorResult } from "./mlsm-post-lipsync-refinement";
import { predictMlsmWaveformSourceSeconds } from "./mlsm-post-lipsync-waveform";
import type { MlsmWaveformAlignment, WordAnchor } from "./mlsm-post-lipsync-types";
import { fuseDetailedTimestampWords, timestampedWords, type TimestampedWord, type WhisperTranscriptDocument } from "./subtitle-generation";

const lyricWords = ["I", "love", "you", "forever"];
const subtitles = `1
00:00:00,000 --> 00:00:04,000
I love you forever
`;

const excerptSubtitles = `1
00:00:00,000 --> 00:00:01,000
I

2
00:00:01,500 --> 00:00:02,500
love

3
00:00:03,000 --> 00:00:04,000
you

4
00:00:06,000 --> 00:00:07,000
forever
`;

const fallenSubtitles = `1
00:00:00,000 --> 00:00:02,720
The fallen

2
00:00:04,340 --> 00:00:07,360
Still loves me
`;

function transcript(times: readonly (readonly [number, number])[], words = lyricWords, durationSeconds = 4): WhisperTranscriptDocument {
  const timed: TimestampedWord[] = words.map((text, index) => ({
    text,
    start: times[index]?.[0] ?? index,
    end: times[index]?.[1] ?? index + .3,
    confidence: .96,
    confidenceSource: "model"
  }));
  return {
    schemaVersion: 1,
    engine: "Whisper",
    model: "whisper-base_timestamped",
    durationSeconds,
    transcript: words.join(" "),
    words: timed,
    phrases: [{ start: timed[0]?.start ?? 0, end: timed.at(-1)?.end ?? durationSeconds, text: words.join(" "), confidence: .96 }]
  };
}

const targetTimes = [[.5, .72], [.82, 1.16], [1.52, 1.84], [1.92, 2.5]] as const;

/** Overlay result strong enough to be trusted: the video runs 2% slower than
 * the master and starts 300 ms into it. */
const trustedWaveform: MlsmWaveformAlignment = {
  method: "onset-rms-xcorr-v1", status: "measured", detail: null, trusted: true,
  offsetSeconds: .3, scale: 1.02, confidence: .84, clarity: .38, residualMs: 21, spreadMs: 140, localAgreement: .9, windows: 11, overlapSeconds: 7.2, searchRadiusMs: 360
};

interface RefineRequestBody { maxShiftMs: number; anchors: Array<{ id: string; sourceStart: number; sourceCenter: number; sourceEnd: number }> }

describe("MLSM POST LIPSYNC · HARD GATE core", () => {
  it("keeps identical source and target on an identity map", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    expect(analysis.alignmentSource).toBe("subtitles");
    expect(analysis.report.matchedWords).toBe(4);
    expect(analysis.report.monotonic).toBe(true);
    expect(analysis.timeMap.segments.every((segment) => Math.abs(segment.speedRatio - 1) < 1e-9)).toBe(true);
    expect(lipsyncTargetToSource(analysis.timeMap, 2.125)).toBeCloseTo(2.125, 10);
  });

  it("recovers a source performance that is ten percent slower without cumulative drift", () => {
    const sourceTimes = targetTimes.map(([start, end]) => [start * 1.1, end * 1.1] as [number, number]);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: transcript(sourceTimes, lyricWords, 4.4), targetTranscript: transcript(targetTimes), sourceDurationSeconds: 4.4, targetDurationSeconds: 4 });
    expect(analysis.timeMap.segments.some((segment) => segment.speedRatio > 1.05)).toBe(true);
    for (const fraction of [0, .25, .5, .75, 1]) {
      const target = analysis.targetDurationSeconds * fraction;
      expect(lipsyncSourceToTarget(analysis.timeMap, lipsyncTargetToSource(analysis.timeMap, target))).toBeCloseTo(target, 10);
    }
  });

  it("confines a strong retime to the phrase whose word timing changed", () => {
    const sourceTimes = [[.5, .72], [.82, 1.16], [1.52, 2.18], [2.26, 2.84]] as const;
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: transcript(sourceTimes, lyricWords, 4), targetTranscript: transcript(targetTimes), sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const changed = analysis.timeMap.segments.filter((segment) => Math.abs(segment.speedRatio - 1) > .08);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(analysis.timeMap.segments.length);
  });

  it("recalculates only segments adjacent to a manually moved word anchor", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const anchor = analysis.anchors[1]!;
    const edited = editLipsyncAnchor(analysis.anchors, anchor.id, {
      targetStart: anchor.targetStart + .04,
      targetCenter: anchor.targetCenter + .04,
      targetEnd: anchor.targetEnd + .04
    });
    const next = buildLipsyncTimeMap({ anchors: edited, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const previousById = new Map(analysis.timeMap.segments.map((segment) => [segment.id, segment]));
    const changed = next.segments.filter((segment) => !previousById.has(segment.id) || Math.abs(segment.speedRatio - previousById.get(segment.id)!.speedRatio) > 1e-9);
    expect(changed.map((segment) => segment.id)).toEqual(expect.arrayContaining([
      expect.stringContaining(analysis.anchors[0]!.id),
      expect.stringContaining(analysis.anchors[1]!.id)
    ]));
    expect(changed).toHaveLength(3);
  });

  it("persists manual overrides without leaving an anchor locked", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const anchor = analysis.anchors[2]!;
    analysis.anchors = editLipsyncAnchor(analysis.anchors, anchor.id, { locked: true });
    analysis.timeMap = buildLipsyncTimeMap({ anchors: analysis.anchors, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const reopened = parseMlsmPostLipsyncAnalysis(serializeMlsmPostLipsyncAnalysis(analysis));
    expect(reopened.anchors[2]).toMatchObject({ locked: false, manuallyEdited: true, origin: "manual" });
    expect(reopened.timeMap).toEqual(analysis.timeMap);
  });

  it("reuses a versioned analysis cache only for the same immutable inputs", async () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const key = await mlsmPostLipsyncCacheKey({ sourceVideoHash: "source-hash", targetAudioHash: "target-hash", subtitleHash: "subtitle-hash", whisperModel: "whisper-base_timestamped" });
    const changedKey = await mlsmPostLipsyncCacheKey({ sourceVideoHash: "source-hash", targetAudioHash: "target-hash", subtitleHash: "changed-subtitle-hash", whisperModel: "whisper-base_timestamped" });
    const cache = new MlsmPostLipsyncCache();
    await cache.set(key, analysis);
    expect(await cache.get(key)).toEqual(analysis);
    expect(await cache.get(changedKey)).toBeNull();
    await cache.clear();
    expect(await cache.get(key)).toBeNull();
  });

  it("rejects corrupted or duplicated Auto-AVSR evidence from a saved analysis", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const serialized = JSON.parse(serializeMlsmPostLipsyncAnalysis(analysis)) as Record<string, unknown>;
    const visualSpeech = serialized.visualSpeech as Record<string, unknown>;
    visualSpeech.enabled = true;
    visualSpeech.provider = "Auto-AVSR";
    visualSpeech.faceCoverage = 1;
    visualSpeech.words = [{ id: "w", text: "love", canonicalIndex: 0, startSeconds: .2, centerSeconds: .3, endSeconds: .4, confidence: .8, semanticSimilarity: .9 }];
    visualSpeech.visemes = [{ canonicalIndex: 0, label: "love", visemeClass: "labiodental", startSeconds: .2, centerSeconds: .3, endSeconds: .4, confidence: .8 }];
    expect(parseMlsmPostLipsyncAnalysis(JSON.stringify(serialized)).visualSpeech.words).toHaveLength(1);
    visualSpeech.words = [...visualSpeech.words as unknown[], { ...(visualSpeech.words as Record<string, unknown>[])[0] }];
    expect(() => parseMlsmPostLipsyncAnalysis(JSON.stringify(serialized))).toThrow(/non è valido/);
    visualSpeech.words = [{ id: "w", text: "love", canonicalIndex: 0, startSeconds: .4, centerSeconds: .3, endSeconds: .2, confidence: 2, semanticSimilarity: .9 }];
    expect(() => parseMlsmPostLipsyncAnalysis(JSON.stringify(serialized))).toThrow(/non è valido/);
  });

  it("persists both complete Whisper word lists and rejects corrupt manual timing", () => {
    const source = transcript(targetTimes);
    const target = transcript([...targetTimes, [4.2, 4.6]], [...lyricWords, "again"], 5);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: source, targetTranscript: target, sourceDurationSeconds: 4, targetDurationSeconds: 5, whisperTranscripts: { source, target } });
    const serialized = JSON.parse(serializeMlsmPostLipsyncAnalysis(analysis)) as Record<string, unknown>;
    const whisperTranscripts = serialized.whisperTranscripts as Record<string, unknown>;
    expect((whisperTranscripts.target as { words: unknown[] }).words).toHaveLength(target.words.length);
    const reopened = parseMlsmPostLipsyncAnalysis(JSON.stringify(serialized));
    expect(reopened.whisperTranscripts.target.words.at(-1)?.text).toBe("again");
    (whisperTranscripts.target as { words: Array<Record<string, unknown>> }).words[1]!.start = -1;
    expect(() => parseMlsmPostLipsyncAnalysis(JSON.stringify(serialized))).toThrow(/non è valido/u);
  });

  it("rejects degenerate Whisper timestamps and keeps words as low-confidence DTW seeds", () => {
    const words = timestampedWords({ text: "Fallen Still loves me", chunks: [
      { text: "Fallen", timestamp: [29.98, 29.98] },
      { text: "Still", timestamp: [29.98, 29.98] },
      { text: "loves", timestamp: [29.98, 29.98] },
      { text: "me", timestamp: [29.98, 29.98] }
    ] }, 15);
    expect(words).toHaveLength(4);
    expect(words.every((word) => word.start >= 0 && word.end <= 15 && word.end > word.start)).toBe(true);
    expect(words.every((word) => word.confidenceSource === "estimated")).toBe(true);
  });

  it("keeps the original The Fallen prototype path when source Whisper timing is degenerate", () => {
    const sourceWords = timestampedWords({ text: "Fallen Still loves me", chunks: [
      { text: "Fallen", timestamp: [29.98, 29.98] },
      { text: "Still", timestamp: [29.98, 29.98] },
      { text: "loves", timestamp: [29.98, 29.98] },
      { text: "me", timestamp: [29.98, 29.98] }
    ] }, 15);
    const source: WhisperTranscriptDocument = { schemaVersion: 1, engine: "Whisper", model: "whisper-base_timestamped", durationSeconds: 15, transcript: "Fallen Still loves me", words: sourceWords, phrases: [] };
    const target = transcript([[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], ["The", "fallen", "Still", "loves", "me"], 60);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles: fallenSubtitles, sourceTranscript: source, targetTranscript: target, sourceDurationSeconds: 15, targetDurationSeconds: 60 });
    expect(analysis.targetDurationSeconds).toBeCloseTo(7.36, 9);
    expect(analysis.unresolved).toContainEqual(expect.objectContaining({ text: "The", reason: "source-missing" }));
    expect(analysis.anchors).toHaveLength(4);
    expect(analysis.anchors.every((anchor) => anchor.origin === "subtitle")).toBe(true);
    expect(analysis.anchors[0]).toMatchObject({ targetStart: .7, targetEnd: 2.72 });
    expect(analysis.anchors.find((anchor) => anchor.text === "Still")).toMatchObject({ targetStart: 4.34 });
    expect(analysis.anchors.at(-1)!.targetStart).toBeCloseTo(6.8566666667, 9);
    expect(analysis.anchors.at(-1)!.targetEnd).toBeCloseTo(7.36, 9);
    expect(analysis.timeMap.points.at(-1)!.targetTime).toBeCloseTo(7.36, 9);
  });

  it("retains every measured phrase boundary from the successful The Fallen hard gate", () => {
    const anchor = (input: Partial<WordAnchor> & Pick<WordAnchor, "id" | "canonicalIndex" | "cueIndex" | "sourceStart" | "sourceCenter" | "sourceEnd" | "targetStart" | "targetCenter" | "targetEnd">): WordAnchor => ({
      text: input.id,
      sourceConfidence: .8,
      targetConfidence: .8,
      matchConfidence: .8,
      confidenceBand: "medium",
      origin: "subtitle",
      locked: false,
      manuallyEdited: false,
      evidence: { textSimilarity: 1, sourceConfidence: .8, targetConfidence: .8, subtitlePrior: 1, sequenceMargin: .8 },
      sourceTranscriptText: input.id,
      targetTranscriptText: input.id,
      ...input
    });
    const anchors: WordAnchor[] = [
      anchor({ id: "the-fallen", canonicalIndex: 0, cueIndex: 0, sourceStart: .02, sourceCenter: 1.63, sourceEnd: 3.24, targetStart: .978, targetCenter: 1.849, targetEnd: 2.72 }),
      anchor({ id: "still", canonicalIndex: 1, cueIndex: 1, sourceStart: 4.488, sourceCenter: 4.7, sourceEnd: 4.9, targetStart: 4.34, targetCenter: 4.62, targetEnd: 4.9 }),
      anchor({ id: "loves", canonicalIndex: 2, cueIndex: 1, sourceStart: 6.518, sourceCenter: 6.7, sourceEnd: 6.9, targetStart: 5.5983, targetCenter: 5.8, targetEnd: 6 }),
      anchor({ id: "me", canonicalIndex: 3, cueIndex: 1, sourceStart: 7.808, sourceCenter: 10.108, sourceEnd: 12.408, targetStart: 6.8567, targetCenter: 7.10835, targetEnd: 7.36 })
    ];
    const map = buildLipsyncTimeMap({ anchors, sourceDurationSeconds: 15.0417, targetDurationSeconds: 7.36 });
    for (const [target, source] of [[.978, .02], [2.72, 3.24], [4.34, 4.488], [5.5983, 6.518], [6.8567, 7.808], [7.36, 12.408]] as const) {
      expect(lipsyncTargetToSource(map, target)).toBeCloseTo(source, 4);
    }
    expect(map.points[0]).toMatchObject({ targetTime: 0, sourceTime: 0 });
    expect(map.points.at(-1)).toMatchObject({ targetTime: 7.36, sourceTime: 12.408 });
    const openingPlan = buildLipsyncRenderPlan({ timeMap: map, sourceFps: 30, outputFps: 60, targetEnd: .978 });
    expect(openingPlan.samples.at(-1)!.sourceTime).toBeLessThanOrEqual(.02);
    expect(openingPlan.samples.every((sample) => sample.sourceFrameLeft === 0)).toBe(true);
  });

  it("ritarda The Fallen sul vero attacco vocale del master senza alterare la seconda frase", () => {
    const anchor = (id: string, canonicalIndex: number, cueIndex: number, targetStart: number, targetCenter: number, targetEnd: number): WordAnchor => ({
      id,
      text: id,
      canonicalIndex,
      cueIndex,
      sourceStart: canonicalIndex * 2,
      sourceCenter: canonicalIndex * 2 + .5,
      sourceEnd: canonicalIndex * 2 + 1,
      targetStart,
      targetCenter,
      targetEnd,
      sourceConfidence: .8,
      targetConfidence: .8,
      matchConfidence: .8,
      confidenceBand: "medium",
      origin: "subtitle",
      locked: false,
      manuallyEdited: false,
      evidence: { textSimilarity: 1, sourceConfidence: .8, targetConfidence: .8, subtitlePrior: 1, sequenceMargin: .8 },
      sourceTranscriptText: id,
      targetTranscriptText: id
    });
    const anchors = [
      anchor("the-fallen", 0, 0, .978, 1.849, 2.72),
      anchor("still", 1, 1, 4.34, 4.62, 4.9)
    ];
    const refinements = new Map<string, RefinedAnchorResult>([["the-fallen", {
      id: "the-fallen",
      sourceCenter: anchors[0]!.sourceCenter,
      targetStart: 31.33,
      targetShiftMs: 352,
      targetConfidence: .9,
      shiftMs: 0,
      confidence: 0,
      method: "mfcc-dtw-unresolved"
    }]]);
    const edited = applyMlsmPostLipsyncRefinements(anchors, refinements, 30);
    expect(edited[0]!.targetStart).toBeCloseTo(1.33, 10);
    expect(edited[0]!.sourceStart).toBe(anchors[0]!.sourceStart);
    expect(edited[1]).toEqual(anchors[1]);
  });

  it("in modalità approfondita corregge l'attacco anche all'indietro", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4, detailMode: "phoneme" });
    const first = analysis.anchors[0]!;
    const refinements = new Map<string, RefinedAnchorResult>([[first.id, {
      id: first.id,
      sourceCenter: first.sourceCenter,
      targetStart: analysis.targetAudioStartSeconds + first.targetStart - .08,
      targetShiftMs: -80,
      targetConfidence: .92,
      shiftMs: 0,
      confidence: 0,
      method: "mfcc-dtw-unresolved"
    }]]);
    const edited = applyMlsmPostLipsyncRefinements(analysis.anchors, refinements, analysis.targetAudioStartSeconds, { allowBidirectionalTargetOnset: true });
    expect(edited[0]!.targetStart).toBeCloseTo(first.targetStart - .08, 9);
  });

  it("rifiuta una rifinitura DTW che invertirebbe due parole consecutive", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const asked = analysis.anchors[1]!; const me = analysis.anchors[2]!;
    const refinements = new Map<string, RefinedAnchorResult>([
      [asked.id, { id: asked.id, sourceCenter: 1.369, shiftMs: 500, confidence: .9, method: "phrase-dtw-v2" }],
      [me.id, { id: me.id, sourceCenter: 1.251, shiftMs: -700, confidence: .9, method: "phrase-dtw-v2" }]
    ]);
    const edited = applyMlsmPostLipsyncRefinements(analysis.anchors, refinements);
    expect(edited[1]!.sourceCenter).toBeLessThan(edited[2]!.sourceCenter);
    expect(edited[2]!.sourceCenter).toBe(me.sourceCenter);
  });

  it("costruisce una time-map lettera/fonema più densa ma sempre monotona", () => {
    const document = transcript(targetTimes);
    const standard = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const detailed = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4, detailMode: "phoneme" });
    expect(detailed.detailMode).toBe("phoneme");
    expect(lipsyncPhoneticPointCount(detailed.anchors)).toBeGreaterThan(detailed.anchors.length * 2);
    expect(detailed.timeMap.points.length).toBeGreaterThan(standard.timeMap.points.length);
    expect(detailed.timeMap.points.some((point) => point.id.includes(":phoneme:"))).toBe(true);
    expect(detailed.report.monotonic).toBe(true);
  });

  it("fonde il secondo passaggio Whisper conservando ordine e attacchi più precisi", () => {
    const primary: TimestampedWord[] = [
      { text: "The", start: .4, end: .8, confidence: .8, confidenceSource: "model" },
      { text: "fallen", start: .82, end: 1.6, confidence: .8, confidenceSource: "model" }
    ];
    const detail: TimestampedWord[] = [
      { text: "The", start: .31, end: .69, confidence: .94, confidenceSource: "model" },
      { text: "fallen", start: .7, end: 1.54, confidence: .93, confidenceSource: "model" }
    ];
    expect(fuseDetailedTimestampWords(primary, detail)).toEqual([
      expect.objectContaining({ text: "The", start: .31, end: .69, confidence: .94 }),
      expect.objectContaining({ text: "fallen", start: .7, end: 1.54, confidence: .93 })
    ]);
  });

  it("sposta più parole come un solo blocco senza deformarne la distanza", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const before = analysis.anchors.map((anchor) => anchor.sourceCenter);
    const shifted = shiftLipsyncAnchors(analysis.anchors, [1, 2], .01, analysis.sourceDurationSeconds);
    expect(shifted[0]!.sourceCenter).toBe(before[0]);
    expect(shifted[1]!.sourceCenter).toBeCloseTo(before[1]! + .01, 10);
    expect(shifted[2]!.sourceCenter).toBeCloseTo(before[2]! + .01, 10);
    expect(shifted[2]!.sourceCenter - shifted[1]!.sourceCenter).toBeCloseTo(before[2]! - before[1]!, 10);
    expect(shifted[1]).toMatchObject({ manuallyEdited: true, origin: "manual", locked: false });
  });

  it("usa anche il bordo finale di una parola modificata nella time-map", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const anchor = analysis.anchors[1]!;
    const edited = editLipsyncAnchor(analysis.anchors, anchor.id, { targetStart: anchor.targetStart, targetCenter: anchor.targetCenter + .05, targetEnd: anchor.targetEnd + .1 });
    const map = buildLipsyncTimeMap({ anchors: edited, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    expect(map.points).toContainEqual(expect.objectContaining({ id: `${anchor.id}:end`, targetTime: anchor.targetEnd + .1 }));
  });

  it("selects the central repeated performance and excludes duplicate edge phrases", () => {
    const repeatedWords = [...lyricWords, ...lyricWords, ...lyricWords];
    const repeatedTimes = [
      [.2, .4], [.5, .7], [.8, 1], [1.1, 1.3],
      [5, 5.2], [5.7, 5.9], [6.4, 6.6], [7.1, 7.3],
      [11, 11.2], [11.7, 11.9], [12.4, 12.6], [13.1, 13.3]
    ] as const;
    const source = transcript(repeatedTimes, repeatedWords, 14);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: source, targetTranscript: transcript(targetTimes), sourceDurationSeconds: 14, targetDurationSeconds: 4 });
    analysis.anchors.map((anchor) => anchor.sourceCenter).forEach((center, index) => expect(center).toBeCloseTo([5.1, 5.8, 6.5, 7.2][index]!, 9));
    expect(analysis.timeMap.points[0]!.sourceTime).toBeGreaterThan(3);
    expect(analysis.timeMap.points.at(-1)!.sourceTime).toBeLessThan(10);
    expect(lipsyncTargetToSource(analysis.timeMap, 2)).toBeGreaterThan(5);
  });

  it("finds the pasted words inside a full master and exports only the subtitle window", () => {
    const source = transcript([[0, 1], [1.5, 2.5], [3, 4], [6, 7]], lyricWords, 7);
    const target = transcript(
      [[4, 4.4], [30, 31], [31.5, 32.5], [33, 34], [36, 37], [48, 48.4]],
      ["unrelated", ...lyricWords, "ending"],
      60
    );
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles: excerptSubtitles, sourceTranscript: source, targetTranscript: target, sourceDurationSeconds: 7, targetDurationSeconds: 60 });
    expect(analysis.targetMasterDurationSeconds).toBe(60);
    expect(analysis.targetAudioStartSeconds).toBeCloseTo(30, 6);
    expect(analysis.targetAudioEndSeconds).toBeCloseTo(37, 6);
    expect(analysis.targetDurationSeconds).toBe(7);
    expect(analysis.report.matchedWords).toBe(4);
    expect(lipsyncTargetToSource(analysis.timeMap, 7)).toBeCloseTo(7, 9);
    const plan = buildLipsyncRenderPlan({ timeMap: analysis.timeMap, sourceFps: 30, outputFps: 30, targetAudioStartSeconds: analysis.targetAudioStartSeconds });
    expect(plan.outputDurationSeconds).toBe(7);
    expect(plan.targetAudioStartSeconds).toBeCloseTo(30, 6);
    expect(plan.targetAudioEndSeconds).toBeCloseTo(37, 6);
    expect(plan.samples).toHaveLength(210);
  });

  it("keeps trim analysis local while preview and export retain absolute master time", () => {
    const source = transcript([[0, 1], [1.5, 2.5], [3, 4], [6, 7]], lyricWords, 7);
    const targetExcerpt = transcript([[2, 3], [3.5, 4.5], [5, 6], [8, 9]], lyricWords, 10);
    const analysis = createMlsmPostLipsyncAnalysis({
      subtitles: excerptSubtitles,
      sourceTranscript: source,
      targetTranscript: targetExcerpt,
      sourceDurationSeconds: 7,
      targetDurationSeconds: 10,
      targetMasterDurationSeconds: 120,
      targetAnalysisStartSeconds: 30
    });
    expect(analysis.targetAnalysisStartSeconds).toBe(30);
    expect(analysis.targetAnalysisEndSeconds).toBe(40);
    expect(analysis.targetAudioStartSeconds).toBeCloseTo(32, 6);
    expect(analysis.targetAudioEndSeconds).toBeCloseTo(39, 6);
    expect(analysis.targetTranscript.words[0]!.start).toBeCloseTo(0, 6);
    expect(analysis.timeMap.points[0]!.targetTime).toBe(0);
  });

  it("sends local excerpt coordinates to DTW instead of absolute master seconds", async () => {
    const source = transcript([[0, 1], [1.5, 2.5], [3, 4], [6, 7]], lyricWords, 7);
    const targetExcerpt = transcript([[2, 3], [3.5, 4.5], [5, 6], [8, 9]], lyricWords, 10);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles: excerptSubtitles, sourceTranscript: source, targetTranscript: targetExcerpt, sourceDurationSeconds: 7, targetDurationSeconds: 10, targetMasterDurationSeconds: 120, targetAnalysisStartSeconds: 30 });
    let requestBody: { anchors: Array<{ targetStart: number }> } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as { anchors: Array<{ targetStart: number }> };
      return new Response(JSON.stringify({ kind: "refineAlignment", anchors: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    try { await refineMlsmPostLipsyncAlignment({ analysis, sourceVocalPath: "/source.wav", targetVocalPath: "/trimmed-target.wav" }); }
    finally { vi.unstubAllGlobals(); }
    const expectedLocalOffset = analysis.targetAudioStartSeconds - analysis.targetAnalysisStartSeconds;
    expect(requestBody!.anchors[0]!.targetStart).toBeCloseTo(expectedLocalOffset + analysis.anchors[0]!.targetStart, 9);
    expect(requestBody!.anchors[0]!.targetStart).toBeLessThan(analysis.targetAnalysisStartSeconds);
  });

  it("uses only Whisper timings when subtitles are omitted", () => {
    const words = ["The", "fallen", "Still", "loves", "me"];
    const source = transcript([[.8, 1], [1.05, 1.8], [3, 3.4], [3.5, 4], [4.1, 4.7]], words, 8);
    const target = transcript(
      [[4, 4.4], [30.8, 31], [31.05, 31.8], [33, 33.4], [33.5, 34], [34.1, 34.7], [48, 48.4]],
      ["unrelated", ...words, "ending"],
      60
    );
    const analysis = createMlsmPostLipsyncAnalysis({ sourceTranscript: source, targetTranscript: target, sourceDurationSeconds: 8, targetDurationSeconds: 60 });
    expect(analysis.alignmentSource).toBe("whisper");
    expect(analysis.canonicalLyrics.map((word) => word.text)).toEqual(words);
    expect(analysis.targetAudioStartSeconds).toBeCloseTo(30.8, 9);
    expect(analysis.targetAudioEndSeconds).toBeCloseTo(34.7, 9);
    expect(analysis.targetDurationSeconds).toBeCloseTo(3.9, 9);
    expect(analysis.anchors).toHaveLength(words.length);
    expect(analysis.anchors[0]).toMatchObject({ sourceStart: .8, targetStart: 0, origin: "automatic" });
    expect(analysis.timeMap.points[0]).toMatchObject({ sourceTime: .8, targetTime: 0 });
    expect(analysis.timeMap.points.at(-1)!.sourceTime).toBeCloseTo(4.7, 9);
    expect(analysis.timeMap.points.at(-1)!.targetTime).toBeCloseTo(3.9, 9);
    expect(analysis.report.monotonic).toBe(true);
    expect(mlsmPostLipsyncAnchorReport(analysis)).toContain('"alignmentSource": "whisper"');
    expect(mlsmPostLipsyncAnchorReport(analysis)).toContain("whisper-timing");
  });

  it("does not reject a Whisper-only match when the AI source repeats the line", () => {
    const words = ["The", "fallen", "Still", "loves", "me"];
    const repeatedWords = [...words, ...words, ...words];
    const source = transcript([
      [.2, .4], [.5, .8], [.9, 1.2], [1.3, 1.6], [1.7, 2],
      [5, 5.2], [5.3, 5.6], [5.7, 6], [6.1, 6.4], [6.5, 6.8],
      [11, 11.2], [11.3, 11.6], [11.7, 12], [12.1, 12.4], [12.5, 12.8]
    ], repeatedWords, 14);
    const leading = Array.from({ length: 12 }, (_, index) => `noise${index}`);
    const trailing = Array.from({ length: 12 }, (_, index) => `ending${index}`);
    const targetWords = [...leading, ...words, ...trailing];
    const targetTimes: Array<[number, number]> = [
      ...leading.map((_, index) => [index, index + .2] as [number, number]),
      [30, 30.2], [30.3, 30.6], [31.7, 32], [32.1, 32.4], [32.5, 32.9],
      ...trailing.map((_, index) => [40 + index, 40 + index + .2] as [number, number])
    ];
    const analysis = createMlsmPostLipsyncAnalysis({ sourceTranscript: source, targetTranscript: transcript(targetTimes, targetWords, 60), sourceDurationSeconds: 14, targetDurationSeconds: 60 });
    expect(analysis.alignmentSource).toBe("whisper");
    expect(analysis.targetAudioStartSeconds).toBeCloseTo(30, 9);
    expect(analysis.targetAudioEndSeconds).toBeCloseTo(32.9, 9);
    expect(analysis.anchors).toHaveLength(words.length);
    expect(analysis.anchors.map((anchor) => anchor.sourceCenter).every((center) => center > 4 && center < 8)).toBe(true);
  });

  it("limits broad DTW recovery to LLM-restored words and protects measured words", async () => {
    const words = ["The", "fallen", "Still", "loves", "me"];
    const source = transcript([[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], words, 7.5);
    source.words[0] = { ...source.words[0]!, confidence: .34, confidenceSource: "estimated" };
    source.words[1] = { ...source.words[1]!, confidence: .34, confidenceSource: "estimated" };
    const analysis = createMlsmPostLipsyncAnalysis({ sourceTranscript: source, targetTranscript: transcript([[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], words, 60), sourceDurationSeconds: 7.5, targetDurationSeconds: 60 });
    const requests: Array<{ maxShiftMs: number; anchors: Array<{ id: string }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { maxShiftMs: number; anchors: Array<{ id: string }> });
      return new Response(JSON.stringify({ kind: "refineAlignment", anchors: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    try {
      await refineMlsmPostLipsyncAlignment({ analysis, sourceVocalPath: "/source.wav", targetVocalPath: "/target.wav" });
    } finally { vi.unstubAllGlobals(); }
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ maxShiftMs: 50, anchors: [{ id: "lipsync-word-2" }, { id: "lipsync-word-3" }, { id: "lipsync-word-4" }] });
    expect(requests[1]).toMatchObject({ maxShiftMs: 7_500, anchors: [{ id: "lipsync-word-0" }, { id: "lipsync-word-1" }] });
  });

  it("replaces the blind recovery hunt with the measured waveform seed and keeps measured words untouched", async () => {
    const words = ["The", "fallen", "Still", "loves", "me"];
    const source = transcript([[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], words, 7.5);
    source.words[0] = { ...source.words[0]!, confidence: .34, confidenceSource: "estimated" };
    source.words[1] = { ...source.words[1]!, confidence: .34, confidenceSource: "estimated" };
    const analysis = createMlsmPostLipsyncAnalysis({ sourceTranscript: source, targetTranscript: transcript([[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], words, 60), sourceDurationSeconds: 7.5, targetDurationSeconds: 60, waveformAlignment: trustedWaveform });
    const requests: RefineRequestBody[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as RefineRequestBody);
      return new Response(JSON.stringify({ kind: "refineAlignment", anchors: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    try {
      await refineMlsmPostLipsyncAlignment({ analysis, sourceVocalPath: "/source.wav", targetVocalPath: "/target.wav", waveform: analysis.waveformAlignment });
    } finally { vi.unstubAllGlobals(); }
    expect(requests).toHaveLength(2);
    // Measured words keep their own Whisper timing and their narrow radius.
    expect(requests[0]!.maxShiftMs).toBe(50);
    for (const request of requests[0]!.anchors) {
      const anchor = analysis.anchors.find((candidate) => candidate.id === request.id)!;
      expect(request.sourceCenter).toBeCloseTo(anchor.sourceCenter, 9);
    }
    // Recovered words search a measured radius instead of 7.5 seconds of video,
    // seeded by the overlay rather than by the timing nobody trusts.
    expect(requests[1]!.maxShiftMs).toBe(analysis.waveformAlignment.searchRadiusMs);
    expect(requests[1]!.maxShiftMs).toBeLessThan(1_000);
    const stemOffset = analysis.targetAudioStartSeconds - analysis.targetAnalysisStartSeconds;
    for (const request of requests[1]!.anchors) {
      const anchor = analysis.anchors.find((candidate) => candidate.id === request.id)!;
      expect(request.sourceStart).toBeCloseTo(predictMlsmWaveformSourceSeconds(trustedWaveform, anchor.targetStart + stemOffset), 9);
      expect(request.sourceCenter).toBeCloseTo(predictMlsmWaveformSourceSeconds(trustedWaveform, anchor.targetCenter + stemOffset), 9);
      expect(request.sourceEnd).toBeCloseTo(predictMlsmWaveformSourceSeconds(trustedWaveform, anchor.targetEnd + stemOffset), 9);
      expect(request.sourceCenter).not.toBeCloseTo(anchor.sourceCenter, 3);
    }
  });

  it("keeps the legacy wide recovery radius when the overlay is not trustworthy", async () => {
    const words = ["The", "fallen", "Still", "loves", "me"];
    const source = transcript([[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], words, 7.5);
    source.words[0] = { ...source.words[0]!, confidence: .34, confidenceSource: "estimated" };
    const ambiguous = { ...trustedWaveform, trusted: false, status: "ambiguous" as const, searchRadiusMs: 0 };
    const analysis = createMlsmPostLipsyncAnalysis({ sourceTranscript: source, targetTranscript: transcript([[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], words, 60), sourceDurationSeconds: 7.5, targetDurationSeconds: 60, waveformAlignment: ambiguous });
    const requests: RefineRequestBody[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as RefineRequestBody);
      return new Response(JSON.stringify({ kind: "refineAlignment", anchors: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    try {
      await refineMlsmPostLipsyncAlignment({ analysis, sourceVocalPath: "/source.wav", targetVocalPath: "/target.wav", waveform: ambiguous });
    } finally { vi.unstubAllGlobals(); }
    expect(requests[1]!.maxShiftMs).toBe(7_500);
    const anchor = analysis.anchors.find((candidate) => candidate.id === requests[1]!.anchors[0]!.id)!;
    expect(requests[1]!.anchors[0]!.sourceCenter).toBeCloseTo(anchor.sourceCenter, 9);
  });

  it("ends exactly on the selected subtitle duration and never accumulates inverse-map drift", () => {
    const sourceTimes = targetTimes.map(([start, end]) => [start * 1.1, end * 1.1] as [number, number]);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: transcript(sourceTimes, lyricWords, 4.4), targetTranscript: transcript(targetTimes), sourceDurationSeconds: 4.4, targetDurationSeconds: 4 });
    expect(lipsyncTargetToSource(analysis.timeMap, 4)).toBeCloseTo(4.4, 12);
    for (let frame = 0; frame <= 240; frame += 1) {
      const target = frame / 60;
      expect(lipsyncSourceToTarget(analysis.timeMap, lipsyncTargetToSource(analysis.timeMap, target))).toBeCloseTo(target, 9);
    }
  });

  it("builds a target-timeline render plan with exact duration and independent frame sampling", () => {
    const sourceTimes = targetTimes.map(([start, end]) => [start * 1.1, end * 1.1] as [number, number]);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: transcript(sourceTimes, lyricWords, 4.4), targetTranscript: transcript(targetTimes), sourceDurationSeconds: 4.4, targetDurationSeconds: 4 });
    const plan = buildLipsyncRenderPlan({ timeMap: analysis.timeMap, sourceFps: 23.976, outputFps: 60, targetStart: .125, targetEnd: 3.983 });
    expect(plan.samples).toHaveLength(Math.ceil((3.983 - .125) * 60));
    expect(auditLipsyncRenderPlan(plan)).toEqual({ valid: true, durationErrorSeconds: expect.any(Number), monotonic: true });
    expect(auditLipsyncRenderPlan(plan).durationErrorSeconds).toBeLessThanOrEqual(1e-9);
    for (const sample of plan.samples) expect(lipsyncSourceToTarget(analysis.timeMap, sample.sourceTime)).toBeCloseTo(sample.targetTime, 9);
  });

  it("marks a missing canonical word unresolved instead of inventing a match", () => {
    const source = transcript([[.5, .72], [.82, 1.16], [1.92, 2.5]], ["I", "love", "forever"]);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: source, targetTranscript: transcript(targetTimes), sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    expect(analysis.unresolved).toContainEqual(expect.objectContaining({ canonicalIndex: 2, text: "you", reason: "source-missing" }));
    expect(analysis.anchors.some((anchor) => anchor.canonicalIndex === 2)).toBe(false);
    expect(mlsmPostLipsyncAnchorReport(analysis)).toContain('"status": "unresolved"');
  });

  it("lets the user create and edit an anchor for every unresolved timeline word", () => {
    const source = transcript([[.5, .72], [.82, 1.16], [1.92, 2.5]], ["I", "love", "forever"]);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: source, targetTranscript: transcript(targetTimes), sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const word = analysis.canonicalLyrics.find((item) => item.text === "you")!;
    const anchors = createManualLipsyncAnchor(word, analysis.timeMap, analysis.anchors);
    const next = replaceMlsmPostLipsyncAnchors(analysis, anchors);
    expect(next.anchors.find((anchor) => anchor.canonicalIndex === word.canonicalIndex)).toMatchObject({ origin: "manual", manuallyEdited: true, locked: false });
    expect(next.unresolved.some((item) => item.canonicalIndex === word.canonicalIndex)).toBe(false);
    expect(next.report.unresolved).toBe(0);
    expect(next.report.matchedWords).toBe(next.report.canonicalWords);
    expect(next.report.monotonic).toBe(true);
  });

  it("passes the numerical gate only with measured ground truth and a real cache hit", () => {
    const document = transcript(targetTimes);
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const groundTruth = analysis.anchors.map((anchor) => ({ canonicalIndex: anchor.canonicalIndex, sourceCenter: anchor.sourceCenter, targetCenter: anchor.targetCenter }));
    const gate = evaluateMlsmPostLipsyncHardGate({ analysis, groundTruth, fps: 60, cacheHit: true });
    expect(gate.passed).toBe(true);
    expect(gate.medianAnchorErrorFrames).toBe(0);
  });
});
