#!/usr/bin/env python3
"""Private persistent Whisper-Streaming session with first-use model setup."""
from __future__ import annotations

import base64
import json
import os
import sys
import time

MAX_LINE = 800_000
MAX_SAMPLES = 16_000 * 8




def decode_pcm(value: str):
    import numpy as np
    raw = base64.b64decode(value, validate=True)
    if len(raw) % 4 or len(raw) > MAX_SAMPLES * 4:
        raise ValueError("Invalid PCM block (maximum 8 seconds at 16 kHz)")
    samples = np.frombuffer(raw, dtype="<f4").copy()
    if not np.isfinite(samples).all():
        raise ValueError("Non-finite PCM samples")
    return np.clip(samples, -1, 1)


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)




def progress(stage, asset="", percent=None):
    emit({"type": "progress", "stage": stage, "asset": asset, "percent": percent})

class StreamingProcessor:
    def __init__(self, upstream, asr):
        self.asr = asr
        self.online = upstream.OnlineASRProcessor(asr, buffer_trimming=("segment", 8))
        self.received = 0

    def process(self, samples, language="auto", final=False):
        import numpy as np
        self.asr.original_language = language if language in ("it", "en", "es", "fr", "de", "pt") else None
        self.received += len(samples) / 16000
        # Digital silence (e.g. a paused web player) needs no inference. This
        # is not speech VAD: quiet vocals/music are not classified or removed.
        if len(samples) and float(np.max(np.abs(samples))) < 1e-5:
            start, end, text = self.online.finish()
            phrases = [{"start": start, "end": end, "text": text.strip()}] if text.strip() else []
            self.online.init(offset=self.received)
            return {"phrases": phrases, "partial": {"text": ""}, "processedUntil": self.received, "backend": self.asr.backend}
        self.online.insert_audio_chunk(samples)
        phrases = []
        if len(self.online.audio_buffer) and len(samples):
            start, end, text = self.online.process_iter()
            if text.strip():
                phrases.append({"start": start, "end": end, "text": text.strip()})
        partial = self.online.to_flush(self.online.transcript_buffer.complete())
        if final:
            start, end, text = self.online.finish()
            if text.strip():
                phrases.append({"start": start, "end": end, "text": text.strip()})
            self.online.init(offset=self.received)
            partial = (None, None, "")
        elif len(self.online.audio_buffer) > 16_000 * 12 and self.online.commited:
            cut = self.online.commited[-1][1] - 1
            if cut > self.online.buffer_time_offset:
                self.online.chunk_at(cut)
        if len(self.online.audio_buffer) > 16_000 * 60:
            raise RuntimeError("Whisper cannot keep up: more than 60 seconds remain unconfirmed. Pause audio or use a faster model; no audio was silently skipped.")
        return {"phrases": phrases, "partial": {"start": partial[0], "end": partial[1], "text": partial[2].strip()},
                "processedUntil": self.received, "backend": self.asr.backend}

def main():
    try:
        os.environ.pop("HF_HUB_OFFLINE", None)
        os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")
        from whisper_streaming_runtime import upstream_module, platform_backend, ensure_mlx, model_snapshot, StreamingASR
        upstream = upstream_module(progress)
        backend, repo = platform_backend()
        if backend == "mlx":
            ensure_mlx(progress)
        else:
            import ctranslate2
            from worker import whisper_device_and_compute_type
            device, _ = whisper_device_and_compute_type(ctranslate2)
            backend, repo = platform_backend(cuda=device == "cuda")
        path = model_snapshot(repo, progress)
        try:
            asr = StreamingASR(backend, path, progress)
        except Exception as error:
            from worker import is_cuda_runtime_load_error
            if backend != "cuda" or not is_cuda_runtime_load_error(error):
                raise
            backend, repo = platform_backend(system="Windows", cuda=False)
            asr = StreamingASR(backend, model_snapshot(repo, progress), progress)
        processor = StreamingProcessor(upstream, asr)
        # Warm kernels before announcing readiness, and validate CUDA DLLs now.
        import numpy as np
        asr.transcribe(np.zeros(16000, dtype=np.float32))
        asr.original_language = None
        if asr.backend != backend:
            backend, repo = "cpu", "Systran/faster-whisper-small"
        emit({"type": "ready", "model": repo.split("/")[-1], "device": backend,
              "engine": "Whisper-Streaming", "stepSeconds": 1.0, "initialSeconds": 2 if backend == "cpu" else 1})
        for line in iter(lambda: sys.stdin.readline(MAX_LINE + 1), ""):
            if len(line) > MAX_LINE:
                raise ValueError("Request too large")
            request = json.loads(line)
            if request.get("action") == "stop":
                break
            started = time.monotonic()
            result = processor.process(decode_pcm(request.get("pcm", "")), request.get("language", "auto"), bool(request.get("final")))
            emit({"type": "result", **result, "elapsedSeconds": round(time.monotonic() - started, 3)})
        return 0
    except Exception as error:
        emit({"type": "error", "error": str(error)[:1500]})
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
