#!/usr/bin/env python3
"""One-shot JSONL protocol v1 worker for Song Player jobs."""

from __future__ import annotations

import json
import os
import re
import signal
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from audio_analysis import (
    AnalysisError,
    MAX_DURATION_SECONDS,
    MAX_INPUT_BYTES,
    analyze_file,
    match_files,
    probe_media,
    resolve_tool,
    ProcessCancelled,
    sha256_file,
    clear_cancellation,
    cancellation_requested,
    request_cancellation,
    run_process,
)

PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 64 * 1024
MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024 * 1024
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
ALLOWED_REQUEST_KEYS = {
    "capabilities": {"protocolVersion", "action"},
    "download": {"protocolVersion", "action", "youtubeUrl", "jobRoot", "libraryRoot"},
    "analyze": {"protocolVersion", "action", "inputPath", "jobRoot"},
    "match": {"protocolVersion", "action", "referencePath", "targetPath", "jobRoot"},
    "separateVocals": {"protocolVersion", "action", "inputPath", "jobRoot"},
}

MAJOR_KEY_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
MINOR_KEY_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)


def remove_coverage_namespace_shadows(paths: list[str]) -> list[str]:
    """Prevent an HTML ``coverage/`` report from shadowing Python coverage.

    Numba optionally imports the Python coverage package.  A repository-level
    Vitest report is a namespace package with the same name and used to make
    librosa/pYIN crash even though every dependency was installed correctly.
    """
    clean = []
    for value in paths:
        candidate = Path(value or os.getcwd()) / "coverage"
        if candidate.is_dir() and not (candidate / "__init__.py").is_file():
            continue
        clean.append(value)
    return clean


def prepare_librosa_import() -> None:
    sys.path[:] = remove_coverage_namespace_shadows(list(sys.path))
    shadow = sys.modules.get("coverage")
    if shadow is not None and getattr(shadow, "__file__", None) is None:
        sys.modules.pop("coverage", None)


def estimate_key_from_chroma(chroma_values: list[float]) -> dict[str, Any]:
    """Krumhansl-Schmuckler key estimate over a real harmonic chromagram."""
    if len(chroma_values) != 12 or not any(value > 0 for value in chroma_values):
        raise WorkerError("musical_analysis_failed", "Il cromagramma del brano non contiene energia armonica sufficiente")

    def correlation(profile: tuple[float, ...], root: int) -> float:
        observed = [float(value) for value in chroma_values]
        rotated = [profile[(note - root) % 12] for note in range(12)]
        observed_mean = sum(observed) / 12
        profile_mean = sum(rotated) / 12
        numerator = sum((value - observed_mean) * (expected - profile_mean) for value, expected in zip(observed, rotated))
        denominator = (
            sum((value - observed_mean) ** 2 for value in observed)
            * sum((expected - profile_mean) ** 2 for expected in rotated)
        ) ** 0.5
        return numerator / denominator if denominator > 1e-12 else -1.0

    candidates = []
    for root in range(12):
        candidates.append((correlation(MAJOR_KEY_PROFILE, root), root, "major"))
        candidates.append((correlation(MINOR_KEY_PROFILE, root), root, "minor"))
    candidates.sort(reverse=True)
    best, second = candidates[0], candidates[1]
    margin = max(0.0, best[0] - second[0])
    confidence = max(0.0, min(1.0, (best[0] + 1.0) * 0.35 + margin * 1.5))
    return {"keyRoot": best[1], "keyMode": best[2], "keyConfidence": round(confidence, 4)}


def analyze_musical_context(source: Path, librosa: Any, np: Any) -> dict[str, Any]:
    samples, sample_rate = librosa.load(str(source), sr=22_050, mono=True)
    if not len(samples):
        raise WorkerError("musical_analysis_failed", "Il brano non contiene campioni audio")
    onset = librosa.onset.onset_strength(y=samples, sr=sample_rate)
    tempo, _beats = librosa.beat.beat_track(onset_envelope=onset, sr=sample_rate)
    tempo_values = np.asarray(tempo).reshape(-1)
    bpm = float(tempo_values[0]) if tempo_values.size else 0.0
    if not np.isfinite(bpm) or bpm <= 0:
        raise WorkerError("musical_analysis_failed", "BPM non rilevabile dal brano")
    harmonic = librosa.effects.harmonic(samples)
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sample_rate)
    chroma_mean = np.asarray(chroma, dtype=float).mean(axis=1)
    key = estimate_key_from_chroma([float(value) for value in chroma_mean])
    return {"bpm": round(bpm, 3), **key}


