"""Local PyTorch/Real-ESRGAN + ffmpeg service used by the web editor.

In development Vite starts this process as a child; it can also be launched explicitly
with ``npm run upscaler:server`` for diagnostics or non-Vite clients.
"""
from __future__ import annotations

import os
import json
import contextlib
import io
import math
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import urllib.request
import uuid
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np
import torch
import uvicorn

# BasicSR 1.4.2 imports an alias removed from recent TorchVision releases.
# Keep the upstream Real-ESRGAN stack while exposing only the compatible symbol.
if "torchvision.transforms.functional_tensor" not in sys.modules:
    from torchvision.transforms.functional import rgb_to_grayscale

    functional_tensor = types.ModuleType("torchvision.transforms.functional_tensor")
    functional_tensor.rgb_to_grayscale = rgb_to_grayscale
    sys.modules["torchvision.transforms.functional_tensor"] = functional_tensor

from basicsr.archs.rrdbnet_arch import RRDBNet
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from realesrgan import RealESRGANer
from realesrgan.archs.srvgg_arch import SRVGGNetCompact
from starlette.background import BackgroundTask

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("DSAS_UPSCALER_CACHE", ROOT / ".upscaler-cache" / "pytorch"))
CACHE.mkdir(parents=True, exist_ok=True)
VIDEO_TEMP_ROOT = Path(os.environ.get("MLSM_UPSCALER_TEMP", ROOT / "temp" / "upscaler"))
VIDEO_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
MODELS = {
    "RealESRGAN_x4plus": (4, 23, "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"),
    "RealESRGAN_x2plus": (2, 23, "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth"),
    "RealESRNet_x4plus": (4, 23, "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.1/RealESRNet_x4plus.pth"),
    "RealESRGAN_x4plus_anime_6B": (4, 6, "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"),
    "realesr-general-x4v3": (4, 32, "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"),
    "realesr-animevideov3": (4, 16, "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth"),
}
status: dict[str, dict[str, object]] = {}
loaded: dict[tuple[str, str, int], RealESRGANer] = {}
lock = threading.Lock()
video_job_lock = threading.Lock()
video_jobs: dict[str, dict[str, object]] = {}
cancelled_video_clients: dict[str, float] = {}
interpolation_job_lock = threading.Lock()
interpolation_jobs: dict[str, dict[str, object]] = {}
interpolation_processes: dict[str, subprocess.Popen[object]] = {}
cancelled_interpolation_clients: dict[str, float] = {}
event_log_lock = threading.Lock()
EVENT_LOG = VIDEO_TEMP_ROOT / "upscaler-events.jsonl"
READY_JOB_RETENTION_SECONDS = int(os.environ.get("MLSM_UPSCALER_READY_TTL", 30 * 60))
FAILED_JOB_RETENTION_SECONDS = int(os.environ.get("MLSM_UPSCALER_FAILED_TTL", 5 * 60))
INTERPOLATION_READY_RETENTION_SECONDS = int(os.environ.get("MLSM_INTERPOLATION_READY_TTL", 30 * 60))
INTERPOLATION_FAILED_RETENTION_SECONDS = int(os.environ.get("MLSM_INTERPOLATION_FAILED_TTL", 5 * 60))

RIFE_WEIGHTS = Path(os.environ.get("DSAS_RIFE_WEIGHTS", CACHE.parent / "rife"))
INTERPOLATION_METHODS = ("blend", "motion", "rife")
# Un montaggio esportato può essere lungo: il limite protegge dal riempire /tmp per errore,
# non è una restrizione editoriale.
INTERPOLATION_MAX_BYTES = int(os.environ.get("DSAS_INTERPOLATION_MAX_BYTES", 4 * 1024 ** 3))
INTERPOLATION_TIMEOUT_SECONDS = int(os.environ.get("DSAS_INTERPOLATION_TIMEOUT", 3600))
INTERPOLATION_PROCESS_GRACE_SECONDS = float(os.environ.get("DSAS_INTERPOLATION_PROCESS_GRACE", "3"))
INTERPOLATION_FRAME_TOLERANCE = 1
INTERPOLATION_FPS_RELATIVE_TOLERANCE = .01
INTERPOLATION_DURATION_TOLERANCE_SECONDS = .05

app = FastAPI(title="MLSM Studio Upscaler", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost|https://tauri\.localhost)$", allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])


def log_upscaler_event(source: str, event: str, **details: object) -> None:
    entry = {"at": time.time(), "source": source, "event": event, **details}
    line = json.dumps(entry, ensure_ascii=False, default=str)
    with event_log_lock:
        with EVENT_LOG.open("a", encoding="utf-8") as output:
            output.write(line + "\n")
    print(f"[MLSM Upscaler] {line}", flush=True)


def cleanup_video_job(job_id: str, reason: str = "cleanup") -> None:
    """Rimuove un solo workspace verificato, senza mai cancellare la root temp."""
    with video_job_lock:
        item = video_jobs.pop(job_id, None)
    if item is None:
        return
    workspace_value = str(item.get("tempDirectory", ""))
    if not workspace_value:
        return
    root = VIDEO_TEMP_ROOT.resolve()
    workspace = Path(workspace_value).resolve()
    if workspace.parent != root:
        log_upscaler_event("backend", "job-cleanup-refused", jobId=job_id, workspace=workspace, reason=reason)
        return
    shutil.rmtree(workspace, ignore_errors=True)
    log_upscaler_event("backend", "job-cleaned", jobId=job_id, workspace=workspace, reason=reason)


def cleanup_interpolation_job(job_id: str, reason: str = "cleanup") -> None:
    """Remove one interpolation workspace, never the service temp root."""
    with interpolation_job_lock:
        item = interpolation_jobs.get(job_id)
        process = interpolation_processes.get(job_id)
    if item is None:
        return
    if process is not None and not _terminate_subprocess(process):
        log_upscaler_event("backend", "interpolation-cleanup-deferred", jobId=job_id, reason=reason)
        schedule_interpolation_job_cleanup(job_id, 1, reason)
        return
    with interpolation_job_lock:
        item = interpolation_jobs.pop(job_id, None)
        interpolation_processes.pop(job_id, None)
    if item is None:
        return
    workspace_value = str(item.get("tempDirectory", ""))
    if not workspace_value:
        return
    root = VIDEO_TEMP_ROOT.resolve()
    workspace = Path(workspace_value).resolve()
    if workspace.parent != root:
        log_upscaler_event("backend", "interpolation-cleanup-refused", jobId=job_id, workspace=workspace, reason=reason)
        return
    shutil.rmtree(workspace, ignore_errors=True)
    log_upscaler_event("backend", "interpolation-job-cleaned", jobId=job_id, workspace=workspace, reason=reason)


def schedule_video_job_cleanup(job_id: str, delay_seconds: int, reason: str) -> None:
    timer = threading.Timer(delay_seconds, cleanup_video_job, args=(job_id, reason))
    timer.daemon = True
    timer.start()


def schedule_interpolation_job_cleanup(job_id: str, delay_seconds: int, reason: str) -> None:
    timer = threading.Timer(delay_seconds, cleanup_interpolation_job, args=(job_id, reason))
    timer.daemon = True
    timer.start()


def purge_stale_video_temp() -> None:
    """A ogni avvio elimina soltanto artefatti di job appartenenti a esecuzioni precedenti."""
    with video_job_lock:
        video_jobs.clear()
        cancelled_video_clients.clear()
    with interpolation_job_lock:
        interpolation_jobs.clear()
        processes = list(interpolation_processes.values())
        interpolation_processes.clear()
        cancelled_interpolation_clients.clear()
    for process in processes:
        _terminate_subprocess(process)
    VIDEO_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    for child in VIDEO_TEMP_ROOT.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


@app.on_event("startup")
def cleanup_stale_upscaler_jobs() -> None:
    purge_stale_video_temp()
    log_upscaler_event("backend", "temp-purged-on-startup", tempDirectory=VIDEO_TEMP_ROOT)


@app.post("/diagnostics/events")
async def diagnostic_event(payload: dict[str, object]):
    source = str(payload.pop("source", "browser"))
    event = str(payload.pop("event", "client-event"))
    log_upscaler_event(source, event, **payload)
    return {"ok": True}


def hardware() -> dict[str, object]:
    mps = bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_available())
    cuda = bool(torch.cuda.is_available())
    recommended = "metal" if mps else "cuda" if cuda else "cpu"
    name = "Apple Silicon · MPS/Metal" if mps else torch.cuda.get_device_name(0) if cuda else "CPU"
    return {"mps": mps, "cuda": cuda, "recommendedBackend": recommended, "gpuName": name}


