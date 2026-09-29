"""Local PyTorch/Real-ESRGAN + ffmpeg service used by the web editor.

In development Vite starts this process as a child; it can also be launched explicitly
with ``npm run upscaler:server`` for diagnostics or non-Vite clients.
"""
from __future__ import annotations

import os
import json
import hashlib
import contextlib
import io
import math
import queue
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import urllib.request
import uuid
from collections.abc import Callable, Iterable
from pathlib import Path

try:
    from process_liveness import process_is_alive
except ModuleNotFoundError:  # imported as tools.upscaler_server in tests
    from tools.process_liveness import process_is_alive


def resolve_upscaler_cpu_threads(configured: str | None, logical_cpus: int | None) -> int:
    """Keep video preparation responsive while allowing an explicit override."""
    if configured:
        try:
            return max(1, min(16, int(configured)))
        except ValueError:
            pass
    # Frame extraction is support work for remote GPUs, not the main workload.
    # A quarter of the logical CPUs (maximum four) leaves the editor and OS
    # responsive even while decoding long high-FPS sources.
    return max(1, min(4, math.ceil(max(1, logical_cpus or 1) / 4)))


UPSCALER_CPU_THREADS = resolve_upscaler_cpu_threads(
    os.environ.get("MLSM_UPSCALER_CPU_THREADS"), os.cpu_count()
)
# These variables must be set before importing NumPy/OpenCV/Torch. This service
# owns its process, so constraining their native pools cannot affect the UI.
for _thread_variable in (
    "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
):
    os.environ[_thread_variable] = str(UPSCALER_CPU_THREADS)

if __name__ == "__main__":
    print("[MLSM startup] Caricamento OpenCV, NumPy e PyTorch dal runtime locale (nessun download modelli).", flush=True)

import cv2
import numpy as np
import torch
import uvicorn

cv2.setNumThreads(UPSCALER_CPU_THREADS)
torch.set_num_threads(UPSCALER_CPU_THREADS)
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    # Import reloads in diagnostics may happen after Torch initialized its pool.
    pass

# BasicSR 1.4.2 imports an alias removed from recent TorchVision releases.
# Keep the upstream Real-ESRGAN stack while exposing only the compatible symbol.
if "torchvision.transforms.functional_tensor" not in sys.modules:
    from torchvision.transforms.functional import rgb_to_grayscale

    functional_tensor = types.ModuleType("torchvision.transforms.functional_tensor")
    functional_tensor.rgb_to_grayscale = rgb_to_grayscale
    sys.modules["torchvision.transforms.functional_tensor"] = functional_tensor

from basicsr.archs.rrdbnet_arch import RRDBNet
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from realesrgan import RealESRGANer
from realesrgan.archs.srvgg_arch import SRVGGNetCompact
from starlette.background import BackgroundTask
if __name__ == "__main__":
    print("[MLSM startup] Dipendenze caricate; inizializzazione servizi video e verifica FFmpeg.", flush=True)
try:
    from remote_upscaler import (
        RemoteUpscalerError, aggregate_catalog, distribute_frames, distribute_video_chunks,
        inspect_video_chunk_endpoints, normalize_endpoint, upscale_image as remote_upscale_image,
        validate_video_chunk_endpoints,
    )
except ModuleNotFoundError:
    from tools.remote_upscaler import (
        RemoteUpscalerError, aggregate_catalog, distribute_frames, distribute_video_chunks,
        inspect_video_chunk_endpoints, normalize_endpoint, upscale_image as remote_upscale_image,
        validate_video_chunk_endpoints,
    )
try:
    try:
        from rife_runtime.adapter import get_rife_capabilities, prepare_rife, validate_rife_request
        from rife_runtime.engine import interpolate_file as practical_rife_interpolate_file
    except ModuleNotFoundError:  # imported as ``tools.upscaler_server`` in tests
        from tools.rife_runtime.adapter import get_rife_capabilities, prepare_rife, validate_rife_request
        from tools.rife_runtime.engine import interpolate_file as practical_rife_interpolate_file
except Exception as rife_import_error:  # RIFE is optional; FFmpeg must still boot.
    _RIFE_IMPORT_ERROR = str(rife_import_error)

    def get_rife_capabilities(*_args, **_kwargs):
        return {"installed": False, "ready": False, "verified": False, "reason": f"Runtime RIFE non disponibile: {_RIFE_IMPORT_ERROR}"}

    def prepare_rife(*_args, **_kwargs):
        raise RuntimeError(f"Runtime RIFE non disponibile: {_RIFE_IMPORT_ERROR}")

    def validate_rife_request(*_args, **_kwargs):
        raise RuntimeError(f"Runtime RIFE non disponibile: {_RIFE_IMPORT_ERROR}")

    def practical_rife_interpolate_file(*_args, **_kwargs):
        raise RuntimeError(f"Runtime RIFE non disponibile: {_RIFE_IMPORT_ERROR}")

try:
    from mlx_dlss_runtime import MlxDlssAdapter, MlxDlssError
except ModuleNotFoundError:
    from tools.mlx_dlss_runtime import MlxDlssAdapter, MlxDlssError

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("DSAS_UPSCALER_CACHE", ROOT / ".upscaler-cache" / "pytorch"))
CACHE.mkdir(parents=True, exist_ok=True)
VIDEO_TEMP_ROOT = Path(os.environ.get("MLSM_UPSCALER_TEMP", ROOT / "temp" / "upscaler"))
VIDEO_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
REMOTE_VIDEO_ROOT = Path(os.environ.get("MLSM_REMOTE_UPSCALER_JOBS", ROOT / ".upscaler-cache" / "remote-video-jobs"))
REMOTE_VIDEO_ROOT.mkdir(parents=True, exist_ok=True)
REMOTE_VIDEO_CHUNK_FRAMES = 100
REMOTE_VIDEO_MAX_CHUNK_FRAMES = 5000
CANVAS_MODEL_ID = "canvas"
CANVAS_VIDEO_PROCESSING_MODE = "canvas-direct-ffmpeg"
LOCAL_AI_VIDEO_PROCESSING_MODE = "local-ai-png-frames"
REMOTE_VIDEO_PROCESSING_MODE = "remote-mp4-segments"
MLX_DLSS_VIDEO_PROCESSING_MODE = "mlx-dlss-native-metal"
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
service_process_lock = threading.Lock()
service_processes: set[subprocess.Popen[object]] = set()
event_log_lock = threading.Lock()
remote_manifest_lock = threading.Lock()
remote_manifest_last_write: dict[str, float] = {}
remote_manifest_written_revision: dict[str, int] = {}
EVENT_LOG = VIDEO_TEMP_ROOT / "upscaler-events.jsonl"
READY_JOB_RETENTION_SECONDS = int(os.environ.get("MLSM_UPSCALER_READY_TTL", 30 * 60))
FAILED_JOB_RETENTION_SECONDS = int(os.environ.get("MLSM_UPSCALER_FAILED_TTL", 5 * 60))
INTERPOLATION_READY_RETENTION_SECONDS = int(os.environ.get("MLSM_INTERPOLATION_READY_TTL", 30 * 60))
INTERPOLATION_FAILED_RETENTION_SECONDS = int(os.environ.get("MLSM_INTERPOLATION_FAILED_TTL", 5 * 60))

INTERPOLATION_METHODS = ("blend", "motion", "motion-obmc", "rife")
# Un montaggio esportato può essere lungo: il limite protegge dal riempire /tmp per errore,
# non è una restrizione editoriale.
INTERPOLATION_MAX_BYTES = int(os.environ.get("DSAS_INTERPOLATION_MAX_BYTES", 4 * 1024 ** 3))
INTERPOLATION_TIMEOUT_SECONDS = int(os.environ.get("DSAS_INTERPOLATION_TIMEOUT", 3600))
INTERPOLATION_PROCESS_GRACE_SECONDS = float(os.environ.get("DSAS_INTERPOLATION_PROCESS_GRACE", "3"))
INTERPOLATION_FRAME_TOLERANCE = 1
INTERPOLATION_FPS_RELATIVE_TOLERANCE = .01
INTERPOLATION_DURATION_TOLERANCE_SECONDS = .05
REMOTE_VIDEO_TERMINAL_PHASES = frozenset(("ready", "error", "cancelled"))
REMOTE_CHECKPOINT_POLICIES = frozenset(("restart", "resume"))
MAX_CONCURRENT_VIDEO_JOBS = 1
mlx_dlss = MlxDlssAdapter()

LOCAL_APP_ORIGIN_REGEX = r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost|https?://tauri\.localhost)$"
app = FastAPI(title="MLSM Studio Upscaler", docs_url=None, redoc_url=None)
# Tauri uses ``http://tauri.localhost`` on Windows and a custom/HTTPS origin on
# the other desktop targets. Missing the HTTP variant makes health appear
# reachable in some contexts while browser-owned POSTs fail as "Failed to fetch".
app.add_middleware(CORSMiddleware, allow_origin_regex=LOCAL_APP_ORIGIN_REGEX, allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])


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
    root = (REMOTE_VIDEO_ROOT if item.get("remote") else VIDEO_TEMP_ROOT).resolve()
    workspace = Path(workspace_value).resolve()
    if workspace.parent != root:
        log_upscaler_event("backend", "job-cleanup-refused", jobId=job_id, workspace=workspace, reason=reason)
        return
    shutil.rmtree(workspace, ignore_errors=True)
    log_upscaler_event("backend", "job-cleaned", jobId=job_id, workspace=workspace, reason=reason)


def _cache_entry_size(path: Path) -> int:
    """Return an entry's size without following links outside the cache root."""
    try:
        if path.is_symlink() or path.is_file():
            return path.lstat().st_size
    except OSError:
        return 0
    total = 0
    try:
        for current, directories, files in os.walk(path, followlinks=False):
            current_path = Path(current)
            directories[:] = [name for name in directories if not (current_path / name).is_symlink()]
            for name in files:
                try:
                    total += (current_path / name).lstat().st_size
                except OSError:
                    continue
    except OSError:
        return total
    return total


def _validated_remote_cache_workspace(item: dict[str, object], root: Path) -> Path:
    """Resolve one job workspace and require the canonical root/job-id layout."""
    job_id = str(item.get("id", "")).strip()
    workspace_value = str(item.get("tempDirectory", "")).strip()
    if not job_id or not workspace_value:
        raise ValueError("identificatore o directory mancanti")
    workspace = Path(workspace_value).resolve()
    if workspace.parent != root or workspace.name != job_id:
        raise ValueError("la directory non è un workspace diretto della cache remota")
    return workspace


def _discard_remote_video_upload_locked(
    job_id: str, placeholder: dict[str, object], workspace: Path
) -> bool:
    """Remove one exact upload placeholder and its workspace while holding the job lock."""
    if video_jobs.get(job_id) is not placeholder:
        return False
    shutil.rmtree(workspace, ignore_errors=True)
    if workspace.exists():
        placeholder.update({
            "phase": "error",
            "phaseLabel": "Pulizia upload remoto non riuscita",
            "error": f"Impossibile rimuovere il workspace incompleto: {workspace}",
        })
        return False
    video_jobs.pop(job_id, None)
    return True


def discard_remote_video_upload(
    job_id: str, placeholder: dict[str, object], workspace: Path
) -> bool:
    """Atomically discard an unfinished remote upload without exposing a cache gap."""
    with video_job_lock:
        return _discard_remote_video_upload_locked(job_id, placeholder, workspace)


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


def _clear_cache_root(root: Path) -> int:
    """Clear one registered cache root without following links or removing the root."""
    if root.is_symlink():
        raise HTTPException(409, "La directory cache è un collegamento simbolico")
    root.mkdir(parents=True, exist_ok=True)
    canonical = root.resolve()
    targets: list[Path] = []
    for child in root.iterdir():
        resolved = child.resolve()
        if child.is_symlink() or resolved.parent != canonical:
            raise HTTPException(409, "La cache contiene un percorso non sicuro")
        targets.append(child)
    removed = sum(_cache_entry_size(path) for path in targets)
    for path in targets:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    return removed


def _active_local_cache_jobs() -> dict[str, list[str]]:
    with video_job_lock:
        video = [
            str(job_id) for job_id, item in video_jobs.items()
            if not item.get("remote") and item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES
        ]
    with interpolation_job_lock:
        interpolation = [
            str(job_id) for job_id, item in interpolation_jobs.items()
            if item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES
        ]
    return {"video": video, "interpolation": interpolation}


def _require_idle_local_cache() -> None:
    active = _active_local_cache_jobs()
    if active["video"] or active["interpolation"]:
        raise HTTPException(409, detail={
            "message": "La cache locale non può essere svuotata durante un job Upscaler o Frame Booster.",
            "videoJobs": active["video"],
            "interpolationJobs": active["interpolation"],
        })


@app.delete("/cache/upscaler-video-temp")
def clear_local_video_temp_cache():
    """Clear completed/orphan local video workspaces while the service stays online."""
    _require_idle_local_cache()
    VIDEO_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    removed = sum(_cache_entry_size(path) for path in VIDEO_TEMP_ROOT.iterdir())
    with video_job_lock:
        completed_video = [
            str(job_id) for job_id, item in video_jobs.items()
            if not item.get("remote") and item.get("phase") in REMOTE_VIDEO_TERMINAL_PHASES
        ]
    with interpolation_job_lock:
        completed_interpolation = [
            str(job_id) for job_id, item in interpolation_jobs.items()
            if item.get("phase") in REMOTE_VIDEO_TERMINAL_PHASES
        ]
    for job_id in completed_video:
        cleanup_video_job(job_id, "settings-cache-clear")
    for job_id in completed_interpolation:
        cleanup_interpolation_job(job_id, "settings-cache-clear")
    _clear_cache_root(VIDEO_TEMP_ROOT)
    return {"removedBytes": removed, "path": str(VIDEO_TEMP_ROOT)}


@app.delete("/cache/upscaler-models")
def clear_upscaler_model_cache():
    """Drop cached Real-ESRGAN models without requiring the service to be stopped."""
    _require_idle_local_cache()
    with lock:
        downloading = [name for name, item in status.items() if item.get("phase") in ("queued", "download")]
        if downloading:
            raise HTTPException(409, detail={
                "message": "Attendi la fine del download dei modelli prima di pulire la cache.",
                "models": downloading,
            })
        loaded.clear()
        status.clear()
        removed = _clear_cache_root(CACHE)
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return {"removedBytes": removed, "path": str(CACHE)}


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


def _stop_service_process(process: subprocess.Popen[object], grace_seconds: float = 2.0) -> None:
    """Terminate and reap one process owned by the local service."""
    try:
        if process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=grace_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=max(1.0, grace_seconds))
    except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
        try:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=1)
        except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
            pass


def _register_service_process(process: subprocess.Popen[object]) -> None:
    with service_process_lock:
        service_processes.add(process)


def _unregister_service_process(process: subprocess.Popen[object]) -> None:
    with service_process_lock:
        service_processes.discard(process)


def terminate_service_processes() -> None:
    """Bounded shutdown for ffmpeg/worker children before the API exits."""
    with service_process_lock:
        processes = list(service_processes)
        service_processes.clear()
    with interpolation_job_lock:
        processes.extend(
            process for process in interpolation_processes.values()
            if process not in processes
        )
        interpolation_processes.clear()
    for process in processes:
        _stop_service_process(process)


@app.on_event("shutdown")
def shutdown_upscaler_children() -> None:
    terminate_service_processes()


def configured_parent_pid() -> int | None:
    try:
        value = int(os.environ.get("MLSM_UPSCALER_PARENT_PID", ""))
    except ValueError:
        return None
    return value if value > 0 and value != os.getpid() else None


def start_parent_watchdog(parent_pid: int | None) -> threading.Thread | None:
    """Stop an app-owned backend when its Vite/Tauri parent disappears."""
    if parent_pid is None:
        return None

    def watch() -> None:
        while True:
            time.sleep(.5)
            if process_is_alive(parent_pid):
                continue
            terminate_service_processes()
            os.kill(os.getpid(), signal.SIGTERM)
            return

    thread = threading.Thread(target=watch, name="upscaler-parent-watchdog", daemon=True)
    thread.start()
    return thread


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


def _windows_media_tool(name: str) -> str | None:
    if sys.platform != "win32":
        return None
    executable = f"{name}.exe"
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / executable,
        Path("C:/Tools/ffmpeg/bin") / executable,
    ]
    return next((str(candidate) for candidate in candidates if candidate.is_file()), None)


def ffmpeg_binary() -> str | None:
    """Resolve FFmpeg across interactive shells, WinGet and packaged desktop starts."""
    return os.environ.get("DSAS_FFMPEG") or shutil.which("ffmpeg") or _windows_media_tool("ffmpeg")


def ffprobe_binary() -> str | None:
    configured = os.environ.get("DSAS_FFPROBE")
    if configured:
        return configured
    binary = ffmpeg_binary()
    sibling = Path(binary).with_name("ffprobe") if binary else None
    return str(sibling) if sibling and sibling.exists() else shutil.which("ffprobe") or _windows_media_tool("ffprobe")


def upscaler_ffmpeg_prefix(binary: str) -> list[str]:
    """Common low-contention prefix for frame extraction/reconstruction."""
    return [
        binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-filter_threads", str(UPSCALER_CPU_THREADS),
    ]


def upscaler_ffmpeg_codec_threads() -> list[str]:
    """Limit the next FFmpeg decoder/encoder instead of using every core."""
    return ["-threads", str(UPSCALER_CPU_THREADS)]


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


def _frame_extraction_filter(output_fps: float | None = None) -> str:
    """Preserve every decoded frame unless an output cadence was explicitly requested."""
    filters = []
    if output_fps is not None:
        filters.append(f"fps={output_fps:.12g}")
    filters.extend(("scale=trunc(iw*sar/2)*2:ih", "setsar=1"))
    return ",".join(filters)


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
    try:
        return bool(get_rife_capabilities().get("ready") and get_rife_capabilities().get("verified"))
    except Exception:
        return False


def interpolation_capabilities() -> dict[str, object]:
    binary = ffmpeg_binary()
    try:
        rife = get_rife_capabilities()
    except Exception as error:
        # RIFE belongs to the optional Video Editor path. Its manifest, model or
        # dependencies must never take down Frame Booster's FFmpeg methods.
        rife = {"installed": False, "ready": False, "verified": False, "reason": str(error)}
    return {
        "ffmpeg": bool(binary),
        "ffmpegPath": binary or "",
        "rife": rife,
        "jobs": True,
        "jobApi": True,
        "device": str(device_from("auto")),
        "automaticDevice": rife.get("automaticDevice"),
    }


@app.get("/upscale/providers/mlx-dlss")
def mlx_dlss_capabilities():
    return mlx_dlss.capabilities()


@app.post("/upscale/providers/mlx-dlss/install")
def install_mlx_dlss():
    try:
        return mlx_dlss.start_install()
    except MlxDlssError as error:
        raise HTTPException(409, str(error)) from error


