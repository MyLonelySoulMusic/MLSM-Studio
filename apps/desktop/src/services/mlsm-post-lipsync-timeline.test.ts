import { describe, expect, it } from "vitest";
import { editLipsyncTimelineAnchors, lipsyncMasterWaveformBars, selectLipsyncTimelineWords } from "./mlsm-post-lipsync-timeline";
import type { WordAnchor } from "./mlsm-post-lipsync-types";

function anchor(index: number, targetStart: number, targetEnd: number): WordAnchor {
  return { id: `word-${index}`, text: `word ${index}`, canonicalIndex: index, cueIndex: 0, sourceStart: targetStart, sourceCenter: (targetStart + targetEnd) / 2, sourceEnd: targetEnd, targetStart, targetCenter: (targetStart + targetEnd) / 2, targetEnd, sourceConfidence: 1, targetConfidence: 1, matchConfidence: 1, confidenceBand: "high", origin: "automatic", locked: false, manuallyEdited: false, evidence: { textSimilarity: 1, sourceConfidence: 1, targetConfidence: 1, subtitlePrior: 1, sequenceMargin: 1 }, sourceTranscriptText: `word ${index}`, targetTranscriptText: `word ${index}` };
}

describe("lipsyncMasterWaveformBars", () => {
  it("estrae soltanto la finestra del master usata dal lipsync", () => {
    const waveform = [0, .1, 0, .2, 0, .8, 0, 1];
    expect(lipsyncMasterWaveformBars(waveform, 4, 2, 2, 2)).toEqual([.8, 1]);
  });

  it("mantiene una timeline renderizzabile anche con waveform assente", () => {
    expect(lipsyncMasterWaveformBars([], 7, 0, 7, 3)).toEqual([0, 0, 0]);
  });
});

describe("selectLipsyncTimelineWords", () => {
  it("supporta selezione singola, additiva e intervallo Shift", () => {
    expect(selectLipsyncTimelineWords({ selected: [], clicked: 2, lastFocused: null })).toEqual([2]);
    expect(selectLipsyncTimelineWords({ selected: [2], clicked: 4, lastFocused: 2, additive: true })).toEqual([2, 4]);
    expect(selectLipsyncTimelineWords({ selected: [2], clicked: 5, lastFocused: 2, range: true })).toEqual([2, 3, 4, 5]);
  });
});

describe("editLipsyncTimelineAnchors", () => {
  const anchors = [anchor(0, .2, .8), anchor(1, 1, 1.5), anchor(2, 1.7, 2.2)];

  it("sposta una selezione multipla come un blocco sulla timeline target", () => {
    const edited = editLipsyncTimelineAnchors({ anchors, canonicalIndexes: [1, 2], mode: "move", deltaSeconds: .2, targetDurationSeconds: 3 });
    expect(edited[0]!.targetStart).toBe(.2);
    expect(edited[1]!.targetStart).toBeCloseTo(1.2, 10);
    expect(edited[2]!.targetEnd).toBeCloseTo(2.4, 10);
    expect(edited[2]!.targetStart - edited[1]!.targetStart).toBeCloseTo(.7, 10);
  });

  it("ridimensiona entrambi i bordi e ricalcola il centro della parola", () => {
    const longer = editLipsyncTimelineAnchors({ anchors, canonicalIndexes: [1], mode: "resize-start", deltaSeconds: -.2, targetDurationSeconds: 3 });
    expect(longer[1]).toMatchObject({ targetStart: .8, targetEnd: 1.5, manuallyEdited: true, origin: "manual" });
    expect(longer[1]!.targetCenter).toBeCloseTo(1.15, 10);
    const shorter = editLipsyncTimelineAnchors({ anchors, canonicalIndexes: [1], mode: "resize-end", deltaSeconds: -.2, targetDurationSeconds: 3 });
    expect(shorter[1]!.targetEnd).toBeCloseTo(1.3, 10);
    expect(shorter[1]!.targetCenter).toBeCloseTo(1.15, 10);
  });
});