def target(model: str) -> Path:
    if model not in MODELS:
        raise HTTPException(404, "Modello sconosciuto")
    return CACHE / f"{model}.pth"


def download(model: str) -> None:
    path = target(model)
    _, _, url = MODELS[model]
    temporary = path.with_suffix(".partial")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "DynamicSoundAnimationStudio/0.1"})
        with urllib.request.urlopen(request) as response, temporary.open("wb") as output:
            total = int(response.headers.get("content-length") or 0)
            done = 0
            with lock:
                status[model] = {"phase": "download", "loadedBytes": 0, "totalBytes": total, "progress": 0}
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                done += len(chunk)
                with lock:
                    status[model] = {"phase": "download", "loadedBytes": done, "totalBytes": total, "progress": done / total if total else 0}
        temporary.replace(path)
        with lock:
            status[model] = {"phase": "ready", "loadedBytes": path.stat().st_size, "totalBytes": path.stat().st_size, "progress": 1}
    except Exception as error:
        temporary.unlink(missing_ok=True)
        with lock:
            status[model] = {"phase": "error", "progress": 0, "error": str(error)}


def ffmpeg_binary() -> str | None:
    """ffmpeg is resolved from PATH: the service never bundles or downloads a binary."""
    return os.environ.get("DSAS_FFMPEG") or shutil.which("ffmpeg")


def ffprobe_binary() -> str | None:
    configured = os.environ.get("DSAS_FFPROBE")
    if configured:
        return configured
    binary = ffmpeg_binary()
    sibling = Path(binary).with_name("ffprobe") if binary else None
    return str(sibling) if sibling and sibling.exists() else shutil.which("ffprobe")


def _ratio_value(value: object) -> float:
    """Return a finite sample-aspect ratio from ffprobe's ``num:den`` value."""
    if isinstance(value, (int, float)):
        return float(value) if np.isfinite(value) and float(value) > 0 else 1.0
    text = str(value or "1:1").strip()
    if ":" in text:
        numerator, denominator = text.split(":", 1)
        try:
            result = float(numerator) / float(denominator)
        except (ValueError, ZeroDivisionError):
            return 1.0
        return result if np.isfinite(result) and result > 0 else 1.0
    try:
        result = float(text)
    except ValueError:
        return 1.0
    return result if np.isfinite(result) and result > 0 else 1.0


def _rotation_value(stream: dict[str, object]) -> int:
    """Read legacy rotate tags and modern display-matrix side data."""
    candidates: list[object] = []
    tags = stream.get("tags")
    if isinstance(tags, dict):
        candidates.append(tags.get("rotate"))
    side_data = stream.get("side_data_list")
    if isinstance(side_data, list):
        for item in side_data:
            if isinstance(item, dict):
                candidates.extend((item.get("rotation"), item.get("rotate"), item.get("displaymatrix")))
    for candidate in candidates:
        if candidate is None:
            continue
        if isinstance(candidate, (int, float)):
            angle = float(candidate)
        else:
            text = str(candidate)
            match = re.search(r"rotation(?:\s+of)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)", text, re.IGNORECASE)
            if match:
                angle = float(match.group(1))
            else:
                try:
                    angle = float(text)
                except ValueError:
                    # ffprobe prints display matrices as three address-prefixed
                    # rows, for example ``00000000: 0 -65536 0``. Parse only the
                    # row payload so the addresses never become coefficients.
                    matrix_rows: list[list[float]] = []
                    for line in text.splitlines():
                        if ":" not in line:
                            continue
                        entries = line.split(":", 1)[1]
                        hex_values = re.findall(r"(?<![0-9A-Fa-f])[0-9A-Fa-f]{8}(?![0-9A-Fa-f])", entries)
                        if any(re.search(r"[A-Fa-f]", value) for value in hex_values):
                            row: list[float] = []
                            for value in hex_values:
                                raw = int(value, 16)
                                if raw & 0x80000000:
                                    raw -= 0x100000000
                                row.append(raw / 65536.0)
                            if len(row) >= 2:
                                matrix_rows.append(row)
                            continue
                        values = re.findall(r"(?<![\w.])[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?![\w.])", entries)
                        if len(values) >= 2:
                            matrix_rows.append([float(value) for value in values])

                    # Keep compatibility with unprefixed decimal matrices and
                    # the signed 16.16 hexadecimal form used by some ffprobe
                    # versions/wrappers.
                    if not matrix_rows:
                        values = re.findall(r"(?<![\w.])[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?![\w.])", text)
                        if len(values) >= 2:
                            matrix_rows.append([float(value) for value in values])
                    if not matrix_rows:
                        matrix_values: list[float] = []
                        for entry in re.findall(r"(?<![0-9A-Fa-f])[0-9A-Fa-f]{8}(?![0-9A-Fa-f])", text):
                            raw = int(entry, 16)
                            if raw & 0x80000000:
                                raw -= 0x100000000
                            matrix_values.append(raw / 65536.0)
                        if len(matrix_values) >= 2:
                            matrix_rows.append(matrix_values)
                    if not matrix_rows:
                        continue
                    try:
                        # The first row contains the 2D transform coefficients
                        # a and b; atan2(b, a) recovers its rotation.
                        angle = math.degrees(math.atan2(matrix_rows[0][1], matrix_rows[0][0]))
                    except (TypeError, ValueError):
                        continue
        if np.isfinite(angle):
            normalized = int(round(angle / 90.0) * 90) % 360
            return normalized
    return 0


def parse_ffprobe_geometry(payload: dict[str, object]) -> dict[str, object]:
    """Parse display geometry from a ffprobe JSON response.

    ``width``/``height`` are coded dimensions; ``display_*`` account for SAR and
    quarter-turn rotation. Keeping this helper pure makes odd mobile-video
    metadata testable without invoking ffmpeg.
    """
    streams = payload.get("streams") if isinstance(payload, dict) else None
    stream = streams[0] if isinstance(streams, list) and streams and isinstance(streams[0], dict) else {}
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if width <= 0 or height <= 0:
        raise ValueError("ffprobe non ha restituito width/height del video")
    sar_text = str(stream.get("sample_aspect_ratio") or "1:1")
    sar = _ratio_value(sar_text)
    rotation = _rotation_value(stream)
    quarter_turn = rotation % 180 == 90
    if quarter_turn:
        display_width, display_height = height, width
        display_aspect_ratio = height / max(1e-9, width * sar)
    else:
        display_width, display_height = width, height
        display_aspect_ratio = (width * sar) / max(1e-9, height)
    return {
        "width": width,
        "height": height,
        "sample_aspect_ratio": sar_text if ":" in sar_text else "1:1",
        "sample_aspect_ratio_value": sar,
        "rotation": rotation,
        "display_width": display_width,
        "display_height": display_height,
        "display_aspect_ratio": display_aspect_ratio,
    }


