"""Client and scheduler for public Gradio image-upscaling endpoints.

The remote service only knows how to upscale one image.  MLSM keeps video
decoding, durable frame storage and audio muxing local and uses this module to
fan frames out to one in-flight request per endpoint.
"""
from __future__ import annotations

import base64
import ipaddress
import json
import os
import queue
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MAX_ENDPOINTS = 16
MAX_REMOTE_INPUT_BYTES = 25 * 1024 * 1024
MAX_REMOTE_OUTPUT_BYTES = 100 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 180


class RemoteUpscalerError(RuntimeError):
    pass


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        normalize_endpoint(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


_safe_opener = urllib.request.build_opener(_SafeRedirectHandler())


def normalize_endpoint(value: str) -> str:
    value = value.strip()
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise RemoteUpscalerError("Endpoint non valido: usa un URL pubblico http/https senza credenziali")
    allow_local = os.environ.get("MLSM_REMOTE_UPSCALER_ALLOW_LOCAL") == "1"
    if parsed.scheme != "https" and not allow_local:
        raise RemoteUpscalerError("Gli endpoint remoti devono usare HTTPS")
    if not allow_local:
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
        except socket.gaierror as error:
            raise RemoteUpscalerError(f"Host endpoint non risolvibile: {parsed.hostname}") from error
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if not ip.is_global:
                raise RemoteUpscalerError("L'endpoint deve risolvere a un indirizzo Internet pubblico")
    path = parsed.path.rstrip("/")
    for suffix in ("/gradio_api/api/upscale_models", "/gradio_api/call/upscale_image", "/api/upscale_models", "/call/upscale_image"):
        if path.endswith(suffix):
            path = path[:-len(suffix)]
            break
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path.rstrip("/"), "", ""))


def _request_json(url: str, payload: dict[str, object], timeout: int) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "MLSM-Studio/1"},
        method="POST",
    )
    try:
        with _safe_opener.open(request, timeout=timeout) as response:
            value = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RemoteUpscalerError(f"Endpoint remoto non raggiungibile: {error}") from error
    if not isinstance(value, dict):
        raise RemoteUpscalerError("Risposta JSON remota non valida")
    return value


def _candidate_url(endpoint: str, path: str) -> str:
    return f"{normalize_endpoint(endpoint)}{path}"


def discover_models(endpoint: str, timeout: int = 20) -> dict[str, object]:
    last_error: Exception | None = None
    for path in ("/gradio_api/api/upscale_models", "/api/upscale_models"):
        try:
            envelope = _request_json(_candidate_url(endpoint, path), {"data": []}, timeout)
            data = envelope.get("data")
            catalog = data[0] if isinstance(data, list) and data else None
            if not isinstance(catalog, dict) or catalog.get("ok") is False or not isinstance(catalog.get("models"), list):
                raise RemoteUpscalerError("Catalogo modelli remoto non valido")
            models = []
            for item in catalog["models"]:
                if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip():
                    models.append({
                        "name": item["name"].strip(),
                        "scale": float(item.get("scale") or 1),
                        "description": str(item.get("description") or ""),
                        "default": bool(item.get("default")),
                    })
            if not models:
                raise RemoteUpscalerError("L'endpoint non espone alcun modello")
            return {"endpoint": normalize_endpoint(endpoint), "defaultModel": str(catalog.get("default_model") or ""), "models": models}
        except Exception as error:  # try legacy Gradio route before failing
            last_error = error
    raise RemoteUpscalerError(str(last_error or "Discovery modelli fallita"))