@app.get("/upscale/providers/mlx-dlss/install")
def mlx_dlss_install_status():
    return mlx_dlss.install_status()


@app.delete("/upscale/providers/mlx-dlss")
def uninstall_mlx_dlss():
    try:
        mlx_dlss.uninstall()
        return {"ok": True}
    except MlxDlssError as error:
        raise HTTPException(409, str(error)) from error


@app.post("/upscale/providers/mlx-dlss/models")
async def import_mlx_dlss_model(file: UploadFile = File(...), kind: str = Form(...)):
    try:
        item = mlx_dlss.import_model(file.file, file.filename or "model", kind)
        return {"ok": True, "model": item, "models": mlx_dlss.list_models()}
    except MlxDlssError as error:
        raise HTTPException(400, str(error)) from error
    finally:
        await file.close()


@app.post("/upscale/providers/mlx-dlss/models/extract-neural")
async def extract_mlx_dlss_neural_model(file: UploadFile = File(...)):
    try:
        item = mlx_dlss.extract_neural_model(file.file, file.filename or "nvngx_dlssnr.dll")
        return {"ok": True, "model": item, "models": mlx_dlss.list_models()}
    except MlxDlssError as error:
        raise HTTPException(400, str(error)) from error
    finally:
        await file.close()


@app.delete("/upscale/providers/mlx-dlss/models/{model_id}")
def remove_mlx_dlss_model(model_id: str):
    try:
        mlx_dlss.remove_model(model_id)
        return {"ok": True, "models": mlx_dlss.list_models()}
    except MlxDlssError as error:
        raise HTTPException(400, str(error)) from error


@app.post("/upscale/providers/mlx-dlss/image")
async def upscale_mlx_dlss_image(
    file: UploadFile = File(...), options: str = Form("{}"), width: int = Form(...), height: int = Form(...),
):
    if not 64 <= width <= 16384 or not 64 <= height <= 16384:
        raise HTTPException(400, "Risoluzione finale fuori dai limiti")
    try:
        configuration = json.loads(options)
        if not isinstance(configuration, dict): raise ValueError
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(400, "Configurazione MLX-DLSS non valida") from error
    with tempfile.TemporaryDirectory(prefix="mlsm-mlx-dlss-image-") as directory:
        workspace = Path(directory)
        suffix = Path(file.filename or "source.png").suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}: suffix = ".png"
        source = workspace / f"source{suffix}"
        output = workspace / "native.png"
        source.write_bytes(await file.read())
        await file.close()
        try:
            mlx_dlss.process_image(source, output, configuration)
            image = cv2.imread(str(output), cv2.IMREAD_UNCHANGED)
            if image is None: raise MlxDlssError("Output immagine MLX-DLSS illeggibile")
            if image.shape[1] != width or image.shape[0] != height:
                image = cv2.resize(image, (width, height), interpolation=cv2.INTER_LANCZOS4)
            ok, encoded = cv2.imencode(".png", image, [cv2.IMWRITE_PNG_COMPRESSION, 2])
            if not ok: raise MlxDlssError("Codifica PNG MLX-DLSS fallita")
            return Response(encoded.tobytes(), media_type="image/png", headers={"X-Upscaler-Backend": "mlx-dlss-metal"})
        except InterruptedError as error:
            raise HTTPException(499, str(error)) from error
        except MlxDlssError as error:
            raise HTTPException(503, str(error)) from error


@app.get("/health")
def health():
    parent_pid = configured_parent_pid()
    return {
        "ok": True, "apiVersion": 7, "capabilities": {
            "imageUpscale": True, "videoJobs": True, "remoteUpscale": True,
            "remoteVideoCheckpointPolicy": True, "remoteVideoCache": True,
            "remoteVideoPartialEndpointPreflight": True,
            "canvasVideoStreaming": True,
            "interpolationJobs": True, "mlxDlssProvider": True,
        },
        **hardware(), "interpolation": interpolation_capabilities(), "videoTempDirectory": str(VIDEO_TEMP_ROOT),
        "remoteVideoDirectory": str(REMOTE_VIDEO_ROOT),
        "pid": os.getpid(),
        "parentPid": parent_pid,
        "ownerKind": os.environ.get("MLSM_UPSCALER_OWNER_KIND", "external"),
        "diagnosticLogPath": os.environ.get("MLSM_UPSCALER_LOG_PATH", str(EVENT_LOG)),
        "resourceLimits": {
            "cpuThreads": UPSCALER_CPU_THREADS,
            "maxConcurrentVideoJobs": MAX_CONCURRENT_VIDEO_JOBS,
        },
    }


@app.post("/upscale/remote/catalog")
def remote_upscale_catalog(payload: dict[str, object] = Body(...)):
    endpoints = payload.get("endpoints")
    if not isinstance(endpoints, list) or not all(isinstance(item, str) for item in endpoints):
        raise HTTPException(400, "Elenco endpoint remoto non valido")
    try:
        return aggregate_catalog(endpoints)
    except RemoteUpscalerError as error:
        raise HTTPException(502, str(error)) from error


@app.post("/upscale/remote/video/preflight")
def remote_video_endpoint_preflight(payload: dict[str, object] = Body(...)):
    endpoints = payload.get("endpoints")
    model = payload.get("model")
    chunk_frames = payload.get("segmentFrames", REMOTE_VIDEO_CHUNK_FRAMES)
    output_fps = payload.get("outputFps")
    if (
        not isinstance(endpoints, list)
        or not all(isinstance(item, str) for item in endpoints)
        or not isinstance(model, str)
        or not model.strip()
    ):
        raise HTTPException(400, "Configurazione verifica endpoint non valida")
    try:
        frames = int(chunk_frames)
        fps = None if output_fps is None else float(output_fps)
        if not 1 <= frames <= REMOTE_VIDEO_MAX_CHUNK_FRAMES:
            raise ValueError
        if fps is not None and (not math.isfinite(fps) or not 1 <= fps <= 480):
            raise ValueError
        return inspect_video_chunk_endpoints(
            endpoints, model.strip(), chunk_frames=frames, output_fps=fps
        )
    except (RemoteUpscalerError, TypeError, ValueError) as error:
        raise HTTPException(400, str(error)) from error


@app.post("/upscale/remote/image")
async def remote_upscale_single_image(
    file: UploadFile = File(...), endpoints: str = Form(...), model: str = Form(...),
    width: int = Form(...), height: int = Form(...),
):
    if width < 64 or height < 64 or width > 16384 or height > 16384:
        raise HTTPException(400, "Risoluzione finale fuori dai limiti")
    try:
        values = json.loads(endpoints)
        if not isinstance(values, list) or not values or len(values) > 16 or not model.strip() or len(model) > 200:
            raise ValueError
        normalized = [normalize_endpoint(str(item)) for item in values]
    except (ValueError, TypeError, json.JSONDecodeError, RemoteUpscalerError) as error:
        raise HTTPException(400, "Endpoint remoti non validi") from error
    source = await file.read()
    await file.close()
    errors: list[str] = []
    for endpoint in normalized:
        try:
            output = remote_upscale_image(endpoint, source, model)
            decoded = cv2.imdecode(np.frombuffer(output, dtype=np.uint8), cv2.IMREAD_COLOR)
            if decoded is None:
                raise RemoteUpscalerError("Output remoto non decodificabile")
            if decoded.shape[1] != width or decoded.shape[0] != height:
                decoded = cv2.resize(decoded, (width, height), interpolation=cv2.INTER_LANCZOS4)
            ok, encoded = cv2.imencode(".png", decoded, [cv2.IMWRITE_PNG_COMPRESSION, 2])
            if not ok:
                raise RemoteUpscalerError("Codifica output remoto fallita")
            return Response(encoded.tobytes(), media_type="image/png", headers={"X-Upscaler-Remote": endpoint})
        except Exception as error:
            errors.append(f"{endpoint}: {error}")
    raise HTTPException(502, "Tutti gli endpoint remoti hanno fallito. " + " | ".join(errors[-3:]))


@app.get("/interpolation/health")
def interpolation_health():
    binary = ffmpeg_binary()
    # Frame Booster uses only Motion and Blend. Keep this health endpoint fully
    # independent from RIFE model discovery/checksums and GPU initialization.
    return {"ok": True, "interpolation": {"ffmpeg": bool(binary), "ffmpegPath": binary or "", "jobs": True, "jobApi": True}}

@app.get("/interpolation/rife/status")
def interpolation_rife_status():
    return {"ok": True, "rife": get_rife_capabilities()}

@app.post("/interpolation/rife/prepare")
def interpolation_rife_prepare(model: str = Form("rife-v4.26")):
    if model != "rife-v4.26":
        raise HTTPException(400, "Modello RIFE non supportato")
    try:
        offline_artifact = os.environ.get("MLSM_RIFE_ARTIFACT")
        prepare_rife(model, Path(offline_artifact) if offline_artifact else None)
        capability = get_rife_capabilities(run_self_test=True)
    except Exception as error:
        raise HTTPException(503, f"Preparazione RIFE fallita: {error}") from error
    if not capability.get("ready") or not capability.get("selfTest"):
        raise HTTPException(503, str(capability.get("reason", "Self-test RIFE fallito")))
    return {"phase": "ready", **capability}


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
    snapshot: dict[str, object] | None = None
    force_manifest = "phase" in patch or "resultPath" in patch
    with video_job_lock:
        current = video_jobs.get(job_id)
        if current is not None:
            if current.get("remote") and current.get("phase") == "cancelled" and patch.get("phase") != "cancelled":
                return
            current.update(patch)
            if current.get("remote"):
                current["manifestRevision"] = int(current.get("manifestRevision", 0)) + 1
                snapshot = dict(current)
    if snapshot is not None:
        persist_remote_video_job(snapshot, force=force_manifest)


def persist_remote_video_job(item: dict[str, object], *, force: bool = True) -> None:
    job_id = str(item.get("id", "")).strip()
    workspace = Path(str(item.get("tempDirectory", "")))
    try:
        root = REMOTE_VIDEO_ROOT.resolve()
        workspace = workspace.resolve()
        # Lock order is always job registry -> manifest. Cache DELETE owns the
        # same registry lock while deleting and unregistering workspaces, so a
        # stale snapshot can neither recreate a cleared directory nor publish
        # job.json after its job has disappeared.
        with video_job_lock:
            current = video_jobs.get(job_id)
            if (
                not job_id
                or current is None
                or not current.get("remote")
                or workspace.parent != root
                or workspace.name != job_id
                or Path(str(current.get("tempDirectory", ""))).resolve() != workspace
                or current != item
            ):
                return
            revision = int(item.get("manifestRevision", 0) or 0)
            current_revision = int(current.get("manifestRevision", 0) or 0)
            if revision != current_revision:
                return
            with remote_manifest_lock:
                written_revision = remote_manifest_written_revision.get(job_id, -1)
                now = time.monotonic()
                if revision < written_revision or (not force and (revision == written_revision or now - remote_manifest_last_write.get(job_id, 0) < .75)):
                    return
                workspace.mkdir(parents=True, exist_ok=True)
                temporary = workspace / ".job.json.partial"
                temporary.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
                temporary.replace(workspace / "job.json")
                remote_manifest_written_revision[job_id] = revision
                remote_manifest_last_write[job_id] = now
    except (OSError, ValueError, TypeError) as error:
        log_upscaler_event("backend", "remote-manifest-error", jobId=item.get("id"), error=str(error))


def restore_remote_video_jobs() -> None:
    restored = 0
    for manifest in REMOTE_VIDEO_ROOT.glob("*/job.json"):
        try:
            item = json.loads(manifest.read_text(encoding="utf-8"))
            workspace = Path(str(item.get("tempDirectory", ""))).resolve()
            if not isinstance(item, dict) or not item.get("remote") or workspace.parent != REMOTE_VIDEO_ROOT.resolve():
                continue
            if item.get("phase") not in ("ready", "error", "cancelled"):
                item.update({
                    "phase": "error", "phaseLabel": "Servizio riavviato · job pronto per la ripresa",
                    "error": "Il servizio locale è stato riavviato; i frame completati sono conservati.",
                    "resumable": True,
                })
            # No restored process owns a live Gradio request, even when a
            # previous startup already converted the manifest to `error`.
            item.update({"activeEndpoints": [], "activeEndpoint": None, "endpointActivity": []})
            with video_job_lock:
                video_jobs[str(item["id"])] = item
            persist_remote_video_job(item)
            restored += 1
        except (OSError, ValueError, TypeError, json.JSONDecodeError, KeyError):
            continue
    if restored:
        log_upscaler_event("backend", "remote-jobs-restored", count=restored)


@app.on_event("startup")
def restore_remote_jobs_on_startup() -> None:
    restore_remote_video_jobs()


def video_job_cancelled(job_id: str) -> bool:
    with video_job_lock:
        return bool(video_jobs.get(job_id, {}).get("cancelRequested"))


def active_video_job_ids_locked(exclude: str | None = None) -> list[str]:
    """Return CPU-heavy video jobs while the caller owns ``video_job_lock``."""
    return [
        str(job_id) for job_id, item in video_jobs.items()
        if job_id != exclude and item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES
    ]


def run_checked(
    command: list[str], timeout: int = INTERPOLATION_TIMEOUT_SECONDS,
    *, cancelled: Callable[[], bool] | None = None,
) -> None:
    if cancelled is not None and cancelled():
        raise InterruptedError("Job annullato prima dell'avvio di ffmpeg")
    if cancelled is not None:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        _register_service_process(process)
        try:
            started = time.monotonic()
            while True:
                try:
                    _, stderr = process.communicate(timeout=.25)
                    break
                except subprocess.TimeoutExpired:
                    if cancelled():
                        _stop_service_process(process, 3)
                        raise InterruptedError("Job annullato durante l'esecuzione di ffmpeg")
                    if time.monotonic() - started >= timeout:
                        _stop_service_process(process, 3)
                        raise RuntimeError("ffmpeg non ha terminato entro il tempo massimo")
            if process.returncode != 0:
                detail = (stderr or b"").decode("utf-8", "replace").strip()[-900:]
                raise RuntimeError(f"ffmpeg ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")
        finally:
            if process.poll() is None:
                _stop_service_process(process)
            _unregister_service_process(process)
        return
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("ffmpeg non ha terminato entro il tempo massimo") from error
    if result.returncode != 0:
        detail = (result.stderr or b"").decode("utf-8", "replace").strip()[-900:]
        raise RuntimeError(f"ffmpeg ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")


def _ffmpeg_timestamp_seconds(value: str) -> float | None:
    """Parse the HH:MM:SS.microseconds timestamp emitted by ``ffmpeg -progress``."""
    try:
        hours, minutes, seconds = value.strip().split(":", 2)
        parsed = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed >= 0 else None


def run_checked_with_progress(
    command: list[str], duration_seconds: float,
    *, cancelled: Callable[[], bool],
    on_progress: Callable[[float, float, float | None], None],
    timeout: int = INTERPOLATION_TIMEOUT_SECONDS,
) -> None:
    """Run FFmpeg while consuming machine-readable progress on every platform.

    A reader thread is used instead of ``select`` because Windows cannot select
    subprocess pipes. Stderr is merged into the same bounded diagnostic stream,
    so FFmpeg can never deadlock on a full pipe during a long 4K/8K encode.
    """
    if cancelled():
        raise InterruptedError("Job annullato prima dell'avvio di ffmpeg")
    progress_command = [*command[:-1], "-progress", "pipe:1", "-nostats", command[-1]]
    process = subprocess.Popen(
        progress_command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    _register_service_process(process)
    messages: queue.Queue[str | None] = queue.Queue()
    output_tail: list[str] = []

    def read_output() -> None:
        try:
            if process.stdout is not None:
                for line in process.stdout:
                    messages.put(line)
        finally:
            messages.put(None)

    reader = threading.Thread(target=read_output, name="mlsm-ffmpeg-progress", daemon=True)
    reader.start()
    started = time.monotonic()
    reader_finished = False
    last_fraction = -1.0
    try:
        while process.poll() is None or not reader_finished:
            try:
                line = messages.get(timeout=.25)
            except queue.Empty:
                line = ""
            if line is None:
                reader_finished = True
            elif line:
                stripped = line.strip()
                output_tail.append(stripped)
                del output_tail[:-120]
                seconds = None
                if stripped.startswith("out_time_us="):
                    try:
                        seconds = int(stripped.partition("=")[2]) / 1_000_000
                    except ValueError:
                        seconds = None
                elif stripped.startswith("out_time="):
                    seconds = _ffmpeg_timestamp_seconds(stripped.partition("=")[2])
                if seconds is not None and duration_seconds > 0:
                    fraction = max(0.0, min(1.0, seconds / duration_seconds))
                    if fraction >= 1 or fraction - last_fraction >= .0025:
                        elapsed = time.monotonic() - started
                        remaining = elapsed / fraction * (1 - fraction) if fraction > 0 else None
                        on_progress(fraction, elapsed, remaining)
                        last_fraction = fraction
            if cancelled():
                _stop_service_process(process, 3)
                raise InterruptedError("Job annullato durante l'esecuzione di ffmpeg")
            if time.monotonic() - started >= timeout:
                _stop_service_process(process, 3)
                raise RuntimeError("ffmpeg non ha terminato entro il tempo massimo")
        reader.join(timeout=1)
        if process.returncode != 0:
            detail = "\n".join(output_tail).strip()[-900:]
            raise RuntimeError(f"ffmpeg ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")
        elapsed = time.monotonic() - started
        on_progress(1.0, elapsed, 0.0)
    finally:
        if process.poll() is None:
            _stop_service_process(process)
        reader.join(timeout=1)
        if process.stdout is not None:
            process.stdout.close()
        _unregister_service_process(process)


def canvas_enhance(frame: np.ndarray, width: int, height: int) -> np.ndarray:
    resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_LANCZOS4)
    blurred = cv2.GaussianBlur(resized, (0, 0), 1.05)
    return cv2.addWeighted(resized, 1.16, blurred, -0.16, 0)


UPSCALER_ADJUSTMENT_DEFAULTS: dict[str, float] = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "saturation": 0.0, "vibrance": 0.0,
    "temperature": 0.0, "tint": 0.0, "sharpness": 0.0, "denoise": 0.0,
}


def parse_upscaler_adjustments(raw: str) -> dict[str, float]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError as error:
        raise ValueError("Regolazioni immagine non valide") from error
    if not isinstance(value, dict) or any(key not in UPSCALER_ADJUSTMENT_DEFAULTS for key in value):
        raise ValueError("Regolazioni immagine non valide")
    parsed = dict(UPSCALER_ADJUSTMENT_DEFAULTS)
    for key, default in parsed.items():
        candidate = value.get(key, default)
        if isinstance(candidate, bool) or not isinstance(candidate, (int, float)) or not math.isfinite(float(candidate)):
            raise ValueError(f"Regolazione {key} non valida")
        minimum, maximum = ((-2.0, 2.0) if key == "exposure" else (0.0, 100.0) if key in ("sharpness", "denoise") else (-100.0, 100.0))
        parsed[key] = max(minimum, min(maximum, float(candidate)))
    return parsed