def resolve_video_dimensions(requested_width: int, requested_height: int, geometry: dict[str, object] | None, preserve_aspect_ratio: bool) -> tuple[int, int]:
    """Resolve an even, bounded output size using requested width as the axis."""
    width = max(64, min(16384, int(round(max(1, requested_width) / 2) * 2)))
    height = max(64, min(16384, int(round(max(1, requested_height) / 2) * 2)))
    if preserve_aspect_ratio and geometry:
        dar = float(geometry.get("display_aspect_ratio") or 0)
        if np.isfinite(dar) and dar > 0:
            height = max(64, min(16384, int(round(width / dar / 2) * 2)))
    return width, height


def _frame_extraction_filter() -> str:
    """Square pixels using the decoded frame SAR after ffmpeg autorotation."""
    return "scale=trunc(iw*sar/2)*2:ih,setsar=1"


def probe_video_geometry(path: Path) -> dict[str, object]:
    probe = ffprobe_binary()
    if not probe:
        raise RuntimeError("ffprobe non disponibile: impossibile determinare la geometria del video")
    result = subprocess.run([
        probe, "-v", "error", "-select_streams", "v:0", "-show_streams",
        "-show_entries", "stream=width,height,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation,displaymatrix",
        "-of", "json", str(path)
    ], capture_output=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or b"").decode("utf-8", "replace").strip()[-500:]
        raise RuntimeError(f"ffprobe non riesce a leggere il video: {detail or 'nessun dettaglio disponibile'}")
    try:
        return parse_ffprobe_geometry(json.loads(result.stdout or b"{}"))
    except (ValueError, json.JSONDecodeError) as error:
        raise RuntimeError("ffprobe non ha restituito una geometria video valida") from error


def rife_available() -> bool:
    return RIFE_WEIGHTS.is_dir() and any(RIFE_WEIGHTS.glob("*.pkl"))


def interpolation_capabilities() -> dict[str, object]:
    binary = ffmpeg_binary()
    return {"ffmpeg": bool(binary), "ffmpegPath": binary or "", "rife": rife_available(), "jobs": True, "jobApi": True, "device": str(device_from("auto"))}


@app.get("/health")
def health():
    return {
        "ok": True, "apiVersion": 3, "capabilities": {"imageUpscale": True, "videoJobs": True, "interpolationJobs": True},
        **hardware(), "interpolation": interpolation_capabilities(), "videoTempDirectory": str(VIDEO_TEMP_ROOT)
    }


@app.get("/interpolation/health")
def interpolation_health():
    return {"ok": True, "interpolation": interpolation_capabilities()}


@app.get("/models/{model}/status")
def model_status(model: str):
    path = target(model)
    if path.exists():
        size = path.stat().st_size
        return {"phase": "ready", "progress": 1, "loadedBytes": size, "totalBytes": size}
    with lock:
        return status.get(model, {"phase": "missing", "progress": 0})


@app.post("/models/{model}/prepare")
def prepare(model: str):
    path = target(model)
    if path.exists():
        return model_status(model)
    with lock:
        current = status.get(model, {})
        if current.get("phase") != "download":
            status[model] = {"phase": "queued", "progress": 0}
            threading.Thread(target=download, args=(model,), daemon=True).start()
    return status[model]


def device_from(requested: str) -> torch.device:
    info = hardware()
    selected = info["recommendedBackend"] if requested not in ("metal", "cuda", "cpu") else requested
    if selected == "metal" and info["mps"]:
        return torch.device("mps")
    if selected == "cuda" and info["cuda"]:
        return torch.device("cuda")
    return torch.device("cpu")


def upsampler(model_name: str, backend: str, tile: int) -> RealESRGANer:
    device = device_from(backend)
    key = (model_name, str(device), tile)
    if key in loaded:
        return loaded[key]
    scale, blocks, _ = MODELS[model_name]
    if model_name in ("realesr-general-x4v3", "realesr-animevideov3"):
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=blocks, upscale=scale, act_type="prelu")
    else:
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=blocks, num_grow_ch=32, scale=scale)
    runner = RealESRGANer(scale=scale, model_path=str(target(model_name)), model=model, tile=tile, tile_pad=10, pre_pad=0, half=device.type != "cpu", device=device)
    loaded[key] = runner
    return runner


@app.post("/upscale")
async def upscale(file: UploadFile = File(...), model: str = Form(...), backend: str = Form("auto"), tile: int = Form(256), width: int = Form(...), height: int = Form(...), tta: bool = Form(False)):
    path = target(model)
    if not path.exists():
        raise HTTPException(409, "Modello non ancora scaricato")
    raw = np.frombuffer(await file.read(), dtype=np.uint8)
    image = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "Immagine non valida")
    runner = upsampler(model, backend, max(0, min(1024, tile)))
    output, _ = quiet_enhance(runner, image, MODELS[model][0])
    if tta:
        mirrored, _ = quiet_enhance(runner, cv2.flip(image, 1), MODELS[model][0])
        output = cv2.addWeighted(output, .5, cv2.flip(mirrored, 1), .5, 0)
    if output.shape[1] != width or output.shape[0] != height:
        output = cv2.resize(output, (width, height), interpolation=cv2.INTER_LANCZOS4)
    ok, encoded = cv2.imencode(".png", output, [cv2.IMWRITE_PNG_COMPRESSION, 2])
    if not ok:
        raise HTTPException(500, "Codifica PNG fallita")
    return Response(encoded.tobytes(), media_type="image/png", headers={"X-Upscaler-Backend": str(device_from(backend))})


def update_video_job(job_id: str, **patch: object) -> None:
    with video_job_lock:
        current = video_jobs.get(job_id)
        if current is not None:
            current.update(patch)


def video_job_cancelled(job_id: str) -> bool:
    with video_job_lock:
        return bool(video_jobs.get(job_id, {}).get("cancelRequested"))


def run_checked(command: list[str], timeout: int = INTERPOLATION_TIMEOUT_SECONDS) -> None:
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("ffmpeg non ha terminato entro il tempo massimo") from error
    if result.returncode != 0:
        detail = (result.stderr or b"").decode("utf-8", "replace").strip()[-900:]
        raise RuntimeError(f"ffmpeg ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")


def canvas_enhance(frame: np.ndarray, width: int, height: int) -> np.ndarray:
    resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_LANCZOS4)
    blurred = cv2.GaussianBlur(resized, (0, 0), 1.05)
    return cv2.addWeighted(resized, 1.16, blurred, -0.16, 0)


def quiet_enhance(runner: RealESRGANer, frame: np.ndarray, outscale: int):
    """RealESRGAN stampa ogni tile su stdout: la UI mostra già un progresso per frame."""
    with contextlib.redirect_stdout(io.StringIO()):
        return runner.enhance(frame, outscale=outscale)


def source_frame_durations(source: Path, total: int, fallback_fps: float) -> list[float]:
    """Legge i PTS reali: anche una sorgente VFR mantiene la durata di ogni fotogramma."""
    probe = ffprobe_binary()
    if not probe:
        return [1 / fallback_fps] * total
    result = subprocess.run([
        probe, "-v", "error", "-select_streams", "v:0", "-show_frames",
        "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time", "-of", "json", str(source)
    ], capture_output=True, check=False)
    if result.returncode != 0:
        return [1 / fallback_fps] * total
    frames = json.loads(result.stdout or b"{}").get("frames", [])
    timestamps = [float(item.get("best_effort_timestamp_time", 0)) for item in frames[:total]]
    durations: list[float] = []
    for index in range(total):
        if index + 1 < len(timestamps):
            duration = timestamps[index + 1] - timestamps[index]
        else:
            item = frames[index] if index < len(frames) else {}
            duration = float(item.get("pkt_duration_time", 0) or 0)
        durations.append(duration if np.isfinite(duration) and duration > 0 else 1 / fallback_fps)
    return durations


