"""Deterministic, local audio analysis helpers for the Song Player worker.

The module deliberately keeps ffmpeg invocation and numerical processing separate so
the matching algorithm can be tested with synthetic arrays without network access.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import threading
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

SAMPLE_RATE = 11_025
FRAME_SIZE = 2_048
HOP_SIZE = 512
MAX_DURATION_SECONDS = 2 * 60 * 60
MAX_INPUT_BYTES = 1_024 * 1_024 * 1_024
MAX_SPECTROGRAM_COLUMNS = 2_048
SPECTROGRAM_ROWS = 96
SUPPORTED_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".mp4",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}


class AnalysisError(RuntimeError):
    """An expected validation, decoding, or analysis failure."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ProcessCancelled(AnalysisError):
    """Raised when the worker receives a termination request."""

    def __init__(self) -> None:
        super().__init__("cancelled", "Operazione Song Player annullata")


# Every ffmpeg/ffprobe process launched by this worker is registered here.  The
# Rust parent owns the process group as the primary cancellation mechanism; the
# registry is a second line of defence when a signal reaches Python directly.
_ACTIVE_PROCESSES: set[subprocess.Popen[bytes]] = set()
# An RLock keeps the signal handler safe if a signal arrives while the worker
# thread is briefly registering or removing a child process.
_PROCESS_LOCK = threading.RLock()
_CANCEL_REQUESTED = threading.Event()


def clear_cancellation() -> None:
    _CANCEL_REQUESTED.clear()


def cancellation_requested() -> bool:
    return _CANCEL_REQUESTED.is_set()


def _terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=0.5)
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()
        except OSError:
            return
        try:
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            return


def request_cancellation() -> None:
    _CANCEL_REQUESTED.set()
    with _PROCESS_LOCK:
        processes = tuple(_ACTIVE_PROCESSES)
    for process in processes:
        _terminate_process(process)


def run_process(command: list[str], *, timeout: float) -> subprocess.CompletedProcess[bytes]:
    """Run a bounded child while keeping it visible to the signal handler."""
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError:
        raise
    with _PROCESS_LOCK:
        _ACTIVE_PROCESSES.add(process)
    deadline = time.monotonic() + timeout
    try:
        while True:
            if cancellation_requested():
                _terminate_process(process)
                raise ProcessCancelled()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _terminate_process(process)
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                stdout, stderr = process.communicate(timeout=min(0.2, remaining))
                if cancellation_requested():
                    raise ProcessCancelled()
                return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
            except subprocess.TimeoutExpired:
                continue
    finally:
        with _PROCESS_LOCK:
            _ACTIVE_PROCESSES.discard(process)


def _numpy():
    try:
        import numpy as np
    except ImportError as error:  # pragma: no cover - exercised on minimal CI hosts
        raise AnalysisError(
            "numpy_unavailable",
            "NumPy non e disponibile nel runtime Song Player",
        ) from error
    return np


def resolve_tool(name: str) -> str:
    tool = shutil.which(name)
    if not tool:
        raise AnalysisError("missing_audio_tool", f"{name} non e disponibile")
    return tool


def validate_local_media(path_value: str) -> Path:
    if not isinstance(path_value, str) or not path_value:
        raise AnalysisError("invalid_path", "Il percorso audio e obbligatorio")
    path = Path(path_value)
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise AnalysisError("invalid_path", "Il file audio locale non e valido")
    resolved = path.resolve(strict=True)
    if resolved.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise AnalysisError("unsupported_media", "Il formato del file non e supportato")
    if resolved.stat().st_size > MAX_INPUT_BYTES:
        raise AnalysisError("media_too_large", "Il file supera il limite di 1 GiB")
    return resolved


