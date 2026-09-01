import { describe, expect, it } from "vitest";
import { createMlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-analysis";
import { applyMlsmVisualSpeechTiming, decodeMlsmVisualSpeechResult, type MlsmVisualSpeechResult } from "./mlsm-post-lipsync-visual";
import type { WhisperTranscriptDocument } from "./subtitle-generation";

const subtitles = `1
00:00:00,000 --> 00:00:02,000
The fallen

2
00:00:02,200 --> 00:00:04,000
Still loves me
`;

function transcript(): WhisperTranscriptDocument {
  const words = [
    { text: "The", start: .35, end: .65, confidence: .96, confidenceSource: "model" as const },
    { text: "fallen", start: .72, end: 1.25, confidence: .96, confidenceSource: "model" as const },
    { text: "Still", start: 2.3, end: 2.65, confidence: .96, confidenceSource: "model" as const },
    { text: "loves", start: 2.72, end: 3.1, confidence: .96, confidenceSource: "model" as const },
    { text: "me", start: 3.2, end: 3.55, confidence: .96, confidenceSource: "model" as const }
  ];
  return { schemaVersion: 1, engine: "Whisper", model: "whisper-base_timestamped", durationSeconds: 4, transcript: "The fallen Still loves me", words, phrases: [{ start: .35, end: 3.55, text: "The fallen Still loves me", confidence: .96 }] };
}

function resultFor(analysis: ReturnType<typeof createMlsmPostLipsyncAnalysis>, changes: Partial<MlsmVisualSpeechResult> = {}): MlsmVisualSpeechResult {
  return {
    kind: "analyzeVisemes", provider: "Auto-AVSR", model: "visual.pth", revision: "abc", device: "cpu", faceCoverage: .96, visualTranscript: "the fallen still loves me", visemes: [],
    words: analysis.anchors.map((anchor) => ({ id: anchor.id, canonicalIndex: anchor.canonicalIndex, text: anchor.text, startSeconds: anchor.sourceStart + .08, centerSeconds: anchor.sourceCenter + .1, endSeconds: anchor.sourceEnd + .08, confidence: .9, semanticSimilarity: .9 })),
    ...changes
  };
}

describe("MLSM Post Lipsync · Auto-AVSR", () => {
  it("decodes only bounded visual timing evidence", () => {
    expect(decodeMlsmVisualSpeechResult({ kind: "analyzeVisemes", provider: "Auto-AVSR", model: "visual.pth", revision: "abc", device: "mps", faceCoverage: .9, visualTranscript: "the fallen", words: [{ id: "w", canonicalIndex: 0, text: "The", startSeconds: .1, centerSeconds: .2, endSeconds: .3, confidence: .8, semanticSimilarity: .7 }], visemes: [{ canonicalIndex: 0, label: "the", visemeClass: "dental", startSeconds: .1, centerSeconds: .2, endSeconds: .3, confidence: .8 }] })).toMatchObject({ provider: "Auto-AVSR", faceCoverage: .9, words: [{ canonicalIndex: 0 }], visemes: [{ visemeClass: "dental" }] });
    expect(() => decodeMlsmVisualSpeechResult({ kind: "analyzeVisemes", provider: "Auto-AVSR", faceCoverage: Number.NaN })).toThrow(/liste|metadati/);
    const valid = resultFor(createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: transcript(), targetTranscript: transcript(), sourceDurationSeconds: 4, targetDurationSeconds: 4 }));
    expect(() => decodeMlsmVisualSpeechResult({ ...valid, words: [...valid.words, valid.words[0]] })).toThrow(/duplicati/);
    expect(() => decodeMlsmVisualSpeechResult({ ...valid, words: undefined })).toThrow(/liste/);
    expect(() => decodeMlsmVisualSpeechResult({ ...valid, faceCoverage: 1.2 })).toThrow(/metadati/);
  });

  it("fuses confident visemes and rebuilds a monotonic time-map", () => {
    const document = transcript();
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const refined = applyMlsmVisualSpeechTiming(analysis, resultFor(analysis));
    expect(refined.visualSpeech).toMatchObject({ enabled: true, applied: true, status: "applied", provider: "Auto-AVSR" });
    expect(refined.report.monotonic).toBe(true);
    expect(refined.anchors.some((anchor, index) => anchor.sourceCenter > analysis.anchors[index]!.sourceCenter && anchor.evidence.visualRefinement?.method === "auto-avsr-ctc-v1")).toBe(true);
  });

  it("does not alter timing when visual evidence is weak", () => {
    const document = transcript();
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    const weak = resultFor(analysis, { faceCoverage: .4, words: resultFor(analysis).words.map((word) => ({ ...word, confidence: .2 })) });
    const refined = applyMlsmVisualSpeechTiming(analysis, weak);
    expect(refined.visualSpeech.status).toBe("no-confident-visemes");
    expect(refined.anchors.map((anchor) => anchor.sourceCenter)).toEqual(analysis.anchors.map((anchor) => anchor.sourceCenter));
    expect(refined.report.monotonic).toBe(true);
  });

  it("never overwrites locked, manually edited, mismatched or implausibly shifted anchors", () => {
    const document = transcript();
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 4, targetDurationSeconds: 4 });
    analysis.anchors[0] = { ...analysis.anchors[0]!, locked: true };
    analysis.anchors[1] = { ...analysis.anchors[1]!, manuallyEdited: true };
    const visual = resultFor(analysis);
    visual.words[2] = { ...visual.words[2]!, id: "wrong-anchor" };
    visual.words[3] = { ...visual.words[3]!, centerSeconds: visual.words[3]!.centerSeconds + 1, startSeconds: visual.words[3]!.startSeconds + 1, endSeconds: visual.words[3]!.endSeconds + 1 };
    const refined = applyMlsmVisualSpeechTiming(analysis, visual);
    expect(refined.anchors.slice(0, 4).map((anchor) => anchor.sourceCenter)).toEqual(analysis.anchors.slice(0, 4).map((anchor) => anchor.sourceCenter));
    expect(refined.report.monotonic).toBe(true);
  });

  it("uses the confident words from the real vertical-video probe and ignores its uncertain opening", () => {
    const document = transcript();
    const analysis = createMlsmPostLipsyncAnalysis({ subtitles, sourceTranscript: document, targetTranscript: document, sourceDurationSeconds: 15.041667, targetDurationSeconds: 4 });
    analysis.anchors = analysis.anchors.map((anchor, index) => index >= 2 ? { ...anchor, sourceConfidence: .45 } : anchor);
    const probe: MlsmVisualSpeechResult = {
      kind: "analyzeVisemes", provider: "Auto-AVSR", model: "vsr_trlrs2lrs3vox2avsp_base.pth", revision: "182b62837773ab01052d4ac21ef1d2203ea7d267", device: "mps", faceCoverage: 1,
      visualTranscript: "FOR STILL LOVE ME", visemes: [],
      words: analysis.anchors.map((anchor, index) => ({
        id: anchor.id, canonicalIndex: anchor.canonicalIndex, text: anchor.text,
        startSeconds: [0, .4792, 4.9375, 5.6042, 7.2708][index]!,
        centerSeconds: [.2304, 1.0692, 4.9739, 6.4334, 7.3595][index]!,
        endSeconds: [.4792, 1.1458, 5.0208, 6.5625, 7.4375][index]!,
        confidence: [.2708, .2709, .6334, .6333, .6334][index]!,
        semanticSimilarity: [.1538, .1538, .963, .963, .963][index]!
      }))
    };
    const refined = applyMlsmVisualSpeechTiming(analysis, probe);
    expect(refined.anchors.slice(0, 2).map((anchor) => anchor.sourceCenter)).toEqual(analysis.anchors.slice(0, 2).map((anchor) => anchor.sourceCenter));
    expect(refined.anchors.slice(2).some((anchor, index) => anchor.sourceCenter !== analysis.anchors[index + 2]!.sourceCenter)).toBe(true);
    expect(refined.visualSpeech).toMatchObject({ applied: true, status: "applied", faceCoverage: 1, visualTranscript: "FOR STILL LOVE ME" });
    expect(refined.report.monotonic).toBe(true);
  });
});
