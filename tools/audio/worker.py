#!/usr/bin/env python3
"""Isolated MLSM Audio TTS worker using Chatterbox Multilingual."""

from __future__ import annotations

import json
import inspect
import math
import os
import re
import sys
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 64 * 1024
MAX_TEXT_CHARS = 8_000
LANGUAGES = {"ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"}
STYLE_PRESETS = {
    "calm": {"exaggeration": .25, "cfgWeight": .55, "temperature": .65},
    "neutral": {},
    "intense": {"exaggeration": .78, "cfgWeight": .35, "temperature": .9},
    "dramatic": {"exaggeration": .9, "cfgWeight": .3, "temperature": .95},
    "soft": {"exaggeration": .18, "cfgWeight": .6, "temperature": .62},
}
CONTROL_TAG = re.compile(r"\[(calm|neutral|intense|dramatic|soft|pause\s*=\s*(\d+(?:\.\d+)?)\s*(ms|s)?)\]", re.IGNORECASE)


class AudioWorkerError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def emit(kind: str, **payload: Any) -> None:
    sys.stdout.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "type": kind, **payload}, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def progress(value: float, message: str) -> None:
    emit("progress", progress=max(0.0, min(1.0, value)), message=message[:512])


def local_file(value: Any, label: str) -> Path:
    if not isinstance(value, str):
        raise AudioWorkerError("invalid_input", f"{label} non valido")
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise AudioWorkerError("invalid_input", f"{label} deve essere un file locale valido")
    return path.resolve(strict=True)


def job_root(value: Any) -> Path:
    if not isinstance(value, str):
        raise AudioWorkerError("invalid_job_root", "Directory del job non valida")
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise AudioWorkerError("invalid_job_root", "Directory del job non valida")
    return path.resolve(strict=True)


def supports_v3_loader(model_class: Any) -> bool:
    """Return whether this installed Chatterbox API accepts the V3 selector."""
    try:
        parameters = inspect.signature(model_class.from_pretrained).parameters.values()
    except (TypeError, ValueError, AttributeError):
        return False
    return any(parameter.name == "t3_model" or parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters)


def load_multilingual_model(model_class: Any, device: str) -> tuple[Any, str]:
    """Load V3 when supported, while remaining compatible with stable 0.1.x."""
    if supports_v3_loader(model_class):
        return model_class.from_pretrained(device=device, t3_model="v3"), "Chatterbox Multilingual V3"
    return model_class.from_pretrained(device=device), "Chatterbox Multilingual"


def capabilities() -> dict[str, Any]:
    try:
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        ready = True
        torch_version = torch.__version__
        engine = "Chatterbox Multilingual V3" if supports_v3_loader(ChatterboxMultilingualTTS) else "Chatterbox Multilingual"
    except Exception:
        ready = False
        torch_version = None
        engine = "Chatterbox Multilingual"
    return {"kind": "capabilities", "ready": ready, "features": {"textToSpeech": ready, "voiceCloning": ready}, "engine": engine, "languages": sorted(LANGUAGES), "torch": torch_version}


def styled_segments(text: str, defaults: dict[str, float]) -> list[dict[str, Any]]:
    """Parse the small, documented MLSM tag language into audible segments."""
    result: list[dict[str, Any]] = []
    cursor = 0
    controls = dict(defaults)
    for match in CONTROL_TAG.finditer(text):
        spoken = text[cursor:match.start()].strip()
        if spoken:
            result.append({"kind": "speech", "text": spoken, **controls})
        tag = match.group(1).lower()
        if tag.startswith("pause"):
            value = float(match.group(2))
            seconds = value / 1000.0 if (match.group(3) or "s").lower() == "ms" else value
            if not .05 <= seconds <= 10:
                raise AudioWorkerError("invalid_pause", "Le pause devono essere comprese tra 0.05 e 10 secondi")
            result.append({"kind": "pause", "seconds": seconds})
        else:
            controls = {**defaults, **STYLE_PRESETS[tag]}
        cursor = match.end()
    spoken = text[cursor:].strip()
    if spoken:
        result.append({"kind": "speech", "text": spoken, **controls})
    if not any(item["kind"] == "speech" for item in result):
        raise AudioWorkerError("invalid_text", "Il testo non contiene parole da pronunciare")
    return result