def probe_media(path: Path) -> dict[str, Any]:
    command = [
        resolve_tool("ffprobe"),
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels:format=duration,size",
        "-of",
        "json",
        str(path),
    ]
    try:
        completed = run_process(command, timeout=30)
    except subprocess.TimeoutExpired as error:
        raise AnalysisError("probe_timeout", "FFprobe ha superato il limite di tempo") from error
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", "replace")[-2_000:].strip()
        raise AnalysisError("probe_failed", message or "FFprobe non ha trovato una traccia audio")
    try:
        payload = json.loads(completed.stdout)
        stream = payload["streams"][0]
        duration = float(payload["format"]["duration"])
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise AnalysisError("probe_failed", "Metadati audio incompleti") from error
    if not math.isfinite(duration) or duration <= 0:
        raise AnalysisError("invalid_duration", "La durata audio non e valida")
    if duration > MAX_DURATION_SECONDS:
        raise AnalysisError("media_too_long", "La durata supera il limite di 2 ore")
    return {
        "durationSeconds": duration,
        "sampleRate": int(stream.get("sample_rate") or 0),
        "channels": int(stream.get("channels") or 0),
        "codec": str(stream.get("codec_name") or "unknown"),
        "fileSize": path.stat().st_size,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode_mono(path: Path) -> tuple[Any, dict[str, Any]]:
    np = _numpy()
    metadata = probe_media(path)
    command = [
        resolve_tool("ffmpeg"),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "f32le",
        "pipe:1",
    ]
    try:
        completed = run_process(command, timeout=max(60, int(metadata["durationSeconds"] * 2)))
    except subprocess.TimeoutExpired as error:
        raise AnalysisError("decode_timeout", "FFmpeg ha superato il limite di tempo") from error
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", "replace")[-2_000:].strip()
        raise AnalysisError("decode_failed", message or "FFmpeg non ha decodificato l'audio")
    samples = np.frombuffer(completed.stdout, dtype="<f4").astype(np.float32, copy=False)
    if samples.size < FRAME_SIZE:
        raise AnalysisError("audio_too_short", "Servono almeno 186 ms di audio")
    if not np.isfinite(samples).all():
        raise AnalysisError("invalid_samples", "Il decoder ha prodotto campioni non validi")
    return samples, metadata


def _frames(samples: Any) -> Any:
    np = _numpy()
    frame_count = 1 + (samples.size - FRAME_SIZE) // HOP_SIZE
    shape = (frame_count, FRAME_SIZE)
    strides = (samples.strides[0] * HOP_SIZE, samples.strides[0])
    return np.lib.stride_tricks.as_strided(samples, shape=shape, strides=strides)


def stft_magnitudes(samples: Any) -> Any:
    """Compute STFT magnitudes in bounded batches."""
    np = _numpy()
    framed = _frames(samples)
    window = np.hanning(FRAME_SIZE).astype(np.float32)
    result = np.empty((framed.shape[0], FRAME_SIZE // 2 + 1), dtype=np.float32)
    for start in range(0, framed.shape[0], 256):
        block = framed[start : start + 256] * window
        result[start : start + block.shape[0]] = np.abs(np.fft.rfft(block, axis=1))
    return result


def chroma_from_magnitudes(magnitudes: Any) -> Any:
    np = _numpy()
    frequencies = np.fft.rfftfreq(FRAME_SIZE, 1.0 / SAMPLE_RATE)
    valid = frequencies >= 55.0
    midi = np.rint(69.0 + 12.0 * np.log2(frequencies[valid] / 440.0)).astype(np.int32)
    pitch_classes = np.mod(midi, 12)
    chroma = np.zeros((magnitudes.shape[0], 12), dtype=np.float32)
    weighted = np.log1p(magnitudes[:, valid])
    for pitch_class in range(12):
        mask = pitch_classes == pitch_class
        if mask.any():
            chroma[:, pitch_class] = weighted[:, mask].sum(axis=1)
    norms = np.linalg.norm(chroma, axis=1, keepdims=True)
    chroma /= np.maximum(norms, 1e-8)
    return chroma


def make_spectrogram(magnitudes: Any) -> dict[str, Any]:
    np = _numpy()
    logged = np.log1p(magnitudes).T
    source_rows = logged.shape[0]
    row_edges = np.linspace(0, source_rows, SPECTROGRAM_ROWS + 1, dtype=np.int32)
    bands = np.empty((SPECTROGRAM_ROWS, logged.shape[1]), dtype=np.float32)
    for row in range(SPECTROGRAM_ROWS):
        start, end = int(row_edges[row]), max(int(row_edges[row + 1]), int(row_edges[row]) + 1)
        bands[row] = logged[start:end].mean(axis=0)
    return _quantize_spectrogram_bands(bands)


def _quantize_spectrogram_bands(bands: Any) -> dict[str, Any]:
    np = _numpy()
    if bands.shape[1] > MAX_SPECTROGRAM_COLUMNS:
        edges = np.linspace(0, bands.shape[1], MAX_SPECTROGRAM_COLUMNS + 1, dtype=np.int32)
        reduced = np.empty((SPECTROGRAM_ROWS, MAX_SPECTROGRAM_COLUMNS), dtype=np.float32)
        for column in range(MAX_SPECTROGRAM_COLUMNS):
            start, end = int(edges[column]), max(int(edges[column + 1]), int(edges[column]) + 1)
            reduced[:, column] = bands[:, start:end].max(axis=1)
        bands = reduced
    low, high = np.percentile(bands, [5.0, 99.5])
    scale = max(float(high - low), 1e-8)
    quantized = np.clip((bands - low) * (255.0 / scale), 0, 255).astype(np.uint8)
    raw = quantized.tobytes(order="C")
    # 96 x 2048 is capped at 192 KiB before base64 expansion.
    if len(raw) > SPECTROGRAM_ROWS * MAX_SPECTROGRAM_COLUMNS:
        raise AnalysisError("spectrogram_too_large", "Spettrogramma oltre il limite interno")
    return {
        "encoding": "base64-uint8",
        "rows": int(quantized.shape[0]),
        "columns": int(quantized.shape[1]),
        "data": base64.b64encode(raw).decode("ascii"),
    }


def make_fingerprint(chroma: Any) -> dict[str, Any]:
    np = _numpy()
    if chroma.shape[0] > 512:
        indices = np.linspace(0, chroma.shape[0] - 1, 512, dtype=np.int32)
        sampled = chroma[indices]
    else:
        sampled = chroma
    primary = np.argmax(sampled, axis=1).astype(np.uint8)
    secondary = np.argsort(sampled, axis=1)[:, -2].astype(np.uint8)
    strength = np.clip(np.max(sampled, axis=1) * 15, 0, 15).astype(np.uint8)
    packed = ((primary << 4) | secondary).tobytes() + strength.tobytes()
    hashes = [f"{int(a):x}{int(b):x}{int(s):x}" for a, b, s in zip(primary, secondary, strength)]
    return {
        "algorithm": "mlsm-chroma-v1",
        "digest": hashlib.sha256(packed).hexdigest(),
        "frameCount": int(chroma.shape[0]),
        "hashes": hashes,
    }


def analyze_samples(samples: Any) -> tuple[Any, dict[str, Any]]:
    np = _numpy()
    framed = _frames(samples)
    window = np.hanning(FRAME_SIZE).astype(np.float32)
    chroma = np.empty((framed.shape[0], 12), dtype=np.float32)
    spectrogram_columns = min(framed.shape[0], MAX_SPECTROGRAM_COLUMNS)
    spectrogram_bands = np.zeros((SPECTROGRAM_ROWS, spectrogram_columns), dtype=np.float32)
    source_rows = FRAME_SIZE // 2 + 1
    row_edges = np.linspace(0, source_rows, SPECTROGRAM_ROWS + 1, dtype=np.int32)
    for start in range(0, framed.shape[0], 256):
        block = framed[start : start + 256] * window
        magnitudes = np.abs(np.fft.rfft(block, axis=1)).astype(np.float32)
        chroma[start : start + block.shape[0]] = chroma_from_magnitudes(magnitudes)
        logged = np.log1p(magnitudes)
        frame_indices = np.arange(start, start + block.shape[0], dtype=np.int64)
        column_indices = np.minimum(
            frame_indices * spectrogram_columns // framed.shape[0],
            spectrogram_columns - 1,
        )
        for row in range(SPECTROGRAM_ROWS):
            row_start = int(row_edges[row])
            row_end = max(int(row_edges[row + 1]), row_start + 1)
            row_values = logged[:, row_start:row_end].mean(axis=1)
            np.maximum.at(spectrogram_bands[row], column_indices, row_values)
    return chroma, {
        "fingerprint": make_fingerprint(chroma),
        "spectrogram": _quantize_spectrogram_bands(spectrogram_bands),
    }


def analyze_file(path_value: str) -> tuple[Any, dict[str, Any]]:
    path = validate_local_media(path_value)
    samples, metadata = decode_mono(path)
    chroma, analysis = analyze_samples(samples)
    result = {
        "path": str(path),
        "hash": sha256_file(path),
        **metadata,
        "analysisSampleRate": SAMPLE_RATE,
        "frameHopSeconds": HOP_SIZE / SAMPLE_RATE,
        **analysis,
    }
    return chroma, result


def _downsample_chroma(chroma: Any, factor: int = 4) -> Any:
    np = _numpy()
    usable = chroma.shape[0] // factor * factor
    if usable < factor:
        return chroma
    reduced = chroma[:usable].reshape(-1, factor, 12).mean(axis=1)
    norms = np.linalg.norm(reduced, axis=1, keepdims=True)
    return reduced / np.maximum(norms, 1e-8)


def candidate_offsets(reference: Any, target: Any, count: int = 5) -> list[tuple[int, float]]:
    """Return non-overlapping coarse offsets using normalized FFT correlation."""
    np = _numpy()
    if reference.ndim != 2 or target.ndim != 2 or reference.shape[1] != 12 or target.shape[1] != 12:
        raise AnalysisError("invalid_chroma", "Le feature chroma non sono valide")
    if target.shape[0] > reference.shape[0]:
        return []
    convolution_size = reference.shape[0] + target.shape[0] - 1
    fft_size = 1 << (convolution_size - 1).bit_length()
    correlation = np.zeros(fft_size, dtype=np.float64)
    for pitch_class in range(12):
        left = np.fft.rfft(reference[:, pitch_class], fft_size)
        right = np.fft.rfft(target[::-1, pitch_class], fft_size)
        correlation += np.fft.irfft(left * right, fft_size)
    values = correlation[target.shape[0] - 1 : reference.shape[0]]
    frame_energy = np.sum(reference * reference, axis=1, dtype=np.float64)
    cumulative_energy = np.concatenate((np.zeros(1, dtype=np.float64), np.cumsum(frame_energy)))
    window_energy = cumulative_energy[target.shape[0] :] - cumulative_energy[: -target.shape[0]]
    target_energy = float(np.sum(target * target))
    scores = values / np.sqrt(np.maximum(window_energy * target_energy, 1e-12))
    exclusion = max(1, target.shape[0] // 4)
    candidates: list[tuple[int, float]] = []
    mutable = scores.copy()
    for _ in range(min(count, mutable.size)):
        index = int(np.argmax(mutable))
        score = float(mutable[index])
        if not math.isfinite(score):
            break
        candidates.append((index, max(-1.0, min(1.0, score))))
        mutable[max(0, index - exclusion) : min(mutable.size, index + exclusion + 1)] = -np.inf
    return candidates


def _refine_candidate(reference: Any, target: Any, coarse_offset: int, factor: int = 4) -> tuple[int, float]:
    np = _numpy()
    center = coarse_offset * factor
    best_offset, best_score = center, -1.0
    for offset in range(max(0, center - factor * 2), min(reference.shape[0] - target.shape[0], center + factor * 2) + 1):
        window = reference[offset : offset + target.shape[0]]
        dots = np.sum(window * target, axis=1)
        denominator = np.linalg.norm(window, axis=1) * np.linalg.norm(target, axis=1)
        score = float(np.mean(dots / np.maximum(denominator, 1e-8)))
        if score > best_score:
            best_offset, best_score = offset, score
    return best_offset, max(-1.0, min(1.0, best_score))


def match_chroma(reference: Any, target: Any, candidate_count: int = 5) -> dict[str, Any]:
    """Match a target excerpt on the reference timeline.

    ``offsetSeconds`` means that target time zero corresponds to that time in the
    reference.  The reference is the full track and must not be shorter than the
    fragment; accepting inverted sequences would produce negative offsets that are
    not meaningful to the Song Player timeline.
    """
    np = _numpy()

    def centered(sequence: Any) -> Any:
        centered_sequence = sequence - np.mean(sequence, axis=1, keepdims=True)
        norms = np.linalg.norm(centered_sequence, axis=1, keepdims=True)
        return centered_sequence / np.maximum(norms, 1e-8)

    reference = centered(reference)
    target = centered(target)
    if target.shape[0] > reference.shape[0]:
        raise AnalysisError(
            "fragment_longer_than_reference",
            "La traccia completa deve avere una durata almeno pari al frammento",
        )
    coarse = candidate_offsets(
        _downsample_chroma(reference), _downsample_chroma(target), candidate_count
    )
    refined = [_refine_candidate(reference, target, offset) for offset, _ in coarse]
    refined.sort(key=lambda item: item[1], reverse=True)
    if not refined:
        raise AnalysisError("match_failed", "Audio insufficiente per il confronto")
    best_offset, best_similarity = refined[0]
    second_similarity = refined[1][1] if len(refined) > 1 else 0.0
    margin = max(0.0, best_similarity - second_similarity)
    confidence = max(0.0, min(1.0, 0.72 * best_similarity + 1.4 * margin - 0.18))
    if best_similarity < 0.48:
        status = "unrelated"
    elif margin < 0.045 or confidence < 0.55:
        status = "ambiguous"
    else:
        status = "matched"

    def timeline_offset(frame_offset: int) -> float:
        return frame_offset * HOP_SIZE / SAMPLE_RATE

    return {
        "offsetSeconds": timeline_offset(best_offset),
        "similarity": best_similarity,
        "confidence": confidence,
        "status": status,
        "needsManualReview": status != "matched",
        "candidates": [
            {
                "offsetSeconds": timeline_offset(offset),
                "similarity": similarity,
            }
            for offset, similarity in refined
        ],
        "method": {
            "algorithm": "mlsm-chroma-offset-v1",
            "candidateSearch": "normalized-fft-correlation",
            "refinement": "frame-cosine",
            "frameHopSeconds": HOP_SIZE / SAMPLE_RATE,
        },
    }


def match_files(reference_value: str, target_value: str) -> dict[str, Any]:
    reference_chroma, reference = analyze_file(reference_value)
    target_chroma, target = analyze_file(target_value)
    if target["durationSeconds"] > reference["durationSeconds"]:
        raise AnalysisError(
            "fragment_longer_than_reference",
            "La traccia completa deve avere una durata almeno pari al frammento",
        )
    match = match_chroma(reference_chroma, target_chroma)
    # Match does not need to duplicate two base64 spectrograms in its result.
    reference.pop("spectrogram", None)
    target.pop("spectrogram", None)
    return {"reference": reference, "target": target, **match}