def encoded_video_frame_count(path: Path) -> int:
    probe = ffprobe_binary()
    if not probe:
        raise RuntimeError("ffprobe non disponibile: impossibile verificare tutti i frame del video finale")
    result = subprocess.run([
        probe, "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=nb_read_frames", "-of", "default=nokey=1:noprint_wrappers=1", str(path)
    ], capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError("ffprobe non riesce a verificare il video ricomposto")
    return int((result.stdout or b"0").decode("utf-8", "replace").strip() or 0)


def process_video_upscale_job(job_id: str) -> None:
    with video_job_lock:
        job = dict(video_jobs[job_id])
    workspace = Path(str(job["tempDirectory"]))
    source = Path(str(job["sourcePath"]))
    originals = workspace / "original-frames"
    enhanced = workspace / "upscaled-frames"
    result_path = workspace / "upscaled-video.mp4"
    originals.mkdir(parents=True, exist_ok=True)
    enhanced.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    try:
        log_upscaler_event("backend", "job-start", jobId=job_id, sourcePath=source, model=job.get("model"), backend=job.get("backend"), target=f'{job.get("width")}x{job.get("height")}')
        binary = ffmpeg_binary()
        if not binary:
            raise RuntimeError("ffmpeg non trovato nel PATH. Installalo con `brew install ffmpeg` e riavvia il servizio.")
        update_video_job(job_id, phase="extracting", phaseLabel="Estrazione di tutti i frame originali", progress=0.01)
        run_checked([
            binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-vf", _frame_extraction_filter(), "-vsync", "0", str(originals / "frame-%08d.png")
        ])
        original_frames = sorted(originals.glob("frame-*.png"))
        if not original_frames:
            raise RuntimeError("Il decoder non ha estratto alcun fotogramma dal video.")
        capture = cv2.VideoCapture(str(source))
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        capture.release()
        if not np.isfinite(fps) or fps <= 0:
            fps = 30.0
        total = len(original_frames)
        log_upscaler_event("backend", "frames-extracted", jobId=job_id, totalFrames=total, fps=fps, originals=originals)
        durations = source_frame_durations(source, total, fps)
        model_name = str(job["model"])
        backend = str(job["backend"])
        tile = int(job["tile"])
        width = int(job["width"])
        height = int(job["height"])
        tta = bool(job["tta"])
        runner = None if model_name == "canvas" else upsampler(model_name, backend, max(0, min(1024, tile)))
        update_video_job(job_id, phase="upscaling", phaseLabel="Upscaling frame per frame", totalFrames=total, currentFrame=0, fps=fps, progress=0.04)
        for index, frame_path in enumerate(original_frames, start=1):
            if video_job_cancelled(job_id):
                update_video_job(job_id, phase="cancelled", phaseLabel="Job annullato", cancelled=True)
                cleanup_video_job(job_id, "cancelled")
                return
            frame = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
            if frame is None:
                raise RuntimeError(f"Fotogramma originale illeggibile: {frame_path.name}")
            completed = index - 1
            elapsed_before = time.monotonic() - started
            estimated_before = (elapsed_before / completed * (total - completed)) if completed else None
            passes = 2 if tta and runner is not None else 1
            update_video_job(
                job_id,
                phaseLabel=f"Frame {index}/{total} · passaggio 1/{passes}",
                currentFrame=completed,
                progress=.04 + .9 * completed / total,
                elapsedSeconds=elapsed_before,
                estimatedRemainingSeconds=estimated_before,
                activeFrame=index,
                inferencePass=1,
                inferencePasses=passes,
            )
            if runner is None:
                output = canvas_enhance(frame, width, height)
            else:
                output, _ = quiet_enhance(runner, frame, MODELS[model_name][0])
                if tta:
                    update_video_job(job_id, phaseLabel=f"Frame {index}/{total} · passaggio TTA 2/2", activeFrame=index, inferencePass=2, inferencePasses=2)
                    mirrored, _ = quiet_enhance(runner, cv2.flip(frame, 1), MODELS[model_name][0])
                    output = cv2.addWeighted(output, .5, cv2.flip(mirrored, 1), .5, 0)
                if output.shape[1] != width or output.shape[0] != height:
                    output = cv2.resize(output, (width, height), interpolation=cv2.INTER_LANCZOS4)
            destination = enhanced / frame_path.name
            if not cv2.imwrite(str(destination), output, [cv2.IMWRITE_PNG_COMPRESSION, 2]):
                raise RuntimeError(f"Impossibile salvare {destination.name}")
            elapsed = time.monotonic() - started
            update_video_job(
                job_id,
                currentFrame=index,
                totalFrames=total,
                progress=.04 + .9 * index / total,
                elapsedSeconds=elapsed,
                estimatedRemainingSeconds=(elapsed / index * (total - index)) if index else None,
                currentOriginalFrame=str(frame_path),
                currentUpscaledFrame=str(destination),
            )
            log_step = max(1, total // 20)
            if index == 1 or index == total or index % log_step == 0:
                log_upscaler_event("backend", "frame-progress", jobId=job_id, currentFrame=index, totalFrames=total, progress=.04 + .9 * index / total)
        if video_job_cancelled(job_id):
            update_video_job(job_id, phase="cancelled", phaseLabel="Job annullato", cancelled=True)
            cleanup_video_job(job_id, "cancelled")
            return
        update_video_job(job_id, phase="encoding", phaseLabel="Ricomposizione video e audio originale", progress=.95)
        log_upscaler_event("backend", "encoding-start", jobId=job_id, totalFrames=total)
        quality = str(job.get("quality", "maximum"))
        crf = "14" if quality == "maximum" else "17"
        manifest = workspace / "upscaled-frames.ffconcat"
        manifest_lines = ["ffconcat version 1.0"]
        for frame_path, duration in zip(sorted(enhanced.glob("frame-*.png")), durations, strict=True):
            manifest_lines.extend((f"file '{frame_path.as_posix()}'", f"duration {duration:.9f}"))
        manifest.write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")
        run_checked([
            binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-safe", "0", "-f", "concat", "-i", str(manifest),
            "-i", str(source), "-map", "0:v:0", "-map", "1:a?", "-map_metadata", "-1",
            "-vf", "setsar=1", "-metadata:s:v:0", "rotate=0", "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-pix_fmt", "yuv420p",
            "-fps_mode", "vfr", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", str(result_path)
        ])
        if video_job_cancelled(job_id):
            update_video_job(job_id, phase="cancelled", phaseLabel="Job annullato", cancelled=True)
            cleanup_video_job(job_id, "cancelled-after-encoding")
            return
        if not result_path.exists() or result_path.stat().st_size <= 0:
            raise RuntimeError("La ricomposizione non ha prodotto un video valido.")
        encoded_frames = encoded_video_frame_count(result_path)
        if encoded_frames != total:
            result_path.unlink(missing_ok=True)
            raise RuntimeError(f"Controllo anti-drop fallito: il risultato contiene {encoded_frames}/{total} frame")
        encoded_geometry = probe_video_geometry(result_path)
        encoded_width = int(encoded_geometry["width"])
        encoded_height = int(encoded_geometry["height"])
        encoded_sar = float(encoded_geometry["sample_aspect_ratio_value"])
        if encoded_width != width or encoded_height != height or not np.isclose(encoded_sar, 1.0, atol=1e-6) or int(encoded_geometry["rotation"]) % 360 != 0:
            result_path.unlink(missing_ok=True)
            raise RuntimeError(
                f"Controllo geometria fallito: ottenuto {encoded_width}x{encoded_height}, "
                f"SAR {encoded_geometry['sample_aspect_ratio']}, rotazione {encoded_geometry['rotation']}"
            )
        update_video_job(
            job_id,
            phase="ready",
            phaseLabel="Upscaling video completato",
            progress=1,
            currentFrame=total,
            totalFrames=total,
            resultPath=str(result_path),
            resultBytes=result_path.stat().st_size,
            effectiveWidth=encoded_width,
            effectiveHeight=encoded_height,
            sampleAspectRatio=encoded_geometry["sample_aspect_ratio"],
            rotation=encoded_geometry["rotation"],
            elapsedSeconds=time.monotonic() - started,
        )
        log_upscaler_event("backend", "job-ready", jobId=job_id, totalFrames=total, resultBytes=result_path.stat().st_size, elapsedSeconds=time.monotonic() - started)
        schedule_video_job_cleanup(job_id, READY_JOB_RETENTION_SECONDS, "ready-expired")
    except Exception as error:
        update_video_job(job_id, phase="error", phaseLabel="Upscaling interrotto", error=str(error))
        log_upscaler_event("backend", "job-error", jobId=job_id, error=str(error))
        schedule_video_job_cleanup(job_id, FAILED_JOB_RETENTION_SECONDS, "failed-expired")


@app.post("/upscale/video/jobs")
async def create_video_upscale_job(
    file: UploadFile = File(...), model: str = Form(...), backend: str = Form("auto"),
    tile: int = Form(256), width: int = Form(...), height: int = Form(...),
    tta: bool = Form(False), quality: str = Form("maximum"), client_id: str = Form(""), preserve_aspect_ratio: bool = Form(True)
):
    log_upscaler_event("backend", "upload-received", fileName=file.filename, model=model, backend=backend, target=f"{width}x{height}", quality=quality, preserveAspectRatio=preserve_aspect_ratio)
    if model != "canvas" and model not in MODELS:
        raise HTTPException(400, "Modello video sconosciuto")
    if model != "canvas" and not target(model).exists():
        raise HTTPException(409, "Modello non ancora scaricato")
    if not ffmpeg_binary():
        raise HTTPException(503, "ffmpeg non disponibile nel servizio locale")
    if width < 64 or height < 64 or width > 16384 or height > 16384:
        raise HTTPException(400, "Risoluzione finale fuori dai limiti")
    job_id = uuid.uuid4().hex
    workspace = VIDEO_TEMP_ROOT / job_id
    workspace.mkdir(parents=True, exist_ok=False)
    suffix = Path(file.filename or "source.mp4").suffix.lower()
    if suffix not in (".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"):
        suffix = ".mp4"
    source = workspace / f"source{suffix}"
    try:
        with source.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                output.write(chunk)
        if source.stat().st_size <= 0:
            raise HTTPException(400, "Video sorgente vuoto")
    except BaseException:
        shutil.rmtree(workspace, ignore_errors=True)
        raise
    finally:
        await file.close()
    try:
        source_geometry = probe_video_geometry(source)
        effective_width, effective_height = resolve_video_dimensions(width, height, source_geometry, preserve_aspect_ratio)
    except Exception as error:
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(400, f"Impossibile determinare la geometria del video: {error}") from error
    with video_job_lock:
        cutoff = time.time() - 3600
        for stale_client in [key for key, cancelled_at in cancelled_video_clients.items() if cancelled_at < cutoff]:
            cancelled_video_clients.pop(stale_client, None)
        client_was_cancelled = bool(client_id and client_id in cancelled_video_clients)
    if client_was_cancelled:
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(409, "La pagina che ha creato il job non è più attiva")
    record: dict[str, object] = {
        "id": job_id, "phase": "queued", "phaseLabel": "Job in coda", "progress": 0,
        "currentFrame": 0, "totalFrames": 0, "tempDirectory": str(workspace),
        "originalFramesDirectory": str(workspace / "original-frames"),
        "upscaledFramesDirectory": str(workspace / "upscaled-frames"),
        "sourcePath": str(source), "model": model, "backend": backend, "tile": tile,
        "requestedWidth": width, "requestedHeight": height,
        "width": effective_width, "height": effective_height, "preserveAspectRatio": preserve_aspect_ratio,
        "sourceGeometry": source_geometry, "tta": tta, "quality": quality,
        "clientId": client_id,
        "cancelRequested": False, "cancelled": False,
    }
    with video_job_lock:
        video_jobs[job_id] = record
    log_upscaler_event("backend", "job-created", jobId=job_id, sourceBytes=source.stat().st_size, tempDirectory=workspace)
    threading.Thread(target=process_video_upscale_job, args=(job_id,), daemon=True).start()
    return record


@app.delete("/upscale/video/clients/{client_id}")
def release_video_upscale_client(client_id: str):
    """Segna la pagina come chiusa anche se l'upload non ha ancora restituito il job ID."""
    with video_job_lock:
        cancelled_video_clients[client_id] = time.time()
        released = []
        for job_id, item in video_jobs.items():
            if item.get("clientId") == client_id:
                item["cancelRequested"] = True
                released.append(job_id)
    return {"released": released}


@app.get("/upscale/video/jobs/{job_id}")
def video_upscale_job_status(job_id: str):
    with video_job_lock:
        item = video_jobs.get(job_id)
        if item is None:
            raise HTTPException(404, "Job video non trovato")
        return dict(item)


@app.delete("/upscale/video/jobs/{job_id}")
def cancel_video_upscale_job(job_id: str):
    with video_job_lock:
        item = video_jobs.get(job_id)
        if item is None:
            raise HTTPException(404, "Job video non trovato")
        item["cancelRequested"] = True
        snapshot = dict(item)
    if snapshot.get("phase") in ("ready", "error", "cancelled"):
        cleanup_video_job(job_id, "client-release")
    return snapshot


@app.get("/upscale/video/jobs/{job_id}/result")
def video_upscale_job_result(job_id: str):
    with video_job_lock:
        item = dict(video_jobs.get(job_id) or {})
    if not item:
        raise HTTPException(404, "Job video non trovato")
    if item.get("phase") != "ready":
        raise HTTPException(409, "Il video non è ancora pronto")
    path = Path(str(item.get("resultPath", "")))
    if not path.exists():
        raise HTTPException(410, "Il risultato del job non è più disponibile")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename="mlsm-upscaled-video.mp4",
        background=BackgroundTask(cleanup_video_job, job_id, "download-complete"),
    )


def minterpolate_filter(target_fps: float, method: str) -> str:
    """Frame interpolation filter graph.

    `motion` runs bidirectional motion estimation and compensation: ffmpeg synthesises
    genuinely new intermediate frames instead of repeating or cross-dissolving the
    existing ones. `blend` keeps the cheaper frame-mixing mode for long exports.
    """
    if method == "blend":
        return f"minterpolate=fps={target_fps:g}:mi_mode=blend"
    return (
        f"minterpolate=fps={target_fps:g}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir"
        ":me=epzs:vsbmc=1:search_param=32:scd=fdiff:scd_threshold=8"
    )


def expected_minterpolate_frame_count(source_frames: int, source_fps: float, target_fps: float) -> int:
    """Minimum complete output produced by ffmpeg's `minterpolate` timeline.

    The filter needs the next two source frames before it can synthesise an
    output timestamp.  Consequently a valid N-frame input produces
    floor((N - 2) * target/source) + 1 frames, not N * target/source.
    """
    if source_frames < 3:
        raise ValueError("Servono almeno tre frame sorgente per verificare l'interpolazione")
    if not math.isfinite(source_fps) or source_fps <= 0 or not math.isfinite(target_fps) or target_fps <= source_fps:
        raise ValueError("Frame rate non validi per la verifica dell'interpolazione")
    return math.floor((source_frames - 2) * target_fps / source_fps) + 1


def validate_interpolation_audit(
    *, source_frames: int, source_fps: float, source_duration: float,
    output_frames: int, output_fps: float, output_duration: float, target_fps: float,
) -> None:
    """Reject duplicated-rate or truncated outputs before they can be delivered."""
    expected_frames = expected_minterpolate_frame_count(source_frames, source_fps, target_fps)
    if not math.isfinite(output_fps) or abs(output_fps - target_fps) > max(.05, target_fps * INTERPOLATION_FPS_RELATIVE_TOLERANCE):
        raise RuntimeError(f"Frame rate interpolato non valido: ottenuti {output_fps:g} fps, target {target_fps:g} fps")
    if output_frames < expected_frames - INTERPOLATION_FRAME_TOLERANCE:
        raise RuntimeError(f"Conteggio interpolato incompleto: ottenuti {output_frames} frame, attesi almeno {expected_frames - INTERPOLATION_FRAME_TOLERANCE}")
    if not math.isfinite(output_duration) or output_duration <= 0:
        raise RuntimeError("Durata del risultato interpolato non valida")
    # `minterpolate` legitimately loses the two-frame look-ahead tail.  Accept
    # that explicit tail and at most two target-frame/timebase rounding units.
    expected_duration = expected_frames / target_fps
    duration_tolerance = max(INTERPOLATION_DURATION_TOLERANCE_SECONDS, 2 / target_fps)
    if output_duration + duration_tolerance < expected_duration:
        raise RuntimeError(f"Durata interpolata troncata: ottenuti {output_duration:g} s, attesi circa {expected_duration:g} s")
    minimum_from_source = max(0.0, source_duration - 2 / source_fps)
    if output_duration + duration_tolerance < minimum_from_source:
        raise RuntimeError(f"Durata interpolata troncata rispetto alla sorgente: ottenuti {output_duration:g} s, sorgente {source_duration:g} s")


def _terminate_subprocess(process: subprocess.Popen[object], grace_seconds: float = INTERPOLATION_PROCESS_GRACE_SECONDS) -> bool:
    """Terminate a worker, then force-kill it after a bounded grace period."""
    try:
        if process.poll() is not None:
            return True
        process.terminate()
        try:
            process.wait(timeout=max(0.0, grace_seconds))
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=max(1.0, grace_seconds))
    except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
        # The process may have exited concurrently with DELETE/cleanup.  A final
        # best-effort kill is safe and cleanup never proceeds while it is alive.
        try:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=max(1.0, grace_seconds))
        except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
            pass
    return process.poll() is not None


