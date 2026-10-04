/* Shared by the browser and the local server; no audio or platform dependencies. */
/* global module */
(function (root) {
  'use strict';
  const VERSION = 2;
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted[middle] + sorted[Math.max(0, middle - (sorted.length % 2 === 0 ? 1 : 0))]) / 2 : 0;
  };
  const clean = (times, duration) => [...new Set((times || []).map(Number)
    .filter(t => Number.isFinite(t) && t >= 0 && t < duration))].sort((a, b) => a - b);

  // Preserve the original bar-based estimate when bars are consistent. Infer
  // triple meter only from repeated evidence, never from one noisy downbeat.
  function estimateTempo(analysis) {
    const beats = clean(analysis.beats, Infinity);
    const downbeats = clean(analysis.downbeats, Infinity);
    const gaps = downbeats.slice(1).map((t, i) => t - downbeats[i]);
    const counts = downbeats.slice(1).map((t, i) => beats.filter(b => b >= downbeats[i] && b < t).length);
    const triple = counts.length >= 4 && counts.filter(n => n === 3).length / counts.length >= .75;
    const meter = triple ? 3 : 4;
    const middle = median(gaps);
    const barPeriod = median(gaps.filter(v => v >= middle * .65 && v <= middle * 1.45));
    const barBpm = barPeriod ? meter * 60 / barPeriod : 0;
    const intervals = beats.slice(1).map((t, i) => t - beats[i]).filter(t => t >= .25 && t <= 1.5);
    const beatPeriod = median(intervals);
    const bpm = gaps.length >= 4 && barBpm >= 55 && barBpm <= 190 ? barBpm : beatPeriod ? 60 / beatPeriod : 0;
    return { bpm, meter };
  }

  // Find chains of observed events compatible with the reference pulse.
  // A missing beat advances the musical position by 2, 3, ... beats; it is
  // never counted as just one, and no synthetic audio anchors are inserted.
  function trustedRuns(analysis, duration, bpm) {
    const times = clean(analysis.beats, duration);
    const period = 60 / bpm;
    if (!(period > 0) || !Number.isFinite(period)) return [];
    const scores = new Float64Array(times.length);
    const previous = new Int32Array(times.length).fill(-1);
    const steps = new Int32Array(times.length);
    for (let i = 0; i < times.length; i++) {
      scores[i] = 1;
      for (let j = i - 1; j >= 0 && times[i] - times[j] <= period * 8.5; j--) {
        const gap = times[i] - times[j];
        const count = Math.round(gap / period);
        if (count < 1 || count > 8) continue;
        const error = Math.abs(gap / (count * period) - 1);
        // Long holes and off-grid detections do not acquire false confidence.
        if (error > .10) continue;
        const reward = 1 - (error / .10) ** 2 - .08 * (count - 1);
        const score = scores[j] + reward;
        if (reward > 0 && score > scores[i]) {
          scores[i] = score; previous[i] = j; steps[i] = count;
        }
      }
    }
    const candidates = times.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const occupied = new Uint8Array(times.length);
    const runs = [];
    for (const end of candidates) {
      if (occupied[end]) continue;
      const chain = [];
      for (let i = end; i >= 0 && !occupied[i]; i = previous[i]) chain.push(i);
      chain.reverse();
      if (chain.length < 6 || times[end] - times[chain[0]] < period * 4) continue;
      // Do not bridge already accepted chains belonging to another phase.
      if (occupied.slice(chain[0], end + 1).some(Boolean)) continue;
      occupied.fill(1, chain[0], end + 1);
      let position = 0;
      const run = chain.map((index, n) => {
        if (n) position += steps[index];
        return { source: times[index], position };
      });
      // A path through random peaks can also fit a grid by chance. Validate
      // local timing evidence before using it, and split at uncertain sections.
      const residuals = run.slice(1).map((anchor, i) =>
        (anchor.source - run[i].source) / ((anchor.position - run[i].position) * period) - 1);
      let piece = [run[0]];
      const finish = () => {
        if (piece.length >= 6 && piece.at(-1).source - piece[0].source >= period * 4) {
          const offset = piece[0].position;
          runs.push(piece.map(anchor => ({ ...anchor, position: anchor.position - offset })));
        }
      };
      for (let i = 1; i < run.length; i++) {
        const window = residuals.slice(Math.max(0, i - 5), Math.min(residuals.length, i + 4));
        const bias = median(window);
        const scatter = median(window.map(v => Math.abs(v - bias)));
        const steady = median(window.map(Math.abs)) <= .025
          || (scatter <= .012 && Math.abs(bias) <= .075);
        if (!steady || run[i].position - run[i - 1].position > 4) {
          finish(); piece = [run[i]];
        } else piece.push(run[i]);
      }
      finish();
    }
    return runs.sort((a, b) => a[0].source - b[0].source);
  }

  function buildMap(analysis, duration, sourceBpm, targetBpm) {
    if (![duration, sourceBpm, targetBpm].every(v => Number.isFinite(v) && v > 0))
      return { points: [], coverage: 0, quantizable: false, version: VERSION };
    const runs = trustedRuns(analysis, duration, sourceBpm);
    const ratio = sourceBpm / targetBpm;
    const period = 60 / targetBpm;
    const points = [{ source: 0, target: 0 }];
    let covered = 0;
    let observed = 0;
    for (const run of runs) {
      const last = points.at(-1);
      const start = run[0];
      // Preserve untracked intros, breaks and endings at the requested global
      // tempo. Their duration cannot be inferred from a missing beat count.
      const targetStart = last.target + (start.source - last.source) * ratio;
      for (const anchor of run) {
        if (anchor.source <= points.at(-1).source) continue;
        points.push({ source: anchor.source, target: targetStart + anchor.position * period });
      }
      covered += run.at(-1).source - start.source;
      observed += run.length;
    }
    const last = points.at(-1);
    points.push({ source: duration, target: last.target + (duration - last.source) * ratio });
    const coverage = Math.min(1, covered / duration);
    return { points, coverage, observed, runs: runs.length,
      quantizable: observed >= 12 && coverage >= .35, version: VERSION };
  }
  function meanTempo(analysis, duration, halfTime = false) {
    const reference = estimateTempo(analysis).bpm;
    const runs = trustedRuns(analysis, duration, reference);
    const bpms = [];
    for (const run of runs) {
      for (let i = 1; i < run.length; i++) {
        const elapsed = run[i].source - run[i - 1].source;
        const pulses = run[i].position - run[i - 1].position;
        bpms.push(60 * pulses / elapsed);
      }
    }
    const mean = bpms.length ? bpms.reduce((total, bpm) => total + bpm, 0) / bpms.length : reference;
    return mean * (halfTime ? .5 : 1);
  }

  function suggestedTargetBpm(analysis, duration, halfTime = false) {
    return Math.round(meanTempo(analysis, duration, halfTime));
  }
  const api = { VERSION, estimateTempo, trustedRuns, buildMap, meanTempo, suggestedTargetBpm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AIQrhythm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