def aggregate_catalog(endpoints: Iterable[str]) -> dict[str, object]:
    normalized = list(dict.fromkeys(normalize_endpoint(item) for item in endpoints))
    if not normalized or len(normalized) > MAX_ENDPOINTS:
        raise RemoteUpscalerError(f"Configura da 1 a {MAX_ENDPOINTS} endpoint attivi")
    statuses_by_endpoint: dict[str, dict[str, object]] = {}
    catalogs_by_endpoint: dict[str, dict[str, object]] = {}
    # Discovery is independent per Colab: waiting for endpoint A before even
    # contacting B makes startup scale linearly with network latency.
    with ThreadPoolExecutor(max_workers=len(normalized), thread_name_prefix="remote-catalog") as executor:
        futures = {executor.submit(discover_models, endpoint): endpoint for endpoint in normalized}
        for future in as_completed(futures):
            endpoint = futures[future]
            try:
                catalog = future.result()
                catalogs_by_endpoint[endpoint] = catalog
                statuses_by_endpoint[endpoint] = {"url": endpoint, "ok": True, "models": catalog["models"]}
            except Exception as error:
                statuses_by_endpoint[endpoint] = {"url": endpoint, "ok": False, "error": str(error), "models": []}
    statuses = [statuses_by_endpoint[endpoint] for endpoint in normalized]
    catalogs = [catalogs_by_endpoint[endpoint] for endpoint in normalized if endpoint in catalogs_by_endpoint]
    if not catalogs:
        raise RemoteUpscalerError("Nessun endpoint remoto attivo ha risposto")
    common = set(item["name"] for item in catalogs[0]["models"])
    by_name = {item["name"]: item for item in catalogs[0]["models"]}
    for catalog in catalogs[1:]:
        common &= {item["name"] for item in catalog["models"]}
    models = [by_name[name] for name in by_name if name in common]
    default = next((str(item["defaultModel"]) for item in catalogs if item.get("defaultModel") in common), models[0]["name"] if models else "")
    return {"ok": True, "endpoints": statuses, "models": models, "defaultModel": default}


def _read_sse_result(url: str, timeout: int) -> list[object]:
    request = urllib.request.Request(url, headers={"Accept": "text/event-stream", "User-Agent": "MLSM-Studio/1"})
    try:
        with _safe_opener.open(request, timeout=timeout) as response:
            event = ""
            data_lines: list[str] = []
            for raw in response:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                elif not line:
                    if event == "error":
                        raise RemoteUpscalerError("Il job Gradio ha restituito un errore")
                    if event in ("complete", "completed") and data_lines:
                        value = json.loads("\n".join(data_lines))
                        if isinstance(value, list):
                            return value
                        raise RemoteUpscalerError("Risultato Gradio non valido")
                    event, data_lines = "", []
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RemoteUpscalerError(f"Lettura risultato Gradio fallita: {error}") from error
    raise RemoteUpscalerError("Stream Gradio terminato senza risultato")


