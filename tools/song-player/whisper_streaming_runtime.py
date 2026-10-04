"""Pinned MIT Whisper-Streaming, private model cache, platform adapters.
Upstream: https://github.com/ufal/whisper_streaming. Audio stays local.
"""
from __future__ import annotations
import hashlib
import importlib.util
import os
import platform
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REVISION = "6da90b44b7e50d79695e68166d2a2c7609c75abb"
ASSETS = {"whisper_online.py": "f0a7bd26bff879cf1e2ee4589bd88c38275c678d8773a47563ceb0e7d970b850",
          "LICENSE": "4ab642ac3c53867fb3516de7de602f0e86117ead78f0851a9f871dbe40823e85"}

def platform_backend(system=None, machine=None, cuda=False):
    system, machine = system or platform.system(), machine or platform.machine()
    if system == "Darwin" and machine.lower() in ("arm64", "aarch64"):
        return "mlx", "mlx-community/whisper-small-mlx"
    return ("cuda", "mobiuslabsgmbh/faster-whisper-large-v3-turbo") if cuda else ("cpu", "Systran/faster-whisper-small")

def runtime_cache():
    return Path.home() / ".cache" / "mlsm-studio" / "whisper-streaming"

def upstream_module(progress, root=None):
    root = (root or runtime_cache()) / REVISION
    root.mkdir(parents=True, exist_ok=True)
    import certifi
    for name, checksum in ASSETS.items():
        target = root / name
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == checksum:
            continue
        progress("runtime", "Whisper-Streaming")
        url = f"https://raw.githubusercontent.com/ufal/whisper_streaming/{REVISION}/{name}"
        with urllib.request.urlopen(url, timeout=30, context=ssl.create_default_context(cafile=certifi.where())) as response:
            data = response.read(100_000)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise RuntimeError("Whisper-Streaming source checksum mismatch")
        temporary = target.with_suffix(target.suffix + ".partial")
        temporary.write_bytes(data)
        temporary.replace(target)
    spec = importlib.util.spec_from_file_location("mlsm_whisper_online", root / "whisper_online.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def ensure_mlx(progress):
    if importlib.util.find_spec("mlx_whisper"):
        return
    progress("dependencies", "mlx-whisper")
    if sys.prefix == sys.base_prefix:
        raise RuntimeError("MLX setup requires the isolated Song Player runtime")
    subprocess.run([sys.executable, "-m", "pip", "install", "mlx-whisper==0.4.3"],
                   stdout=sys.stderr, stderr=sys.stderr, check=True, timeout=600)

def model_snapshot(repo, progress, root=None):
    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm
    root = root or runtime_cache()
    marker = root / (repo.replace("/", "--") + ".ready")
    if marker.is_file():
        path = Path(marker.read_text().strip())
        if (path / "config.json").is_file() and any((path / name).is_file() for name in ("weights.npz", "weights.safetensors", "model.bin")):
            return path
    progress("download", repo)
    highest = [None]
    class DownloadProgress(tqdm):
        def update(self, n=1):
            result = super().update(n)
            now = time.monotonic()
            if now - getattr(self, "_mlsm_update", 0) > .5:
                self._mlsm_update = now
                if self.unit == "B" and self.total and self.total > 1_000_000:
                    highest[0] = max(highest[0] or 0, min(100, int(self.n * 100 / self.total)))
                progress("download", repo, highest[0])
            return result
    path = Path(snapshot_download(repo_id=repo, cache_dir=str(root / "models"),
        allow_patterns=["*.json", "*.npz", "*.safetensors", "*.bin", "vocabulary.*", "tokenizer.*"],
        max_workers=2, tqdm_class=DownloadProgress))
    root.mkdir(parents=True, exist_ok=True)
    temporary = marker.with_suffix(".partial")
    temporary.write_text(str(path))
    temporary.replace(marker)
    return path

class StreamingASR:
    """Adapter for upstream OnlineASRProcessor (LocalAgreement-2)."""
    sep = ""
    def __init__(self, backend, path, progress):
        self.backend, self.original_language, self.path, self.progress = backend, None, str(path), progress
        progress("model", backend)
        if backend == "mlx":
            import mlx.core as mx
            from mlx_whisper.transcribe import ModelHolder
            if not mx.metal.is_available():
                raise RuntimeError("MLX Metal is unavailable on this Mac")
            ModelHolder.get_model(self.path, mx.float16)
            mx.eval(ModelHolder.model.parameters())
        else:
            self.load_native(backend)

    def load_native(self, backend):
        import ctranslate2
        from faster_whisper import WhisperModel
        from worker import whisper_compute_type_for_device
        device = "cuda" if backend == "cuda" else "cpu"
        self.model = WhisperModel(self.path, device=device,
            compute_type=whisper_compute_type_for_device(ctranslate2, device),
            cpu_threads=min(4, max(1, (os.cpu_count() or 2) // 2)), num_workers=1, local_files_only=True)

    def transcribe(self, audio, init_prompt=""):
        options = dict(language=self.original_language, initial_prompt=init_prompt or None,
            word_timestamps=True, condition_on_previous_text=False, temperature=0,
            no_speech_threshold=.95, logprob_threshold=-2.0, compression_ratio_threshold=3.0)
        if self.backend == "mlx":
            import mlx_whisper
            result = mlx_whisper.transcribe(audio, path_or_hf_repo=self.path, **options)
            self.original_language = self.original_language or result.get("language")
            return result.get("segments", [])
        from worker import is_cuda_runtime_load_error
        # Faster-Whisper and MLX use different names for this threshold.
        options["log_prob_threshold"] = options.pop("logprob_threshold")
        try:
            segments, info = self.model.transcribe(audio, beam_size=1, best_of=1, vad_filter=False, **options)
            result = list(segments)
        except Exception as error:
            if self.backend != "cuda" or not is_cuda_runtime_load_error(error):
                raise
            self.backend = "cpu"
            self.path = str(model_snapshot("Systran/faster-whisper-small", self.progress))
            self.load_native("cpu")
            segments, info = self.model.transcribe(audio, beam_size=1, best_of=1, vad_filter=False, **options)
            result = list(segments)
        self.original_language = self.original_language or info.language
        return result

    def ts_words(self, segments):
        words = []
        for segment in segments:
            values = segment.get("words", []) if isinstance(segment, dict) else segment.words or []
            for word in values:
                words.append((word["start"], word["end"], word["word"]) if isinstance(word, dict) else (word.start, word.end, word.word))
        return words

    def segments_end_ts(self, segments):
        return [segment["end"] if isinstance(segment, dict) else segment.end for segment in segments]
