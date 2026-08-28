"""Device-agnostic adapter for the pinned upstream Practical-RIFE runtime.

The model architecture and weights are never reimplemented here: both come
from the checksummed hzwer artifact installed by :mod:`manifest`.  This module
only replaces upstream's CUDA-only process setup with explicit PyTorch device
placement so the same network can run on Apple MPS, CUDA, or opt-in CPU.
"""
from __future__ import annotations

import importlib.util
import inspect
import math
import sys
import types
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from torch.nn import functional as F


def device_available(device: str) -> bool:
    if device == "mps":
        return bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_available())
    if device == "cuda":
        return bool(torch.cuda.is_available())
    return device == "cpu"


def automatic_device() -> str | None:
    if device_available("mps"):
        return "mps"
    if device_available("cuda"):
        return "cuda"
    # CPU is supported, but never selected implicitly for a potentially
    # hours-long video job. The user must choose it explicitly.
    return None


def resolve_device(requested: str) -> str:
    if requested == "auto":
        selected = automatic_device()
        if selected is None:
            raise RuntimeError("Nessuna GPU MPS/CUDA disponibile; seleziona CPU esplicitamente per usare RIFE.")
        return selected
    if requested not in {"mps", "cuda", "cpu"} or not device_available(requested):
        raise RuntimeError(f"Device RIFE {requested} non disponibile.")
    return requested


def resolve_precision(device: str, requested: str) -> str:
    if requested == "auto":
        return "fp16" if device == "cuda" else "fp32"
    if requested not in {"fp16", "fp32"}:
        raise RuntimeError(f"Precisione RIFE {requested} non supportata.")
    if requested == "fp16" and device != "cuda":
        raise RuntimeError("RIFE FP16 è supportato solo su CUDA; MPS usa FP32.")
    return requested


def _load_upstream_model(runtime_path: Path, device: str, precision: str) -> Any:
    model_path = runtime_path / "train_log" if (runtime_path / "train_log").is_dir() else runtime_path
    module_path = model_path / "RIFE_HDv3.py"
    weights_path = model_path / "flownet.pkl"
    if not module_path.is_file() or not weights_path.is_file():
        raise RuntimeError("Runtime Practical-RIFE incompleto.")
    # v4.x architecture modules import siblings (IFNet_HDv3, warplayer, ...)
    # by their upstream names, so the verified directory must be importable.
    runtime_text = str(runtime_path)
    if runtime_text not in sys.path:
        sys.path.insert(0, runtime_text)
    package_name = f"mlsm_practical_rife_{abs(hash(runtime_text))}"
    package = types.ModuleType(package_name)
    package.__path__ = [runtime_text]  # type: ignore[attr-defined]
    package.__package__ = package_name
    sys.modules[package_name] = package
    module_name = f"{package_name}.RIFE_HDv3"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Impossibile caricare RIFE_HDv3.py dall'artifact verificato.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Upstream's warplayer.py keeps a module-level CUDA/CPU device chosen at
    # import time. On Apple Silicon that becomes CPU even though inference is
    # on MPS. Retarget only modules loaded from the verified upstream runtime;
    # no global PyTorch monkey-patching is performed.
    runtime_resolved = runtime_path.resolve()
    for imported in tuple(sys.modules.values()):
        imported_file = getattr(imported, "__file__", None)
        if not imported_file:
            continue
        try:
            Path(imported_file).resolve().relative_to(runtime_resolved)
        except (OSError, ValueError):
            continue
        if isinstance(getattr(imported, "device", None), torch.device):
            setattr(imported, "device", torch.device(device))
        grid_cache = getattr(imported, "backwarp_tenGrid", None)
        if isinstance(grid_cache, dict):
            grid_cache.clear()
    model = module.Model()
    model.load_model(str(model_path), -1)
    model.eval()
    dtype = torch.float16 if precision == "fp16" else torch.float32
    modules = []
    for value in vars(model).values():
        if isinstance(value, torch.nn.Module) and all(value is not existing for existing in modules):
            value.to(device=torch.device(device), dtype=dtype)
            value.eval()
            modules.append(value)
    if not modules:
        raise RuntimeError("L'upstream Practical-RIFE non ha esposto una rete PyTorch.")
    return model


