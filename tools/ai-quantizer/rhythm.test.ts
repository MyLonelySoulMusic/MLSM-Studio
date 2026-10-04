import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { estimateTempo, buildMap, meanTempo, suggestedTargetBpm } = require('./public/rhythm.cjs');
const sequence = (start: number, step: number, count: number) => Array.from({ length: count }, (_, i) => start + i * step);

describe('Conservative rhythmic map', () => {
  it('rounds the arithmetic mean of local BPMs rather than the median tempo', () => {
    const bpms = [...Array(12).fill(120.1), ...Array(10).fill(123.3)];
    const beats = [0];
    for (const bpm of bpms) beats.push(beats.at(-1)! + 60 / bpm);
    const analysis = { beats, downbeats: [] }, duration = beats.at(-1)! + .5;
    expect(estimateTempo(analysis).bpm).toBeCloseTo(120.1, 5);
    expect(meanTempo(analysis, duration)).toBeCloseTo(bpms.reduce((a, b) => a + b, 0) / bpms.length, 5);
    expect(suggestedTargetBpm(analysis, duration)).toBe(122);
  });
  it('halves the mean before rounding the automatic target', () => {
    const analysis = { beats: sequence(0, 60 / 142.8, 40), downbeats: [] };
    expect(suggestedTargetBpm(analysis, 18)).toBe(143);
    expect(suggestedTargetBpm(analysis, 18, true)).toBe(71);
  });
  it('retains the original bar-based estimate and recognizes consistently triple meter', () => {
    const beats = sequence(0, .5, 100);
    expect(estimateTempo({ beats, downbeats: sequence(0, 2, 25) })).toEqual({ bpm: 120, meter: 4 });
    expect(estimateTempo({ beats, downbeats: sequence(0, 1.5, 33) })).toEqual({ bpm: 120, meter: 3 });
  });
  it('does not require drums or downbeats when the pulse is stable', () => {
    const analysis = { beats: sequence(0, .75, 80), downbeats: [] };
    expect(estimateTempo(analysis).bpm).toBe(80);
    const map = buildMap(analysis, 60, 80, 80);
    expect(map.quantizable).toBe(true);
    expect(map.points.at(-1).target).toBeCloseTo(60, 8);
  });
  it('does not accelerate or slow down when the tracker switches between subdivisions', () => {
    const beats = [...sequence(0, .5, 40), ...sequence(20, .25, 80), ...sequence(40, 1, 20)];
    const result = buildMap({ beats }, 60, 120, 120);
    expect(result.quantizable).toBe(true);
    for (const point of result.points) expect(point.target).toBeCloseTo(point.source, 8);
  });
  it('counts triplet subdivisions and missing beats by elapsed musical positions', () => {
    const beats = [...sequence(0, .56, 90), ...sequence(50.4, .84, 60)];
    const result = buildMap({ beats }, 102, 60 / .42, 60 / .42);
    expect(result.quantizable).toBe(true);
    expect(result.points.at(-1).target).toBeCloseTo(102, 8);
  });
  it('preserves the duration of an untracked intro, long break and ending without inventing anchors', () => {
    const beats = [...sequence(12, .5, 40), ...sequence(70, .5, 40)];
    const result = buildMap({ beats }, 100, 120, 120);
    expect(result.quantizable).toBe(true);
    expect(result.points.filter((p: { source: number }) => p.source > 31.5 && p.source < 70)).toHaveLength(0);
    expect(result.points.at(-1).target).toBeCloseTo(100, 8);
    for (const point of result.points) expect(point.target).toBeCloseTo(point.source, 8);
  });
  it('rejects insufficient pulse evidence instead of presenting an identity map as successful quantization', () => {
    expect(buildMap({ beats: [0, 2.1, 7.8, 19.3, 44, 58] }, 60, 120, 120).quantizable).toBe(false);
    expect(buildMap({ beats: sequence(10, .5, 20) }, 180, 120, 120).quantizable).toBe(false);
  });
  it('does not mistake a long sequence of irregular peaks for a reliable pulse', () => {
    let seed = 42;
    for (let sample = 0; sample < 3; sample++) {
      const beats = [];
      for (let time = 0; time < 180;) {
        beats.push(time);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        time += .1 + seed / 2 ** 32 * 1.2;
      }
      expect(buildMap({ beats }, 180, 120, 120).quantizable).toBe(false);
    }
  });
  it('changes speed only according to the explicit target BPM, including untracked regions', () => {
    const result = buildMap({ beats: sequence(5, .5, 80) }, 50, 120, 100);
    expect(result.quantizable).toBe(true);
    expect(result.points.at(-1).target).toBeCloseTo(60, 8);
    expect(result.points.filter((p: { source: number }) => p.source === 0)).toHaveLength(1);
  });
});
