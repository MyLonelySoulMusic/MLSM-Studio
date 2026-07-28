import { describe, expect, it } from "vitest";
import type { EnergyFrame } from "@rbs/audio-analysis";
import { applyTeddyPhonemeTimeline, extractTeddyPhonemeCues, resolveTeddyLipSync } from "./teddy-lipsync";

function frame(timeSeconds: number, rms: number, formant: "open" | "wide" | "round" = "open"): EnergyFrame {
  const bands48 = Array.from({ length: 48 }, () => .03);
  const ranges = formant === "open" ? [[20, 27, .95], [28, 34, .42]] : formant === "wide" ? [[20, 27, .28], [28, 34, 1]] : [[12, 19, .9], [20, 27, .72], [28, 34, .16]];
  for (const [from, to, value] of ranges) for (let index = from!; index <= to!; index += 1) bands48[index] = value!;
  return { timeSeconds, rms, low: rms * .25, mid: rms, high: rms * .18, flux: .02, spectralCentroid: 1_400, spectralFlatness: .04, bands48 };
}

describe("teddy 3D lip sync", () => {
  it("mantiene la bocca chiusa nel silenzio", () => {
    const energy = Array.from({ length: 20 }, (_, index) => frame(index * .02, 0));
    expect(resolveTeddyLipSync(energy, .2)).toEqual({ jawOpen: 0, lipRound: 0, lipWide: 0, lipPress: 0, tongue: 0, voicing: 0 });
  });
  it("distingue vocali aperte, anteriori e arrotondate", () => {
    const open = Array.from({ length: 20 }, (_, index) => frame(index * .02, .16, "open"));
    const wide = Array.from({ length: 20 }, (_, index) => frame(index * .02, .16, "wide"));
    const round = Array.from({ length: 20 }, (_, index) => frame(index * .02, .16, "round"));
    expect(resolveTeddyLipSync(open, .2).jawOpen).toBeGreaterThan(.35);
    expect(resolveTeddyLipSync(wide, .2).lipWide).toBeGreaterThan(resolveTeddyLipSync(wide, .2).lipRound);
    expect(resolveTeddyLipSync(round, .2).lipRound).toBeGreaterThan(resolveTeddyLipSync(round, .2).lipWide);
  });
  it("restituisce sempre pesi finiti e limitati", () => {
    const energy = Array.from({ length: 25 }, (_, index) => frame(index * .017, index % 2 ? .7 : .01, index % 3 === 0 ? "wide" : "open"));
    for (const value of Object.values(resolveTeddyLipSync(energy, .23, 2.5, 2.5))) { expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
  });
  it("identifica intervalli di fonemi continui dall'analisi vocale", () => {
    const energy = [
      ...Array.from({ length: 8 }, (_, index) => frame(index * .02, 0)),
      ...Array.from({ length: 22 }, (_, index) => frame((index + 8) * .02, .18, "open")),
      ...Array.from({ length: 10 }, (_, index) => frame((index + 30) * .02, 0))
    ];
    const cues = extractTeddyPhonemeCues(energy);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every((cue) => cue.id.startsWith("phoneme-") && cue.endSeconds > cue.startSeconds)).toBe(true);
    expect(cues.some((cue) => ["A", "EI", "OU", "LT"].includes(cue.viseme))).toBe(true);
  });
  it("applica gli interventi della timeline al movimento reale del muso", () => {
    const pose = { jawOpen: .8, lipRound: .1, lipWide: .2, lipPress: 0, tongue: .1, voicing: .9 };
    const cues = [{ id: "a", startSeconds: .2, endSeconds: .8, viseme: "MBP" as const, confidence: .8, manual: true }];
    expect(applyTeddyPhonemeTimeline(pose, .1, cues, true)).toEqual({ jawOpen: 0, lipRound: 0, lipWide: 0, lipPress: 0, tongue: 0, voicing: 0 });
    const active = applyTeddyPhonemeTimeline(pose, .5, cues, true);
    expect(active.jawOpen).toBeLessThanOrEqual(.06);
    expect(active.lipPress).toBeGreaterThan(.7);
  });
  it("rilascia la bocca in posa neutra alla fine del brano e del fonema", () => {
    const pose = { jawOpen: .9, lipRound: .4, lipWide: .2, lipPress: 0, tongue: .3, voicing: 1 };
    const cues = [{ id: "last", startSeconds: 9.5, endSeconds: 10.2, viseme: "A" as const, confidence: .9, manual: false }];
    const releasing = applyTeddyPhonemeTimeline(pose, 9.95, cues, true, 10);
    const ended = applyTeddyPhonemeTimeline(pose, 10, cues, true, 10);
    expect(releasing.jawOpen).toBeLessThan(pose.jawOpen);
    expect(ended).toEqual({ jawOpen: 0, lipRound: 0, lipWide: 0, lipPress: 0, tongue: 0, voicing: 0 });
    expect(applyTeddyPhonemeTimeline(pose, 10, [], false, 10)).toEqual(ended);
  });
});
