#!/usr/bin/env python3
"""One-shot JSONL protocol v1 worker for Song Player jobs."""

from __future__ import annotations

import json
import math
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
    "separateVocals": {"protocolVersion", "action", "inputPath", "jobRoot", "startSeconds", "endSeconds"},
    "extractAudio": {"protocolVersion", "action", "inputPath", "jobRoot"},
    "refineAlignment": {"protocolVersion", "action", "sourcePath", "targetPath", "anchors", "jobRoot"},
    "analyzeVisemes": {"protocolVersion", "action", "inputPath", "anchors", "language", "jobRoot"},
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


def _run_ffmpeg(source: Path, destination: Path, start_seconds: float | None = None, end_seconds: float | None = None) -> None:
    command = [
        resolve_tool("ffmpeg"),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
    ]
    if start_seconds is not None:
        command.extend(["-ss", f"{start_seconds:.6f}"])
    command.extend(["-i",
        str(source),
    ])
    if start_seconds is not None and end_seconds is not None:
        command.extend(["-t", f"{end_seconds - start_seconds:.6f}"])
    command.extend([
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        str(destination),
    ])
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
    try:
        from auto_avsr_runtime import visual_dependencies_ready
        auto_avsr_ready = visual_dependencies_ready()
    except Exception:
        auto_avsr_ready = False
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
            "autoAvsr": auto_avsr_ready,
        },
        "features": {
            "download": bool(yt_dlp_version and ffmpeg and ffprobe),
            "analyze": bool(numpy_version and ffmpeg and ffprobe),
            "match": bool(numpy_version and ffmpeg and ffprobe),
            "separateVocals": bool(demucs_ready and librosa_ready and ffmpeg and ffprobe),
            "extractAudio": bool(ffmpeg and ffprobe),
            "refineAlignment": bool(librosa_ready and ffmpeg and ffprobe),
            "analyzeVisemes": bool(auto_avsr_ready),
        },
        "limits": {
            "maxInputBytes": MAX_INPUT_BYTES,
            "maxDownloadBytes": MAX_DOWNLOAD_BYTES,
            "maxDurationSeconds": MAX_DURATION_SECONDS,
            "spectrogramRows": 96,
            "spectrogramMaxColumns": 2_048,
        },
    }


