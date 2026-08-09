#!/usr/bin/env python3
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from scipy.ndimage import minimum_filter1d

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "ai_music_detector.onnx"
MODEL_URL = "https://raw.githubusercontent.com/lofcz/ai-music-detector/6ba389e94a179ac90f3eb134b741ef37baa30434/src/models/ai_music_detector.onnx"


def ensure_model():
    if MODEL_PATH.exists():
        return
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    partial = MODEL_PATH.with_suffix(".onnx.partial")
    try:
        urllib.request.urlretrieve(MODEL_URL, partial)
        partial.replace(MODEL_PATH)
    finally:
        partial.unlink(missing_ok=True)


def load_audio(path):
    process = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
        "-acodec", "pcm_f32le", "-ar", "16000", "-ac", "1", "-"
    ], capture_output=True, check=True)
    audio = np.frombuffer(process.stdout, dtype=np.float32)
    return audio[:16000 * 300]


def fakeprint(audio):
    signal = torch.from_numpy(audio.copy()).unsqueeze(0)
    window = torch.hann_window(8192)
    spectrum = torch.stft(signal, n_fft=8192, hop_length=4096, win_length=8192,
                          window=window, center=True, return_complex=True).abs().pow(2)
    spectrum_db = 10 * torch.log10(torch.clamp(spectrum, min=1e-10, max=1e6))
    mean_spectrum = spectrum_db.mean(dim=(0, 2)).numpy()
    frequencies = np.linspace(0, 8000, 4097)
    selected = mean_spectrum[(frequencies >= 1000) & (frequencies <= 8000)]
    hull = minimum_filter1d(selected, size=10, mode="nearest")
    hull = np.clip(hull, -45, None)
    residue = np.clip(selected - hull, 0, 5)
    return (residue / (np.max(residue) + 1e-6)).astype(np.float32)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: detect_ai.py AUDIO")
    ensure_model()
    audio = load_audio(Path(sys.argv[1]))
    if len(audio) < 16000 * 10:
        raise SystemExit("servono almeno 10 secondi di audio")
    features = fakeprint(audio).reshape(1, -1)
    session = ort.InferenceSession(str(MODEL_PATH))
    probability = float(session.run(None, {session.get_inputs()[0].name: features})[0][0, 0])
    probability = max(0.0, min(1.0, probability))
    print(json.dumps({
        "aiProbability": round(probability * 100, 2),
        "confidence": round(abs(probability - .5) * 200, 2),
        "classification": "AI probabile" if probability >= .5 else "AI non rilevata",
        "model": "AI Music Detector v1 · fakeprint ONNX",
        "scope": "Suno ≤5 / Udio ≤1.5",
        "disclaimer": "Stima probabilistica, non prova di provenienza o percentuale materiale.",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
