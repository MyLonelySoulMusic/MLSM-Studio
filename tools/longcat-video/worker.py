#!/usr/bin/env python3
"""Strict MLSM adapter for the official meituan-longcat/LongCat-Video pipeline."""

from __future__ import annotations

import argparse
import datetime
import json
import os
import signal
import sys
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1
PINNED_REVISION = "6b3f4b8582a8bc3f20f795735f5383716c4ba794"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPOSITORY = PROJECT_ROOT / ".longcat-video" / "repository"
DEFAULT_CHECKPOINT = PROJECT_ROOT / ".longcat-video" / "weights" / "LongCat-Video"
REQUIRED_CHECKPOINT_DIRECTORIES = ("tokenizer", "text_encoder", "vae", "scheduler", "dit", "lora")
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}


class WorkerError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _path_from_env(name: str, fallback: Path) -> Path:
    value = os.environ.get(name, "").strip()
    return Path(value).expanduser().resolve() if value else fallback.resolve()


def runtime_paths() -> tuple[Path, Path]:
    return (
        _path_from_env("MLSM_LONGCAT_REPOSITORY", DEFAULT_REPOSITORY),
        _path_from_env("MLSM_LONGCAT_CHECKPOINT", DEFAULT_CHECKPOINT),
    )


def _emit(kind: str, **payload: Any) -> None:
    if int(os.environ.get("RANK", "0")) != 0:
        return
    print(json.dumps({"protocolVersion": PROTOCOL_VERSION, "type": kind, **payload}, ensure_ascii=False), flush=True)


def capabilities() -> dict[str, Any]:
    repository, checkpoint = runtime_paths()
    repository_ready = (repository / "longcat_video" / "pipeline_longcat_video.py").is_file()
    checkpoint_ready = all((checkpoint / directory).is_dir() for directory in REQUIRED_CHECKPOINT_DIRECTORIES)
    platform_supported = sys.platform.startswith("linux")
    torch_ready = False
    cuda_ready = False
    gpu_name = None
    dependency_error = None
    try:
        import torch
        import diffusers  # noqa: F401
        import transformers  # noqa: F401
        import torchvision  # noqa: F401
        torch_ready = True
        cuda_ready = bool(torch.cuda.is_available() and torch.cuda.device_count() > 0)
        if cuda_ready:
            gpu_name = str(torch.cuda.get_device_name(0))
    except Exception as error:  # capability checks must report, never crash
        dependency_error = str(error)
    ready = platform_supported and repository_ready and checkpoint_ready and torch_ready and cuda_ready
    missing: list[str] = []
    if not platform_supported:
        missing.append("la pipeline ufficiale richiede Linux con NCCL")
    if not repository_ready:
        missing.append("repository ufficiale non installato")
    if not torch_ready:
        missing.append(f"dipendenze Python incomplete{': ' + dependency_error if dependency_error else ''}")
    if torch_ready and not cuda_ready:
        missing.append("GPU NVIDIA CUDA non rilevata")
    if not checkpoint_ready:
        missing.append("checkpoint LongCat-Video incompleto")
    return {
        "ready": ready,
        "platformSupported": platform_supported,
        "runtimeReady": torch_ready,
        "repositoryReady": repository_ready,
        "checkpointReady": checkpoint_ready,
        "cudaReady": cuda_ready,
        "gpuName": gpu_name,
        "revision": PINNED_REVISION,
        "reason": None if ready else "; ".join(missing),
        "setupCommand": "npm run longcat-video:setup",
    }