def optional_musical_context(source: Path, librosa: Any, np: Any) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return analyze_musical_context(source, librosa, np), None
    except Exception as error:  # metadata failure must not discard the separated vocal stem
        return None, str(error)[:512] or type(error).__name__


class WorkerError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def emit(message_type: str, **payload: Any) -> None:
    message = {"protocolVersion": PROTOCOL_VERSION, "type": message_type, **payload}
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def progress(value: float, message: str) -> None:
    emit("progress", progress=max(0.0, min(1.0, float(value))), message=message[:512])


def validate_youtube_url(url: Any) -> tuple[str, str]:
    if not isinstance(url, str) or len(url) > 2_048:
        raise WorkerError("invalid_youtube_url", "URL YouTube non valido")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment:
        raise WorkerError("invalid_youtube_url", "E richiesto un URL YouTube HTTPS diretto")
    host = (parsed.hostname or "").lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError as error:
        raise WorkerError("invalid_youtube_url", "La porta dell'URL non e valida") from error
    if port not in (None, 443):
        raise WorkerError("invalid_youtube_url", "La porta dell'URL non e consentita")
    query = parse_qs(parsed.query, keep_blank_values=True)
    forbidden = {"list", "playlist", "start_radio", "live"}
    if forbidden.intersection(query):
        raise WorkerError("playlist_not_allowed", "Playlist, radio e live non sono supportati")
    if host == "youtu.be":
        if parsed.query and set(query) - {"t", "si"}:
            raise WorkerError("invalid_youtube_url", "L'URL contiene parametri non consentiti")
        parts = [part for part in parsed.path.split("/") if part]
        video_id = parts[0] if len(parts) == 1 else ""
    elif host in YOUTUBE_HOSTS:
        if set(query) - {"v", "t", "start", "si"}:
            raise WorkerError("invalid_youtube_url", "L'URL contiene parametri non consentiti")
        parts = [part for part in parsed.path.split("/") if part]
        if parsed.path == "/watch" and len(query.get("v", [])) == 1:
            video_id = query["v"][0]
        elif len(parts) == 2 and parts[0] == "shorts" and not query.get("v"):
            video_id = parts[1]
        else:
            video_id = ""
    else:
        raise WorkerError("invalid_youtube_host", "Host YouTube non consentito")
    if not VIDEO_ID.fullmatch(video_id):
        raise WorkerError("invalid_video_id", "L'URL non contiene un video ID valido")
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    return canonical, video_id


def _validate_root(path_value: Any, label: str) -> Path:
    if not isinstance(path_value, str):
        raise WorkerError("invalid_worker_root", f"{label} non valida")
    path = Path(path_value)
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise WorkerError("invalid_worker_root", f"{label} non valida")
    return path.resolve(strict=True)


def _confined_child(root: Path, name: str) -> Path:
    candidate = root / name
    candidate.mkdir(parents=False, exist_ok=True)
    resolved = candidate.resolve(strict=True)
    if resolved.parent != root:
        raise WorkerError("invalid_worker_root", "Directory di staging non confinata")
    return resolved


def _cleanup_staging(request: dict[str, Any]) -> None:
    """Best-effort cleanup, but only for the verified direct staging child."""
    try:
        job_root = _validate_root(request.get("jobRoot"), "Job root")
        staging_path = job_root / "staging"
        if staging_path.is_symlink() or not staging_path.exists():
            return
        staging = staging_path.resolve(strict=True)
        if staging.parent == job_root and staging.name == "staging":
            shutil.rmtree(staging)
    except (OSError, WorkerError):
        return


def _load_yt_dlp():
    try:
        import yt_dlp
    except ImportError as error:
        raise WorkerError("yt_dlp_unavailable", "yt-dlp non e installato") from error
    return yt_dlp


