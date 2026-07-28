import type { EnergyFrame } from "@rbs/audio-analysis";

const emptyBands = Array.from({ length: 48 }, () => 0);

export interface CoverSpectrumFrame { bands: number[]; leftBands: number[]; rightBands: number[]; pulse: number; leftPulse: number; rightPulse: number; stereoWidth: number; }

export function resolveCoverSpectrum(energy: readonly EnergyFrame[] | undefined, timeSeconds: number): CoverSpectrumFrame {
  if (!energy?.length) return { bands: [...emptyBands], leftBands: [...emptyBands], rightBands: [...emptyBands], pulse: 0, leftPulse: 0, rightPulse: 0, stereoWidth: 0 };
  let low = 0; let high = energy.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if ((energy[middle]?.timeSeconds ?? 0) < timeSeconds) low = middle + 1; else high = middle; }
  const rightIndex = Math.min(energy.length - 1, low); const leftIndex = Math.max(0, rightIndex - 1); const left = energy[leftIndex]!; const right = energy[rightIndex]!;
  const mix = right.timeSeconds === left.timeSeconds ? 0 : Math.max(0, Math.min(1, (timeSeconds - left.timeSeconds) / (right.timeSeconds - left.timeSeconds)));
  const fallback = (frame: EnergyFrame, index: number) => index < 14 ? frame.low : index < 34 ? frame.mid : frame.high;
  const frameBand = (frame: EnergyFrame, index: number) => frame.bands48?.[index] ?? frame.bands24?.[Math.floor(index / 2)] ?? fallback(frame, index);
  const directRms = Math.max(0, left.rms + (right.rms - left.rms) * mix); const directFlux = Math.max(0, left.flux + (right.flux - left.flux) * mix); const directLoudness = Math.max(0, Math.min(1, directRms * 8 + directFlux * 2));
  const directBands = Array.from({ length: 48 }, (_, index) => Math.max(0, Math.min(1, (frameBand(left, index) + (frameBand(right, index) - frameBand(left, index)) * mix) * directLoudness)));
  const temporal = Array.from({ length: 48 }, () => 0); let temporalWeight = 0; let smoothRms = 0; let smoothFlux = 0;
  for (let index = leftIndex; index >= 0 && timeSeconds - (energy[index]?.timeSeconds ?? 0) <= .42; index -= 1) { const frame = energy[index]!; const age = timeSeconds - frame.timeSeconds; const weight = Math.exp(-Math.max(0, age) / .24); const loudness = Math.max(0, Math.min(1, frame.rms * 8 + frame.flux * 2)); for (let band = 0; band < 48; band += 1) temporal[band] = (temporal[band] ?? 0) + frameBand(frame, band) * loudness * weight; smoothRms += frame.rms * weight; smoothFlux += frame.flux * weight; temporalWeight += weight; }
  for (let index = rightIndex; index < energy.length && (energy[index]?.timeSeconds ?? Infinity) - timeSeconds <= .1; index += 1) { const frame = energy[index]!; const lead = frame.timeSeconds - timeSeconds; if (lead < 0) continue; const weight = Math.exp(-lead / .065) * .45; const loudness = Math.max(0, Math.min(1, frame.rms * 8 + frame.flux * 2)); for (let band = 0; band < 48; band += 1) temporal[band] = (temporal[band] ?? 0) + frameBand(frame, band) * loudness * weight; smoothRms += frame.rms * weight; smoothFlux += frame.flux * weight; temporalWeight += weight; }
  const timeSmoothed = temporalWeight > 0 ? temporal.map((value) => value / temporalWeight) : directBands;
  const bands = timeSmoothed.map((value, index, values) => Math.max(0, Math.min(1, value * .62 + (values[index - 1] ?? value) * .19 + (values[index + 1] ?? value) * .19)));
  const pulse = temporalWeight > 0 ? smoothRms / temporalWeight * 5.5 + smoothFlux / temporalWeight * 2.2 : directRms * 5.5 + directFlux * 2.2;
  const channelBands = (side: "left" | "right") => {
    const accumulated = Array.from({ length: 48 }, () => 0); let weightTotal = 0; let channelRms = 0;
    for (let index = leftIndex; index >= 0 && timeSeconds - (energy[index]?.timeSeconds ?? 0) <= .34; index -= 1) {
      const frame = energy[index]!; const weight = Math.exp(-Math.max(0, timeSeconds - frame.timeSeconds) / .2); const rms = side === "left" ? frame.leftRms ?? frame.rms : frame.rightRms ?? frame.rms; const source = side === "left" ? frame.leftBands48 : frame.rightBands48;
      const loudness = Math.max(0, Math.min(1, rms * 8 + frame.flux * 1.4));
      for (let band = 0; band < 48; band += 1) accumulated[band] = (accumulated[band] ?? 0) + (source?.[band] ?? frameBand(frame, band)) * loudness * weight;
      channelRms += rms * weight; weightTotal += weight;
    }
    const leftRms = side === "left" ? left.leftRms ?? left.rms : left.rightRms ?? left.rms; const rightRms = side === "left" ? right.leftRms ?? right.rms : right.rightRms ?? right.rms; const interpolatedRms = leftRms + (rightRms - leftRms) * mix;
    const leftSource = side === "left" ? left.leftBands48 : left.rightBands48; const rightSource = side === "left" ? right.leftBands48 : right.rightBands48;
    const direct = Array.from({ length: 48 }, (_, band) => ((leftSource?.[band] ?? frameBand(left, band)) + ((rightSource?.[band] ?? frameBand(right, band)) - (leftSource?.[band] ?? frameBand(left, band))) * mix) * Math.max(0, Math.min(1, interpolatedRms * 8)));
    const raw = weightTotal > 0 ? accumulated.map((value) => value / weightTotal) : direct;
    return {
      bands: raw.map((value, index, values) => Math.max(0, Math.min(1, value * .68 + (values[index - 1] ?? value) * .16 + (values[index + 1] ?? value) * .16))),
      pulse: Math.max(0, Math.min(1, weightTotal > 0 ? channelRms / weightTotal * 6.4 : interpolatedRms * 6.4))
    };
  };
  const leftChannel = channelBands("left"); const rightChannel = channelBands("right");
  const leftWidth = left.stereoWidth ?? 0; const rightWidth = right.stereoWidth ?? leftWidth;
  const stereoWidth = Math.max(0, Math.min(1, leftWidth + (rightWidth - leftWidth) * mix));
  return { bands, leftBands: leftChannel.bands, rightBands: rightChannel.bands, pulse: Math.max(0, Math.min(1, pulse)), leftPulse: leftChannel.pulse, rightPulse: rightChannel.pulse, stereoWidth };
}