def _prepare_remote_payload(image: bytes) -> tuple[bytes, str]:
    if not image:
        raise RemoteUpscalerError("Immagine remota vuota")
    mime = "image/jpeg" if image.startswith(b"\xff\xd8\xff") else "image/webp" if image.startswith(b"RIFF") else "image/png"
    if len(image) <= MAX_REMOTE_INPUT_BYTES:
        return image, mime
    # The documented Colab API rejects payloads over 25 MB. Preserve geometry
    # and try a high-quality JPEG representation rather than dropping a frame.
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
        decoded = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
        if decoded is not None:
            for quality in (96, 92, 88, 82, 74):
                ok, encoded = cv2.imencode(".jpg", decoded, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if ok and len(encoded) <= MAX_REMOTE_INPUT_BYTES:
                    return encoded.tobytes(), "image/jpeg"
    except (ImportError, ValueError):
        pass
    raise RemoteUpscalerError("Il frame supera 25 MB e non può essere compresso entro il limite dell'endpoint")


def upscale_image(endpoint: str, image: bytes, model: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> bytes:
    image, mime = _prepare_remote_payload(image)
    encoded = f"data:{mime};base64," + base64.b64encode(image).decode("ascii")
    last_error: Exception | None = None
    for path in ("/gradio_api/call/upscale_image", "/call/upscale_image"):
        try:
            endpoint_url = _candidate_url(endpoint, path)
            queued = _request_json(endpoint_url, {"data": [encoded, model]}, min(timeout, 30))
            event_id = queued.get("event_id")
            if not isinstance(event_id, str) or not event_id:
                raise RemoteUpscalerError("Gradio non ha restituito event_id")
            result = _read_sse_result(f"{endpoint_url}/{urllib.parse.quote(event_id, safe='')}", timeout)
            item = result[0] if result else None
            if not isinstance(item, dict) or item.get("ok") is False or not isinstance(item.get("image"), str):
                raise RemoteUpscalerError(str(item.get("error") if isinstance(item, dict) else "Risultato immagine mancante"))
            data_url = item["image"]
            if "," not in data_url:
                raise RemoteUpscalerError("Data URL immagine non valido")
            output = base64.b64decode(data_url.split(",", 1)[1], validate=True)
            if not output or len(output) > MAX_REMOTE_OUTPUT_BYTES:
                raise RemoteUpscalerError("Output remoto vuoto o troppo grande")
            return output
        except Exception as error:
            last_error = error
    raise RemoteUpscalerError(str(last_error or "Upscaling remoto fallito"))


def distribute_frames(
    frames: list[Path], endpoints: list[str], model: str, destination: Path,
    *, retries: int = 2, cancelled: Callable[[], bool] = lambda: False,
    on_progress: Callable[[int, int, str, Path], None] = lambda *_: None,
    on_endpoint: Callable[[str, str, Path], None] = lambda *_: None,
) -> tuple[int, list[dict[str, str]]]:
    """Process missing frames with one serial worker per endpoint.

    Each successful frame is written through a `.partial` file and atomically
    renamed, so an app/Colab interruption can never masquerade as completion.
    Existing non-empty PNG files are checkpoints and are skipped on resume.
    """
    destination.mkdir(parents=True, exist_ok=True)
    def valid_checkpoint(path: Path) -> bool:
        try:
            if path.stat().st_size <= 0:
                return False
            return path.read_bytes()[:12].startswith((b"\x89PNG", b"\xff\xd8\xff", b"RIFF"))
        except OSError:
            return False

    completed = sum(1 for frame in frames if valid_checkpoint(destination / frame.name))
    # A Colab URL is ephemeral. Once every checkpoint is safely on disk, final
    # rendering/muxing must work even if all Gradio hosts have expired.
    if completed == len(frames):
        return completed, []
    normalized = list(dict.fromkeys(normalize_endpoint(item) for item in endpoints))
    if not normalized or len(normalized) > MAX_ENDPOINTS:
        raise RemoteUpscalerError(f"Configura da 1 a {MAX_ENDPOINTS} endpoint attivi")
    work: queue.Queue[tuple[Path, int, str | None]] = queue.Queue()
    for frame in frames:
        target = destination / frame.name
        if not valid_checkpoint(target):
            work.put((frame, 0, None))
    lock = threading.Lock()
    failures: list[dict[str, str]] = []
    hard_failures: list[str] = []
    total = len(frames)

    def worker(endpoint: str) -> None:
        nonlocal completed
        while True:
            try:
                frame, attempt, last_endpoint = work.get(timeout=.2)
            except queue.Empty:
                if work.unfinished_tasks == 0:
                    return
                continue
            try:
                if last_endpoint == endpoint and len(normalized) > 1:
                    work.put((frame, attempt, last_endpoint))
                    time.sleep(.02)
                    continue
                if cancelled():
                    continue
                try:
                    on_endpoint(endpoint, "busy", frame)
                    output = upscale_image(endpoint, frame.read_bytes(), model)
                    partial = destination / f".{frame.name}.partial"
                    partial.write_bytes(output)
                    if not output.startswith((b"\x89PNG", b"\xff\xd8\xff", b"RIFF")):
                        partial.unlink(missing_ok=True)
                        raise RemoteUpscalerError("Il remoto non ha restituito un'immagine riconoscibile")
                    partial.replace(destination / frame.name)
                    with lock:
                        completed += 1
                        current = completed
                    on_progress(current, total, endpoint, destination / frame.name)
                    on_endpoint(endpoint, "idle", frame)
                except Exception as error:
                    on_endpoint(endpoint, "error", frame)
                    with lock:
                        failures.append({"endpoint": endpoint, "frame": frame.name, "error": str(error)})
                    if not cancelled() and attempt < retries * max(1, len(normalized)):
                        work.put((frame, attempt + 1, endpoint))
                    else:
                        with lock:
                            hard_failures.append(f"{frame.name}: {error}")
            finally:
                work.task_done()

    threads = [threading.Thread(target=worker, args=(endpoint,), daemon=True) for endpoint in normalized]
    for thread in threads:
        thread.start()
    work.join()
    for thread in threads:
        thread.join(timeout=1)
    if cancelled():
        raise InterruptedError("Job remoto annullato; i frame completati restano salvati")
    if hard_failures:
        raise RemoteUpscalerError(f"{len(hard_failures)} frame non completati. Puoi riprendere il job. Ultimo errore: {hard_failures[-1]}")
    return completed, failures
