import { describe, expect, it, vi } from "vitest";
import {
  decodeMlsmWaveformAlignment,
  measureMlsmPostLipsyncWaveformAlignment,
  mlsmWaveformSearchRadiusMs,
  mlsmWaveformTrustThresholds,
  predictMlsmWaveformSourceSeconds,
  unmeasuredMlsmWaveformAlignment
} from "./mlsm-post-lipsync-waveform";

/** A measurement that clears every trust threshold with room to spare. */
function measured(overrides: Record<string, unknown> = {}) {
  return {
    kind: "alignWaveform", aligned: true, method: "onset-rms-xcorr-v1",
    offsetSeconds: -1.25, scale: 1.02, confidence: .82, clarity: .41, residualMs: 18, spreadMs: 120, localAgreement: .88, windows: 9, overlapSeconds: 7.4,
    ...overrides
  };
}

describe("MLSM POST LIPSYNC · waveform overlay", () => {
  it("trusts a clear overlay and turns its spread into a bounded search radius", () => {
    const alignment = decodeMlsmWaveformAlignment(measured());
    expect(alignment).toMatchObject({ status: "measured", trusted: true, offsetSeconds: -1.25, scale: 1.02, windows: 9 });
    // 120 ms of per-window breathing → 150 + 1.5 × 120 ms, far below the 30 s blind hunt.
    expect(alignment.searchRadiusMs).toBe(330);
    expect(mlsmWaveformSearchRadiusMs({ ...alignment, spreadMs: 0 })).toBe(150);
    expect(mlsmWaveformSearchRadiusMs({ ...alignment, spreadMs: 10_000 })).toBe(900);
    expect(mlsmWaveformSearchRadiusMs({ ...alignment, trusted: false })).toBe(0);
  });

  it("refuses a looped backing track that correlates equally well one bar away", () => {
    const alignment = decodeMlsmWaveformAlignment(measured({ confidence: .96, clarity: mlsmWaveformTrustThresholds.clarity - .01 }));
    expect(alignment).toMatchObject({ status: "ambiguous", trusted: false, searchRadiusMs: 0 });
    expect(alignment.confidence).toBeCloseTo(.96, 9);
  });

  it("refuses weak correlation, disagreeing windows and too few windows", () => {
    for (const overrides of [
      { confidence: mlsmWaveformTrustThresholds.confidence - .01 },
      { localAgreement: mlsmWaveformTrustThresholds.localAgreement - .01 },
      { windows: mlsmWaveformTrustThresholds.windows - 1 }
    ]) {
      const alignment = decodeMlsmWaveformAlignment(measured(overrides));
      expect(alignment.trusted).toBe(false);
      expect(alignment.status).toBe("ambiguous");
    }
  });

  it("reports an unmeasurable overlay without inventing a mapping", () => {
    const alignment = decodeMlsmWaveformAlignment({ kind: "alignWaveform", aligned: false, reason: "sovrapposizione troppo breve" });
    expect(alignment).toMatchObject({ status: "unmeasurable", trusted: false, detail: "sovrapposizione troppo breve", scale: 1, offsetSeconds: 0, searchRadiusMs: 0 });
    expect(unmeasuredMlsmWaveformAlignment("disabled")).toMatchObject({ status: "disabled", trusted: false, scale: 1, offsetSeconds: 0 });
  });

  it("rejects a response that is not a waveform overlay or carries an impossible mapping", () => {
    expect(() => decodeMlsmWaveformAlignment(null)).toThrow(/non valida/u);
    expect(() => decodeMlsmWaveformAlignment({ kind: "refineAlignment", aligned: true })).toThrow(/non pertinente/u);
    expect(() => decodeMlsmWaveformAlignment(measured({ scale: 0 }))).toThrow(/mappa temporale/u);
    expect(() => decodeMlsmWaveformAlignment(measured({ offsetSeconds: "later" }))).toThrow(/mappa temporale/u);
  });

  it("maps a master instant onto the video timeline and never before its first frame", () => {
    const alignment = decodeMlsmWaveformAlignment(measured({ offsetSeconds: -29.6, scale: 1.05 }));
    expect(predictMlsmWaveformSourceSeconds(alignment, 30)).toBeCloseTo(1.9, 9);
    expect(predictMlsmWaveformSourceSeconds(alignment, 0)).toBe(0);
  });

  it("measures through the local vocal service and never lets a failure abort the analysis", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify(measured()), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    try {
      const messages: string[] = [];
      const alignment = await measureMlsmPostLipsyncWaveformAlignment({ sourceVocalPath: "/source.wav", targetVocalPath: "/target.wav", onProgress: (_progress, message) => messages.push(message) });
      expect(alignment.trusted).toBe(true);
      expect(JSON.parse(bodies[0]!)).toEqual({ sourcePath: "/source.wav", targetPath: "/target.wav" });
      expect(messages.at(-1)).toContain("Onde sovrapposte");
    } finally { vi.unstubAllGlobals(); }

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "librosa non disponibile" }), { status: 500, headers: { "Content-Type": "application/json" } })));
    try {
      await expect(measureMlsmPostLipsyncWaveformAlignment({ sourceVocalPath: "/source.wav", targetVocalPath: "/target.wav" })).rejects.toThrow(/librosa non disponibile/u);
    } finally { vi.unstubAllGlobals(); }
  });
});