class _QuietYdlLogger:
    def debug(self, message: str) -> None:
        return None

    def warning(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


def _handle_signal(_signum: int, _frame: Any) -> None:
    # Keep this handler tiny: the audio-analysis registry terminates every
    # currently tracked ffmpeg/ffprobe child before the worker exits through
    # its normal JSONL error path.
    request_cancellation()


def _install_signal_handlers() -> None:
    for signum in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if signum is not None:
            signal.signal(signum, _handle_signal)


def _run_ffmpeg(source: Path, destination: Path) -> None:
    command = [
        resolve_tool("ffmpeg"),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        str(destination),
    ]
    try:
        completed = run_process(command, timeout=MAX_DURATION_SECONDS * 2)
    except ProcessCancelled as error:
        raise WorkerError("cancelled", str(error)) from error
    except subprocess.TimeoutExpired as error:
        raise WorkerError("transcode_timeout", "FFmpeg ha superato il limite di tempo") from error
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", "replace")[-2_000:].strip()
        raise WorkerError("transcode_failed", message or "FFmpeg non ha convertito l'audio")


def download(request: dict[str, Any]) -> dict[str, Any]:
    canonical_url, video_id = validate_youtube_url(request.get("youtubeUrl"))
    job_root = _validate_root(request.get("jobRoot"), "Job root")
    library_root = _validate_root(request.get("libraryRoot"), "Library root")
    staging = _confined_child(job_root, "staging")
    progress(0.04, "URL YouTube verificato")

    def download_progress(data: dict[str, Any]) -> None:
        status = data.get("status")
        if status == "downloading":
            total = data.get("total_bytes") or data.get("total_bytes_estimate")
            downloaded = data.get("downloaded_bytes") or 0
            fraction = float(downloaded) / float(total) if total else 0.0
            progress(0.08 + 0.57 * max(0.0, min(1.0, fraction)), "Download audio")
        elif status == "finished":
            progress(0.68, "Download completato")

    def reject_unsupported(info: dict[str, Any], _incomplete: bool = False) -> str | None:
        if info.get("_type") in {"playlist", "multi_video"} or info.get("entries") is not None:
            return "Playlist e risorse multi-video non sono supportate"
        if info.get("is_live") or info.get("live_status") not in (None, "not_live"):
            return "Le dirette e le premiere non sono supportate"
        return None

    yt_dlp = _load_yt_dlp()
    options = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "max_filesize": MAX_DOWNLOAD_BYTES,
        "outtmpl": str(staging / "source.%(ext)s"),
        "restrictfilenames": True,
        "quiet": True,
        "no_warnings": True,
        "logger": _QuietYdlLogger(),
        "progress_hooks": [download_progress],
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "match_filter": reject_unsupported,
    }
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(canonical_url, download=True)
            if cancellation_requested():
                raise ProcessCancelled()
            if not isinstance(info, dict):
                raise WorkerError("download_failed", "yt-dlp non ha restituito metadati")
            if info.get("_type") in {"playlist", "multi_video"} or info.get("entries") is not None:
                raise WorkerError("playlist_not_allowed", "La risorsa e una playlist")
            if info.get("is_live") or info.get("live_status") not in (None, "not_live"):
                raise WorkerError("live_not_allowed", "Le dirette non sono supportate")
            if info.get("id") != video_id:
                raise WorkerError("video_id_mismatch", "Il video risolto non corrisponde all'URL")
            extractor = str(info.get("extractor_key") or info.get("extractor") or "").lower()
            if "youtube" not in extractor:
                raise WorkerError("invalid_extractor", "La risorsa non e stata risolta da YouTube")
            source_value = downloader.prepare_filename(info)
            provider_title = info.get("title")
    except ProcessCancelled as error:
        raise WorkerError("cancelled", str(error)) from error
    except WorkerError:
        raise
    except Exception as error:
        raise WorkerError("download_failed", str(error)[:1_000]) from error

    source_path = Path(source_value)
    if source_path.is_symlink():
        raise WorkerError("unsafe_download_path", "yt-dlp ha prodotto un link simbolico")
    source = source_path.resolve(strict=True)
    if source.parent != staging or not source.is_file():
        raise WorkerError("unsafe_download_path", "yt-dlp ha prodotto un percorso non confinato")
    if source.stat().st_size > MAX_DOWNLOAD_BYTES:
        raise WorkerError("download_too_large", "Il download supera il limite di 512 MiB")
    source_probe = probe_media(source)
    progress(0.74, "Conversione audio PCM")
    converted = staging / "output.wav"
    _run_ffmpeg(source, converted)
    if not converted.is_file() or converted.stat().st_size > MAX_OUTPUT_BYTES:
        raise WorkerError("output_too_large", "L'audio convertito supera il limite di 1 GiB")
    digest = sha256_file(converted)
    final = library_root / f"youtube-{video_id}-{digest[:12]}.wav"
    if final.exists():
        if final.is_symlink() or final.resolve().parent != library_root:
            raise WorkerError("unsafe_output_path", "Destinazione audio non valida")
        if sha256_file(final) != digest:
            raise WorkerError("output_collision", "La destinazione esistente non corrisponde all'hash")
        converted.unlink()
    else:
        os.replace(converted, final)
    final = final.resolve(strict=True)
    if final.parent != library_root:
        raise WorkerError("unsafe_output_path", "Destinazione audio non confinata")
    metadata = probe_media(final)
    progress(0.96, "Verifica hash e metadati")
    result = {
        "kind": "download",
        "path": str(final),
        "fileName": final.name,
        "youtubeUrl": canonical_url,
        "videoId": video_id,
        "hash": digest,
        "source": source_probe,
        **metadata,
    }
    if isinstance(provider_title, str) and provider_title.strip():
        result["title"] = provider_title.strip()[:512]
    return result