def apply_upscaler_adjustments(frame: np.ndarray, adjustments: dict[str, float]) -> np.ndarray:
    """Replica sul video completo la correzione mostrata dal renderer Canvas."""
    item = adjustments
    brightness = 2 ** item["exposure"] * (1 + (item["whites"] + item["highlights"] * .35 + item["shadows"] * .15 + item["blacks"] * .1) / 500)
    contrast = 1 + item["contrast"] / 100 + (item["whites"] - item["blacks"]) / 600
    saturation = max(0.0, 1 + (item["saturation"] + item["vibrance"] * .65) / 100)
    output = frame.astype(np.float32) / 255.0
    output = (output * max(.05, brightness) - .5) * max(.05, contrast) + .5
    gray = cv2.cvtColor(np.clip(output, 0, 1), cv2.COLOR_BGR2GRAY)[..., None]
    output = gray + (output - gray) * saturation
    output[..., 2] += item["temperature"] / 100 * .12
    output[..., 0] -= item["temperature"] / 100 * .12
    output[..., 1] += item["tint"] / 100 * .10
    output[..., (0, 2)] -= item["tint"] / 100 * .035
    output = np.clip(output * 255.0, 0, 255).astype(np.uint8)
    if item["denoise"] > 0:
        sigma = min(1.2, item["denoise"] / 90)
        output = cv2.GaussianBlur(output, (0, 0), max(.05, sigma))
    if item["sharpness"] > 0:
        amount = min(.42, item["sharpness"] / 240)
        blurred = cv2.GaussianBlur(output, (0, 0), 1.0)
        output = cv2.addWeighted(output, 1 + amount, blurred, -amount, 0)
    return output


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
        probe, *upscaler_ffmpeg_codec_threads(), "-v", "error", "-select_streams", "v:0", "-show_frames",
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
        probe, *upscaler_ffmpeg_codec_threads(), "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=nb_read_frames", "-of", "default=nokey=1:noprint_wrappers=1", str(path)
    ], capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError("ffprobe non riesce a verificare il video ricomposto")
    return int((result.stdout or b"0").decode("utf-8", "replace").strip() or 0)


def _positive_rate(value: object) -> float:
    """Parse an ffprobe frame-rate fraction without accepting invalid clocks."""
    text = str(value or "0").strip()
    try:
        if "/" in text:
            numerator, denominator = text.split("/", 1)
            rate = float(numerator) / float(denominator)
        else:
            rate = float(text)
    except (ValueError, ZeroDivisionError):
        return 0.0
    return rate if np.isfinite(rate) and rate > 0 else 0.0


def probe_video_timeline(path: Path, output_fps: float | None = None) -> tuple[int, float, float]:
    """Read frame count, cadence and duration without materialising image files.

    MP4/MOV normally expose ``nb_frames`` directly, making this operation nearly
    instantaneous. Containers without an index use ffprobe's packet/frame count
    fallback, which still avoids PNG compression and disk I/O.
    """
    probe = ffprobe_binary()
    if not probe:
        raise RuntimeError("ffprobe non disponibile: impossibile analizzare la timeline video")

    def read(count_frames: bool) -> dict[str, object]:
        command = [
            probe, "-v", "error", "-select_streams", "v:0",
            *( ["-count_frames"] if count_frames else [] ),
            "-show_entries", "stream=avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,duration:format=duration",
            "-of", "json", str(path),
        ]
        result = subprocess.run(command, capture_output=True, check=False)
        if result.returncode != 0:
            detail = (result.stderr or b"").decode("utf-8", "replace").strip()[-500:]
            raise RuntimeError(f"ffprobe non riesce a leggere la timeline: {detail or 'nessun dettaglio disponibile'}")
        try:
            return json.loads(result.stdout or b"{}")
        except json.JSONDecodeError as error:
            raise RuntimeError("ffprobe ha restituito una timeline non valida") from error

    payload = read(False)
    streams = payload.get("streams") if isinstance(payload, dict) else None
    stream = streams[0] if isinstance(streams, list) and streams and isinstance(streams[0], dict) else {}
    count = int(stream.get("nb_frames") or 0)
    if count <= 0:
        payload = read(True)
        streams = payload.get("streams") if isinstance(payload, dict) else None
        stream = streams[0] if isinstance(streams, list) and streams and isinstance(streams[0], dict) else {}
        count = int(stream.get("nb_read_frames") or stream.get("nb_frames") or 0)
    formats = payload.get("format") if isinstance(payload, dict) else None
    duration = float(stream.get("duration") or (formats.get("duration") if isinstance(formats, dict) else 0) or 0)
    source_fps = _positive_rate(stream.get("avg_frame_rate")) or _positive_rate(stream.get("r_frame_rate"))
    if not np.isfinite(duration) or duration <= 0:
        duration = count / source_fps if count > 0 and source_fps > 0 else 0.0
    if count <= 0 or source_fps <= 0 or duration <= 0:
        raise RuntimeError("Il video non espone un conteggio frame o una durata valida")
    if output_fps is not None:
        source_fps = output_fps
        count = max(1, int(round(duration * output_fps)))
    return count, source_fps, duration


def valid_remote_video_segment(path: Path, expected_frames: int) -> bool:
    """Validate a durable MP4 checkpoint before it is trusted or reused."""
    try:
        with path.open("rb") as source:
            header = source.read(12)
        return (
            path.stat().st_size > 0
            and len(header) >= 8
            and header[4:8] == b"ftyp"
            and encoded_video_frame_count(path) == expected_frames
        )
    except (OSError, RuntimeError, ValueError):
        return False


def build_remote_video_segments(
    originals: list[Path], fps: float, workspace: Path, *, chunk_frames: int = REMOTE_VIDEO_CHUNK_FRAMES,
    cancelled: Callable[[], bool] | None = None,
) -> list[tuple[Path, int]]:
    """Encode ordered source PNGs into independently retryable MP4 chunks."""
    binary = ffmpeg_binary()
    if not binary:
        raise RuntimeError("ffmpeg non trovato: impossibile creare i segmenti remoti")
    segment_dir = workspace / "input-segments"
    segment_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[tuple[Path, int]] = []
    for zero_start in range(0, len(originals), chunk_frames):
        expected = min(chunk_frames, len(originals) - zero_start)
        target = segment_dir / f"segment-{zero_start // chunk_frames + 1:06d}.mp4"
        if not valid_remote_video_segment(target, expected):
            target.unlink(missing_ok=True)
            partial = segment_dir / f".{target.name}.partial.mp4"
            partial.unlink(missing_ok=True)
            run_checked([
                *upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(),
                "-framerate", f"{fps:.12g}", "-start_number", str(zero_start + 1),
                "-i", str(workspace / "original-frames" / "frame-%08d.png"),
                "-frames:v", str(expected), "-an", "-c:v", "libx264", "-preset", "ultrafast",
                "-crf", "12", "-pix_fmt", "yuv444p", "-movflags", "+faststart",
                *upscaler_ffmpeg_codec_threads(), str(partial),
            ], cancelled=cancelled)
            if not valid_remote_video_segment(partial, expected):
                partial.unlink(missing_ok=True)
                raise RuntimeError(f"Segmento sorgente non valido: {target.name}")
            partial.replace(target)
        chunks.append((target, expected))
    return chunks


def build_remote_video_segments_from_source(
    source: Path, total_frames: int, fps: float, workspace: Path, *,
    chunk_frames: int = REMOTE_VIDEO_CHUNK_FRAMES,
    output_fps: float | None = None,
    cancelled: Callable[[], bool] | None = None,
    on_progress: Callable[[int, int, int], None] = lambda *_: None,
) -> list[tuple[Path, int]]:
    """Create durable remote chunks in one streaming decode pass.

    The legacy path first wrote every decoded frame as a compressed PNG and
    immediately read those PNGs again to create MP4 chunks. For long videos that
    produced tens of thousands of files and hours of avoidable CPU/disk work.
    This path preserves every frame (unless an FPS conversion was explicitly
    requested) and writes the resumable MP4 chunks directly.
    """
    if total_frames <= 0 or not np.isfinite(fps) or fps <= 0:
        raise RuntimeError("Timeline non valida per la segmentazione remota")
    binary = ffmpeg_binary()
    if not binary:
        raise RuntimeError("ffmpeg non trovato: impossibile creare i segmenti remoti")
    segment_dir = workspace / "input-segments"
    expected = [
        (segment_dir / f"segment-{index + 1:06d}.mp4", min(chunk_frames, total_frames - index * chunk_frames))
        for index in range(math.ceil(total_frames / chunk_frames))
    ]
    if expected and all(valid_remote_video_segment(path, count) for path, count in expected):
        on_progress(len(expected), len(expected), total_frames)
        return expected
    shutil.rmtree(segment_dir, ignore_errors=True)
    segment_dir.mkdir(parents=True, exist_ok=True)
    filters = _frame_extraction_filter(output_fps)
    # Force a constant timestamp grid without dropping frames. The explicit fps
    # filter remains the only operation allowed to alter the source frame count.
    filters = f"{filters},settb=AVTB,setpts=N/({fps:.12g}*TB)"
    command = [
        *upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(), "-i", str(source),
        "-map", "0:v:0", "-an", "-vf", filters, "-r", f"{fps:.12g}", "-fps_mode", "cfr",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv444p",
        "-g", str(chunk_frames), "-keyint_min", str(chunk_frames), "-sc_threshold", "0",
        "-f", "segment", "-reset_timestamps", "1", "-segment_start_number", "1",
        "-segment_time", f"{chunk_frames / fps:.12g}",
    ]
    command.extend((*upscaler_ffmpeg_codec_threads(), str(segment_dir / "segment-%06d.mp4")))
    monitor_done = threading.Event()

    def monitor_segments() -> None:
        reported = -1
        while not monitor_done.wait(.25):
            # The last visible path is the file FFmpeg is still writing. Every
            # preceding segment has already been closed by the segment muxer.
            closed = max(0, len(list(segment_dir.glob("segment-*.mp4"))) - 1)
            if closed != reported:
                reported = closed
                on_progress(closed, len(expected), min(total_frames, closed * chunk_frames))

    monitor = threading.Thread(target=monitor_segments, name="upscaler-segment-progress", daemon=True)
    monitor.start()
    try:
        run_checked(command, cancelled=cancelled)
    finally:
        monitor_done.set()
        monitor.join(timeout=1)
    generated = sorted(segment_dir.glob("segment-*.mp4"))
    if len(generated) != len(expected):
        raise RuntimeError(f"Segmentazione incompleta: ottenuti {len(generated)}/{len(expected)} segmenti")
    for path, count in expected:
        if not valid_remote_video_segment(path, count):
            raise RuntimeError(f"Segmento sorgente non valido: {path.name}")
    on_progress(len(expected), len(expected), total_frames)
    return expected


def materialize_remote_video_segments(
    chunks: list[tuple[Path, int]], enhanced: Path, workspace: Path,
    *, on_progress: Callable[[int, int, int], None] = lambda *_: None,
    cancelled: Callable[[], bool] | None = None,
) -> int:
    """Decode checkpointed output chunks back into the canonical ordered frame set."""
    binary = ffmpeg_binary()
    if not binary:
        raise RuntimeError("ffmpeg non trovato: impossibile ricostruire i segmenti remoti")
    decoded_root = workspace / "decoded-segments"
    enhanced.mkdir(parents=True, exist_ok=True)
    global_index = 1
    for segment_index, (chunk, expected) in enumerate(chunks, start=1):
        if not valid_remote_video_segment(chunk, expected):
            raise RuntimeError(f"Checkpoint segmento non valido: {chunk.name}")
        decoded = decoded_root / f"segment-{segment_index:06d}"
        shutil.rmtree(decoded, ignore_errors=True)
        decoded.mkdir(parents=True, exist_ok=True)
        run_checked([
            *upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(), "-i", str(chunk),
            "-vsync", "0", *upscaler_ffmpeg_codec_threads(), str(decoded / "frame-%08d.png"),
        ], cancelled=cancelled)
        frames = sorted(decoded.glob("frame-*.png"))
        if len(frames) != expected:
            raise RuntimeError(f"Segmento {chunk.name}: decodificati {len(frames)}/{expected} frame")
        for frame in frames:
            destination = enhanced / f"frame-{global_index:08d}.png"
            frame.replace(destination)
            global_index += 1
        shutil.rmtree(decoded, ignore_errors=True)
        on_progress(segment_index, len(chunks), global_index - 1)
    shutil.rmtree(decoded_root, ignore_errors=True)
    return global_index - 1