def analyze_visemes(request: dict[str, Any]) -> dict[str, Any]:
    job_root = _validate_root(request.get("jobRoot"), "Job root")
    input_value = request.get("inputPath")
    if not isinstance(input_value, str):
        raise WorkerError("invalid_input", "Percorso del video non valido")
    source = Path(input_value)
    if not source.is_absolute() or source.is_symlink() or not source.is_file():
        raise WorkerError("invalid_input", "Il video deve essere un file locale valido")
    source = source.resolve(strict=True)
    if source.stat().st_size > MAX_INPUT_BYTES:
        raise WorkerError("input_too_large", "Il video supera il limite consentito")
    language = request.get("language", "en")
    if not isinstance(language, str) or not language or len(language) > 16 or not re.fullmatch(r"[A-Za-z-]+", language):
        raise WorkerError("invalid_input", "Lingua Auto-AVSR non valida")
    anchors = request.get("anchors")
    if not isinstance(anchors, list) or not 1 <= len(anchors) <= 128:
        raise WorkerError("invalid_input", "Auto-AVSR richiede da 1 a 128 anchor")
    normalized = []
    seen_ids: set[str] = set()
    seen_indexes: set[int] = set()
    for item in anchors:
        if not isinstance(item, dict):
            raise WorkerError("invalid_input", "Anchor Auto-AVSR non valido")
        try:
            identifier = item["id"]
            text = item["text"]
            canonical_index = int(item["canonicalIndex"])
            cue_index = int(item["cueIndex"])
            source_start = float(item["sourceStart"])
            source_center = float(item["sourceCenter"])
            source_end = float(item["sourceEnd"])
            source_confidence = float(item["sourceConfidence"])
        except (KeyError, TypeError, ValueError) as error:
            raise WorkerError("invalid_input", "Campi anchor Auto-AVSR incompleti") from error
        if (
            not isinstance(identifier, str) or not identifier or len(identifier) > 200
            or identifier in seen_ids or not isinstance(text, str) or not text.strip() or len(text) > 120
            or canonical_index < 0 or canonical_index in seen_indexes or cue_index < 0
            or not all(math.isfinite(value) for value in (source_start, source_center, source_end, source_confidence))
            or not 0 <= source_confidence <= 1
            or source_start < 0 or source_start > source_center or source_center > source_end
        ):
            raise WorkerError("invalid_input", "Valori anchor Auto-AVSR non validi")
        seen_ids.add(identifier)
        seen_indexes.add(canonical_index)
        normalized.append({
            "id": identifier,
            "text": text.strip(),
            "canonicalIndex": canonical_index,
            "cueIndex": cue_index,
            "sourceStart": source_start,
            "sourceCenter": source_center,
            "sourceEnd": source_end,
            "sourceConfidence": source_confidence,
        })
    try:
        from auto_avsr_runtime import VisualSpeechError, analyze_visual_speech
        return analyze_visual_speech(source, normalized, language, job_root, progress, cancellation_requested)
    except VisualSpeechError as error:
        raise WorkerError("visual_speech_failed", str(error)) from error


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
    start_value = request.get("startSeconds")
    end_value = request.get("endSeconds")
    if (start_value is None) != (end_value is None):
        raise WorkerError("invalid_input", "startSeconds ed endSeconds devono essere indicati insieme")
    if start_value is not None:
        if isinstance(start_value, bool) or isinstance(end_value, bool) or not isinstance(start_value, (int, float)) or not isinstance(end_value, (int, float)):
            raise WorkerError("invalid_input", "Intervallo del master non valido")
        start_seconds = float(start_value)
        end_seconds = float(end_value)
        metadata = probe_media(source)
        if not math.isfinite(start_seconds) or not math.isfinite(end_seconds) or start_seconds < 0 or end_seconds <= start_seconds + 0.05 or end_seconds > float(metadata["durationSeconds"]) + 0.05:
            raise WorkerError("invalid_input", "Intervallo del master fuori dalla durata del file")
        window_source = staging / "master-window.wav"
        progress(0.02, f"Taglio master {start_seconds:.3f}–{end_seconds:.3f} s")
        _run_ffmpeg(source, window_source, start_seconds, min(end_seconds, float(metadata["durationSeconds"])))
        if not window_source.is_file() or window_source.stat().st_size <= 44:
            raise WorkerError("invalid_input", "FFmpeg non ha prodotto l’estratto del master")
        source = window_source.resolve(strict=True)
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


def extract_audio(request: dict[str, Any]) -> dict[str, Any]:
    """Extract the first audio stream without ever touching the source video."""
    job_root = _validate_root(request.get("jobRoot"), "Job root")
    input_value = request.get("inputPath")
    if not isinstance(input_value, str):
        raise WorkerError("invalid_input", "Percorso del video non valido")
    source = Path(input_value)
    if not source.is_absolute() or source.is_symlink() or not source.is_file():
        raise WorkerError("invalid_input", "Il video deve essere un file locale valido")
    source = source.resolve(strict=True)
    if source.stat().st_size > MAX_INPUT_BYTES:
        raise WorkerError("input_too_large", "Il video supera il limite consentito")
    destination = job_root / "source-audio.wav"
    progress(0.08, "Estrazione audio dal video originale")
    _run_ffmpeg(source, destination)
    destination = destination.resolve(strict=True)
    if destination.parent != job_root or destination.is_symlink() or destination.stat().st_size <= 44:
        raise WorkerError("invalid_extracted_audio", "FFmpeg non ha prodotto un audio valido")
    progress(0.96, "Audio sorgente verificato")
    return {"kind": "extractAudio", "path": str(destination), "codec": "pcm_s16le", "sampleRate": 44100, "channels": 2}