def capabilities() -> dict[str, Any]:
    try:
        import numpy as np
        numpy_version = np.__version__
    except ImportError:
        numpy_version = None
    try:
        yt_dlp = _load_yt_dlp()
        yt_dlp_version = getattr(getattr(yt_dlp, "version", None), "__version__", "installed")
    except WorkerError:
        yt_dlp_version = None
    ffmpeg = shutil.which("ffmpeg") is not None
    ffprobe = shutil.which("ffprobe") is not None
    try:
        import demucs  # noqa: F401
        demucs_ready = True
    except ImportError:
        demucs_ready = False
    try:
        prepare_librosa_import()
        import librosa  # noqa: F401
        # Access the lazy symbols used by the real pipeline. A plain
        # ``import librosa`` is insufficient and previously reported ready even
        # when numba could not be imported.
        _ = librosa.load
        _ = librosa.pyin
        librosa_ready = True
    except Exception:
        librosa_ready = False
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ready": bool(numpy_version and yt_dlp_version and ffmpeg and ffprobe),
        "pythonVersion": ".".join(str(value) for value in sys.version_info[:3]),
        "dependencies": {
            "numpy": numpy_version,
            "ytDlp": yt_dlp_version,
            "ffmpeg": ffmpeg,
            "ffprobe": ffprobe,
            "demucs": demucs_ready,
            "librosa": librosa_ready,
        },
        "features": {
            "download": bool(yt_dlp_version and ffmpeg and ffprobe),
            "analyze": bool(numpy_version and ffmpeg and ffprobe),
            "match": bool(numpy_version and ffmpeg and ffprobe),
            "separateVocals": bool(demucs_ready and librosa_ready and ffmpeg and ffprobe),
        },
        "limits": {
            "maxInputBytes": MAX_INPUT_BYTES,
            "maxDownloadBytes": MAX_DOWNLOAD_BYTES,
            "maxDurationSeconds": MAX_DURATION_SECONDS,
            "spectrogramRows": 96,
            "spectrogramMaxColumns": 2_048,
        },
    }


