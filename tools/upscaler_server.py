"""Local PyTorch/Real-ESRGAN service used by the web editor. Run explicitly; never auto-started."""
from __future__ import annotations

import os
import sys
import threading
import types
import urllib.request
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
from fastapi.responses import Response
from realesrgan import RealESRGANer
from realesrgan.archs.srvgg_arch import SRVGGNetCompact

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("DSAS_UPSCALER_CACHE", ROOT / ".upscaler-cache" / "pytorch"))
CACHE.mkdir(parents=True, exist_ok=True)
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

app = FastAPI(title="MLSM Studio Upscaler", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost|https://tauri\.localhost)$", allow_methods=["GET", "POST"], allow_headers=["*"])


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


@app.get("/health")
def health():
    return {"ok": True, **hardware()}


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
    output, _ = runner.enhance(image, outscale=MODELS[model][0])
    if tta:
        mirrored, _ = runner.enhance(cv2.flip(image, 1), outscale=MODELS[model][0])
        output = cv2.addWeighted(output, .5, cv2.flip(mirrored, 1), .5, 0)
    if output.shape[1] != width or output.shape[0] != height:
        output = cv2.resize(output, (width, height), interpolation=cv2.INTER_LANCZOS4)
    ok, encoded = cv2.imencode(".png", output, [cv2.IMWRITE_PNG_COMPRESSION, 2])
    if not ok:
        raise HTTPException(500, "Codifica PNG fallita")
    return Response(encoded.tobytes(), media_type="image/png", headers={"X-Upscaler-Backend": str(device_from(backend))})


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("DSAS_UPSCALER_PORT", "8765")), log_level="info")
