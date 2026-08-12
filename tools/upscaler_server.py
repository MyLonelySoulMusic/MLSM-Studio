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
event_log_lock = threading.Lock()
EVENT_LOG = VIDEO_TEMP_ROOT / "upscaler-events.jsonl"
READY_JOB_RETENTION_SECONDS = int(os.environ.get("MLSM_UPSCALER_READY_TTL", 30 * 60))
FAILED_JOB_RETENTION_SECONDS = int(os.environ.get("MLSM_UPSCALER_FAILED_TTL", 5 * 60))

RIFE_WEIGHTS = Path(os.environ.get("DSAS_RIFE_WEIGHTS", CACHE.parent / "rife"))
INTERPOLATION_METHODS = ("blend", "motion", "rife")
# Un montaggio esportato può essere lungo: il limite protegge dal riempire /tmp per errore,
# non è una restrizione editoriale.
INTERPOLATION_MAX_BYTES = int(os.environ.get("DSAS_INTERPOLATION_MAX_BYTES", 4 * 1024 ** 3))
INTERPOLATION_TIMEOUT_SECONDS = int(os.environ.get("DSAS_INTERPOLATION_TIMEOUT", 3600))

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


def schedule_video_job_cleanup(job_id: str, delay_seconds: int, reason: str) -> None:
    timer = threading.Timer(delay_seconds, cleanup_video_job, args=(job_id, reason))
    timer.daemon = True
    timer.start()


def purge_stale_video_temp() -> None:
    """A ogni avvio elimina soltanto artefatti di job appartenenti a esecuzioni precedenti."""
    with video_job_lock:
        video_jobs.clear()
        cancelled_video_clients.clear()
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
    return {"ffmpeg": bool(binary), "ffmpegPath": binary or "", "rife": rife_available(), "device": str(device_from("auto"))}


@app.get("/health")
def health():
    return {
        "ok": True, "apiVersion": 2, "capabilities": {"imageUpscale": True, "videoJobs": True},
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


def run_rife(source: Path, destination: Path, target_fps: float) -> str:
    """RIFE reuses the GPU stack already loaded for upscaling; weights stay user-provided."""
    if not rife_available():
        raise HTTPException(409, f"Pesi RIFE non presenti in {RIFE_WEIGHTS}. Copiali lì oppure scegli la stima del movimento ffmpeg.")
    try:
        from rife_interpolate import interpolate_file  # type: ignore[import-not-found]
    except ImportError as error:
        raise HTTPException(503, "Runtime RIFE non installato in questo ambiente. Usa la stima del movimento ffmpeg.") from error
    interpolate_file(str(source), str(destination), target_fps=target_fps, weights=str(RIFE_WEIGHTS), device=str(device_from("auto")))
    if not destination.exists() or destination.stat().st_size == 0:
        raise HTTPException(500, "Il runtime RIFE non ha prodotto un file utilizzabile.")
    return f"rife · {device_from('auto')}"


@app.post("/interpolate")
async def interpolate(file: UploadFile = File(...), source_fps: float = Form(...), target_fps: float = Form(...), method: str = Form("motion")):
    if method not in INTERPOLATION_METHODS:
        raise HTTPException(400, "Metodo di interpolazione sconosciuto")
    if not 1 <= source_fps <= 480 or not 1 <= target_fps <= 480:
        raise HTTPException(400, "Frame rate fuori dai limiti supportati (1-480)")
    if target_fps <= source_fps:
        raise HTTPException(400, "Il frame rate di destinazione deve superare quello di partenza")
    payload = await file.read()
    if not payload:
        raise HTTPException(400, "File vuoto")
    if len(payload) > INTERPOLATION_MAX_BYTES:
        raise HTTPException(413, "File troppo grande per il servizio di interpolazione")
    with tempfile.TemporaryDirectory(prefix="mlsm-interpolate-") as workspace:
        source = Path(workspace) / "source.mp4"
        destination = Path(workspace) / "interpolated.mp4"
        source.write_bytes(payload)
        backend = run_rife(source, destination, target_fps) if method == "rife" else run_ffmpeg(source, destination, target_fps, method)
        if not destination.exists() or destination.stat().st_size == 0:
            raise HTTPException(500, "L'interpolazione non ha prodotto un file utilizzabile.")
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
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("DSAS_UPSCALER_PORT", "8765")), log_level="info")