def separate_vocals(request: dict[str, Any]) -> dict[str, Any]:
    """Real two-stem separation followed by monophonic pitch extraction.

    Instrumental energy never reaches the returned pitch track: pYIN runs only
    on Demucs' `vocals.wav` output.  Unvoiced frames are omitted deliberately.
    """
    job_root = _validate_root(request.get("jobRoot"), "Job root")
    input_value = request.get("inputPath")
    if not isinstance(input_value, str):
        raise WorkerError("invalid_input", "Percorso del brano non valido")
    source = Path(input_value)
    if not source.is_absolute() or source.is_symlink() or not source.is_file():
        raise WorkerError("invalid_input", "Il brano deve essere un file locale valido")
    source = source.resolve(strict=True)
    if source.stat().st_size > MAX_INPUT_BYTES:
        raise WorkerError("input_too_large", "Il brano supera il limite consentito")
    staging = _confined_child(job_root, "staging")
    output_root = staging / "demucs"
    output_root.mkdir(parents=False, exist_ok=False)
    progress(0.04, "Caricamento modello Demucs htdemucs")
    command = [sys.executable, "-m", "demucs.separate", "--two-stems", "vocals", "-n", "htdemucs", "--out", str(output_root), str(source)]
    try:
        completed = run_process(command, timeout=MAX_DURATION_SECONDS * 4)
    except ProcessCancelled as error:
        raise WorkerError("cancelled", str(error)) from error
    except subprocess.TimeoutExpired as error:
        raise WorkerError("separation_timeout", "Demucs ha superato il tempo massimo") from error
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", "replace")[-2_000:].strip()
        raise WorkerError("separation_failed", message or "Demucs non ha separato la voce")
    candidates = list(output_root.glob("*/**/vocals.wav"))
    if len(candidates) != 1:
        raise WorkerError("missing_vocal_stem", "Demucs non ha prodotto uno stem vocale univoco")
    candidate = candidates[0].resolve(strict=True)
    if output_root.resolve(strict=True) not in candidate.parents or candidate.is_symlink():
        raise WorkerError("unsafe_vocal_stem", "Percorso dello stem vocale non valido")
    vocal_path = job_root / "vocals.wav"
    shutil.copyfile(candidate, vocal_path)
    vocal_path = vocal_path.resolve(strict=True)
    if vocal_path.parent != job_root or vocal_path.stat().st_size > MAX_OUTPUT_BYTES:
        raise WorkerError("invalid_vocal_stem", "Stem vocale non valido")
    progress(0.82, "Estrazione pitch pYIN dallo stem vocale")
    prepare_librosa_import()
    import librosa
    import numpy as np
    samples, sample_rate = librosa.load(str(vocal_path), sr=22_050, mono=True)
    f0, voiced, probability = librosa.pyin(samples, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"), sr=sample_rate, frame_length=2_048, hop_length=1_024)
    times = librosa.times_like(f0, sr=sample_rate, hop_length=1_024)
    pitch = []
    for time_value, frequency, is_voiced, confidence in zip(times, f0, voiced, probability):
        confidence_value = float(confidence) if confidence is not None else 0.0
        if not bool(is_voiced) or not np.isfinite(frequency) or not np.isfinite(confidence_value) or confidence_value < 0.45:
            continue
        time_number = float(time_value)
        midi_number = float(librosa.hz_to_midi(frequency))
        # Keep the native pYIN cadence.  The UI turns these frames into stable
        # note segments with median filtering and hysteresis; dropping repeated
        # notes here used to erase onsets/releases and made the piano lag.
        pitch.append([round(time_number, 4), round(midi_number, 3), round(confidence_value, 4)])
        if len(pitch) >= 30_000:
            break
    progress(0.91, "Analisi armonica e tempo dal mix completo")
    musical_analysis, musical_analysis_error = optional_musical_context(source, librosa, np)
    progress(0.96, "Stem vocale verificato")
    return {"kind": "separateVocals", "path": str(vocal_path), "model": "htdemucs", "pitchAlgorithm": "pyin", "sampleRate": int(sample_rate), "pitch": pitch, "musicalAnalysis": musical_analysis, "musicalAnalysisError": musical_analysis_error}


def validate_request(request: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(request, dict):
        raise WorkerError("invalid_request", "La richiesta deve essere un oggetto JSON")
    if request.get("protocolVersion") != PROTOCOL_VERSION:
        raise WorkerError("unsupported_protocol", "Versione protocollo non supportata")
    action = request.get("action")
    if action not in ALLOWED_REQUEST_KEYS:
        raise WorkerError("invalid_action", "Azione Song Player non supportata")
    unknown = set(request) - ALLOWED_REQUEST_KEYS[action]
    if unknown:
        raise WorkerError("unknown_fields", f"Campi non consentiti: {', '.join(sorted(unknown))}")
    return action, request


def dispatch(request: Any) -> dict[str, Any]:
    action, request = validate_request(request)
    if action == "capabilities":
        return capabilities()
    if action == "download":
        try:
            return download(request)
        finally:
            _cleanup_staging(request)
    if action == "analyze":
        _validate_root(request.get("jobRoot"), "Job root")
        progress(0.05, "Verifica audio locale")
        _, result = analyze_file(request.get("inputPath"))
        progress(0.95, "Fingerprint e spettrogramma completati")
        return {"kind": "analyze", **result}
    if action == "match":
        _validate_root(request.get("jobRoot"), "Job root")
        progress(0.04, "Analisi audio di riferimento")
        result = match_files(request.get("referencePath"), request.get("targetPath"))
        progress(0.96, "Allineamento completato")
        return {"kind": "match", **result}
    if action == "separateVocals":
        try:
            return separate_vocals(request)
        finally:
            _cleanup_staging(request)
    raise AssertionError("unreachable")


def read_one_request() -> Any:
    raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
    if not raw or len(raw) > MAX_REQUEST_BYTES or not raw.endswith(b"\n"):
        raise WorkerError("invalid_request", "Richiesta JSONL assente o troppo grande")
    if sys.stdin.buffer.read(1):
        raise WorkerError("multiple_requests", "Il worker accetta una sola richiesta")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise WorkerError("invalid_json", "JSON non valido") from error


def main() -> int:
    clear_cancellation()
    _install_signal_handlers()
    try:
        result = dispatch(read_one_request())
        emit("result", result=result)
        return 0
    except (WorkerError, AnalysisError) as error:
        emit("error", error={"code": error.code, "message": str(error)[:2_000]})
        return 2
    except Exception as error:  # never leak a traceback through the protocol
        emit("error", error={"code": "internal_error", "message": str(error)[:2_000]})
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
