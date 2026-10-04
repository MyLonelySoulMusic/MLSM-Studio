#!/usr/bin/env python3
import json
import math
import os
import statistics
import sys
from pathlib import Path

import numpy as np
from beat_this.inference import Audio2Frames, load_audio
from beat_this.model.postprocessor import Postprocessor


def robust_median(values):
    values = [float(v) for v in values if math.isfinite(float(v)) and float(v) > 0]
    if not values:
        return 0.0
    median = statistics.median(values)
    kept = [v for v in values if median * 0.65 <= v <= median * 1.45]
    return statistics.median(kept or values)


def percentile(values, p):
    return float(np.percentile(np.asarray(values, dtype=float), p)) if values else 0.0


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: analyze.py AUDIO_FILE")

    audio_path = Path(sys.argv[1]).resolve()
    checkpoint = os.environ.get("BEAT_THIS_MODEL", "final0")
    signal, sample_rate = load_audio(str(audio_path))
    engine = Audio2Frames(checkpoint_path=checkpoint, device="cpu", float16=False)
    beat_logits, downbeat_logits = engine(signal, sample_rate)
    beat_prob = torch_sigmoid(beat_logits)
    downbeat_prob = torch_sigmoid(downbeat_logits)
    beats, downbeats = Postprocessor(type="minimal")(beat_logits, downbeat_logits)
    beats = [round(float(v), 6) for v in beats]
    downbeats = [round(float(v), 6) for v in downbeats]

    beat_intervals = np.diff(beats).tolist()
    bar_intervals = np.diff(downbeats).tolist()
    beat_period = robust_median(beat_intervals)
    bar_period = robust_median(bar_intervals)
    bpm_from_beats = 60.0 / beat_period if beat_period else 0.0
    # Keep the original estimate. The shared rhythm validator resolves meter
    # and builds compatible beat positions instead of counting all peaks alike.
    bpm_from_bars = 240.0 / bar_period if bar_period else 0.0
    bpm = bpm_from_bars if 55 <= bpm_from_bars <= 190 else bpm_from_beats

    normal_beats = [v for v in beat_intervals if beat_period * .72 <= v <= beat_period * 1.28]
    interval_mad = statistics.median(
        [abs(v - beat_period) for v in normal_beats]
    ) if normal_beats else beat_period
    regularity = max(0.0, 1.0 - interval_mad / max(beat_period * .12, 1e-6))
    coverage = min(1.0, len(beats) * beat_period / max(len(signal) / sample_rate, 1))
    downbeat_consistency = min(1.0, len(downbeats) * 4 / max(len(beats), 1))
    peak_strength = min(1.0, float(np.mean(np.sort(beat_prob)[-max(1, len(beats)):])) * 1.5)
    confidence = round(100 * (
        regularity * .38 + coverage * .20 + downbeat_consistency * .22 + peak_strength * .20
    ))

    result = {
        "engine": "Beat This! final0",
        "beats": beats,
        "downbeats": downbeats,
        "detectedBpm": round(bpm, 2),
        "confidence": max(0, min(100, confidence)),
        "meter": 4,
        "stats": {
            "beatCount": len(beats),
            "downbeatCount": len(downbeats),
            "medianBeatInterval": round(beat_period, 6),
            "medianBarInterval": round(bar_period, 6),
            "barIntervalP05": round(percentile(bar_intervals, 5), 6),
            "barIntervalP95": round(percentile(bar_intervals, 95), 6),
            "activationMean": round(float(np.mean(beat_prob)), 6),
            "activationPeakMean": round(peak_strength, 6),
        },
    }
    print(json.dumps(result, separators=(",", ":")))


def torch_sigmoid(value):
    return (1.0 / (1.0 + np.exp(-value.detach().cpu().numpy()))).astype(float)


if __name__ == "__main__":
    main()