def _wait_for_interpolation_process(
    process: subprocess.Popen[object], *, timeout_seconds: float,
    cancelled: Callable[[], bool] | None = None,
) -> int:
    """Wait responsively so cancellation and timeout always stop the worker."""
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    while True:
        if cancelled and cancelled():
            _terminate_subprocess(process)
            raise InterruptedError("Interpolazione annullata")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            _terminate_subprocess(process)
            raise TimeoutError("L'interpolazione non è terminata entro il tempo massimo.")
        try:
            return process.wait(timeout=min(.1, remaining))
        except subprocess.TimeoutExpired:
            continue


def run_ffmpeg(source: Path, destination: Path, target_fps: float, method: str) -> str:
    binary = ffmpeg_binary()
    if not binary:
        raise HTTPException(503, "ffmpeg non trovato nel PATH. Installalo (brew install ffmpeg) e riavvia il servizio.")
    command = [
        binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source),
        "-filter:v", minterpolate_filter(target_fps, method),
        "-r", f"{target_fps:g}",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        # L'audio del montaggio è già stato mixato dall'editor: va copiato intatto.
        "-c:a", "copy",
        str(destination),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=INTERPOLATION_TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired as error:
        raise HTTPException(504, "ffmpeg non ha terminato l'interpolazione entro il tempo massimo.") from error
    if result.returncode != 0:
        detail = (result.stderr or b"").decode("utf-8", "replace").strip()[-600:]
        raise HTTPException(500, f"ffmpeg ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")
    return f"ffmpeg · {method}"