def encoded_video_duration(path: Path) -> float:
    probe = ffprobe_binary()
    if not probe:
        raise RuntimeError("ffprobe non disponibile: impossibile verificare la durata del video finale")
    result = subprocess.run([
        probe, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nokey=1:noprint_wrappers=1", str(path),
    ], capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError("ffprobe non riesce a verificare la durata del video ricomposto")
    try:
        duration = float((result.stdout or b"0").decode("utf-8", "replace").strip() or 0)
    except ValueError as error:
        raise RuntimeError("ffprobe ha restituito una durata non valida") from error
    if not np.isfinite(duration) or duration <= 0:
        raise RuntimeError("Il video ricomposto non contiene una timeline valida")
    return duration


def audio_packet_count(path: Path) -> int:
    probe = ffprobe_binary()
    if not probe:
        return 0
    result = subprocess.run([
        probe, "-v", "error", "-select_streams", "a:0", "-count_packets",
        "-show_entries", "stream=nb_read_packets", "-of", "default=nokey=1:noprint_wrappers=1", str(path),
    ], capture_output=True, check=False)
    if result.returncode != 0:
        return 0
    try:
        return max(0, int((result.stdout or b"0").decode("utf-8", "replace").strip() or 0))
    except ValueError:
        return 0


def video_adjustment_filter(
    width: int, height: int, adjustments: dict[str, float], *, canvas_enhancement: bool = False,
) -> str:
    """Build a streaming scale/colour filter equivalent to frame rendering.

    Canvas adds its deterministic base sharpening. Remote AI segments already
    contain their enhancement and only need final sizing and user adjustments.
    """
    item = adjustments
    brightness = 2 ** item["exposure"] * (
        1 + (item["whites"] + item["highlights"] * .35 + item["shadows"] * .15 + item["blacks"] * .1) / 500
    )
    contrast = 1 + item["contrast"] / 100 + (item["whites"] - item["blacks"]) / 600
    saturation = max(0.0, 1 + (item["saturation"] + item["vibrance"] * .65) / 100)
    gain = max(.05, brightness) * max(.05, contrast)
    offset = (.5 - .5 * max(.05, contrast)) * 255

    def affine(channel_offset: float = 0.0) -> str:
        constant = offset + channel_offset * 255
        return f"val*{gain:.8g}{constant:+.8g}"

    red_shift = item["temperature"] / 100 * .12 - item["tint"] / 100 * .035
    green_shift = item["tint"] / 100 * .10
    blue_shift = -item["temperature"] / 100 * .12 - item["tint"] / 100 * .035
    filters = [f"scale={width}:{height}:flags=lanczos"]
    if canvas_enhancement:
        filters.append("unsharp=5:5:0.16:5:5:0")
    filters.extend([
        f"lutrgb=r={affine()}:g={affine()}:b={affine()}",
        f"hue=s={saturation:.8g}",
        f"lutrgb=r=val{red_shift * 255:+.8g}:g=val{green_shift * 255:+.8g}:b=val{blue_shift * 255:+.8g}",
    ])
    if item["denoise"] > 0:
        filters.append(f"gblur=sigma={min(1.2, item['denoise'] / 90):.8g}")
    if item["sharpness"] > 0:
        filters.append(f"unsharp=5:5:{min(.42, item['sharpness'] / 240):.8g}:5:5:0")
    filters.append("setsar=1")
    return ",".join(filters)


def video_adjustments_are_neutral(adjustments: dict[str, float]) -> bool:
    """True when the remote AI output can be muxed without decoding frames."""
    return all(abs(float(adjustments.get(key, 0.0))) <= 1e-9 for key in UPSCALER_ADJUSTMENT_DEFAULTS)


def effective_video_adjustments(job: dict[str, object]) -> dict[str, float]:
    """Apply video corrections only after the user explicitly enables them."""
    if not bool(job.get("applyVideoAdjustments", False)):
        return dict(UPSCALER_ADJUSTMENT_DEFAULTS)
    return parse_upscaler_adjustments(json.dumps(job.get("adjustments", {})))


def canvas_video_filter(width: int, height: int, adjustments: dict[str, float]) -> str:
    """Streaming equivalent of Canvas enhancement and adjustments."""
    return video_adjustment_filter(width, height, adjustments, canvas_enhancement=True)


def video_job_is_remote(job: dict[str, object]) -> bool:
    """Read persisted remote flags without treating the string ``false`` as true."""
    value = job.get("remote", False)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value == 1
    return str(value).strip().casefold() in {"1", "true", "yes", "on"}


def canonical_local_video_model(value: object) -> str:
    """Canonicalise the sole non-AI model while preserving exact AI identifiers."""
    model = str(value).strip()
    return CANVAS_MODEL_ID if model.casefold() == CANVAS_MODEL_ID else model


def video_processing_mode(job: dict[str, object]) -> str:
    if job.get("provider") == "mlx-dlss":
        return MLX_DLSS_VIDEO_PROCESSING_MODE
    if video_job_is_remote(job):
        return REMOTE_VIDEO_PROCESSING_MODE
    if canonical_local_video_model(job.get("model", "")) == CANVAS_MODEL_ID:
        return CANVAS_VIDEO_PROCESSING_MODE
    return LOCAL_AI_VIDEO_PROCESSING_MODE


def process_mlx_dlss_video_job(
    job_id: str, job: dict[str, object], source: Path, result_path: Path, binary: str, started: float,
) -> None:
    """Run the upstream native AVFoundation/Metal pipeline as one cancellable job."""
    total, source_fps, expected_duration = probe_video_timeline(source)
    configuration = dict(job.get("providerConfig", {}))
    start_seconds = max(0.0, float(job.get("sourceStartSeconds", 0) or 0))
    preview_seconds = max(0.0, float(job.get("sourceDurationSeconds", 0) or 0))
    if start_seconds or preview_seconds:
        start_frame = min(max(0, total - 1), int(round(start_seconds * source_fps)))
        selected_frames = min(total - start_frame, max(1, int(round(preview_seconds * source_fps)))) if preview_seconds else total - start_frame
        configuration.update(startFrame=start_frame, frames=selected_frames)
        total = selected_frames
        expected_duration = selected_frames / source_fps
    configuration["audioPolicy"] = str(configuration.get("audioPolicy", "preserve"))
    codec = str(configuration.get("codec", "h264"))
    native_path = result_path.with_suffix(".mov" if codec == "prores" else ".native.mp4")
    update_video_job(job_id, phase="upscaling", phaseLabel="MLX-DLSS · elaborazione Metal nativa", progress=.03, totalFrames=total)

    def report(item: dict[str, object]) -> None:
        native_progress = float(item.get("progress", 0) or 0)
        current = int(item.get("currentFrame", round(native_progress * total)) or 0)
        elapsed = float(item.get("elapsedSeconds", 0) or 0) or (time.monotonic() - started)
        remaining = (elapsed / current * (total - current)) if current > 0 and total > current else (0 if current >= total else None)
        update_video_job(
            job_id, phase="upscaling", phaseLabel="MLX-DLSS · elaborazione Metal",
            progress=max(.01, min(.95, native_progress)), currentFrame=min(total, current), totalFrames=total,
            elapsedSeconds=elapsed, estimatedRemainingSeconds=remaining,
        )

    mlx_dlss.process_video(source, native_path, configuration, cancelled=lambda: video_job_cancelled(job_id), progress=report)
    if video_job_cancelled(job_id): raise InterruptedError("Job MLX-DLSS annullato")
    target_width, target_height = int(job["width"]), int(job["height"])
    geometry = probe_video_geometry(native_path)
    needs_resize = int(geometry["width"]) != target_width or int(geometry["height"]) != target_height
    replace_audio = configuration["audioPolicy"] == "replace"
    if needs_resize or replace_audio:
        update_video_job(job_id, phase="encoding", phaseLabel="Finalizzazione risoluzione e audio", progress=.93)
        video_codec = "prores_ks" if codec == "prores" else "hevc_videotoolbox" if codec == "hevc" else "h264_videotoolbox"
        command = [*upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(), "-i", str(native_path)]
        replacement_path = Path(str(job.get("replacementAudioPath", "")))
        if replace_audio:
            if not replacement_path.is_file(): raise RuntimeError("Traccia audio sostitutiva non disponibile")
            command += ["-i", str(replacement_path), "-map", "0:v:0", "-map", "1:a:0"]
        if needs_resize:
            command += ["-vf", f"scale={target_width}:{target_height}:flags=lanczos,setsar=1", "-c:v", video_codec]
            if codec != "prores": command += ["-b:v", str(configuration.get("bitrate", "20000000"))]
        else:
            command += ["-c:v", "copy"]
        command += ["-c:a", "aac" if replace_audio else "copy"]
        if replace_audio: command += ["-shortest"]
        command += ["-movflags", "+faststart", *upscaler_ffmpeg_codec_threads(), str(result_path)]
        run_checked(command, cancelled=lambda: video_job_cancelled(job_id))
        native_path.unlink(missing_ok=True)
    else:
        native_path.replace(result_path)
    encoded_geometry = probe_video_geometry(result_path)
    encoded_frames = encoded_video_frame_count(result_path)
    encoded_duration = encoded_video_duration(result_path)
    source_audio_packets = audio_packet_count(source)
    output_audio_packets = audio_packet_count(result_path)
    if configuration["audioPolicy"] == "preserve" and source_audio_packets and not output_audio_packets:
        raise RuntimeError("MLX-DLSS non ha conservato la traccia audio originale")
    update_video_job(
        job_id, phase="ready", phaseLabel="MLX-DLSS completato", error=None, progress=1,
        currentFrame=total, totalFrames=total, resultPath=str(result_path), resultBytes=result_path.stat().st_size,
        encodedFrameCount=encoded_frames, durationSeconds=encoded_duration,
        effectiveWidth=int(encoded_geometry["width"]), effectiveHeight=int(encoded_geometry["height"]),
        sampleAspectRatio=encoded_geometry["sample_aspect_ratio"], rotation=encoded_geometry["rotation"],
        elapsedSeconds=time.monotonic() - started, sourceAudioPackets=source_audio_packets,
        audioPacketCount=output_audio_packets,
        audioRestored=configuration["audioPolicy"] == "mute" or source_audio_packets == 0 or output_audio_packets > 0,
        sourceFps=source_fps, outputFps=encoded_frames / max(encoded_duration, .001), processingMode=MLX_DLSS_VIDEO_PROCESSING_MODE,
        container="mov" if codec == "prores" else "mp4", codec=codec,
    )
    log_upscaler_event("mlx-dlss", "job-ready", jobId=job_id, totalFrames=total, resultBytes=result_path.stat().st_size, elapsedSeconds=time.monotonic() - started)
    schedule_video_job_cleanup(job_id, READY_JOB_RETENTION_SECONDS, "ready-expired")


def process_canvas_video_job(
    job_id: str, job: dict[str, object], source: Path, result_path: Path, binary: str, started: float,
) -> None:
    """Render Canvas video in one bounded-thread FFmpeg pass with audio."""
    total, fps, expected_duration = probe_video_timeline(source)
    width = int(job["width"])
    height = int(job["height"])
    adjustments = effective_video_adjustments(job)
    quality = str(job.get("quality", "maximum"))
    crf = "14" if quality == "maximum" else "17"
    update_video_job(
        job_id, phase="encoding", phaseLabel="Canvas rapido · elaborazione video diretta",
        progress=.05, currentFrame=0, totalFrames=total, fps=fps,
        processingMode=CANVAS_VIDEO_PROCESSING_MODE, frameStorageMode="none",
        originalFramesDirectory="", upscaledFramesDirectory="",
        inputSegmentsDirectory=None, upscaledSegmentsDirectory=None,
        completedSegments=0, totalSegments=0,
    )
    try:
        run_checked([
            *upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(), "-i", str(source),
            "-map", "0:v:0", "-map", "0:a?", "-map_metadata", "-1",
            "-vf", canvas_video_filter(width, height, adjustments),
            "-metadata:s:v:0", "rotate=0", "-c:v", "libx264", "-preset", "fast",
            "-crf", crf, "-pix_fmt", "yuv420p", "-fps_mode", "passthrough",
            "-c:a", "aac", "-b:a", "320k", "-t", f"{expected_duration:.9f}",
            "-movflags", "+faststart", *upscaler_ffmpeg_codec_threads(), str(result_path),
        ], cancelled=lambda: video_job_cancelled(job_id))
    except InterruptedError:
        update_video_job(job_id, phase="cancelled", phaseLabel="Job annullato", cancelled=True)
        cleanup_video_job(job_id, "cancelled")
        return
    if not result_path.exists() or result_path.stat().st_size <= 0:
        raise RuntimeError("Canvas rapido non ha prodotto un video valido")
    encoded_frames = encoded_video_frame_count(result_path)
    if encoded_frames != total:
        result_path.unlink(missing_ok=True)
        raise RuntimeError(f"Controllo anti-drop Canvas fallito: {encoded_frames}/{total} frame")
    encoded_duration = encoded_video_duration(result_path)
    duration_tolerance = max(.05, 1.5 / fps)
    if abs(encoded_duration - expected_duration) > duration_tolerance:
        result_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Controllo durata Canvas fallito: ottenuti {encoded_duration:.3f}/{expected_duration:.3f} secondi"
        )
    geometry = probe_video_geometry(result_path)
    source_audio_packets = audio_packet_count(source)
    output_audio_packets = audio_packet_count(result_path)
    if source_audio_packets > 0 and output_audio_packets <= 0:
        result_path.unlink(missing_ok=True)
        raise RuntimeError("Controllo audio Canvas fallito: il video finale non contiene l'audio sorgente")
    if (
        int(geometry["width"]) != width or int(geometry["height"]) != height
        or not np.isclose(float(geometry["sample_aspect_ratio_value"]), 1.0, atol=1e-6)
        or int(geometry["rotation"]) % 360 != 0
    ):
        result_path.unlink(missing_ok=True)
        raise RuntimeError("Controllo geometria Canvas fallito")
    update_video_job(
        job_id, phase="ready", phaseLabel="Canvas video completato", error=None, progress=1,
        currentFrame=total, completedFrames=total, totalFrames=total,
        resultPath=str(result_path), resultBytes=result_path.stat().st_size,
        encodedFrameCount=encoded_frames, durationSeconds=encoded_duration,
        effectiveWidth=width, effectiveHeight=height,
        sampleAspectRatio=geometry["sample_aspect_ratio"], rotation=geometry["rotation"],
        elapsedSeconds=time.monotonic() - started, sourceAudioPackets=source_audio_packets,
        audioPacketCount=output_audio_packets,
        audioRestored=source_audio_packets == 0 or output_audio_packets > 0,
        sourceFps=fps, outputFps=fps,
        processingMode=CANVAS_VIDEO_PROCESSING_MODE, frameStorageMode="none",
    )
    log_upscaler_event(
        "backend", "canvas-video-ready", jobId=job_id, totalFrames=total,
        resultBytes=result_path.stat().st_size, elapsedSeconds=time.monotonic() - started,
    )
    schedule_video_job_cleanup(job_id, READY_JOB_RETENTION_SECONDS, "ready-expired")


def process_remote_segment_video_job(
    job_id: str, job: dict[str, object], source: Path, chunks: list[tuple[Path, int]],
    result_path: Path, binary: str, total: int, fps: float, expected_duration: float, started: float,
) -> None:
    """Join checkpointed remote MP4 chunks without decoding them to PNG files."""
    if not chunks or sum(count for _, count in chunks) != total:
        raise RuntimeError("Checkpoint segmenti remoti incompleti")
    for path, count in chunks:
        if not valid_remote_video_segment(path, count):
            raise RuntimeError(f"Checkpoint segmento remoto non valido: {path.name}")
    width = int(job["width"])
    height = int(job["height"])
    adjustments = effective_video_adjustments(job)
    quality = str(job.get("quality", "maximum"))
    crf = "14" if quality == "maximum" else "17"
    manifest = Path(str(job["tempDirectory"])) / "upscaled-segments.ffconcat"
    manifest.write_text(
        "ffconcat version 1.0\n" + "\n".join(f"file '{path.as_posix()}'" for path, _ in chunks) + "\n",
        encoding="utf-8",
    )
    geometries = [probe_video_geometry(path) for path, _ in chunks]
    can_stream_copy = video_adjustments_are_neutral(adjustments) and all(
        int(geometry["width"]) == width and int(geometry["height"]) == height
        and np.isclose(float(geometry["sample_aspect_ratio_value"]), 1.0, atol=1e-6)
        and int(geometry["rotation"]) % 360 == 0
        for geometry in geometries
    )
    final_stage_label = (
        "Unione segmenti e ripristino audio"
        if can_stream_copy else
        "Applicazione regolazioni e codifica finale"
        if bool(job.get("applyVideoAdjustments", False)) else
        "Ridimensionamento e codifica finale"
    )
    update_video_job(
        job_id, phase="encoding", phaseLabel=final_stage_label,
        progress=.91, currentFrame=total, completedFrames=total, totalFrames=total,
        completedSegments=len(chunks), totalSegments=len(chunks),
        estimatedRemainingSeconds=None,
    )

    def final_progress(fraction: float, _elapsed: float, remaining: float | None) -> None:
        update_video_job(
            job_id,
            phaseLabel=f"{final_stage_label} · {round(fraction * 100)}%",
            progress=.91 + .08 * fraction,
            estimatedRemainingSeconds=remaining,
        )

    common_input = [
        *upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(),
        "-safe", "0", "-f", "concat", "-i", str(manifest),
        *upscaler_ffmpeg_codec_threads(), "-i", str(source),
        "-map", "0:v:0", "-map", "1:a?", "-map_metadata", "-1",
    ]
    if can_stream_copy:
        command = [
            *common_input, "-c:v", "copy", "-c:a", "copy",
            "-t", f"{expected_duration:.9f}", "-movflags", "+faststart", str(result_path),
        ]
    else:
        command = [
            *common_input, "-vf", video_adjustment_filter(width, height, adjustments),
            "-metadata:s:v:0", "rotate=0", "-c:v", "libx264", "-preset", "fast",
            "-crf", crf, "-pix_fmt", "yuv420p", "-fps_mode", "passthrough",
            "-c:a", "aac", "-b:a", "320k", "-t", f"{expected_duration:.9f}",
            "-movflags", "+faststart", *upscaler_ffmpeg_codec_threads(), str(result_path),
        ]
    try:
        run_checked_with_progress(
            command, expected_duration,
            cancelled=lambda: video_job_cancelled(job_id), on_progress=final_progress,
        )
    except InterruptedError:
        update_video_job(
            job_id, phase="cancelled", phaseLabel="Job remoto annullato · segmenti conservati",
            cancelled=True, resumable=True,
        )
        return
    if not result_path.exists() or result_path.stat().st_size <= 0:
        raise RuntimeError("La ricostruzione diretta dei segmenti non ha prodotto un video valido")
    encoded_frames = encoded_video_frame_count(result_path)
    if encoded_frames != total:
        result_path.unlink(missing_ok=True)
        raise RuntimeError(f"Controllo anti-drop segmenti fallito: {encoded_frames}/{total} frame")
    encoded_duration = encoded_video_duration(result_path)
    if abs(encoded_duration - expected_duration) > max(.05, 1.5 / fps):
        result_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Controllo durata segmenti fallito: ottenuti {encoded_duration:.3f}/{expected_duration:.3f} secondi"
        )
    geometry = probe_video_geometry(result_path)
    source_audio_packets = audio_packet_count(source)
    output_audio_packets = audio_packet_count(result_path)
    if source_audio_packets > 0 and output_audio_packets <= 0:
        result_path.unlink(missing_ok=True)
        raise RuntimeError("Controllo audio fallito: il video ricostruito non contiene l'audio sorgente")
    if (
        int(geometry["width"]) != width or int(geometry["height"]) != height
        or not np.isclose(float(geometry["sample_aspect_ratio_value"]), 1.0, atol=1e-6)
        or int(geometry["rotation"]) % 360 != 0
    ):
        result_path.unlink(missing_ok=True)
        raise RuntimeError("Controllo geometria segmenti fallito")
    update_video_job(
        job_id, phase="ready", phaseLabel="Upscaling video completato", error=None, progress=1,
        currentFrame=total, completedFrames=total, totalFrames=total,
        completedSegments=len(chunks), totalSegments=len(chunks),
        resultPath=str(result_path), resultBytes=result_path.stat().st_size,
        encodedFrameCount=encoded_frames, durationSeconds=encoded_duration,
        effectiveWidth=width, effectiveHeight=height,
        sampleAspectRatio=geometry["sample_aspect_ratio"], rotation=geometry["rotation"],
        elapsedSeconds=time.monotonic() - started, sourceAudioPackets=source_audio_packets,
        audioPacketCount=output_audio_packets,
        audioRestored=source_audio_packets == 0 or output_audio_packets > 0,
        sourceFps=fps, outputFps=fps, segmentFrames=int(job.get("remoteChunkFrames", REMOTE_VIDEO_CHUNK_FRAMES)),
        activeEndpoints=[],
    )
    log_upscaler_event(
        "backend", "remote-segments-ready", jobId=job_id, totalFrames=total,
        totalSegments=len(chunks), resultBytes=result_path.stat().st_size,
        elapsedSeconds=time.monotonic() - started,
    )