def _bounded_text(value: Any, field: str, maximum: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise WorkerError("invalid_request", f"{field} deve essere una stringa")
    value = value.strip()
    if required and not value:
        raise WorkerError("invalid_request", f"{field} non può essere vuoto")
    if len(value) > maximum or any(ord(character) < 32 and character not in "\n\t" for character in value):
        raise WorkerError("invalid_request", f"{field} non valido o troppo lungo")
    return value


def _integer(value: Any, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise WorkerError("invalid_request", f"{field} deve essere compreso tra {minimum} e {maximum}")
    return value


def _number(value: Any, field: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= float(value) <= maximum:
        raise WorkerError("invalid_request", f"{field} deve essere compreso tra {minimum} e {maximum}")
    return float(value)


def validate_request(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("protocolVersion") != PROTOCOL_VERSION:
        raise WorkerError("invalid_request", "protocolVersion non valida")
    allowed_common = {"protocolVersion", "mode", "prompt", "negativePrompt", "inputPath", "outputPath", "width", "height", "resolution", "numFrames", "numCondFrames", "numInferenceSteps", "guidanceScale", "seed", "useDistill", "enableCompile"}
    unknown = set(raw) - allowed_common
    if unknown:
        raise WorkerError("invalid_request", f"campi non supportati: {', '.join(sorted(unknown))}")
    mode = raw.get("mode")
    if mode not in {"textToVideo", "imageToVideo", "videoContinuation"}:
        raise WorkerError("invalid_request", "mode non valida")
    request = {
        "mode": mode,
        "prompt": _bounded_text(raw.get("prompt"), "prompt", 4000, required=True),
        "negativePrompt": _bounded_text(raw.get("negativePrompt", ""), "negativePrompt", 4000),
        "numFrames": _integer(raw.get("numFrames"), "numFrames", 5, 257),
        "numInferenceSteps": _integer(raw.get("numInferenceSteps"), "numInferenceSteps", 1, 100),
        "guidanceScale": _number(raw.get("guidanceScale"), "guidanceScale", 0.0, 20.0),
        "seed": _integer(raw.get("seed"), "seed", 0, 2_147_483_647),
        "useDistill": raw.get("useDistill") is True,
        "enableCompile": raw.get("enableCompile") is True,
    }
    if (request["numFrames"] - 1) % 4:
        raise WorkerError("invalid_request", "numFrames deve rispettare (numFrames - 1) divisibile per 4")
    output_path = Path(_bounded_text(raw.get("outputPath"), "outputPath", 4096, required=True))
    if not output_path.is_absolute() or output_path.suffix.lower() != ".mp4" or not output_path.parent.is_dir() or output_path.exists():
        raise WorkerError("invalid_output", "outputPath deve essere un nuovo MP4 in una cartella esistente")
    request["outputPath"] = output_path.resolve()
    if mode == "textToVideo":
        request["width"] = _integer(raw.get("width"), "width", 256, 1280)
        request["height"] = _integer(raw.get("height"), "height", 256, 1280)
        if request["width"] % 16 or request["height"] % 16:
            raise WorkerError("invalid_request", "width e height devono essere divisibili per 16")
    else:
        resolution = raw.get("resolution")
        if resolution not in {"480p", "720p"}:
            raise WorkerError("invalid_request", "resolution deve essere 480p o 720p")
        request["resolution"] = resolution
        input_path = Path(_bounded_text(raw.get("inputPath"), "inputPath", 4096, required=True))
        supported = SUPPORTED_IMAGE_EXTENSIONS if mode == "imageToVideo" else SUPPORTED_VIDEO_EXTENSIONS
        if not input_path.is_absolute() or not input_path.is_file() or input_path.is_symlink() or input_path.suffix.lower() not in supported:
            raise WorkerError("invalid_input", "file sorgente non valido o non supportato")
        request["inputPath"] = input_path.resolve()
        if mode == "videoContinuation":
            request["numCondFrames"] = _integer(raw.get("numCondFrames"), "numCondFrames", 1, min(65, request["numFrames"]))
    if request["useDistill"] and (request["numInferenceSteps"] != 16 or request["guidanceScale"] != 1.0):
        raise WorkerError("invalid_request", "il profilo distilled richiede 16 step e guidance 1")
    return request


def _load_pipeline(repository: Path, checkpoint: Path, enable_compile: bool):
    sys.path.insert(0, str(repository))
    import torch
    import torch.distributed as dist
    from transformers import AutoTokenizer, UMT5EncoderModel
    from longcat_video.context_parallel import context_parallel_util
    from longcat_video.context_parallel.context_parallel_util import init_context_parallel
    from longcat_video.modules.autoencoder_kl_wan import AutoencoderKLWan
    from longcat_video.modules.longcat_video_dit import LongCatVideoTransformer3DModel
    from longcat_video.modules.scheduling_flow_match_euler_discrete import FlowMatchEulerDiscreteScheduler
    from longcat_video.pipeline_longcat_video import LongCatVideoPipeline

    if not torch.cuda.is_available() or torch.cuda.device_count() < 1:
        raise WorkerError("cuda_unavailable", "LongCat-Video ufficiale richiede una GPU NVIDIA CUDA")
    rank = int(os.environ.get("RANK", "0")); local_rank = int(os.environ.get("LOCAL_RANK", "0"))
    torch.cuda.set_device(local_rank)
    if not dist.is_initialized():
        dist.init_process_group(backend="nccl", timeout=datetime.timedelta(hours=24))
    init_context_parallel(context_parallel_size=1, global_rank=rank, world_size=int(os.environ.get("WORLD_SIZE", "1")))
    split = context_parallel_util.get_optimal_split(context_parallel_util.get_cp_size())
    _emit("progress", progress=0.12, message="Caricamento tokenizer e text encoder")
    tokenizer = AutoTokenizer.from_pretrained(checkpoint, subfolder="tokenizer", torch_dtype=torch.bfloat16, local_files_only=True)
    text_encoder = UMT5EncoderModel.from_pretrained(checkpoint, subfolder="text_encoder", torch_dtype=torch.bfloat16, local_files_only=True)
    _emit("progress", progress=0.2, message="Caricamento VAE e scheduler")
    vae = AutoencoderKLWan.from_pretrained(checkpoint, subfolder="vae", torch_dtype=torch.bfloat16, local_files_only=True)
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(checkpoint, subfolder="scheduler", torch_dtype=torch.bfloat16, local_files_only=True)
    _emit("progress", progress=0.28, message="Caricamento modello LongCat 13.6B")
    dit = LongCatVideoTransformer3DModel.from_pretrained(checkpoint, subfolder="dit", cp_split_hw=split, torch_dtype=torch.bfloat16, local_files_only=True)
    if enable_compile:
        dit = torch.compile(dit)
    pipe = LongCatVideoPipeline(tokenizer=tokenizer, text_encoder=text_encoder, vae=vae, scheduler=scheduler, dit=dit)
    pipe.to(local_rank)
    return torch, dist, pipe, local_rank


def generate(request: dict[str, Any]) -> dict[str, Any]:
    repository, checkpoint = runtime_paths()
    state = capabilities()
    if not state["ready"]:
        raise WorkerError("runtime_unavailable", state["reason"] or "runtime LongCat-Video non pronto")
    _emit("progress", progress=0.04, message="Validazione pipeline ufficiale")
    torch, dist, pipe, device = _load_pipeline(repository, checkpoint, request["enableCompile"])
    output_path: Path = request["outputPath"]
    try:
        generator = torch.Generator(device=device); generator.manual_seed(request["seed"] + int(os.environ.get("RANK", "0")))
        if request["useDistill"]:
            lora_path = checkpoint / "lora" / "cfg_step_lora.safetensors"
            if not lora_path.is_file():
                raise WorkerError("checkpoint_incomplete", "LoRA distilled assente nel checkpoint")
            pipe.dit.load_lora(str(lora_path), "cfg_step_lora"); pipe.dit.enable_loras(["cfg_step_lora"])
        _emit("progress", progress=0.34, message="Diffusione video in corso")
        import numpy as np
        common = dict(prompt=request["prompt"], num_frames=request["numFrames"], num_inference_steps=request["numInferenceSteps"], use_distill=request["useDistill"], guidance_scale=request["guidanceScale"], generator=generator)
        if not request["useDistill"]:
            common["negative_prompt"] = request["negativePrompt"]
        if request["mode"] == "textToVideo":
            output = pipe.generate_t2v(height=request["height"], width=request["width"], **common)[0]
        elif request["mode"] == "imageToVideo":
            from diffusers.utils import load_image
            import PIL.Image
            image = load_image(str(request["inputPath"])); target_size = image.size
            output = pipe.generate_i2v(image=image, resolution=request["resolution"], **common)[0]
            output = np.asarray([PIL.Image.fromarray((frame * 255).clip(0, 255).astype(np.uint8)).resize(target_size, PIL.Image.Resampling.BICUBIC) for frame in output], dtype=np.uint8)
        else:
            import cv2
            import PIL.Image
            from diffusers.utils import load_video
            source_video = load_video(str(request["inputPath"]))
            capture = cv2.VideoCapture(str(request["inputPath"])); source_fps = capture.get(cv2.CAP_PROP_FPS); capture.release()
            stride = max(1, round((source_fps if source_fps > 0 else 15) / 15))
            conditioned = source_video[::stride]; target_size = conditioned[0].size
            generated = pipe.generate_vc(video=conditioned, resolution=request["resolution"], num_cond_frames=request["numCondFrames"], enhance_hf=not request["useDistill"], **common)[0]
            generated = [PIL.Image.fromarray((frame * 255).clip(0, 255).astype(np.uint8)).resize(target_size, PIL.Image.Resampling.BICUBIC) for frame in generated]
            output = np.asarray(conditioned + generated[request["numCondFrames"]:], dtype=np.uint8)
        if request["useDistill"]:
            pipe.dit.disable_all_loras()
        _emit("progress", progress=0.9, message="Codifica MP4 H.264")
        from torchvision.io import write_video
        array = np.asarray(output)
        if array.dtype != np.uint8:
            array = (array * 255).clip(0, 255).astype(np.uint8)
        tensor = torch.from_numpy(array)
        if tensor.ndim != 4 or tensor.shape[-1] not in (3, 4):
            raise WorkerError("invalid_model_output", "forma dei fotogrammi generati non valida")
        write_video(str(output_path), tensor, fps=15, video_codec="libx264", options={"crf": "18"})
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise WorkerError("encoding_failed", "il file MP4 non è stato creato")
        frames, height, width = int(tensor.shape[0]), int(tensor.shape[1]), int(tensor.shape[2])
        return {"mode": request["mode"], "path": str(output_path), "width": width, "height": height, "frames": frames, "fps": 15, "durationSeconds": frames / 15, "seed": request["seed"]}
    except Exception:
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        raise
    finally:
        try:
            torch.cuda.empty_cache(); torch.cuda.ipc_collect()
            if dist.is_initialized(): dist.destroy_process_group()
        except Exception:
            pass


def _handle_signal(_signum: int, _frame: Any) -> None:
    raise KeyboardInterrupt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--capabilities", action="store_true"); parser.add_argument("--request")
    args = parser.parse_args(argv)
    signal.signal(signal.SIGTERM, _handle_signal); signal.signal(signal.SIGINT, _handle_signal)
    try:
        if args.capabilities:
            _emit("result", result=capabilities()); return 0
        if not args.request:
            raise WorkerError("invalid_request", "--request è obbligatorio")
        request_path = Path(args.request).resolve()
        if not request_path.is_file() or request_path.stat().st_size > 64 * 1024:
            raise WorkerError("invalid_request", "file richiesta assente o troppo grande")
        request = validate_request(json.loads(request_path.read_text(encoding="utf-8")))
        _emit("result", result=generate(request)); return 0
    except KeyboardInterrupt:
        _emit("error", error={"code": "cancelled", "message": "Job annullato"}); return 130
    except WorkerError as error:
        _emit("error", error={"code": error.code, "message": str(error)}); return 1
    except Exception as error:
        _emit("error", error={"code": "generation_failed", "message": str(error)}); return 1


if __name__ == "__main__":
    raise SystemExit(main())