def synthesize(request: dict[str, Any]) -> dict[str, Any]:
    root = job_root(request.get("jobRoot"))
    reference = local_file(request.get("referencePath"), "Voce di riferimento")
    text = request.get("text")
    language = request.get("language")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
        raise AudioWorkerError("invalid_text", f"Il testo deve contenere da 1 a {MAX_TEXT_CHARS} caratteri")
    if not isinstance(language, str) or language not in LANGUAGES:
        raise AudioWorkerError("invalid_language", "Lingua TTS non supportata")
    values: dict[str, float] = {}
    for key, default, low, high in (("exaggeration", .5, 0., 1.), ("cfgWeight", .5, 0., 1.), ("temperature", .8, .05, 2.)):
        raw = request.get(key, default)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(float(raw)) or not low <= float(raw) <= high:
            raise AudioWorkerError("invalid_controls", f"Parametro {key} non valido")
        values[key] = float(raw)
    try:
        import torch
        import torchaudio
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    except ImportError as error:
        raise AudioWorkerError("tts_runtime_unavailable", "Chatterbox non è installato nel runtime Audio") from error
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    cache = Path(os.environ.get("HF_HOME", str(Path.home() / ".cache" / "mlsm-studio" / "chatterbox"))).expanduser()
    cache.mkdir(parents=True, exist_ok=True)
    progress(.05, f"Caricamento/download Chatterbox Multilingual · {device.upper()}")
    model, engine = load_multilingual_model(ChatterboxMultilingualTTS, device)
    segments = styled_segments(text.strip(), values)
    progress(.52, "Clonazione timbro e generazione del parlato")
    generated = []
    speech_segments = sum(item["kind"] == "speech" for item in segments)
    speech_index = 0
    for item in segments:
        if item["kind"] == "pause":
            generated.append(torch.zeros((1, round(float(item["seconds"]) * model.sr))))
            continue
        speech_index += 1
        progress(.52 + .42 * speech_index / max(1, speech_segments), f"Generazione segmento {speech_index}/{speech_segments}")
        generated.append(model.generate(text=item["text"], language_id=language, audio_prompt_path=str(reference), exaggeration=item["exaggeration"], cfg_weight=item["cfgWeight"], temperature=item["temperature"]))
    wav = torch.cat(generated, dim=-1)
    target = root / "speech.wav"
    torchaudio.save(str(target), wav.cpu(), model.sr)
    target = target.resolve(strict=True)
    if target.parent != root or target.stat().st_size <= 44:
        raise AudioWorkerError("invalid_output", "Chatterbox non ha prodotto un WAV valido")
    progress(.98, "Audio sintetizzato e verificato")
    return {"kind": "synthesizeSpeech", "path": str(target), "engine": engine, "sampleRate": int(model.sr), "language": language, "device": device}


def dispatch(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION:
        raise AudioWorkerError("invalid_request", "Richiesta Audio non valida")
    action = request.get("action")
    allowed = {"capabilities": {"protocolVersion", "action"}, "synthesizeSpeech": {"protocolVersion", "action", "jobRoot", "referencePath", "text", "language", "exaggeration", "cfgWeight", "temperature"}}
    if action not in allowed:
        raise AudioWorkerError("invalid_action", "Azione Audio non supportata")
    unknown = set(request) - allowed[action]
    if unknown:
        raise AudioWorkerError("unknown_fields", f"Campi non consentiti: {', '.join(sorted(unknown))}")
    return capabilities() if action == "capabilities" else synthesize(request)


def main() -> int:
    raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
    try:
        if not raw or len(raw) > MAX_REQUEST_BYTES or not raw.endswith(b"\n") or sys.stdin.buffer.read(1):
            raise AudioWorkerError("invalid_request", "Richiesta JSONL assente o troppo grande")
        result = dispatch(json.loads(raw))
        emit("result", result=result)
        return 0
    except AudioWorkerError as error:
        emit("error", error={"code": error.code, "message": str(error)[:2_000]})
        return 2
    except Exception as error:
        emit("error", error={"code": "internal_error", "message": str(error)[:2_000]})
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