def _merge_activity_intervals(intervals: Any, sample_rate: int, minimum_duration: float = 0.12, maximum_gap: float = 0.65) -> list[tuple[float, float]]:
    """Turns noisy vocal-isolation islands into stable sung phrase windows."""
    stable = [(float(start) / sample_rate, float(end) / sample_rate) for start, end in intervals if (float(end) - float(start)) / sample_rate >= minimum_duration]
    merged: list[tuple[float, float]] = []
    for start, end in stable:
        if merged and start - merged[-1][1] <= maximum_gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _center_activity_groups(groups: list[tuple[float, float]], required: int) -> list[tuple[float, float]]:
    """AI clips may repeat the performance at both edges; retain the centre."""
    if required <= 0 or len(groups) <= required:
        return groups
    offset = (len(groups) - required) // 2
    return groups[offset:offset + required]


def _snap_to_acoustic_onset(candidate: float, onsets: list[float]) -> float:
    if not onsets:
        return candidate
    nearest = min(onsets, key=lambda onset: abs(onset - candidate))
    distance = abs(nearest - candidate)
    return nearest if 0.09 < distance <= 0.2 else candidate


def _delayed_target_cue_onsets(
    groups: list[tuple[float, float]],
    anchors: list[dict[str, Any]],
    minimum_delay: float = 0.12,
    maximum_delay: float = 1.5,
) -> dict[str, float]:
    """Find trustworthy late attacks in the isolated master vocal.

    Subtitle/Whisper timings may include the breath or instrumental lead-in of
    a phrase.  That is harmless for captions, but opening the video retime at
    that instant makes the lips visibly anticipate the master.  Only positive
    corrections are accepted here: an already-good phrase is never pulled
    earlier merely because Demucs retained a little pre-echo.
    """
    overrides: dict[str, float] = {}
    cue_order = list(dict.fromkeys(item["cueIndex"] for item in anchors))
    for cue_index in cue_order:
        cue = [item for item in anchors if item["cueIndex"] == cue_index]
        if not cue:
            continue
        first = cue[0]
        requested_start = min(item["targetStart"] for item in cue)
        requested_end = max(item["targetEnd"] for item in cue)
        candidates = []
        for start, end in groups:
            overlap = max(0.0, min(end, requested_end) - max(start, requested_start))
            if overlap >= 0.08:
                candidates.append((overlap, -abs(start - requested_start), start, end))
        if not candidates:
            continue
        _, _, onset, _ = max(candidates)
        delay = onset - requested_start
        latest = first["targetCenter"] - 0.02
        if minimum_delay <= delay <= maximum_delay and onset <= latest:
            overrides[first["id"]] = onset
    return overrides