class PracticalRife:
    def __init__(self, runtime_path: Path, device: str, precision: str) -> None:
        self.device_name = resolve_device(device)
        self.precision_name = resolve_precision(self.device_name, precision)
        self.device = torch.device(self.device_name)
        self.dtype = torch.float16 if self.precision_name == "fp16" else torch.float32
        self.model = _load_upstream_model(runtime_path, self.device_name, self.precision_name)

    def _tensor(self, image: np.ndarray) -> tuple[torch.Tensor, tuple[int, int]]:
        if image.ndim != 3 or image.shape[2] != 3:
            raise RuntimeError("Frame RIFE non RGB.")
        height, width = image.shape[:2]
        tensor = torch.from_numpy(np.ascontiguousarray(image.transpose(2, 0, 1))).unsqueeze(0)
        tensor = tensor.to(device=self.device, dtype=self.dtype).div_(255.0)
        # RIFE v4.26 uses six flow blocks and requires mod-64 tensors.
        padded_height = math.ceil(height / 64) * 64
        padded_width = math.ceil(width / 64) * 64
        return F.pad(tensor, (0, padded_width - width, 0, padded_height - height)), (height, width)

    def interpolate(self, first_rgb: np.ndarray, second_rgb: np.ndarray, timestep: float) -> np.ndarray:
        if not 0 < timestep < 1:
            raise ValueError("Il timestep RIFE deve essere compreso tra 0 e 1.")
        first, shape = self._tensor(first_rgb)
        second, second_shape = self._tensor(second_rgb)
        if second_shape != shape:
            raise RuntimeError("I frame RIFE hanno dimensioni diverse.")
        inference = self.model.inference
        parameters = inspect.signature(inference).parameters
        kwargs: dict[str, Any] = {}
        if "timestep" in parameters:
            kwargs["timestep"] = float(timestep)
        if "scale" in parameters:
            kwargs["scale"] = 1.0
        if "timestep" not in parameters and abs(timestep - .5) > 1e-6:
            raise RuntimeError("Questo artifact Practical-RIFE non supporta timestep arbitrari.")
        with torch.inference_mode():
            result = inference(first, second, **kwargs)
        if isinstance(result, (tuple, list)):
            result = result[-1]
        if not isinstance(result, torch.Tensor):
            raise RuntimeError("Practical-RIFE non ha restituito un tensore.")
        height, width = shape
        output = result[0, :, :height, :width].float().clamp(0, 1).mul(255).byte().cpu().numpy()
        return np.ascontiguousarray(output.transpose(1, 2, 0))


def mini_inference(runtime_path: Path, device: str, precision: str) -> dict[str, Any]:
    engine = PracticalRife(runtime_path, device, precision)
    first = np.zeros((64, 64, 3), dtype=np.uint8)
    second = np.full((64, 64, 3), 255, dtype=np.uint8)
    output = engine.interpolate(first, second, .5)
    if output.shape != first.shape or output.dtype != np.uint8 or not np.isfinite(output).all():
        raise RuntimeError("Self-test RIFE: output non valido.")
    return {"device": engine.device_name, "precision": engine.precision_name, "shape": list(output.shape)}


def interpolate_file(
    source: Path,
    destination: Path,
    *,
    target_fps: float,
    runtime_path: Path,
    device: str,
    precision: str,
) -> dict[str, Any]:
    engine = PracticalRife(runtime_path, device, precision)
    capture = cv2.VideoCapture(str(source))
    if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
        capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    if not capture.isOpened() or not math.isfinite(source_fps) or source_fps <= 0:
        capture.release()
        raise RuntimeError("Practical-RIFE non riesce a decodificare il video sorgente.")
    if not math.isfinite(target_fps) or target_fps <= source_fps:
        capture.release()
        raise RuntimeError("FPS target RIFE non validi.")
    ok, first_bgr = capture.read()
    if not ok or first_bgr is None:
        capture.release()
        raise RuntimeError("Il video sorgente non contiene frame decodificabili.")
    height, width = first_bgr.shape[:2]
    writer = cv2.VideoWriter(str(destination), cv2.VideoWriter_fourcc(*"mp4v"), target_fps, (width, height))
    if not writer.isOpened():
        capture.release()
        raise RuntimeError("OpenCV non riesce a creare il video RIFE.")
    written = 0
    next_output_time = 0.0
    pair_index = 0
    try:
        while True:
            ok, second_bgr = capture.read()
            if not ok or second_bgr is None:
                break
            pair_start = pair_index / source_fps
            pair_end = (pair_index + 1) / source_fps
            first_rgb = cv2.cvtColor(first_bgr, cv2.COLOR_BGR2RGB)
            second_rgb = cv2.cvtColor(second_bgr, cv2.COLOR_BGR2RGB)
            while next_output_time < pair_end - 1e-9:
                timestep = (next_output_time - pair_start) * source_fps
                if timestep <= 1e-7:
                    output_bgr = first_bgr
                else:
                    interpolated = engine.interpolate(first_rgb, second_rgb, min(1 - 1e-7, max(1e-7, timestep)))
                    output_bgr = cv2.cvtColor(interpolated, cv2.COLOR_RGB2BGR)
                writer.write(output_bgr)
                written += 1
                next_output_time = written / target_fps
            first_bgr = second_bgr
            pair_index += 1
        final_time = pair_index / source_fps
        if next_output_time <= final_time + (0.5 / target_fps):
            writer.write(first_bgr)
            written += 1
    finally:
        writer.release()
        capture.release()
    if written < 2 or not destination.is_file() or destination.stat().st_size <= 0:
        raise RuntimeError("Practical-RIFE non ha prodotto un video valido.")
    return {"device": engine.device_name, "precision": engine.precision_name, "frames": written}