def _update_interpolation_job(job_id: str, **patch: object) -> None:
    with interpolation_job_lock:
        item = interpolation_jobs.get(job_id)
        if item is not None:
            item.update(patch)


def _interpolation_job_cancelled(job_id: str) -> bool:
    with interpolation_job_lock:
        item = interpolation_jobs.get(job_id)
        return bool(item and item.get("cancelRequested"))


def _interpolation_probe(path: Path) -> tuple[int, float, float]:
    """Return encoded frames, average frame rate and video duration."""
    probe = ffprobe_binary()
    if not probe:
        raise RuntimeError("ffprobe non disponibile: impossibile verificare l'interpolazione")
    result = subprocess.run([
        probe, "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=nb_read_frames,avg_frame_rate,duration:format=duration", "-of", "json", str(path)
    ], capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError("ffprobe non riesce a verificare il risultato interpolato")
    try:
        payload = json.loads(result.stdout or b"{}")
        stream = payload.get("streams", [])[0]
        frames = int(stream.get("nb_read_frames") or 0)
        rate = str(stream.get("avg_frame_rate") or "0/1")
        numerator, denominator = rate.split("/", 1)
        fps = float(numerator) / float(denominator) if float(denominator) else 0.0
        duration = float(stream.get("duration") or payload.get("format", {}).get("duration") or 0)
    except (IndexError, KeyError, TypeError, ValueError, ZeroDivisionError) as error:
        raise RuntimeError("ffprobe non ha restituito i metadati del risultato interpolato") from error
    return frames, fps, duration


def _run_ffmpeg_interpolation_job(job_id: str, source: Path, destination: Path, target_fps: float, method: str, expected_frames: int) -> str:
    """Run ffmpeg with machine-readable progress and cooperative cancellation."""
    binary = ffmpeg_binary()
    if not binary:
        raise RuntimeError("ffmpeg non trovato nel PATH. Installalo con `brew install ffmpeg` e riavvia il servizio.")
    command = [
        binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-filter:v", minterpolate_filter(target_fps, method), "-r", f"{target_fps:g}",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-c:a", "copy", "-progress", "pipe:1", str(destination)
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    with interpolation_job_lock:
        item = interpolation_jobs.get(job_id)
        if item is not None:
            item["processId"] = process.pid
    started = time.monotonic()
    try:
        assert process.stdout is not None
        for raw_line in process.stdout:
            if time.monotonic() - started > INTERPOLATION_TIMEOUT_SECONDS:
                process.kill()
                process.wait(timeout=3)
                raise TimeoutError("ffmpeg non ha terminato l'interpolazione entro il tempo massimo.")
            if _interpolation_job_cancelled(job_id):
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
                raise InterruptedError("Interpolazione annullata")
            line = raw_line.strip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            elapsed = time.monotonic() - started
            if key == "frame":
                frame = max(0, int(float(value or 0)))
                fraction = min(1.0, frame / max(1, expected_frames))
                _update_interpolation_job(job_id, currentFrame=frame, totalFrames=expected_frames, progress=fraction, stageProgress=fraction, elapsedSeconds=elapsed, estimatedRemainingSeconds=(elapsed / frame * (expected_frames - frame)) if frame else None, indeterminate=False)
            elif key == "total_size":
                size = max(0, int(float(value or 0)))
                _update_interpolation_job(job_id, processedBytes=size, bytesProcessed=size, elapsedSeconds=elapsed)
            elif key == "progress" and value == "end":
                _update_interpolation_job(job_id, progress=1.0, stageProgress=1.0, currentFrame=expected_frames, totalFrames=expected_frames, elapsedSeconds=elapsed, estimatedRemainingSeconds=0)
        returncode = process.wait(timeout=INTERPOLATION_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as error:
        process.kill()
        process.wait(timeout=3)
        raise TimeoutError("ffmpeg non ha terminato l'interpolazione entro il tempo massimo.") from error
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
    if returncode != 0:
        detail = (process.stderr.read() if process.stderr else "").strip()[-600:]
        raise RuntimeError(f"ffmpeg ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")
    return f"ffmpeg · {method}"


def _rife_worker_command(source: Path, destination: Path, target_fps: float) -> list[str]:
    return [
        sys.executable, str(Path(__file__).resolve()), "--rife-worker",
        str(source), str(destination), f"{target_fps:g}", str(RIFE_WEIGHTS), str(device_from("auto")),
    ]


def _run_rife_worker(source: Path, destination: Path, target_fps: float, weights: Path, device: str) -> None:
    try:
        from rife_interpolate import interpolate_file  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError("Runtime RIFE non installato in questo ambiente. Usa la stima del movimento ffmpeg.") from error
    interpolate_file(str(source), str(destination), target_fps=target_fps, weights=str(weights), device=device)


def _run_isolated_rife(source: Path, destination: Path, target_fps: float, job_id: str | None = None) -> str:
    """Run the callable-only RIFE runtime in a killable worker process."""
    if not rife_available():
        raise HTTPException(409, f"Pesi RIFE non presenti in {RIFE_WEIGHTS}. Copiali lì oppure scegli la stima del movimento ffmpeg.")
    log_path = destination.with_suffix(".rife-worker.log")
    with log_path.open("w+b") as worker_log:
        process = subprocess.Popen(_rife_worker_command(source, destination, target_fps), stdout=subprocess.DEVNULL, stderr=worker_log)
        if job_id:
            with interpolation_job_lock:
                interpolation_processes[job_id] = process
                item = interpolation_jobs.get(job_id)
                if item is not None:
                    item["processId"] = process.pid
        try:
            returncode = _wait_for_interpolation_process(
                process,
                timeout_seconds=INTERPOLATION_TIMEOUT_SECONDS,
                cancelled=(lambda: _interpolation_job_cancelled(job_id)) if job_id else None,
            )
            if job_id and _interpolation_job_cancelled(job_id):
                raise InterruptedError("Interpolazione annullata")
            if returncode != 0:
                worker_log.flush()
                worker_log.seek(0)
                detail = worker_log.read().decode("utf-8", "replace").strip()[-600:]
                raise RuntimeError(f"RIFE ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")
        finally:
            if job_id:
                with interpolation_job_lock:
                    if interpolation_processes.get(job_id) is process:
                        interpolation_processes.pop(job_id, None)
            if process.poll() is None:
                _terminate_subprocess(process)
    log_path.unlink(missing_ok=True)
    if not destination.exists() or destination.stat().st_size == 0:
        raise HTTPException(500, "Il runtime RIFE non ha prodotto un file utilizzabile.")
    return f"rife · {device_from('auto')}"


def run_rife(source: Path, destination: Path, target_fps: float) -> str:
    """Legacy endpoint wrapper; it remains synchronous but RIFE stays isolated."""
    return _run_isolated_rife(source, destination, target_fps)


def process_interpolation_job(job_id: str) -> None:
    with interpolation_job_lock:
        job = dict(interpolation_jobs.get(job_id) or {})
    if not job:
        return
    source = Path(str(job["sourcePath"]))
    destination = Path(str(job["tempDirectory"])) / "interpolated.mp4"
    started = time.monotonic()
    try:
        source_fps = float(job["sourceFps"])
        target_fps = float(job["targetFps"])
        source_frames, probed_source_fps, source_duration = _interpolation_probe(source)
        if abs(probed_source_fps - source_fps) > max(.05, source_fps * INTERPOLATION_FPS_RELATIVE_TOLERANCE):
            raise RuntimeError(f"Frame rate sorgente non coerente: dichiarati {source_fps:g} fps, rilevati {probed_source_fps:g} fps")
        expected = expected_minterpolate_frame_count(source_frames, source_fps, target_fps)
        _update_interpolation_job(job_id, sourceFrames=source_frames, totalFrames=expected, stageTotalFrames=expected, phase="interpolating", phaseLabel="Interpolazione dei fotogrammi", progress=0.0, stageProgress=0.0)
        if _interpolation_job_cancelled(job_id):
            raise InterruptedError("Interpolazione annullata")
        method = str(job["method"])
        if method == "rife":
            # RIFE runtimes generally expose no frame callback.  Mark this honestly
            # as indeterminate and still check cancellation at the boundaries.
            _update_interpolation_job(job_id, indeterminate=True, progress=0.0, stageProgress=None, phaseLabel="RIFE · elaborazione GPU in corso")
            backend = _run_isolated_rife(source, destination, target_fps, job_id)
        else:
            backend = _run_ffmpeg_interpolation_job(job_id, source, destination, target_fps, method, expected)
        if _interpolation_job_cancelled(job_id):
            raise InterruptedError("Interpolazione annullata")
        _update_interpolation_job(job_id, phase="verifying", phaseLabel="Verifica del file interpolato", progress=1.0, stageProgress=1.0, indeterminate=False)
        if not destination.exists() or destination.stat().st_size <= 0:
            raise RuntimeError("L'interpolazione non ha prodotto un file utilizzabile.")
        frames, fps, duration = _interpolation_probe(destination)
        validate_interpolation_audit(
            source_frames=source_frames, source_fps=source_fps, source_duration=source_duration,
            output_frames=frames, output_fps=fps, output_duration=duration, target_fps=target_fps,
        )
        _update_interpolation_job(job_id, phase="ready", phaseLabel="Interpolazione completata", progress=1.0, stageProgress=1.0, currentFrame=frames, totalFrames=frames, resultPath=str(destination), resultBytes=destination.stat().st_size, processedBytes=destination.stat().st_size, bytesProcessed=destination.stat().st_size, outputFps=fps, backend=backend, elapsedSeconds=time.monotonic() - started, estimatedRemainingSeconds=0, indeterminate=False)
        schedule_interpolation_job_cleanup(job_id, INTERPOLATION_READY_RETENTION_SECONDS, "interpolation-ready-expired")
    except InterruptedError:
        _update_interpolation_job(job_id, phase="cancelled", phaseLabel="Interpolazione annullata", indeterminate=False, cancelled=True)
        cleanup_interpolation_job(job_id, "interpolation-cancelled")
    except Exception as error:
        _update_interpolation_job(job_id, phase="error", phaseLabel="Interpolazione interrotta", error=str(error), indeterminate=False)
        log_upscaler_event("backend", "interpolation-job-error", jobId=job_id, error=str(error))
        schedule_interpolation_job_cleanup(job_id, INTERPOLATION_FAILED_RETENTION_SECONDS, "interpolation-failed-expired")


async def _stream_upload_limited(file: UploadFile, destination: Path, max_bytes: int = INTERPOLATION_MAX_BYTES) -> int:
    """Persist an upload without ever writing or retaining bytes beyond the cap."""
    written = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                next_size = written + len(chunk)
                if next_size > max_bytes:
                    raise HTTPException(413, "File troppo grande per il servizio di interpolazione")
                output.write(chunk)
                written = next_size
        if written <= 0:
            raise HTTPException(400, "File video vuoto")
        return written
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


@app.post("/interpolation/jobs")
@app.post("/interpolate/jobs")
async def create_interpolation_job(
    file: UploadFile = File(...), source_fps: float = Form(...), target_fps: float = Form(...),
    method: str = Form("motion"), client_id: str = Form("")
):
    if method not in INTERPOLATION_METHODS:
        raise HTTPException(400, "Metodo di interpolazione sconosciuto")
    if not 1 <= source_fps <= 480 or not 1 <= target_fps <= 480 or target_fps <= source_fps:
        raise HTTPException(400, "Frame rate fuori dai limiti o target non superiore alla sorgente")
    if method == "rife" and not rife_available():
        raise HTTPException(409, "Pesi RIFE non presenti nel servizio locale")
    if method != "rife" and not ffmpeg_binary():
        raise HTTPException(503, "ffmpeg non disponibile nel servizio locale")
    job_id = f"interpolation-{uuid.uuid4().hex}"
    workspace = VIDEO_TEMP_ROOT / job_id
    workspace.mkdir(parents=True, exist_ok=False)
    source = workspace / (Path(file.filename or "source.mp4").stem + ".mp4")
    try:
        source_bytes = await _stream_upload_limited(file, source)
    except BaseException:
        shutil.rmtree(workspace, ignore_errors=True)
        raise
    finally:
        await file.close()
    with interpolation_job_lock:
        if client_id and client_id in cancelled_interpolation_clients:
            shutil.rmtree(workspace, ignore_errors=True)
            raise HTTPException(409, "La pagina che ha creato il job non è più attiva")
        record: dict[str, object] = {
            "id": job_id, "phase": "queued", "phaseLabel": "Job di interpolazione in coda", "progress": 0.0, "stageProgress": 0.0,
            "currentFrame": 0, "totalFrames": 0, "sourceFps": source_fps, "targetFps": target_fps, "method": method,
            "tempDirectory": str(workspace), "sourcePath": str(source), "clientId": client_id,
            "cancelRequested": False, "cancelled": False, "indeterminate": method == "rife", "processedBytes": 0, "totalBytes": source_bytes
        }
        interpolation_jobs[job_id] = record
    log_upscaler_event("backend", "interpolation-job-created", jobId=job_id, sourceBytes=source_bytes, targetFps=target_fps, method=method)
    threading.Thread(target=process_interpolation_job, args=(job_id,), daemon=True).start()
    return record


@app.delete("/interpolation/clients/{client_id}")
@app.delete("/interpolate/clients/{client_id}")
def release_interpolation_client(client_id: str):
    with interpolation_job_lock:
        cancelled_interpolation_clients[client_id] = time.time()
        released = []
        processes = []
        for job_id, item in interpolation_jobs.items():
            if item.get("clientId") == client_id:
                item["cancelRequested"] = True
                released.append(job_id)
                process = interpolation_processes.get(job_id)
                if process is not None:
                    processes.append(process)
    for process in processes:
        _terminate_subprocess(process)
    return {"released": released}


@app.get("/interpolation/jobs/{job_id}")
@app.get("/interpolate/jobs/{job_id}")
def interpolation_job_status(job_id: str):
    with interpolation_job_lock:
        item = interpolation_jobs.get(job_id)
        if item is None:
            raise HTTPException(404, "Job di interpolazione non trovato")
        return dict(item)


@app.delete("/interpolation/jobs/{job_id}")
@app.delete("/interpolate/jobs/{job_id}")
def cancel_interpolation_job(job_id: str):
    with interpolation_job_lock:
        item = interpolation_jobs.get(job_id)
        if item is None:
            raise HTTPException(404, "Job di interpolazione non trovato")
        item["cancelRequested"] = True
        snapshot = dict(item)
        process = interpolation_processes.get(job_id)
    if process is not None:
        _terminate_subprocess(process)
    if snapshot.get("phase") in ("ready", "error", "cancelled"):
        cleanup_interpolation_job(job_id, "client-release")
    return snapshot


@app.get("/interpolation/jobs/{job_id}/result")
@app.get("/interpolate/jobs/{job_id}/result")
def interpolation_job_result(job_id: str):
    with interpolation_job_lock:
        item = dict(interpolation_jobs.get(job_id) or {})
    if not item:
        raise HTTPException(404, "Job di interpolazione non trovato")
    if item.get("phase") != "ready":
        raise HTTPException(409, "Il risultato dell'interpolazione non è ancora pronto")
    path = Path(str(item.get("resultPath", "")))
    if not path.exists():
        raise HTTPException(410, "Il risultato dell'interpolazione non è più disponibile")
    return FileResponse(path, media_type="video/mp4", filename="mlsm-interpolated-video.mp4", background=BackgroundTask(cleanup_interpolation_job, job_id, "download-complete"))


@app.post("/interpolate")
async def interpolate(file: UploadFile = File(...), source_fps: float = Form(...), target_fps: float = Form(...), method: str = Form("motion")):
    if method not in INTERPOLATION_METHODS:
        raise HTTPException(400, "Metodo di interpolazione sconosciuto")
    if not 1 <= source_fps <= 480 or not 1 <= target_fps <= 480:
        raise HTTPException(400, "Frame rate fuori dai limiti supportati (1-480)")
    if target_fps <= source_fps:
        raise HTTPException(400, "Il frame rate di destinazione deve superare quello di partenza")
    with tempfile.TemporaryDirectory(prefix="mlsm-interpolate-") as workspace:
        source = Path(workspace) / "source.mp4"
        destination = Path(workspace) / "interpolated.mp4"
        try:
            await _stream_upload_limited(file, source)
        finally:
            await file.close()
        source_frames, probed_source_fps, source_duration = _interpolation_probe(source)
        if abs(probed_source_fps - source_fps) > max(.05, source_fps * INTERPOLATION_FPS_RELATIVE_TOLERANCE):
            raise HTTPException(400, f"Frame rate sorgente non coerente: dichiarati {source_fps:g} fps, rilevati {probed_source_fps:g} fps")
        backend = run_rife(source, destination, target_fps) if method == "rife" else run_ffmpeg(source, destination, target_fps, method)
        if not destination.exists() or destination.stat().st_size == 0:
            raise HTTPException(500, "L'interpolazione non ha prodotto un file utilizzabile.")
        frames, fps, duration = _interpolation_probe(destination)
        validate_interpolation_audit(
            source_frames=source_frames, source_fps=source_fps, source_duration=source_duration,
            output_frames=frames, output_fps=fps, output_duration=duration, target_fps=target_fps,
        )
        return Response(
            destination.read_bytes(),
            media_type="video/mp4",
            headers={
                "X-Interpolation-Backend": backend,
                "X-Interpolation-Method": method,
                "X-Interpolation-Target-Fps": f"{target_fps:g}",
            },
        )


if __name__ == "__main__":
    if len(sys.argv) == 7 and sys.argv[1] == "--rife-worker":
        try:
            _run_rife_worker(Path(sys.argv[2]), Path(sys.argv[3]), float(sys.argv[4]), Path(sys.argv[5]), sys.argv[6])
        except Exception as error:
            print(str(error), file=sys.stderr, flush=True)
            raise SystemExit(1) from error
        raise SystemExit(0)
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("DSAS_UPSCALER_PORT", "8765")), log_level="info")