def process_video_upscale_job(job_id: str) -> None:
    with video_job_lock:
        job = dict(video_jobs[job_id])
    workspace = Path(str(job["tempDirectory"]))
    source = Path(str(job["sourcePath"]))
    originals = workspace / "original-frames"
    enhanced = workspace / "upscaled-frames"
    rendered = workspace / "rendered-frames"
    provider_configuration = job.get("providerConfig", {}) if isinstance(job.get("providerConfig"), dict) else {}
    result_path = workspace / ("upscaled-video.mov" if job.get("provider") == "mlx-dlss" and provider_configuration.get("codec") == "prores" else "upscaled-video.mp4")
    remote_job = video_job_is_remote(job)
    model_name = (
        str(job.get("model", "")).strip()
        if remote_job
        else canonical_local_video_model(job.get("model", ""))
    )
    processing_mode = video_processing_mode(job)
    started = time.monotonic()
    try:
        update_video_job(job_id, model=model_name, processingMode=processing_mode)
        log_upscaler_event(
            "backend", "job-start", jobId=job_id, sourcePath=source,
            model=model_name, backend=job.get("backend"), processingMode=processing_mode,
            target=f'{job.get("width")}x{job.get("height")}',
        )
        binary = ffmpeg_binary()
        if not binary:
            raise RuntimeError("ffmpeg non trovato nel PATH. Installalo con `brew install ffmpeg` e riavvia il servizio.")
        if processing_mode == MLX_DLSS_VIDEO_PROCESSING_MODE:
            process_mlx_dlss_video_job(job_id, job, source, result_path, binary, started)
            return
        if processing_mode == CANVAS_VIDEO_PROCESSING_MODE:
            process_canvas_video_job(job_id, job, source, result_path, binary, started)
            return
        # Canvas returned above, before these directories can exist. The
        # remaining pipelines retain their checkpoint directories for local AI
        # frames and backwards-compatible remote recovery.
        originals.mkdir(parents=True, exist_ok=True)
        enhanced.mkdir(parents=True, exist_ok=True)
        remote_chunk_frames = int(job.get("remoteChunkFrames", REMOTE_VIDEO_CHUNK_FRAMES))
        remote_output_fps_value = job.get("remoteOutputFps")
        remote_output_fps = float(remote_output_fps_value) if remote_output_fps_value is not None else None
        existing_originals = sorted(originals.glob("frame-*.png")) if remote_job else []
        validated_remote_endpoints: list[str] | None = None
        input_chunks: list[tuple[Path, int]] = []
        output_chunks: list[tuple[Path, int]] = []
        if remote_job:
            total, fps, source_duration = probe_video_timeline(source, remote_output_fps)
            source_fps = fps
            durations = [1 / fps] * total
            input_chunks = [
                (workspace / "input-segments" / f"segment-{zero_start // remote_chunk_frames + 1:06d}.mp4", min(remote_chunk_frames, total - zero_start))
                for zero_start in range(0, total, remote_chunk_frames)
            ]
            output_segment_dir = workspace / "upscaled-segments"
            output_chunks = [(output_segment_dir / chunk.name, count) for chunk, count in input_chunks]
            configured_endpoints = [str(item) for item in job.get("remoteEndpoints", [])]
            cached_frames_complete = len(list(enhanced.glob("frame-*.png"))) == total
            cached_segments_complete = bool(output_chunks) and all(
                valid_remote_video_segment(path, count) for path, count in output_chunks
            )
            if not cached_frames_complete and not cached_segments_complete:
                update_video_job(job_id, phase="upscaling", phaseLabel=f"Verifica {len(configured_endpoints)} endpoint remoti…", progress=.005)
                validated_remote_endpoints = validate_video_chunk_endpoints(
                    configured_endpoints, str(job["model"]),
                    chunk_frames=remote_chunk_frames, output_fps=remote_output_fps,
                )
            update_video_job(
                job_id, phase="extracting", phaseLabel="Segmentazione rapida del video sorgente",
                progress=.01, totalFrames=total, fps=fps, totalSegments=len(input_chunks),
                inputSegmentsDirectory=str(workspace / "input-segments"),
            )
            if not cached_segments_complete and not cached_frames_complete:
                input_chunks = build_remote_video_segments_from_source(
                    source, total, fps, workspace, chunk_frames=remote_chunk_frames,
                    output_fps=remote_output_fps,
                    cancelled=lambda: video_job_cancelled(job_id),
                    on_progress=lambda completed, segment_total, frames: update_video_job(
                        job_id,
                        phaseLabel=f"Segmentazione sorgente {completed}/{segment_total}",
                        completedSegments=completed,
                        currentFrame=frames,
                        progress=.01 + .03 * frames / total,
                    ),
                )
            original_frames: list[Path] = []
            log_upscaler_event(
                "backend", "source-segmented", jobId=job_id, totalFrames=total,
                fps=fps, segments=len(input_chunks), durationSeconds=source_duration,
            )
        else:
            if model_name == CANVAS_MODEL_ID:
                raise RuntimeError(
                    "Errore interno: Canvas locale non può usare l'estrazione PNG frame-per-frame"
                )
            update_video_job(job_id, phase="extracting", phaseLabel="Estrazione di tutti i frame originali", progress=0.01)
            run_checked([
                *upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(), "-i", str(source),
                "-vf", _frame_extraction_filter(), "-vsync", "0",
                "-compression_level", "1", *upscaler_ffmpeg_codec_threads(), str(originals / "frame-%08d.png")
            ], cancelled=lambda: video_job_cancelled(job_id))
            original_frames = sorted(originals.glob("frame-*.png"))
            if not original_frames:
                raise RuntimeError("Il decoder non ha estratto alcun fotogramma dal video.")
            capture = cv2.VideoCapture(str(source))
            source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
            capture.release()
            if not np.isfinite(source_fps) or source_fps <= 0:
                source_fps = 30.0
            fps = source_fps
            total = len(original_frames)
            durations = source_frame_durations(source, total, fps)
            log_upscaler_event("backend", "frames-extracted", jobId=job_id, totalFrames=total, fps=fps, originals=originals)
        backend = str(job["backend"])
        tile = int(job["tile"])
        width = int(job["width"])
        height = int(job["height"])
        tta = bool(job["tta"])
        if remote_job:
            remote_endpoints = [str(item) for item in job.get("remoteEndpoints", [])]
            existing_enhanced = sorted(enhanced.glob("frame-*.png"))
            failures: list[dict[str, str]] = []
            if len(existing_enhanced) == total:
                update_video_job(
                    job_id, phase="upscaling", phaseLabel="Checkpoint frame completi · ricostruzione locale",
                    totalFrames=total, currentFrame=total, completedFrames=total, fps=fps,
                    progress=.94, resumable=True, completedSegments=0, totalSegments=0,
                )
            else:
                completed_segments = sum(1 for path, count in output_chunks if valid_remote_video_segment(path, count))
                completed_segment_frames = sum(count for path, count in output_chunks if valid_remote_video_segment(path, count))
                if completed_segments < len(input_chunks):
                    update_video_job(
                        job_id, phase="upscaling", phaseLabel=f"Verifica {len(remote_endpoints)} endpoint remoti…",
                        totalFrames=total, currentFrame=completed_segment_frames, completedFrames=completed_segment_frames,
                        totalSegments=len(input_chunks), completedSegments=completed_segments,
                        inputSegmentsDirectory=str(workspace / "input-segments"),
                        upscaledSegmentsDirectory=str(output_segment_dir), fps=fps,
                        progress=.04 + .86 * completed_segment_frames / total, resumable=True,
                    )
                    # The frontend already obtained explicit approval for the
                    # reachable subset. Revalidate that subset immediately
                    # before dispatch so a dead endpoint cannot receive work.
                    remote_endpoints = validated_remote_endpoints or validate_video_chunk_endpoints(
                        remote_endpoints, model_name,
                        chunk_frames=remote_chunk_frames, output_fps=remote_output_fps,
                    )
                endpoint_activity_lock = threading.Lock()
                segment_frame_counts = {path.name: count for path, count in input_chunks}
                endpoint_activity: dict[str, dict[str, object]] = {
                    endpoint: {
                        "url": endpoint, "state": "idle", "activeFrame": None,
                        "activeSegment": None, "completed": 0, "completedSegments": 0,
                        "completedFrames": 0, "failures": 0,
                        "segmentFrame": 0, "segmentTotalFrames": 0,
                        "segmentProgress": 0.0, "segmentPhase": "idle",
                        "segmentElapsedSeconds": 0.0,
                        "segmentEstimatedRemainingSeconds": None,
                        "secondsPerFrame": None, "updatedAtMs": None,
                    }
                    for endpoint in remote_endpoints
                }
                update_video_job(
                    job_id, phase="upscaling", phaseLabel=f"Segmenti remoti · {len(remote_endpoints)} endpoint pronti",
                    totalFrames=total, currentFrame=completed_segment_frames, completedFrames=completed_segment_frames,
                    totalSegments=len(input_chunks), completedSegments=completed_segments,
                    inputSegmentsDirectory=str(workspace / "input-segments"),
                    upscaledSegmentsDirectory=str(output_segment_dir), fps=fps,
                    progress=.04 + .86 * completed_segment_frames / total, resumable=True,
                    endpointActivity=list(endpoint_activity.values()), activeEndpoints=[],
                )

                def remote_endpoint_state(endpoint: str, state: str, segment: Path) -> None:
                    with endpoint_activity_lock:
                        item = endpoint_activity[endpoint]
                        item["state"] = state
                        item["activeFrame"] = None
                        item["activeSegment"] = segment.name if state == "busy" else None
                        if state == "busy":
                            item.update({
                                "segmentFrame": 0,
                                "segmentTotalFrames": segment_frame_counts.get(segment.name, 0),
                                "segmentProgress": 0.0,
                                "segmentPhase": "awaiting_progress",
                                "segmentElapsedSeconds": 0.0,
                                "segmentEstimatedRemainingSeconds": None,
                                "secondsPerFrame": None,
                                "updatedAtMs": int(time.time() * 1000),
                            })
                        elif state == "idle":
                            item.update({
                                "segmentFrame": item.get("segmentTotalFrames", 0),
                                "segmentProgress": 1.0,
                                "segmentPhase": "ready",
                                "segmentEstimatedRemainingSeconds": 0.0,
                                "updatedAtMs": int(time.time() * 1000),
                            })
                        else:
                            item.update({
                                "segmentPhase": "error",
                                "updatedAtMs": int(time.time() * 1000),
                            })
                        if state == "error":
                            item["failures"] = int(item["failures"]) + 1
                        snapshot = [dict(endpoint_activity[url]) for url in remote_endpoints]
                        busy = [str(value["url"]) for value in snapshot if value["state"] == "busy"]
                    update_video_job(
                        job_id, endpointActivity=snapshot, activeEndpoints=busy,
                        phaseLabel=f"Segmenti remoti · {len(busy)}/{len(remote_endpoints)} endpoint al lavoro",
                    )

                def remote_endpoint_progress(
                    endpoint: str, segment: Path, progress_item: dict[str, object],
                ) -> None:
                    expected = segment_frame_counts.get(segment.name, 0)

                    def finite_number(key: str) -> float | None:
                        try:
                            value = float(progress_item.get(key))
                        except (TypeError, ValueError):
                            return None
                        return value if math.isfinite(value) and value >= 0 else None

                    completed_value = finite_number("completed_frames")
                    total_value = finite_number("total_frames")
                    fraction_value = finite_number("progress")
                    elapsed_value = finite_number("elapsed_seconds")
                    remaining_value = finite_number("estimated_remaining_seconds")
                    seconds_per_frame = finite_number("seconds_per_frame")
                    completed_in_segment = max(0, min(expected, int(completed_value or 0)))
                    total_in_segment = max(1, int(total_value or expected or 1))
                    fraction = max(0.0, min(1.0, fraction_value if fraction_value is not None else completed_in_segment / total_in_segment))
                    with endpoint_activity_lock:
                        item = endpoint_activity.get(endpoint)
                        # A late streamed update from a retried segment must not
                        # overwrite the endpoint's newly assigned segment.
                        if item is None or item.get("activeSegment") != segment.name or item.get("state") != "busy":
                            return
                        item.update({
                            "segmentFrame": completed_in_segment,
                            "segmentTotalFrames": total_in_segment,
                            "segmentProgress": fraction,
                            "segmentPhase": str(progress_item.get("state") or "upscaling"),
                            "segmentElapsedSeconds": elapsed_value or 0.0,
                            "segmentEstimatedRemainingSeconds": remaining_value,
                            "secondsPerFrame": seconds_per_frame,
                            "updatedAtMs": int(time.time() * 1000),
                        })
                        snapshot = [dict(endpoint_activity[url]) for url in remote_endpoints]
                        busy = [str(value["url"]) for value in snapshot if value["state"] == "busy"]
                    update_video_job(
                        job_id,
                        endpointActivity=snapshot,
                        activeEndpoints=busy,
                        phaseLabel=f"Segmenti remoti · {len(busy)}/{len(remote_endpoints)} endpoint al lavoro",
                    )

                def remote_progress(
                    segments_done: int, segment_total: int, frames_done: int, frame_total: int,
                    endpoint: str, destination: Path,
                ) -> None:
                    elapsed = time.monotonic() - started
                    segment_frames = next((count for path, count in input_chunks if path.name == destination.name), 0)
                    with endpoint_activity_lock:
                        item = endpoint_activity[endpoint]
                        item["completed"] = int(item["completed"]) + 1
                        item["completedSegments"] = int(item["completedSegments"]) + 1
                        item["completedFrames"] = int(item["completedFrames"]) + segment_frames
                        snapshot = [dict(endpoint_activity[url]) for url in remote_endpoints]
                        busy = [str(value["url"]) for value in snapshot if value["state"] == "busy"]
                    update_video_job(
                        job_id, phaseLabel=f"Segmenti remoti · {len(busy)}/{len(remote_endpoints)} endpoint al lavoro",
                        currentFrame=frames_done, completedFrames=frames_done, totalFrames=frame_total,
                        completedSegments=segments_done, totalSegments=segment_total,
                        progress=.04 + .86 * frames_done / frame_total, elapsedSeconds=elapsed,
                        estimatedRemainingSeconds=(elapsed / frames_done * (frame_total - frames_done)) if frames_done else None,
                        currentUpscaledFrame=str(destination), activeEndpoint=endpoint,
                        endpointActivity=snapshot, activeEndpoints=busy,
                    )

                completed_segments, completed, failures = distribute_video_chunks(
                    input_chunks, remote_endpoints, model_name, output_segment_dir,
                    retries=int(job.get("remoteRetries", 2)), cancelled=lambda: video_job_cancelled(job_id),
                    output_fps=remote_output_fps,
                    validate_checkpoint=valid_remote_video_segment,
                    on_progress=remote_progress, on_endpoint=remote_endpoint_state,
                    on_endpoint_progress=remote_endpoint_progress,
                )
                update_video_job(
                    job_id, phaseLabel="Ricostruzione locale dei segmenti ricevuti", progress=.91,
                    currentFrame=completed, completedFrames=completed,
                    completedSegments=completed_segments, totalSegments=len(input_chunks),
                    endpointFailures=failures[-100:], activeEndpoints=[],
                )
                if output_chunks and all(valid_remote_video_segment(path, count) for path, count in output_chunks):
                    process_remote_segment_video_job(
                        job_id, job, source, output_chunks, result_path, binary,
                        total, fps, source_duration, started,
                    )
                    return
                materialized = materialize_remote_video_segments(
                    output_chunks, enhanced, workspace,
                    cancelled=lambda: video_job_cancelled(job_id),
                    on_progress=lambda segment, segment_total, frames: update_video_job(
                        job_id,
                        phaseLabel=f"Ricostruzione segmento {segment}/{segment_total}",
                        completedSegments=segment,
                        currentFrame=frames,
                        progress=.91 + .03 * frames / total,
                    ),
                )
                if materialized != total:
                    raise RuntimeError(f"Controllo anti-drop segmenti fallito: {materialized}/{total} frame")
                update_video_job(job_id, currentFrame=materialized, completedFrames=materialized, progress=.94)
        else:
            runner = upsampler(model_name, backend, max(0, min(1024, tile)))
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
                passes = 2 if tta else 1
                update_video_job(job_id, phaseLabel=f"Frame {index}/{total} · passaggio 1/{passes}", currentFrame=completed, progress=.04 + .9 * completed / total, elapsedSeconds=elapsed_before, estimatedRemainingSeconds=estimated_before, activeFrame=index, inferencePass=1, inferencePasses=passes)
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
                update_video_job(job_id, currentFrame=index, totalFrames=total, progress=.04 + .9 * index / total, elapsedSeconds=elapsed, estimatedRemainingSeconds=(elapsed / index * (total - index)) if index else None, currentOriginalFrame=str(frame_path), currentUpscaledFrame=str(destination))
                log_step = max(1, total // 20)
                if index == 1 or index == total or index % log_step == 0:
                    log_upscaler_event("backend", "frame-progress", jobId=job_id, currentFrame=index, totalFrames=total, progress=.04 + .9 * index / total)
        if video_job_cancelled(job_id):
            update_video_job(job_id, phase="cancelled", phaseLabel="Job annullato", cancelled=True)
            if not job.get("remote"):
                cleanup_video_job(job_id, "cancelled")
            return
        # I checkpoint remoti restano immutati e riprendibili. Risoluzione e
        # preset completo vengono materializzati separatamente, evitando che un
        # retry applichi due volte le stesse correzioni.
        shutil.rmtree(rendered, ignore_errors=True)
        rendered.mkdir(parents=True, exist_ok=True)
        adjustments_value = effective_video_adjustments(job)
        enhanced_frames = sorted(enhanced.glob("frame-*.png"))
        if len(enhanced_frames) != total:
            raise RuntimeError(f"Controllo anti-drop fallito prima delle regolazioni: {len(enhanced_frames)}/{total} frame")
        update_video_job(job_id, phase="upscaling", phaseLabel="Applicazione regolazioni a tutti i frame", progress=.94)
        for index, checkpoint in enumerate(enhanced_frames, start=1):
            if video_job_cancelled(job_id):
                raise InterruptedError("Job annullato durante le regolazioni")
            output = cv2.imread(str(checkpoint), cv2.IMREAD_COLOR)
            if output is None:
                raise RuntimeError(f"Checkpoint illeggibile: {checkpoint.name}")
            if output.shape[1] != width or output.shape[0] != height:
                output = cv2.resize(output, (width, height), interpolation=cv2.INTER_LANCZOS4)
            output = apply_upscaler_adjustments(output, adjustments_value)
            destination = rendered / checkpoint.name
            if not cv2.imwrite(str(destination), output, [cv2.IMWRITE_PNG_COMPRESSION, 2]):
                raise RuntimeError(f"Impossibile applicare le regolazioni a {checkpoint.name}")
            if index == total or index % max(1, total // 20) == 0:
                update_video_job(job_id, phaseLabel=f"Regolazioni frame {index}/{total}", progress=.94 + .01 * index / total)
        update_video_job(job_id, phase="encoding", phaseLabel="Ricomposizione video e audio originale", progress=.95)
        log_upscaler_event("backend", "encoding-start", jobId=job_id, totalFrames=total)
        quality = str(job.get("quality", "maximum"))
        crf = "14" if quality == "maximum" else "17"
        expected_duration = float(sum(durations))
        if not np.isfinite(expected_duration) or expected_duration <= 0:
            raise RuntimeError("La timeline del video sorgente non contiene durate valide")
        # Il demuxer concat assegna alle immagini statiche una base temporale
        # implicita di 25 fps. Senza un rate di input esplicito, una sorgente a
        # 30 fps viene ricomposta a 25 fps e `-shortest` elimina circa un sesto
        # dei frame quando l'audio termina. Usiamo il rate medio reale della
        # timeline estratta e lasciamo che l'audio termini naturalmente.
        recomposition_fps = total / expected_duration
        manifest = workspace / "upscaled-frames.ffconcat"
        manifest_lines = ["ffconcat version 1.0"]
        for frame_path, duration in zip(sorted(rendered.glob("frame-*.png")), durations, strict=True):
            manifest_lines.extend((f"file '{frame_path.as_posix()}'", f"duration {duration:.9f}"))
        manifest.write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")
        run_checked([
            *upscaler_ffmpeg_prefix(binary), *upscaler_ffmpeg_codec_threads(),
            "-r", f"{recomposition_fps:.12g}", "-safe", "0", "-f", "concat", "-i", str(manifest),
            *upscaler_ffmpeg_codec_threads(), "-i", str(source), "-map", "0:v:0", "-map", "1:a?", "-map_metadata", "-1",
            "-vf", "setsar=1", "-metadata:s:v:0", "rotate=0", "-c:v", "libx264", "-preset", "fast" if job.get("remote") else "slow", "-crf", crf, "-pix_fmt", "yuv420p",
            "-fps_mode", "passthrough", "-c:a", "aac", "-b:a", "320k",
            "-t", f"{expected_duration:.9f}", "-movflags", "+faststart",
            *upscaler_ffmpeg_codec_threads(), str(result_path)
        ], cancelled=lambda: video_job_cancelled(job_id))
        if video_job_cancelled(job_id):
            update_video_job(job_id, phase="cancelled", phaseLabel="Job annullato", cancelled=True)
            if not job.get("remote"):
                cleanup_video_job(job_id, "cancelled-after-encoding")
            return
        if not result_path.exists() or result_path.stat().st_size <= 0:
            raise RuntimeError("La ricomposizione non ha prodotto un video valido.")
        encoded_frames = encoded_video_frame_count(result_path)
        if encoded_frames != total:
            result_path.unlink(missing_ok=True)
            raise RuntimeError(f"Controllo anti-drop fallito: il risultato contiene {encoded_frames}/{total} frame")
        encoded_duration = encoded_video_duration(result_path)
        duration_tolerance = max(.05, 1.5 / recomposition_fps)
        if abs(encoded_duration - expected_duration) > duration_tolerance:
            result_path.unlink(missing_ok=True)
            raise RuntimeError(
                f"Controllo durata fallito: ottenuti {encoded_duration:.3f}/{expected_duration:.3f} secondi"
            )
        encoded_geometry = probe_video_geometry(result_path)
        source_audio_packets = audio_packet_count(source)
        output_audio_packets = audio_packet_count(result_path)
        if source_audio_packets > 0 and output_audio_packets <= 0:
            result_path.unlink(missing_ok=True)
            raise RuntimeError("Controllo audio fallito: la sorgente contiene audio ma il video ricomposto no")
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
            error=None,
            progress=1,
            currentFrame=total,
            totalFrames=total,
            resultPath=str(result_path),
            resultBytes=result_path.stat().st_size,
            encodedFrameCount=encoded_frames,
            durationSeconds=encoded_duration,
            effectiveWidth=encoded_width,
            effectiveHeight=encoded_height,
            sampleAspectRatio=encoded_geometry["sample_aspect_ratio"],
            rotation=encoded_geometry["rotation"],
            elapsedSeconds=time.monotonic() - started,
            sourceAudioPackets=source_audio_packets,
            audioPacketCount=output_audio_packets,
            audioRestored=source_audio_packets == 0 or output_audio_packets > 0,
            sourceFps=source_fps,
            outputFps=fps,
            segmentFrames=remote_chunk_frames if job.get("remote") else None,
        )
        log_upscaler_event("backend", "job-ready", jobId=job_id, totalFrames=total, resultBytes=result_path.stat().st_size, elapsedSeconds=time.monotonic() - started)
        if not job.get("remote"):
            schedule_video_job_cleanup(job_id, READY_JOB_RETENTION_SECONDS, "ready-expired")
    except InterruptedError as error:
        update_video_job(job_id, phase="cancelled", phaseLabel="Job remoto annullato · frame conservati", error=str(error), cancelled=True, resumable=True)
        log_upscaler_event("backend", "remote-job-cancelled", jobId=job_id, error=str(error))
    except Exception as error:
        update_video_job(
            job_id, phase="error",
            phaseLabel="Upscaling remoto interrotto · frame conservati" if job.get("remote") else "Upscaling interrotto",
            error=str(error), resumable=bool(job.get("remote")),
        )
        log_upscaler_event("backend", "job-error", jobId=job_id, error=str(error))
        if not job.get("remote"):
            schedule_video_job_cleanup(job_id, FAILED_JOB_RETENTION_SECONDS, "failed-expired")


def remote_video_job_reuse_rank(item: dict[str, object]) -> tuple[int, int, int]:
    result_path = Path(str(item.get("resultPath", "")))
    ready_artifact = item.get("phase") == "ready" and result_path.is_file() and result_path.stat().st_size > 0
    return (
        1 if ready_artifact else 0,
        int(item.get("completedFrames", item.get("currentFrame", 0)) or 0),
        int(item.get("manifestRevision", 0) or 0),
    )


def remote_video_job_checkpoint_matches(
    item: dict[str, object], *, source_hash: str, model: str, processing_key: str | None = None
) -> bool:
    """Return whether remote AI checkpoints can be reused for this source/model."""
    stored_processing_key = item.get("remoteProcessingKey")
    if stored_processing_key is None:
        stored_processing_key = json.dumps({
            "segmentFrames": int(item.get("remoteChunkFrames", REMOTE_VIDEO_CHUNK_FRAMES)),
            "outputFps": item.get("remoteOutputFps"),
        }, sort_keys=True, separators=(",", ":"))
    return bool(
        item.get("remote")
        and item.get("sourceHash") == source_hash
        and item.get("model") == model
        and (processing_key is None or stored_processing_key == processing_key)
        and item.get("phase") in ("ready", "error", "cancelled")
    )


def normalize_remote_checkpoint_policy(value: str) -> str:
    policy = value.strip().lower()
    if policy not in REMOTE_CHECKPOINT_POLICIES:
        raise ValueError("La scelta checkpoint deve essere 'resume' oppure 'restart'")
    return policy


def remote_video_job_candidate_rank(
    item: dict[str, object], render_settings: dict[str, object]
) -> tuple[int, int, int, int]:
    """Prefer the largest checkpoint set, then an exact verified render."""
    ready_artifact, completed_frames, revision = remote_video_job_reuse_rank(item)
    render_matches = all(item.get(key) == value for key, value in render_settings.items())
    return (
        completed_frames,
        1 if render_matches and ready_artifact else 0,
        ready_artifact,
        revision,
    )


def select_remote_video_job_candidate(
    items: Iterable[dict[str, object]],
    *,
    source_hash: str,
    model: str,
    render_settings: dict[str, object],
    checkpoint_policy: str,
    processing_key: str | None = None,
) -> dict[str, object] | None:
    """Select reusable checkpoints only after an explicit resume decision."""
    if normalize_remote_checkpoint_policy(checkpoint_policy) != "resume":
        return None
    candidates = [
        item for item in items
        if remote_video_job_checkpoint_matches(
            item, source_hash=source_hash, model=model, processing_key=processing_key
        )
    ]
    return max(
        candidates,
        key=lambda item: remote_video_job_candidate_rank(item, render_settings),
        default=None,
    )


def prepare_remote_video_job_reuse(
    item: dict[str, object],
    *,
    render_settings: dict[str, object],
    endpoints: list[str],
    retries: int,
    client_id: str,
) -> bool:
    """Apply a new render request to reusable remote checkpoints.

    Returns True when local processing must resume. Remote endpoint output is
    stored before resizing and colour adjustments, so changing only the final
    render settings must not discard already completed AI frames.
    """
    render_matches = all(item.get(key) == value for key, value in render_settings.items())
    result_path = Path(str(item.get("resultPath", "")))
    ready_artifact = (
        render_matches
        and item.get("phase") == "ready"
        and result_path.is_file()
        and result_path.stat().st_size > 0
    )
    item.update({
        "remoteEndpoints": endpoints,
        "remoteRetries": retries,
        "clientId": client_id,
    })
    if ready_artifact:
        return False
    item.update(render_settings)
    item.update({
        "phase": "queued",
        "phaseLabel": "Ripresa dai frame AI salvati",
        "cancelRequested": False,
        "cancelled": False,
        "error": None,
        "resultPath": None,
        "resultBytes": None,
        "activeEndpoints": [],
        "activeEndpoint": None,
        "endpointActivity": [],
    })
    return True


@app.post("/upscale/video/jobs")
async def create_video_upscale_job(
    file: UploadFile = File(...), model: str = Form(...), backend: str = Form("auto"),
    tile: int = Form(256), width: int = Form(...), height: int = Form(...),
    tta: bool = Form(False), quality: str = Form("maximum"), client_id: str = Form(""), preserve_aspect_ratio: bool = Form(True),
    remote_config: str = Form(""), provider: str = Form("classic"), provider_config: str = Form("{}"), adjustments: str = Form("{}"),
    apply_video_adjustments: bool = Form(False), replacement_audio: UploadFile | None = File(None),
    source_start_seconds: float = Form(0), source_duration_seconds: float = Form(0),
    checkpoint_policy: str = Form("restart"),
):
    # Unit/in-process callers invoke the FastAPI function directly and therefore
    # see ``Form`` descriptors instead of HTTP-decoded defaults. Preserve the
    # pre-provider contract for those callers and for older desktop builds.
    if not isinstance(provider, str): provider = "classic"
    if not isinstance(provider_config, str): provider_config = "{}"
    if not isinstance(replacement_audio, UploadFile): replacement_audio = None
    if not isinstance(source_start_seconds, (int, float)): source_start_seconds = 0
    if not isinstance(source_duration_seconds, (int, float)): source_duration_seconds = 0
    if provider not in {"classic", "mlx-dlss"}:
        raise HTTPException(400, "Provider Upscaler non riconosciuto")
    try:
        parsed_provider_config = json.loads(provider_config)
        if not isinstance(parsed_provider_config, dict): raise ValueError
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(400, "Configurazione provider Upscaler non valida") from error
    if provider == "mlx-dlss" and not mlx_dlss.capabilities().get("usable"):
        raise HTTPException(503, "MLX-DLSS non è installato, compatibile e verificato")
    try:
        checkpoint_policy = normalize_remote_checkpoint_policy(checkpoint_policy)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    try:
        parsed_adjustments = parse_upscaler_adjustments(adjustments)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    adjustments_key = json.dumps(parsed_adjustments, sort_keys=True, separators=(",", ":"))
    remote: dict[str, object] | None = None
    if remote_config and provider == "classic":
        try:
            value = json.loads(remote_config)
            endpoints = value.get("endpoints") if isinstance(value, dict) else None
            remote_model = value.get("model") if isinstance(value, dict) else None
            if not isinstance(endpoints, list) or not endpoints or not all(isinstance(item, str) for item in endpoints) or not isinstance(remote_model, str) or not remote_model.strip():
                raise ValueError
            remote = {
                "endpoints": list(dict.fromkeys(normalize_endpoint(item) for item in endpoints)),
                "model": remote_model.strip(),
                "retries": max(0, min(6, int(value.get("retries", 2)))),
                "segmentFrames": int(value.get("segmentFrames", REMOTE_VIDEO_CHUNK_FRAMES)),
                "outputFps": None if value.get("outputFps") is None else float(value["outputFps"]),
            }
            if not 1 <= int(remote["segmentFrames"]) <= REMOTE_VIDEO_MAX_CHUNK_FRAMES:
                raise ValueError
            output_fps = remote["outputFps"]
            if output_fps is not None and (not math.isfinite(float(output_fps)) or not 1 <= float(output_fps) <= 480):
                raise ValueError
        except (ValueError, TypeError, json.JSONDecodeError, RemoteUpscalerError) as error:
            raise HTTPException(400, "Configurazione Upscaler remoto non valida") from error
    if remote is None and provider == "classic":
        model = canonical_local_video_model(model)
    log_upscaler_event("backend", "upload-received", fileName=file.filename, model=model, backend=backend, target=f"{width}x{height}", quality=quality, preserveAspectRatio=preserve_aspect_ratio, checkpointPolicy=checkpoint_policy)
    if provider == "classic" and remote is None and model != CANVAS_MODEL_ID and model not in MODELS:
        raise HTTPException(400, "Modello video sconosciuto")
    if provider == "classic" and remote is None and model != CANVAS_MODEL_ID and not target(model).exists():
        raise HTTPException(409, "Modello non ancora scaricato")
    if not ffmpeg_binary():
        raise HTTPException(503, "ffmpeg non disponibile nel servizio locale")
    if width < 64 or height < 64 or width > 16384 or height > 16384:
        raise HTTPException(400, "Risoluzione finale fuori dai limiti")
    job_id = uuid.uuid4().hex
    workspace = (REMOTE_VIDEO_ROOT if remote else VIDEO_TEMP_ROOT) / job_id
    upload_placeholder: dict[str, object] | None = None
    if remote:
        upload_placeholder = {
            "id": job_id,
            "phase": "uploading",
            "phaseLabel": "Ricezione video sorgente",
            "progress": 0,
            "currentFrame": 0,
            "totalFrames": 0,
            "tempDirectory": str(workspace),
            "sourceName": file.filename or "source.mp4",
            "clientId": client_id,
            "cancelRequested": False,
            "cancelled": False,
            "remote": True,
            "resumable": False,
            "checkpointPolicy": checkpoint_policy,
        }
        # Workspace creation and registration share the same lock used by the
        # bulk cache DELETE. The cache can therefore never observe an upload
        # directory without also observing its active placeholder.
        with video_job_lock:
            active_jobs = active_video_job_ids_locked()
            if not active_jobs:
                workspace.mkdir(parents=True, exist_ok=False)
                video_jobs[job_id] = upload_placeholder
        if active_jobs:
            await file.close()
            log_upscaler_event("backend", "video-job-admission-refused", activeJobIds=active_jobs, sourceName=file.filename)
            raise HTTPException(
                409,
                "È già attivo un job video Upscaler. Attendi il completamento o annullalo prima di avviare un altro video.",
            )
    else:
        workspace.mkdir(parents=True, exist_ok=False)
    suffix = Path(file.filename or "source.mp4").suffix.lower()
    if suffix not in (".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"):
        suffix = ".mp4"
    source = workspace / f"source{suffix}"
    source_hash = hashlib.sha256()
    try:
        with source.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                output.write(chunk)
                source_hash.update(chunk)
        if source.stat().st_size <= 0:
            raise HTTPException(400, "Video sorgente vuoto")
    except BaseException:
        if upload_placeholder is not None:
            discard_remote_video_upload(job_id, upload_placeholder, workspace)
        else:
            shutil.rmtree(workspace, ignore_errors=True)
        raise
    finally:
        try:
            await file.close()
        except BaseException:
            if upload_placeholder is not None:
                discard_remote_video_upload(job_id, upload_placeholder, workspace)
            else:
                shutil.rmtree(workspace, ignore_errors=True)
            raise
    replacement_audio_path: Path | None = None
    if provider == "mlx-dlss" and parsed_provider_config.get("audioPolicy") == "replace":
        if replacement_audio is None:
            shutil.rmtree(workspace, ignore_errors=True)
            raise HTTPException(400, "Seleziona una traccia audio sostitutiva")
        audio_suffix = Path(replacement_audio.filename or "replacement.m4a").suffix.lower()
        if audio_suffix not in {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"}: audio_suffix = ".m4a"
        replacement_audio_path = workspace / f"replacement-audio{audio_suffix}"
        try:
            with replacement_audio_path.open("wb") as output:
                while chunk := await replacement_audio.read(1024 * 1024): output.write(chunk)
        finally:
            await replacement_audio.close()
        if replacement_audio_path.stat().st_size <= 0:
            shutil.rmtree(workspace, ignore_errors=True)
            raise HTTPException(400, "Traccia audio sostitutiva vuota")
    try:
        source_geometry = probe_video_geometry(source)
        effective_width, effective_height = resolve_video_dimensions(width, height, source_geometry, preserve_aspect_ratio)
    except Exception as error:
        if upload_placeholder is not None:
            discard_remote_video_upload(job_id, upload_placeholder, workspace)
        else:
            shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(400, f"Impossibile determinare la geometria del video: {error}") from error
    with video_job_lock:
        cutoff = time.time() - 3600
        for stale_client in [key for key, cancelled_at in cancelled_video_clients.items() if cancelled_at < cutoff]:
            cancelled_video_clients.pop(stale_client, None)
        client_was_cancelled = bool(
            (client_id and client_id in cancelled_video_clients)
            or (upload_placeholder is not None and upload_placeholder.get("cancelRequested"))
        )
    if client_was_cancelled:
        if upload_placeholder is not None:
            discard_remote_video_upload(job_id, upload_placeholder, workspace)
        else:
            shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(409, "La pagina che ha creato il job non è più attiva")
    digest = source_hash.hexdigest()
    log_upscaler_event(
        "backend", "upload-verified", fileName=file.filename,
        sourceBytes=source.stat().st_size, sourceHash=digest,
        checkpointPolicy=checkpoint_policy,
    )
    if remote:
        remote_processing_key = json.dumps({
            "segmentFrames": int(remote["segmentFrames"]),
            "outputFps": remote["outputFps"],
        }, sort_keys=True, separators=(",", ":"))
        render_settings: dict[str, object] = {
            "requestedWidth": width,
            "requestedHeight": height,
            "width": effective_width,
            "height": effective_height,
            "preserveAspectRatio": preserve_aspect_ratio,
            "quality": quality,
            "applyVideoAdjustments": apply_video_adjustments,
            "adjustments": parsed_adjustments,
            "adjustmentsKey": adjustments_key,
            "backend": backend,
            "tile": tile,
            "tta": tta,
        }
        with video_job_lock:
            if (
                upload_placeholder is None
                or video_jobs.get(job_id) is not upload_placeholder
                or upload_placeholder.get("cancelRequested")
                or (client_id and client_id in cancelled_video_clients)
            ):
                if upload_placeholder is not None:
                    _discard_remote_video_upload_locked(job_id, upload_placeholder, workspace)
                raise HTTPException(409, "La pagina che ha creato il job non è più attiva")
            candidate = select_remote_video_job_candidate(
                video_jobs.values(),
                source_hash=digest,
                model=str(remote["model"]),
                render_settings=render_settings,
                checkpoint_policy=checkpoint_policy,
                processing_key=remote_processing_key,
            )
            if candidate is not None:
                if upload_placeholder is None or not _discard_remote_video_upload_locked(
                    job_id, upload_placeholder, workspace
                ):
                    raise HTTPException(500, "Impossibile chiudere l'upload temporaneo prima della ripresa")
                resume_existing = prepare_remote_video_job_reuse(
                    candidate,
                    render_settings=render_settings,
                    endpoints=list(remote["endpoints"]),
                    retries=int(remote["retries"]),
                    client_id=client_id,
                )
                snapshot = dict(candidate)
                snapshot["checkpointPolicy"] = checkpoint_policy
                candidate["checkpointPolicy"] = checkpoint_policy
            else:
                snapshot = {}
                resume_existing = False
        if snapshot:
            persist_remote_video_job(snapshot)
            if resume_existing:
                threading.Thread(target=process_video_upscale_job, args=(str(snapshot["id"]),), daemon=True).start()
            log_upscaler_event("backend", "remote-job-reused", jobId=snapshot["id"], sourceHash=digest, completedFrames=snapshot.get("currentFrame", 0))
            return snapshot
    record_processing_mode = (MLX_DLSS_VIDEO_PROCESSING_MODE if provider == "mlx-dlss" else
        REMOTE_VIDEO_PROCESSING_MODE
        if remote
        else CANVAS_VIDEO_PROCESSING_MODE if model == CANVAS_MODEL_ID else LOCAL_AI_VIDEO_PROCESSING_MODE
    )
    stores_png_frames = record_processing_mode not in {CANVAS_VIDEO_PROCESSING_MODE, MLX_DLSS_VIDEO_PROCESSING_MODE}
    frame_storage_mode = (
        "none" if record_processing_mode in {CANVAS_VIDEO_PROCESSING_MODE, MLX_DLSS_VIDEO_PROCESSING_MODE}
        else "mp4-segments" if record_processing_mode == REMOTE_VIDEO_PROCESSING_MODE
        else "png-checkpoints"
    )
    record: dict[str, object] = {
        "id": job_id, "phase": "queued", "phaseLabel": "Job in coda", "progress": 0,
        "currentFrame": 0, "totalFrames": 0, "tempDirectory": str(workspace),
        "processingMode": record_processing_mode,
        "frameStorageMode": frame_storage_mode,
        "originalFramesDirectory": str(workspace / "original-frames") if stores_png_frames else "",
        "upscaledFramesDirectory": str(workspace / "upscaled-frames") if stores_png_frames else "",
        "sourcePath": str(source), "model": str(remote["model"]) if remote else model, "backend": backend, "tile": tile,
        "provider": provider, "providerConfig": parsed_provider_config,
        "replacementAudioPath": str(replacement_audio_path) if replacement_audio_path else "",
        "sourceStartSeconds": max(0.0, float(source_start_seconds)), "sourceDurationSeconds": max(0.0, float(source_duration_seconds)),
        "sourceName": file.filename or "source.mp4", "sourceBytes": source.stat().st_size, "sourceHash": digest,
        "requestedWidth": width, "requestedHeight": height,
        "width": effective_width, "height": effective_height, "preserveAspectRatio": preserve_aspect_ratio,
        "sourceGeometry": source_geometry, "tta": tta, "quality": quality,
        "applyVideoAdjustments": apply_video_adjustments,
        "adjustments": parsed_adjustments, "adjustmentsKey": adjustments_key,
        "clientId": client_id,
        "cancelRequested": False, "cancelled": False,
        "remote": bool(remote), "resumable": bool(remote),
        "checkpointPolicy": checkpoint_policy,
        "remoteEndpoints": remote["endpoints"] if remote else [], "remoteRetries": remote["retries"] if remote else 0,
        "remoteChunkFrames": remote["segmentFrames"] if remote else REMOTE_VIDEO_CHUNK_FRAMES,
        "remoteOutputFps": remote["outputFps"] if remote else None,
        "remoteProcessingKey": remote_processing_key if remote else None,
    }
    blocked_by: list[str] = []
    with video_job_lock:
        if upload_placeholder is not None:
            if (
                video_jobs.get(job_id) is not upload_placeholder
                or upload_placeholder.get("cancelRequested")
                or (client_id and client_id in cancelled_video_clients)
            ):
                _discard_remote_video_upload_locked(job_id, upload_placeholder, workspace)
                raise HTTPException(409, "La pagina che ha creato il job non è più attiva")
            video_jobs[job_id] = record
        else:
            blocked_by = active_video_job_ids_locked()
            if not blocked_by:
                video_jobs[job_id] = record
    if blocked_by:
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(
            409,
            "È già attivo un job video Upscaler. Attendi il completamento o annullalo prima di avviare un altro video.",
        )
    if remote:
        persist_remote_video_job(record)
    log_upscaler_event("backend", "job-created", jobId=job_id, sourceBytes=source.stat().st_size, sourceHash=digest, checkpointPolicy=checkpoint_policy, tempDirectory=workspace)
    threading.Thread(target=process_video_upscale_job, args=(job_id,), daemon=True).start()
    return record


@app.post("/upscale/video/jobs/{job_id}/resume")
def resume_video_upscale_job(job_id: str, payload: dict[str, object] = Body(default={})):
    with video_job_lock:
        item = video_jobs.get(job_id)
        if item is None or not item.get("remote"):
            raise HTTPException(404, "Job remoto riprendibile non trovato")
        if item.get("phase") not in ("error", "cancelled"):
            raise HTTPException(409, "Il job non è in uno stato riprendibile")
        if active_video_job_ids_locked(exclude=job_id):
            raise HTTPException(409, "È già attivo un altro job video Upscaler")
        endpoints = payload.get("endpoints")
        if endpoints is not None:
            if not isinstance(endpoints, list) or not endpoints or not all(isinstance(value, str) for value in endpoints):
                raise HTTPException(400, "Endpoint di ripresa non validi")
            try:
                item["remoteEndpoints"] = list(dict.fromkeys(normalize_endpoint(value) for value in endpoints))
            except RemoteUpscalerError as error:
                raise HTTPException(400, str(error)) from error
        item.update({"phase": "queued", "phaseLabel": "Ripresa dai frame salvati", "cancelRequested": False, "cancelled": False, "error": None})
        snapshot = dict(item)
    persist_remote_video_job(snapshot)
    threading.Thread(target=process_video_upscale_job, args=(job_id,), daemon=True).start()
    return snapshot


@app.get("/upscale/remote/video/jobs")
def recoverable_remote_video_jobs():
    with video_job_lock:
        return {"jobs": [dict(item) for item in video_jobs.values() if item.get("remote") and item.get("phase") in ("error", "cancelled", "ready")]}


@app.get("/upscale/video/jobs/active")
def active_video_upscale_jobs():
    """Lightweight admission probe; unlike cache status it never walks disk."""
    with video_job_lock:
        return {
            "jobs": [
                {
                    "id": str(item.get("id", "")),
                    "phase": str(item.get("phase", "queued")),
                    "phaseLabel": str(item.get("phaseLabel", "Job video attivo")),
                    "sourceName": str(item.get("sourceName", "")),
                    "remote": bool(item.get("remote")),
                    "cancelRequested": bool(item.get("cancelRequested")),
                }
                for item in video_jobs.values()
                if item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES
            ]
        }


@app.get("/upscale/remote/video/cache")
def remote_video_cache_status():
    root = REMOTE_VIDEO_ROOT.resolve()
    root.mkdir(parents=True, exist_ok=True)
    with video_job_lock:
        jobs = [dict(item) for item in video_jobs.values() if item.get("remote")]
    active = [str(item.get("id", "")) for item in jobs if item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES]
    terminal = [str(item.get("id", "")) for item in jobs if item.get("phase") in REMOTE_VIDEO_TERMINAL_PHASES]
    entries = list(root.iterdir())
    return {
        "directory": str(root),
        "jobs": len(jobs),
        "terminalJobs": len(terminal),
        "activeJobs": len(active),
        "activeJobIds": active,
        "entries": len(entries),
        "bytes": sum(_cache_entry_size(entry) for entry in entries),
    }


@app.delete("/upscale/remote/video/cache")
def clear_remote_video_cache():
    """Delete remote checkpoints without racing a worker or escaping the cache root."""
    root = REMOTE_VIDEO_ROOT.resolve()
    root.mkdir(parents=True, exist_ok=True)
    deleted_paths: set[Path] = set()
    deleted_bytes = 0
    failures: list[dict[str, str]] = []
    deleted_job_ids: list[str] = []

    with video_job_lock:
        remote_items = {
            str(item.get("id", "")): item
            for item in video_jobs.values()
            if item.get("remote")
        }
        active = sorted(
            job_id for job_id, item in remote_items.items()
            if item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES
        )
        if active:
            raise HTTPException(409, detail={
                "message": "La cache remota non può essere svuotata mentre esistono job attivi.",
                "activeJobs": active,
            })

        validated_workspaces: dict[str, Path] = {}
        invalid_jobs: list[dict[str, str]] = []
        for job_id, item in remote_items.items():
            try:
                validated_workspaces[job_id] = _validated_remote_cache_workspace(item, root)
            except ValueError as error:
                invalid_jobs.append({"jobId": job_id, "error": str(error)})
        if invalid_jobs:
            raise HTTPException(409, detail={
                "message": "Cancellazione rifiutata: uno o più workspace non appartengono alla cache remota.",
                "invalidJobs": invalid_jobs,
            })

        targets: list[Path] = []
        unsafe_entries: list[str] = []
        for entry in root.iterdir():
            resolved = entry.resolve()
            if entry.is_symlink() or resolved.parent != root:
                unsafe_entries.append(str(entry))
            else:
                targets.append(resolved)
        if unsafe_entries:
            raise HTTPException(409, detail={
                "message": "Cancellazione rifiutata: la cache contiene collegamenti o percorsi non sicuri.",
                "unsafeEntries": unsafe_entries,
            })

        target_sizes = {target: _cache_entry_size(target) for target in targets}
        for target in targets:
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
                deleted_paths.add(target)
                deleted_bytes += target_sizes[target]
            except OSError as error:
                failures.append({"path": str(target), "error": str(error)})

        for job_id, workspace in validated_workspaces.items():
            if not workspace.exists() or workspace in deleted_paths:
                current = video_jobs.get(job_id)
                if current is remote_items[job_id]:
                    video_jobs.pop(job_id, None)
                    deleted_job_ids.append(job_id)

    tracking_ids = set(deleted_job_ids)
    tracking_ids.update(path.name for path in deleted_paths)
    with remote_manifest_lock:
        for job_id in tracking_ids:
            remote_manifest_last_write.pop(job_id, None)
            remote_manifest_written_revision.pop(job_id, None)

    root.mkdir(parents=True, exist_ok=True)
    result: dict[str, object] = {
        "directory": str(root),
        "removedJobs": len(deleted_job_ids),
        "deletedEntries": len(deleted_paths),
        "removedBytes": deleted_bytes,
        "remainingEntries": len(list(root.iterdir())),
    }
    if failures:
        result["failures"] = failures
        log_upscaler_event("backend", "remote-cache-clear-partial", **result)
        raise HTTPException(500, detail=result)
    log_upscaler_event("backend", "remote-cache-cleared", **result)
    return result


@app.delete("/upscale/video/clients/{client_id}")
def release_video_upscale_client(client_id: str):
    """Segna la pagina come chiusa anche se l'upload non ha ancora restituito il job ID."""
    snapshots: list[dict[str, object]] = []
    with video_job_lock:
        cancelled_video_clients[client_id] = time.time()
        released = []
        for job_id, item in video_jobs.items():
            if item.get("clientId") == client_id:
                item["cancelRequested"] = True
                if item.get("remote") and item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES:
                    item.update({
                        "phase": "cancelled", "phaseLabel": "Job remoto annullato",
                        "cancelled": True, "activeEndpoints": [],
                    })
                    item["manifestRevision"] = int(item.get("manifestRevision", 0)) + 1
                    snapshots.append(dict(item))
                released.append(job_id)
    for snapshot in snapshots:
        persist_remote_video_job(snapshot)
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
        if item.get("remote") and item.get("phase") not in REMOTE_VIDEO_TERMINAL_PHASES:
            item.update({
                "phase": "cancelled", "phaseLabel": "Job remoto annullato",
                "cancelled": True, "activeEndpoints": [],
            })
            item["manifestRevision"] = int(item.get("manifestRevision", 0)) + 1
        snapshot = dict(item)
    if snapshot.get("remote"):
        persist_remote_video_job(snapshot)
    if snapshot.get("phase") in ("ready", "error", "cancelled") and not snapshot.get("remote"):
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
    # The frontend adopts this artifact for preview and desktop save. Deleting
    # the workspace at response completion races the native atomic copy, so the
    # READY_JOB_RETENTION_SECONDS timer scheduled at finalization owns cleanup.
    is_mov = path.suffix.lower() == ".mov"
    return FileResponse(path, media_type="video/quicktime" if is_mov else "video/mp4", filename="mlsm-upscaled-video.mov" if is_mov else "mlsm-upscaled-video.mp4")


def minterpolate_filter(target_fps: float, method: str) -> str:
    """Frame interpolation filter graph.

    `motion` runs bidirectional motion estimation and compensation: ffmpeg synthesises
    genuinely new intermediate frames instead of repeating or cross-dissolving the
    existing ones. `motion-obmc` exposes the requested plain OBMC bidirectional
    profile, while `blend` keeps the cheaper frame-mixing mode for long exports.
    """
    if method == "blend":
        return f"minterpolate=fps={target_fps:g}:mi_mode=blend"
    if method == "motion-obmc":
        return f"minterpolate=fps={target_fps:g}:mi_mode=mci:mc_mode=obmc:me_mode=bidir"
    return (
        f"minterpolate=fps={target_fps:g}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir"
        ":me=epzs:vsbmc=1:search_param=32:scd=fdiff:scd_threshold=8"
    )


def complete_minterpolate_filter(target_fps: float, method: str, source_fps: float) -> str:
    """Pad minterpolate's two-frame look-ahead without extending the source timeline."""
    if not math.isfinite(source_fps) or source_fps <= 0:
        raise ValueError("Frame rate sorgente non valido")
    tail_seconds = 2 / source_fps
    return f"tpad=stop_mode=clone:stop_duration={tail_seconds:.12g},{minterpolate_filter(target_fps, method)}"


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


def complete_interpolation_frame_count(
    source_frames: int, source_fps: float, source_duration: float, target_fps: float,
) -> int:
    """Progress target for the padded, duration-preserving Frame Booster output."""
    minimum = expected_minterpolate_frame_count(source_frames, source_fps, target_fps)
    if not math.isfinite(source_duration) or source_duration <= 0:
        raise ValueError("Durata sorgente non valida")
    return max(minimum, int(round(source_duration * target_fps)))


def validate_interpolation_audit(
    *, source_frames: int, source_fps: float, source_duration: float,
    output_frames: int, output_fps: float, output_duration: float, target_fps: float,
    source_width: int | None = None, source_height: int | None = None, output_width: int | None = None, output_height: int | None = None,
    source_sar: str | None = None, output_sar: str | None = None, source_dar: float | None = None, output_dar: float | None = None,
    source_has_audio: bool | None = None, output_has_audio: bool | None = None,
) -> None:
    """Reject duplicated-rate or truncated outputs before they can be delivered."""
    expected_frames = expected_minterpolate_frame_count(source_frames, source_fps, target_fps)
    if not math.isfinite(output_fps) or abs(output_fps - target_fps) > max(.05, target_fps * INTERPOLATION_FPS_RELATIVE_TOLERANCE):
        raise RuntimeError(f"Frame rate interpolato non valido: ottenuti {output_fps:g} fps, target {target_fps:g} fps")
    if output_frames < expected_frames - INTERPOLATION_FRAME_TOLERANCE:
        raise RuntimeError(f"Conteggio interpolato incompleto: ottenuti {output_frames} frame, attesi almeno {expected_frames - INTERPOLATION_FRAME_TOLERANCE}")
    if not math.isfinite(output_duration) or output_duration <= 0:
        raise RuntimeError("Durata del risultato interpolato non valida")
    # Frame Booster pads the look-ahead tail before minterpolate, therefore the
    # delivered video must preserve the complete source timeline.
    expected_duration = expected_frames / target_fps
    duration_tolerance = max(INTERPOLATION_DURATION_TOLERANCE_SECONDS, 2 / target_fps)
    if output_duration + duration_tolerance < expected_duration:
        raise RuntimeError(f"Durata interpolata troncata: ottenuti {output_duration:g} s, attesi circa {expected_duration:g} s")
    if output_duration + duration_tolerance < source_duration:
        raise RuntimeError(f"Durata interpolata troncata rispetto alla sorgente: ottenuti {output_duration:g} s, sorgente {source_duration:g} s")
    if source_width is not None and output_width is not None and (source_width != output_width or source_height != output_height):
        raise RuntimeError("Geometria del risultato interpolato diversa dalla sorgente")
    if source_sar and output_sar and source_sar != output_sar:
        raise RuntimeError("Sample aspect ratio del risultato interpolato diverso dalla sorgente")
    if source_dar and output_dar and abs(source_dar - output_dar) > .01:
        raise RuntimeError("Display aspect ratio del risultato interpolato diverso dalla sorgente")
    if source_has_audio and output_has_audio is False:
        raise RuntimeError("L'audio della sorgente è stato perso")


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


def _register_interpolation_process(job_id: str | None, process: subprocess.Popen[object]) -> None:
    """Register one child process while it belongs to an interpolation job.

    All job-aware subprocesses go through the same registry.  DELETE can then
    terminate ffprobe, ffmpeg and remux children just as it terminates RIFE's
    isolated worker; the registry is intentionally not used by legacy
    synchronous endpoints.
    """
    if not job_id:
        return
    with interpolation_job_lock:
        item = interpolation_jobs.get(job_id)
        if item is None:
            return
        interpolation_processes[job_id] = process
        item["processId"] = getattr(process, "pid", None)


def _unregister_interpolation_process(job_id: str | None, process: subprocess.Popen[object]) -> None:
    if not job_id:
        return
    with interpolation_job_lock:
        if interpolation_processes.get(job_id) is process:
            interpolation_processes.pop(job_id, None)
        item = interpolation_jobs.get(job_id)
        if item is not None and item.get("processId") == getattr(process, "pid", None):
            item.pop("processId", None)


def _run_interpolation_subprocess(
    job_id: str,
    command: list[str],
    *,
    timeout_seconds: float = INTERPOLATION_TIMEOUT_SECONDS,
    on_stdout_line: Callable[[str], None] | None = None,
) -> subprocess.CompletedProcess[bytes]:
    """Run a job child with cancellation, timeout and bounded process cleanup.

    Two reader threads continuously drain stdout/stderr so a verbose ffmpeg
    process cannot block on a full pipe.  The caller remains responsive to a
    DELETE request while the process is running and receives an ordinary
    ``CompletedProcess`` once it exits.  Every exit path unregisters the child
    only after it has stopped.
    """
    if _interpolation_job_cancelled(job_id):
        raise InterruptedError("Interpolazione annullata")
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _register_interpolation_process(job_id, process)
    output_queue: queue.Queue[tuple[str, bytes]] = queue.Queue()
    stdout_chunks: list[bytes] = []
    stderr_chunks: list[bytes] = []

    def drain(stream: object, label: str) -> None:
        if stream is None or not hasattr(stream, "readline"):
            return
        try:
            while True:
                line = stream.readline()  # type: ignore[attr-defined]
                if line in (b"", "", None):
                    break
                if isinstance(line, str):
                    line = line.encode("utf-8", "replace")
                output_queue.put((label, bytes(line)))
        except (OSError, ValueError):
            # The stream can be closed by terminate/kill while the reader is
            # draining.  The process result still determines the job outcome.
            return

    readers: list[threading.Thread] = []
    for stream, label in ((getattr(process, "stdout", None), "stdout"), (getattr(process, "stderr", None), "stderr")):
        if stream is not None and hasattr(stream, "readline"):
            reader = threading.Thread(target=drain, args=(stream, label), daemon=True)
            reader.start()
            readers.append(reader)

    started = time.monotonic()

    def consume(label: str, chunk: bytes) -> None:
        if label == "stdout":
            stdout_chunks.append(chunk)
            if on_stdout_line is not None:
                on_stdout_line(chunk.decode("utf-8", "replace").strip())
        else:
            stderr_chunks.append(chunk)

    try:
        while process.poll() is None:
            if _interpolation_job_cancelled(job_id):
                _terminate_subprocess(process)
                raise InterruptedError("Interpolazione annullata")
            if time.monotonic() - started >= max(0.0, timeout_seconds):
                _terminate_subprocess(process)
                raise TimeoutError("L'interpolazione non è terminata entro il tempo massimo.")
            while True:
                try:
                    label, chunk = output_queue.get_nowait()
                except queue.Empty:
                    break
                consume(label, chunk)
            try:
                process.wait(timeout=.05)
            except subprocess.TimeoutExpired:
                continue
        returncode = process.poll()
        # DELETE can race with the final wait/poll transition.  Honour a
        # cancellation observed after the child exited as well, before
        # publishing a successful CompletedProcess to the caller.
        if _interpolation_job_cancelled(job_id):
            raise InterruptedError("Interpolazione annullata")
        # Give readers a bounded opportunity to consume the EOF and remaining
        # bytes after process exit.  They are daemon threads as a final guard.
        for reader in readers:
            reader.join(timeout=1)
        while True:
            try:
                label, chunk = output_queue.get_nowait()
            except queue.Empty:
                break
            consume(label, chunk)
        return subprocess.CompletedProcess(command, int(returncode or 0), b"".join(stdout_chunks), b"".join(stderr_chunks))
    finally:
        if process.poll() is None:
            _terminate_subprocess(process)
        _unregister_interpolation_process(job_id, process)


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


def _interpolation_probe(path: Path, job_id: str | None = None) -> tuple[int, float, float]:
    """Return encoded frames, average frame rate and video duration."""
    probe = ffprobe_binary()
    if not probe:
        raise RuntimeError("ffprobe non disponibile: impossibile verificare l'interpolazione")
    command = [
        probe, "-v", "error", "-select_streams", "v:0", "-count_frames",
        "-show_entries", "stream=nb_read_frames,avg_frame_rate,duration:format=duration", "-of", "json", str(path)
    ]
    if job_id:
        result = _run_interpolation_subprocess(job_id, command)
    else:
        result = subprocess.run(command, capture_output=True, check=False)
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


def _interpolation_media_audit(path: Path, job_id: str | None = None, count_frames: bool = True) -> dict[str, object]:
    """Read the complete source/output contract used by standalone Frame Booster."""
    probe = ffprobe_binary()
    if not probe:
        raise RuntimeError("ffprobe non disponibile: impossibile verificare il file")
    command = [probe, "-v", "error"]
    if count_frames:
        command.append("-count_frames")
    command.extend(["-show_streams", "-show_format", "-of", "json", str(path)])
    if job_id:
        result = _run_interpolation_subprocess(job_id, command)
    else:
        result = subprocess.run(command, capture_output=True, check=False)
    if result.returncode != 0: raise RuntimeError("ffprobe non riesce a leggere l'audit multimediale")
    payload = json.loads(result.stdout or b"{}")
    streams = payload.get("streams", [])
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    if not isinstance(video, dict): raise RuntimeError("Il file non contiene una traccia video")
    rate = str(video.get("avg_frame_rate") or video.get("r_frame_rate") or "0/1"); numerator, denominator = rate.split("/", 1)
    fps = float(numerator) / float(denominator) if float(denominator) else 0.0
    duration = float(video.get("duration") or payload.get("format", {}).get("duration") or 0)
    frames = int(video.get("nb_read_frames") or video.get("nb_frames") or 0)
    if frames <= 0 and duration > 0 and fps > 0:
        frames = max(1, round(duration * fps))
    # Reuse the same rotation/SAR parser used by video ingest. Smartphone files
    # commonly store landscape-coded pixels plus a 90-degree display matrix;
    # comparing raw coded dimensions would reject a correct autorotated output.
    geometry = parse_ffprobe_geometry({"streams": [video]})
    sar = str(geometry["sample_aspect_ratio"])
    if int(geometry["rotation"]) % 180 == 90 and ":" in sar:
        numerator, denominator = sar.split(":", 1)
        sar = f"{denominator}:{numerator}"
    return {
        "frameCount": frames,
        "fps": fps,
        "durationSeconds": duration,
        "width": int(geometry["display_width"]),
        "height": int(geometry["display_height"]),
        "codedWidth": int(geometry["width"]),
        "codedHeight": int(geometry["height"]),
        "rotation": int(geometry["rotation"]),
        "sampleAspectRatio": sar,
        "displayAspectRatio": float(geometry["display_aspect_ratio"]),
        "hasAudio": any(item.get("codec_type") == "audio" for item in streams),
    }


def _resolve_interpolation_rates(
    *, probed_source_fps: float, declared_source_fps: object,
    target_fps: object, target_multiplier: object,
) -> tuple[float, float]:
    if target_multiplier is not None:
        source = float(probed_source_fps)
        return source, source * float(target_multiplier)
    source = float(declared_source_fps or probed_source_fps)
    return source, float(target_fps or 0)


def _run_ffmpeg_interpolation_job(
    job_id: str, source: Path, destination: Path, target_fps: float, method: str,
    expected_frames: int, source_fps: float, source_duration: float,
) -> str:
    """Run ffmpeg with machine-readable progress and cooperative cancellation."""
    binary = ffmpeg_binary()
    if not binary:
        raise RuntimeError("ffmpeg non trovato nel PATH. Installalo con `brew install ffmpeg` e riavvia il servizio.")
    command = [
        binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-filter:v", complete_minterpolate_filter(target_fps, method, source_fps),
        "-r", f"{target_fps:g}", "-t", f"{source_duration:.12g}",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-c:a", "copy", "-progress", "pipe:1", str(destination)
    ]
    started = time.monotonic()
    def on_progress_line(line: str) -> None:
        if "=" not in line:
            return
        key, value = line.split("=", 1)
        elapsed = time.monotonic() - started
        if key == "frame":
            try:
                frame = max(0, int(float(value or 0)))
            except ValueError:
                return
            fraction = min(1.0, frame / max(1, expected_frames))
            _update_interpolation_job(job_id, currentFrame=frame, totalFrames=expected_frames, progress=fraction, stageProgress=fraction, elapsedSeconds=elapsed, estimatedRemainingSeconds=(elapsed / frame * (expected_frames - frame)) if frame else None, indeterminate=False)
        elif key == "total_size":
            try:
                size = max(0, int(float(value or 0)))
            except ValueError:
                return
            _update_interpolation_job(job_id, processedBytes=size, bytesProcessed=size, elapsedSeconds=elapsed)
        elif key == "progress" and value == "end":
            _update_interpolation_job(job_id, progress=1.0, stageProgress=1.0, currentFrame=expected_frames, totalFrames=expected_frames, elapsedSeconds=elapsed, estimatedRemainingSeconds=0)

    result = _run_interpolation_subprocess(job_id, command, on_stdout_line=on_progress_line)
    returncode = result.returncode
    if returncode != 0:
        detail = result.stderr.decode("utf-8", "replace").strip()[-600:]
        raise RuntimeError(f"ffmpeg ha restituito un errore: {detail or 'nessun dettaglio disponibile'}")
    return f"ffmpeg · {method}"


def _rife_worker_command(source: Path, destination: Path, target_fps: float, device: str = "auto", precision: str = "auto", model_id: str = "rife-v4.26") -> list[str]:
    return [
        sys.executable, str(Path(__file__).resolve()), "--rife-worker",
        str(source), str(destination), f"{target_fps:g}", str(model_id), str(device), str(precision),
    ]


def _run_rife_worker(source: Path, destination: Path, target_fps: float, model_id: str, device: str, precision: str = "auto") -> None:
    # The worker may run only after the server-side manifest, checksum and
    # PyTorch device validation have passed.  Never import a random module or
    # silently switch to FFmpeg when those checks fail.
    runtime = validate_rife_request(model_id, device, precision, require_self_test=False)
    practical_rife_interpolate_file(
        source,
        destination,
        target_fps=target_fps,
        runtime_path=Path(str(runtime["runtimePath"])),
        device=str(runtime["device"]),
        precision=str(runtime["precision"]),
    )


def _run_isolated_rife(source: Path, destination: Path, target_fps: float, job_id: str | None = None, device: str = "auto", precision: str = "auto", model_id: str = "rife-v4.26") -> str:
    """Run the callable-only RIFE runtime in a killable worker process."""
    try:
        # Validate the device the user actually selected. A failed automatic
        # MPS test must not block an explicitly verified CUDA/CPU job (or vice
        # versa), and the worker receives the resolved device/precision.
        request = validate_rife_request(model_id, device, precision)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(409, str(error)) from error
    effective_device = str(request["device"])
    effective_precision = str(request["precision"])
    log_path = destination.with_suffix(".rife-worker.log")
    with log_path.open("w+b") as worker_log:
        process = subprocess.Popen(_rife_worker_command(source, destination, target_fps, effective_device, effective_precision, model_id), stdout=subprocess.DEVNULL, stderr=worker_log)
        _register_interpolation_process(job_id, process)
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
            if process.poll() is None:
                _terminate_subprocess(process)
            _unregister_interpolation_process(job_id, process)
    log_path.unlink(missing_ok=True)
    if not destination.exists() or destination.stat().st_size == 0:
        raise HTTPException(500, "Il runtime RIFE non ha prodotto un file utilizzabile.")
    return f"rife · {effective_device}/{effective_precision}"


def _remux_interpolation_audio(source: Path, destination: Path, job_id: str | None = None) -> None:
    """Copy the original audio stream onto a RIFE video without re-encoding it."""
    binary = ffmpeg_binary()
    if not binary: raise RuntimeError("ffmpeg non disponibile per il remux audio RIFE")
    temporary = destination.with_suffix(".audio-remux.mp4")
    command = [binary, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(destination), "-i", str(source), "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy", "-c:a", "copy", "-shortest", str(temporary)]
    try:
        if job_id:
            result = _run_interpolation_subprocess(job_id, command)
        else:
            result = subprocess.run(command, capture_output=True, check=False, timeout=INTERPOLATION_TIMEOUT_SECONDS)
        if result.returncode != 0: raise RuntimeError((result.stderr or b"").decode("utf-8", "replace")[-500:] or "Remux audio RIFE fallito")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


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
        source_frames, probed_source_fps, source_duration = _interpolation_probe(source, job_id)
        source_audit = _interpolation_media_audit(source, job_id)
        # Multiplier mode is derived exclusively from ffprobe. Browser metadata
        # is often missing or rounded (29.97 vs 30) and must never determine the
        # output timeline.
        source_fps, target_fps = _resolve_interpolation_rates(
            probed_source_fps=probed_source_fps,
            declared_source_fps=job.get("sourceFps"),
            target_fps=job.get("targetFps"),
            target_multiplier=job.get("targetMultiplier"),
        )
        if not 1 <= target_fps <= 480 or target_fps <= source_fps:
            raise RuntimeError("Frame rate target non valido o non superiore alla sorgente")
        if abs(probed_source_fps - source_fps) > max(.05, source_fps * INTERPOLATION_FPS_RELATIVE_TOLERANCE):
            raise RuntimeError(f"Frame rate sorgente non coerente: dichiarati {source_fps:g} fps, rilevati {probed_source_fps:g} fps")
        _update_interpolation_job(job_id, sourceFps=source_fps, targetFps=target_fps)
        expected = complete_interpolation_frame_count(source_frames, source_fps, source_duration, target_fps)
        _update_interpolation_job(job_id, sourceFrames=source_frames, totalFrames=expected, stageTotalFrames=expected, phase="interpolating", phaseLabel="Interpolazione dei fotogrammi", progress=0.0, stageProgress=0.0)
        if _interpolation_job_cancelled(job_id):
            raise InterruptedError("Interpolazione annullata")
        method = str(job["method"])
        if method == "rife":
            # RIFE runtimes generally expose no frame callback.  Mark this honestly
            # as indeterminate and still check cancellation at the boundaries.
            _update_interpolation_job(job_id, indeterminate=True, progress=0.0, stageProgress=None, phaseLabel="RIFE · elaborazione GPU in corso")
            backend = _run_isolated_rife(source, destination, target_fps, job_id, str(job.get("device", "auto")), str(job.get("precision", "auto")), str(job.get("rifeModel", "rife-v4.26")))
            if bool(source_audit.get("hasAudio")):
                _update_interpolation_job(job_id, phase="remuxing", phaseLabel="Ripristino audio originale", indeterminate=True)
                _remux_interpolation_audio(source, destination, job_id)
        else:
            backend = _run_ffmpeg_interpolation_job(
                job_id, source, destination, target_fps, method, expected,
                source_fps, source_duration,
            )
        if _interpolation_job_cancelled(job_id):
            raise InterruptedError("Interpolazione annullata")
        _update_interpolation_job(job_id, phase="verifying", phaseLabel="Verifica del file interpolato", progress=1.0, stageProgress=1.0, indeterminate=False)
        if not destination.exists() or destination.stat().st_size <= 0:
            raise RuntimeError("L'interpolazione non ha prodotto un file utilizzabile.")
        frames, fps, duration = _interpolation_probe(destination, job_id)
        output_audit = _interpolation_media_audit(destination, job_id)
        validate_interpolation_audit(
            source_frames=source_frames, source_fps=source_fps, source_duration=source_duration,
            output_frames=frames, output_fps=fps, output_duration=duration, target_fps=target_fps,
            source_width=int(source_audit["width"]), source_height=int(source_audit["height"]), output_width=int(output_audit["width"]), output_height=int(output_audit["height"]), source_sar=str(source_audit["sampleAspectRatio"]), output_sar=str(output_audit["sampleAspectRatio"]), source_dar=float(source_audit["displayAspectRatio"]), output_dar=float(output_audit["displayAspectRatio"]), source_has_audio=bool(source_audit["hasAudio"]), output_has_audio=bool(output_audit["hasAudio"]),
        )
        _update_interpolation_job(job_id, phase="ready", phaseLabel="Interpolazione completata", progress=1.0, stageProgress=1.0, currentFrame=frames, totalFrames=frames, resultPath=str(destination), resultBytes=destination.stat().st_size, processedBytes=destination.stat().st_size, bytesProcessed=destination.stat().st_size, outputFps=fps, backend=backend, source=source_audit, output=output_audit, elapsedSeconds=time.monotonic() - started, estimatedRemainingSeconds=0, indeterminate=False)
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


@app.post("/interpolation/probe")
@app.post("/interpolate/probe")
async def probe_interpolation_source(file: UploadFile = File(...)):
    """Read source FPS as soon as a Frame Booster file is selected."""
    if not ffprobe_binary():
        raise HTTPException(503, "ffprobe non disponibile nel servizio locale")
    suffix = Path(file.filename or "source.mp4").suffix.lower()
    if suffix not in (".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"):
        suffix = ".mp4"
    workspace = Path(tempfile.mkdtemp(prefix="mlsm-frame-probe-"))
    source = workspace / ("source" + suffix)
    log_upscaler_event("backend", "interpolation-probe-start", fileName=file.filename or "source.mp4", contentType=file.content_type or "")
    try:
        source_bytes = await _stream_upload_limited(file, source)
        result = _interpolation_media_audit(source, count_frames=False)
        log_upscaler_event("backend", "interpolation-probe-ready", fileName=file.filename or "source.mp4", sourceBytes=source_bytes, fps=result.get("fps"), width=result.get("width"), height=result.get("height"))
        return result
    except HTTPException:
        log_upscaler_event("backend", "interpolation-probe-http-error", fileName=file.filename or "source.mp4")
        raise
    except Exception as error:
        log_upscaler_event("backend", "interpolation-probe-error", fileName=file.filename or "source.mp4", error=str(error))
        raise HTTPException(400, str(error)) from error
    finally:
        await file.close()
        shutil.rmtree(workspace, ignore_errors=True)


@app.post("/interpolation/jobs")
@app.post("/interpolate/jobs")
async def create_interpolation_job(
    file: UploadFile = File(...), source_fps: float | None = Form(None), target_fps: float | None = Form(None),
    target_multiplier: float | None = Form(None), method: str = Form("motion"), client_id: str = Form(""),
    device: str = Form("auto"), rife_model: str = Form("rife-v4.26"), precision: str = Form("auto")
):
    if method not in INTERPOLATION_METHODS:
        raise HTTPException(400, "Metodo di interpolazione sconosciuto")
    if target_multiplier is not None and target_fps is not None:
        raise HTTPException(400, "Scegli un moltiplicatore oppure FPS diretti, non entrambi")
    if target_multiplier is None and target_fps is None:
        raise HTTPException(400, "Target di interpolazione mancante")
    if target_multiplier is not None and (not math.isfinite(target_multiplier) or target_multiplier <= 1 or target_multiplier > 16):
        raise HTTPException(400, "Moltiplicatore fuori dai limiti supportati")
    if target_fps is not None and (not math.isfinite(target_fps) or not 1 <= target_fps <= 480):
        raise HTTPException(400, "Frame rate target fuori dai limiti supportati")
    if device not in ("auto", "mps", "cuda", "cpu") or precision not in ("auto", "fp16", "fp32"):
        raise HTTPException(400, "Device o precisione non supportati")
    if method == "rife":
        try:
            validate_rife_request(rife_model, device, precision)
        except (RuntimeError, ValueError) as error:
            raise HTTPException(409, str(error)) from error
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
            "currentFrame": 0, "totalFrames": 0, "sourceFps": source_fps, "targetFps": target_fps, "targetMultiplier": target_multiplier, "method": method,
            "tempDirectory": str(workspace), "sourcePath": str(source), "clientId": client_id,
            "cancelRequested": False, "cancelled": False, "indeterminate": method == "rife", "processedBytes": 0, "totalBytes": source_bytes,
            "device": device, "rifeModel": rife_model, "precision": precision
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
    # Keep the verified artifact until the existing ready-job retention timer
    # expires. The desktop client downloads it for preview first and may copy
    # the same audited file to a user-selected destination afterwards.
    return FileResponse(path, media_type="video/mp4", filename="mlsm-interpolated-video.mp4")


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
        source_audit = _interpolation_media_audit(source)
        if abs(probed_source_fps - source_fps) > max(.05, source_fps * INTERPOLATION_FPS_RELATIVE_TOLERANCE):
            raise HTTPException(400, f"Frame rate sorgente non coerente: dichiarati {source_fps:g} fps, rilevati {probed_source_fps:g} fps")
        backend = run_rife(source, destination, target_fps) if method == "rife" else run_ffmpeg(source, destination, target_fps, method)
        if method == "rife" and bool(source_audit.get("hasAudio")):
            _remux_interpolation_audio(source, destination)
        if not destination.exists() or destination.stat().st_size == 0:
            raise HTTPException(500, "L'interpolazione non ha prodotto un file utilizzabile.")
        frames, fps, duration = _interpolation_probe(destination)
        output_audit = _interpolation_media_audit(destination)
        validate_interpolation_audit(
            source_frames=source_frames, source_fps=source_fps, source_duration=source_duration,
            output_frames=frames, output_fps=fps, output_duration=duration, target_fps=target_fps,
            source_width=int(source_audit["width"]), source_height=int(source_audit["height"]), output_width=int(output_audit["width"]), output_height=int(output_audit["height"]), source_sar=str(source_audit["sampleAspectRatio"]), output_sar=str(output_audit["sampleAspectRatio"]), source_dar=float(source_audit["displayAspectRatio"]), output_dar=float(output_audit["displayAspectRatio"]), source_has_audio=bool(source_audit["hasAudio"]), output_has_audio=bool(output_audit["hasAudio"]),
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
    if len(sys.argv) in (7, 8) and sys.argv[1] == "--rife-worker":
        try:
            # argv[5] is the manifest model identifier, not a filesystem path.
            # Converting it to Path makes even the supported ``rife-v4.26``
            # fail the worker-side allow-list before inference can start.
            _run_rife_worker(Path(sys.argv[2]), Path(sys.argv[3]), float(sys.argv[4]), sys.argv[5], sys.argv[6], sys.argv[7] if len(sys.argv) == 8 else "auto")
        except Exception as error:
            print(str(error), file=sys.stderr, flush=True)
            raise SystemExit(1) from error
        raise SystemExit(0)
    parent_pid = configured_parent_pid()
    log_upscaler_event(
        "backend", "service-starting", pid=os.getpid(), parentPid=parent_pid,
        ownerKind=os.environ.get("MLSM_UPSCALER_OWNER_KIND", "cli"),
        platform=sys.platform, python=sys.executable, eventLog=str(EVENT_LOG),
    )
    start_parent_watchdog(parent_pid)
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("DSAS_UPSCALER_PORT", "8765")), log_level="info")
