from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from .engine import automatic_device, device_available, mini_inference, resolve_device, resolve_precision
from .manifest import manifest_status, prepare_model

_self_test_lock = threading.Lock()
_self_test_cache: dict[tuple[str, str, str], dict[str, Any]] = {}


def prepare_rife(model_id: str = "rife-v4.26", local_artifact: Path | None = None) -> dict[str, Any]:
    prepared = prepare_model(model_id, local_artifact)
    with _self_test_lock:
        _self_test_cache.clear()
    return prepared


def _self_test(status: dict[str, Any], device: str, precision: str) -> dict[str, Any]:
    runtime = str(status.get("runtimePath", ""))
    key = (runtime, device, precision)
    with _self_test_lock:
        cached = _self_test_cache.get(key)
    if cached is not None:
        return cached
    try:
        result = mini_inference(Path(runtime), device, precision)
        value = {"ok": True, **result}
    except Exception as error:
        value = {"ok": False, "error": str(error), "device": device, "precision": precision}
    with _self_test_lock:
        _self_test_cache[key] = value
    return value


def get_rife_capabilities(run_self_test: bool = True) -> dict[str, Any]:
    status = manifest_status()
    devices = [device for device in ("mps", "cuda", "cpu") if device_available(device)]
    automatic = automatic_device()
    precisions = ["fp32"] + (["fp16"] if device_available("cuda") else [])
    base = {
        **status,
        "supportedDevices": devices,
        "supportedPrecisions": precisions,
        "automaticDevice": automatic,
        "cpuRequiresExplicitSelection": True,
        "selfTest": False,
    }
    if not status.get("ready") or not run_self_test:
        return base
    # Validate the preferred accelerator. On CPU-only hosts the test is still
    # useful to prove the artifact, but jobs remain opt-in through `device=cpu`.
    test_device = automatic or "cpu"
    test_precision = "fp16" if test_device == "cuda" else "fp32"
    result = _self_test(status, test_device, test_precision)
    if not result.get("ok"):
        return {**base, "ready": False, "selfTestResult": result, "reason": f"Self-test RIFE fallito: {result.get('error', 'errore sconosciuto')}"}
    return {**base, "selfTest": True, "selfTestResult": result, "reason": "Runtime Practical-RIFE verificato con mini inferenza reale."}


def validate_rife_request(model_id: str, device: str, precision: str, require_self_test: bool = True) -> dict[str, Any]:
    if model_id != "rife-v4.26":
        raise ValueError("Modello RIFE non supportato")
    status = manifest_status(model_id)
    if not status.get("ready") or not status.get("verified"):
        raise RuntimeError(str(status.get("reason", "RIFE non verificato")))
    effective = resolve_device(device)
    resolved = resolve_precision(effective, precision)
    test = _self_test(status, effective, resolved) if require_self_test else {"ok": True}
    if not test.get("ok"):
        raise RuntimeError(f"Self-test RIFE su {effective}/{resolved} fallito: {test.get('error', 'errore sconosciuto')}")
    return {
        "modelId": model_id,
        "device": effective,
        "precision": resolved,
        "artifact": status.get("artifact"),
        "runtimePath": status.get("runtimePath"),
        "sha256": status.get("sha256"),
        "selfTest": True,
    }