def refine_alignment(request: dict[str, Any]) -> dict[str, Any]:
    """Refine lyric boundaries against isolated vocals.

    Reliable Whisper timestamps use a small local MFCC pass. Degenerate sung
    timestamps use the proven subtitle-constrained path instead: source phrase
    boundaries come from vocal activity, internal word starts use a globally
    monotone delta-MFCC path, and SRT/VTT remains the target clock. This avoids
    the unconstrained DTW collapse where a complete word was mapped to 90 ms.
    """
    _validate_root(request.get("jobRoot"), "Job root")
    source_value = request.get("sourcePath")
    target_value = request.get("targetPath")
    anchors = request.get("anchors")
    if not isinstance(source_value, str) or not isinstance(target_value, str):
        raise WorkerError("invalid_input", "Stem vocali non validi")
    source = Path(source_value)
    target = Path(target_value)
    if any(not path.is_absolute() or path.is_symlink() or not path.is_file() for path in (source, target)):
        raise WorkerError("invalid_input", "Gli stem vocali devono essere file locali validi")
    source = source.resolve(strict=True)
    target = target.resolve(strict=True)
    if not isinstance(anchors, list) or not anchors or len(anchors) > 128:
        raise WorkerError("invalid_anchors", "Servono da 1 a 128 anchor per batch")
    normalized_anchors = []
    for item in anchors:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise WorkerError("invalid_anchor", "Anchor non valido")
        try:
            cue_index = int(item["cueIndex"])
            values = {
                "sourceStart": float(item["sourceStart"]), "sourceCenter": float(item["sourceCenter"]), "sourceEnd": float(item["sourceEnd"]),
                "targetStart": float(item["targetStart"]), "targetCenter": float(item["targetCenter"]), "targetEnd": float(item["targetEnd"]),
                "maximumShift": min(30.0, max(0.0, float(item.get("maxShiftMs", 50.0)) / 1000.0)),
            }
        except (KeyError, TypeError, ValueError) as error:
            raise WorkerError("invalid_anchor", "Timestamp anchor non validi") from error
        if cue_index < 0 or not all(math.isfinite(value) for value in values.values()):
            raise WorkerError("invalid_anchor", "Timestamp anchor non finiti")
        if values["sourceStart"] > values["sourceCenter"] or values["sourceCenter"] > values["sourceEnd"] or values["targetStart"] > values["targetCenter"] or values["targetCenter"] > values["targetEnd"]:
            raise WorkerError("invalid_anchor", "Intervallo anchor non ordinato")
        normalized_anchors.append({"id": item["id"], "cueIndex": cue_index, **values})

    prepare_librosa_import()
    import librosa
    import numpy as np
    sample_rate = 16_000
    hop_length = 160
    progress(0.04, "Decodifica stem vocali per micro allineamento")
    source_samples, _ = librosa.load(str(source), sr=sample_rate, mono=True)
    target_samples, _ = librosa.load(str(target), sr=sample_rate, mono=True)
    global_alignment = None
    target_onset_overrides: dict[str, float] = {}
    requested_shifts = [item["maximumShift"] for item in normalized_anchors]
    if requested_shifts and max(requested_shifts) > 0.1:
        cue_order = list(dict.fromkeys(item["cueIndex"] for item in normalized_anchors))
        activity_groups: list[tuple[float, float]] = []
        for top_db in (35, 30, 25, 40):
            intervals = librosa.effects.split(source_samples, top_db=top_db, frame_length=1024, hop_length=hop_length)
            candidate_groups = _merge_activity_intervals(intervals, sample_rate)
            if len(candidate_groups) >= len(cue_order):
                activity_groups = _center_activity_groups(candidate_groups, len(cue_order))
                break
        if len(activity_groups) == len(cue_order):
            # Keep a two-hop pre-roll when the isolated vocal is active from
            # sample zero. A literal 0→0 phrase onset would be discarded by
            # the strictly monotone time map and would pull the first word
            # forward by almost one second in the The Fallen fixture.
            first_start, first_end = activity_groups[0]
            activity_groups[0] = (max(first_start, 2 * hop_length / sample_rate), first_end)
            source_window_start, source_window_end = activity_groups[0][0], activity_groups[-1][1]
        else:
            source_window_start, source_window_end = 0.0, len(source_samples) / sample_rate
            activity_groups = []
        target_window_start = max(0.0, min(item["targetStart"] for item in normalized_anchors))
        target_window_end = min(len(target_samples) / sample_rate, max(item["targetEnd"] for item in normalized_anchors))
        # Detect the real master-vocal attack independently from the source
        # DTW.  Start at a strict threshold and relax only when no useful late
        # onset is found; this rejects Demucs bleed before the sung phrase.
        for top_db in (20, 25, 30, 35):
            target_intervals = librosa.effects.split(target_samples, top_db=top_db, frame_length=1024, hop_length=hop_length)
            target_groups = _merge_activity_intervals(target_intervals, sample_rate)
            target_onset_overrides = _delayed_target_cue_onsets(target_groups, normalized_anchors)
            if target_onset_overrides:
                break
        source_slice = source_samples[int(source_window_start * sample_rate):int(source_window_end * sample_rate)]
        target_slice = target_samples[int(target_window_start * sample_rate):int(target_window_end * sample_rate)]
        if len(source_slice) >= 1024 and len(target_slice) >= 1024:
            progress(0.07, "Allineamento per frase vincolato da sottotitoli e attività vocale")
            source_mfcc = librosa.feature.mfcc(y=source_slice, sr=sample_rate, n_mfcc=13, n_fft=512, hop_length=hop_length)
            target_mfcc = librosa.feature.mfcc(y=target_slice, sr=sample_rate, n_mfcc=13, n_fft=512, hop_length=hop_length)
            source_delta = librosa.feature.delta(source_mfcc)
            target_delta = librosa.feature.delta(target_mfcc)
            _, path = librosa.sequence.dtw(X=source_delta, Y=target_delta, metric="euclidean", global_constraints=True, band_rad=0.3)
            onset_envelope = librosa.onset.onset_strength(y=source_slice, sr=sample_rate, hop_length=hop_length)
            onset_frames = librosa.util.peak_pick(onset_envelope, pre_max=10, post_max=10, pre_avg=20, post_avg=20, delta=0.08, wait=10)
            source_onsets = [source_window_start + float(frame) * hop_length / sample_rate for frame in onset_frames]
            cue_bounds = {cue_index: activity_groups[index] for index, cue_index in enumerate(cue_order)} if activity_groups else {}
            cue_anchor_ids = {
                cue_index: (
                    next(item["id"] for item in normalized_anchors if item["cueIndex"] == cue_index),
                    next(item["id"] for item in reversed(normalized_anchors) if item["cueIndex"] == cue_index),
                ) for cue_index in cue_order
            }
            global_alignment = (source_window_start, target_window_start, source_mfcc, target_mfcc, path, cue_bounds, cue_anchor_ids, source_onsets)
    refined = []
    for index, item in enumerate(normalized_anchors):
        if cancellation_requested():
            raise WorkerError("cancelled", "Micro allineamento annullato")
        source_start, source_center, source_end = item["sourceStart"], item["sourceCenter"], item["sourceEnd"]
        target_start, target_center, target_end = item["targetStart"], item["targetCenter"], item["targetEnd"]
        maximum_shift = item["maximumShift"]
        target_onset = target_onset_overrides.get(item["id"])
        target_fields = ({
            "targetStart": target_onset,
            "targetShiftMs": (target_onset - target_start) * 1000.0,
            "targetConfidence": 0.9,
        } if target_onset is not None else {})
        result = {"id": item["id"], "sourceCenter": source_center, "shiftMs": 0.0, "confidence": 0.0, "method": "mfcc-dtw-unresolved", **target_fields}
        if maximum_shift > 0:
            if global_alignment is not None and maximum_shift > 0.1:
                source_window_start, target_window_start, source_mfcc, target_mfcc, path, cue_bounds, cue_anchor_ids, source_onsets = global_alignment
            else:
                padding = max(0.12, maximum_shift + 0.06)
                source_window_start = max(0.0, source_start - padding)
                source_window_end = min(len(source_samples) / sample_rate, source_end + padding)
                target_window_start = max(0.0, target_start - padding)
                target_window_end = min(len(target_samples) / sample_rate, target_end + padding)
                source_slice = source_samples[int(source_window_start * sample_rate):int(source_window_end * sample_rate)]
                target_slice = target_samples[int(target_window_start * sample_rate):int(target_window_end * sample_rate)]
                if len(source_slice) < 1024 or len(target_slice) < 1024:
                    refined.append(result)
                    progress(0.08 + 0.86 * (index + 1) / len(anchors), f"Micro allineamento anchor {index + 1}/{len(anchors)}")
                    continue
                source_mfcc = librosa.feature.mfcc(y=source_slice, sr=sample_rate, n_mfcc=13, n_fft=512, hop_length=hop_length)
                target_mfcc = librosa.feature.mfcc(y=target_slice, sr=sample_rate, n_mfcc=13, n_fft=512, hop_length=hop_length)
                _, path = librosa.sequence.dtw(X=source_mfcc, Y=target_mfcc, metric="cosine")
            def mapped_source_time(target_time: float, source_seed: float) -> float | None:
                mapped_target_frame = int(round((target_time - target_window_start) * sample_rate / hop_length))
                mapped_source_frames = [int(pair[0]) for pair in path if abs(int(pair[1]) - mapped_target_frame) <= 1]
                if not mapped_source_frames:
                    return None
                mapped = source_window_start + float(np.median(mapped_source_frames)) * hop_length / sample_rate
                return min(source_seed + maximum_shift, max(source_seed - maximum_shift, mapped))

            candidate_start = mapped_source_time(target_start, source_start)
            candidate = mapped_source_time(target_center, source_center)
            candidate_end = mapped_source_time(target_end, source_end)
            if global_alignment is not None and maximum_shift > 0.1 and item["cueIndex"] in cue_bounds:
                first_id, last_id = cue_anchor_ids[item["cueIndex"]]
                phrase_start, phrase_end = cue_bounds[item["cueIndex"]]
                if item["id"] == first_id:
                    candidate_start = phrase_start
                elif candidate_start is not None and source_onsets:
                    # DTW is authoritative near an onset. If it misses one by
                    # over 90 ms, snap to the acoustic attack rather than
                    # carrying the error into every following word.
                    candidate_start = _snap_to_acoustic_onset(candidate_start, source_onsets)
                if item["id"] == last_id:
                    candidate_end = phrase_end
                if first_id == last_id:
                    candidate = (phrase_start + phrase_end) / 2
            if candidate_start is not None and candidate is not None and candidate_end is not None and candidate_start <= candidate_end:
                candidate = min(candidate_end, max(candidate_start, candidate))
                source_frame = int(round((candidate - source_window_start) * sample_rate / hop_length))
                target_frame = int(round((target_center - target_window_start) * sample_rate / hop_length))
                source_frame = min(source_mfcc.shape[1] - 1, max(0, source_frame))
                target_frame = min(target_mfcc.shape[1] - 1, max(0, target_frame))
                left = source_mfcc[:, source_frame]
                right = target_mfcc[:, target_frame]
                similarity = float(np.dot(left, right) / max(1e-8, np.linalg.norm(left) * np.linalg.norm(right)))
                confidence = max(0.0, min(1.0, (similarity + 1.0) / 2.0))
                method = "phrase-dtw-v2" if global_alignment is not None and maximum_shift > 0.1 else "mfcc-dtw-v1"
                result = {"id": item["id"], "sourceStart": candidate_start, "sourceCenter": candidate, "sourceEnd": candidate_end, "shiftMs": (candidate - source_center) * 1000.0, "confidence": confidence, "method": method, **target_fields}
        refined.append(result)
        progress(0.08 + 0.86 * (index + 1) / len(anchors), f"Micro allineamento anchor {index + 1}/{len(anchors)}")
    return {"kind": "refineAlignment", "anchors": refined, "algorithm": "subtitle-constrained-phrase-dtw-v2" if global_alignment is not None else "mfcc-dtw-v1", "sampleRate": sample_rate, "hopLength": hop_length}


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
    if action == "extractAudio":
        return extract_audio(request)
    if action == "refineAlignment":
        return refine_alignment(request)
    if action == "analyzeVisemes":
        return analyze_visemes(request)
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
