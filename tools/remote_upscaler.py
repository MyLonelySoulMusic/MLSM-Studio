"""Client and parallel schedulers for public Gradio upscaling endpoints.

Photos still use the image endpoint. Videos are packaged as bounded MP4 chunks
and fanned out with one in-flight chunk per endpoint; successful chunks are
atomically checkpointed before more work is assigned.
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
MAX_REMOTE_VIDEO_INPUT_BYTES = 512 * 1024 * 1024
MAX_REMOTE_VIDEO_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 180
VIDEO_CHUNK_TIMEOUT_SECONDS = 3600
MAX_VIDEO_CHUNK_FRAMES = 5000


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
    for suffix in (
        "/gradio_api/api/upscale_models", "/gradio_api/call/upscale_models",
        "/gradio_api/call/upscale_image",
        "/gradio_api/call/upscale_video_chunk", "/api/upscale_models",
        "/call/upscale_models", "/call/upscale_image", "/call/upscale_video_chunk",
    ):
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
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        if "No interface is running" in detail:
            raise RemoteUpscalerError("L'interfaccia Gradio non è in esecuzione: riavvia il Colab e aggiorna il link pubblico") from error
        raise RemoteUpscalerError(f"Endpoint remoto non raggiungibile: HTTP {error.code}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RemoteUpscalerError(f"Endpoint remoto non raggiungibile: {error}") from error
    if not isinstance(value, dict):
        raise RemoteUpscalerError("Risposta JSON remota non valida")
    return value


def _candidate_url(endpoint: str, path: str) -> str:
    return f"{normalize_endpoint(endpoint)}{path}"


def discover_models(endpoint: str, timeout: int = 20) -> dict[str, object]:
    last_error: Exception | None = None
    for path in ("/gradio_api/call/upscale_models", "/call/upscale_models"):
        try:
            envelope = _request_json(_candidate_url(endpoint, path), {"data": []}, timeout)
            event_id = envelope.get("event_id")
            if not isinstance(event_id, str) or not event_id:
                raise RemoteUpscalerError("Gradio non ha restituito event_id per il catalogo")
            data = _read_sse_result(
                _candidate_url(endpoint, f"{path}/{urllib.parse.quote(event_id, safe='')}"), timeout
            )
            catalog = data[0] if data else None
            return _validated_catalog(endpoint, catalog)
        except Exception as error:
            last_error = error
    for path in ("/gradio_api/api/upscale_models", "/api/upscale_models"):
        try:
            envelope = _request_json(_candidate_url(endpoint, path), {"data": []}, timeout)
            data = envelope.get("data")
            catalog = data[0] if isinstance(data, list) and data else None
            return _validated_catalog(endpoint, catalog)
        except Exception as error:  # try legacy Gradio route before failing
            last_error = error
    raise RemoteUpscalerError(str(last_error or "Discovery modelli fallita"))


def _validated_catalog(endpoint: str, catalog: object) -> dict[str, object]:
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
    capabilities = catalog.get("capabilities") if isinstance(catalog.get("capabilities"), dict) else {}
    return {
        "endpoint": normalize_endpoint(endpoint),
        "apiVersion": int(catalog.get("api_version") or 1),
        "capabilities": capabilities,
        "defaultModel": str(catalog.get("default_model") or ""),
        "models": models,
    }


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
    by_name: dict[str, dict[str, object]] = {}
    for catalog in catalogs:
        for item in catalog["models"]:
            by_name.setdefault(str(item["name"]), item)
    models = list(by_name.values())
    default = next((str(item["defaultModel"]) for item in catalogs if item.get("defaultModel") in by_name), models[0]["name"] if models else "")
    return {"ok": True, "endpoints": statuses, "models": models, "defaultModel": default}


def validate_video_chunk_endpoints(
    endpoints: Iterable[str], model: str, *, chunk_frames: int = 100, output_fps: float | None = None
) -> list[str]:
    """Require every configured endpoint to support the selected chunk model."""
    status = inspect_video_chunk_endpoints(
        endpoints, model, chunk_frames=chunk_frames, output_fps=output_fps
    )
    failures = status["failures"]
    if failures:
        raise RemoteUpscalerError(
            "Verifica endpoint fallita. Il job non è partito perché tutti gli endpoint devono essere raggiungibili: "
            + " | ".join(f"{item['url']}: {item['error']}" for item in failures)
        )
    return status["reachableEndpoints"]


def inspect_video_chunk_endpoints(
    endpoints: Iterable[str], model: str, *, chunk_frames: int = 100, output_fps: float | None = None
) -> dict[str, object]:
    """Probe all video endpoints concurrently and preserve partial availability."""
    normalized = list(dict.fromkeys(normalize_endpoint(item) for item in endpoints))
    if not normalized or len(normalized) > MAX_ENDPOINTS:
        raise RemoteUpscalerError(f"Configura da 1 a {MAX_ENDPOINTS} endpoint attivi")
    reachable: set[str] = set()
    failures_by_endpoint: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=len(normalized), thread_name_prefix="remote-video-health") as executor:
        futures = {executor.submit(discover_models, endpoint): endpoint for endpoint in normalized}
        for future in as_completed(futures):
            endpoint = futures[future]
            try:
                catalog = future.result()
                names = {str(item.get("name")) for item in catalog.get("models", []) if isinstance(item, dict)}
                capabilities = catalog.get("capabilities") if isinstance(catalog.get("capabilities"), dict) else {}
                if not capabilities.get("video_chunks"):
                    raise RemoteUpscalerError("API segmenti video non disponibile: aggiorna il notebook/app Colab")
                endpoint_max = int(capabilities.get("max_chunk_frames") or capabilities.get("chunk_frames") or 100)
                if chunk_frames > endpoint_max:
                    raise RemoteUpscalerError(
                        f"segmenti da {chunk_frames} frame non supportati (massimo endpoint: {endpoint_max})"
                    )
                if output_fps is not None and not capabilities.get("optional_output_fps"):
                    raise RemoteUpscalerError("FPS di uscita configurabile non disponibile: aggiorna l'endpoint")
                if model not in names:
                    raise RemoteUpscalerError(f"modello {model} non disponibile")
                reachable.add(endpoint)
            except Exception as error:
                failures_by_endpoint[endpoint] = str(error)
    return {
        "ok": bool(reachable),
        "reachableEndpoints": [endpoint for endpoint in normalized if endpoint in reachable],
        "failures": [
            {"url": endpoint, "error": failures_by_endpoint[endpoint]}
            for endpoint in normalized if endpoint in failures_by_endpoint
        ],
    }


def _read_sse_result(
    url: str,
    timeout: int,
    on_progress: Callable[[dict[str, object]], None] | None = None,
) -> list[object]:
    request = urllib.request.Request(url, headers={"Accept": "text/event-stream", "User-Agent": "MLSM-Studio/1"})
    try:
        with _safe_opener.open(request, timeout=timeout) as response:
            event = ""
            data_lines: list[str] = []
            last_generated_result: list[object] | None = None
            for raw in response:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                elif not line:
                    if event == "error":
                        raise RemoteUpscalerError("Il job Gradio ha restituito un errore")
                    if event == "generating" and data_lines:
                        value = json.loads("\n".join(data_lines))
                        item = value[0] if isinstance(value, list) and value else None
                        if (
                            on_progress is not None
                            and isinstance(item, dict)
                            and item.get("event") == "progress"
                        ):
                            on_progress(item)
                        elif isinstance(value, list) and any(candidate is not None for candidate in value):
                            # Generator endpoints can publish their final value
                            # as the last `generating` event, then close with a
                            # `complete` event whose data is `[null]`.
                            last_generated_result = value
                    if event in ("complete", "completed") and data_lines:
                        value = json.loads("\n".join(data_lines))
                        if isinstance(value, list):
                            if any(candidate is not None for candidate in value):
                                return value
                            if last_generated_result is not None:
                                return last_generated_result
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


def upscale_video_chunk(
    endpoint: str,
    video: bytes,
    model: str,
    expected_frames: int,
    output_fps: float | None = None,
    timeout: int = VIDEO_CHUNK_TIMEOUT_SECONDS,
    on_progress: Callable[[dict[str, object]], None] | None = None,
) -> tuple[bytes, dict[str, object]]:
    """Send one MP4 chunk and return its upscaled MP4 plus audited metadata."""
    if expected_frames < 1 or expected_frames > MAX_VIDEO_CHUNK_FRAMES:
        raise RemoteUpscalerError(f"Un segmento remoto deve contenere da 1 a {MAX_VIDEO_CHUNK_FRAMES} frame")
    if output_fps is not None and (not isinstance(output_fps, (int, float)) or not 0 < float(output_fps) <= 480):
        raise RemoteUpscalerError("FPS remoto non valido: usa un valore tra 1 e 480")
    if not video or len(video) > MAX_REMOTE_VIDEO_INPUT_BYTES or len(video) < 12 or video[4:8] != b"ftyp":
        raise RemoteUpscalerError("Segmento MP4 remoto vuoto, non valido o troppo grande")
    encoded = "data:video/mp4;base64," + base64.b64encode(video).decode("ascii")
    last_error: Exception | None = None
    for path in ("/gradio_api/call/upscale_video_chunk", "/call/upscale_video_chunk"):
        try:
            endpoint_url = _candidate_url(endpoint, path)
            # Gradio v3 declares four components and rejects a shorter data
            # array before Python defaults are applied. Older v2 endpoints
            # ignore the extra value, so always sending 0 is backward-safe.
            inputs: list[object] = [encoded, model, expected_frames, float(output_fps or 0)]
            queued = _request_json(endpoint_url, {"data": inputs}, min(timeout, 60))
            event_id = queued.get("event_id")
            if not isinstance(event_id, str) or not event_id:
                raise RemoteUpscalerError("Gradio non ha restituito event_id per il segmento")
            result = _read_sse_result(
                f"{endpoint_url}/{urllib.parse.quote(event_id, safe='')}",
                timeout,
                on_progress=on_progress,
            )
            item = result[0] if result else None
            if not isinstance(item, dict) or item.get("ok") is False or not isinstance(item.get("video"), str):
                raise RemoteUpscalerError(str(item.get("error") if isinstance(item, dict) else "Video remoto mancante"))
            returned_frames = int(item.get("frame_count") or 0)
            if returned_frames != expected_frames:
                raise RemoteUpscalerError(f"Conteggio remoto non valido: {returned_frames}/{expected_frames} frame")
            data_url = item["video"]
            if "," not in data_url:
                raise RemoteUpscalerError("Data URL video non valido")
            output = base64.b64decode(data_url.split(",", 1)[1], validate=True)
            if (
                not output or len(output) > MAX_REMOTE_VIDEO_OUTPUT_BYTES
                or len(output) < 12 or output[4:8] != b"ftyp"
            ):
                raise RemoteUpscalerError("Output video remoto vuoto, non valido o troppo grande")
            return output, item
        except Exception as error:
            last_error = error
    raise RemoteUpscalerError(str(last_error or "Upscaling del segmento remoto fallito"))


def _cancellable_remote_call(
    operation: Callable[[], tuple[bytes, dict[str, object]]],
    cancelled: Callable[[], bool],
) -> tuple[bytes, dict[str, object]]:
    """Detach a blocking urllib/Gradio stream as soon as its job is cancelled.

    Python cannot safely kill a thread blocked in an SSL read. Running that read
    in a daemon thread lets the scheduler release its queue item and job slot
    immediately; its eventual result has no path to the checkpoint directory.
    """
    result: queue.Queue[tuple[bool, object]] = queue.Queue(maxsize=1)

    def execute() -> None:
        try:
            result.put((True, operation()))
        except BaseException as error:
            result.put((False, error))

    request = threading.Thread(target=execute, name="remote-video-request", daemon=True)
    request.start()
    while request.is_alive():
        if cancelled():
            raise InterruptedError("Richiesta Gradio sganciata perché il job è stato annullato")
        request.join(timeout=.2)
    succeeded, value = result.get_nowait()
    if not succeeded:
        raise value if isinstance(value, BaseException) else RemoteUpscalerError(str(value))
    return value  # type: ignore[return-value]


def distribute_video_chunks(
    chunks: list[tuple[Path, int]],
    endpoints: list[str],
    model: str,
    destination: Path,
    *,
    retries: int = 2,
    output_fps: float | None = None,
    cancelled: Callable[[], bool] = lambda: False,
    validate_checkpoint: Callable[[Path, int], bool] | None = None,
    on_progress: Callable[[int, int, int, int, str, Path], None] = lambda *_: None,
    on_endpoint: Callable[[str, str, Path], None] = lambda *_: None,
    on_endpoint_progress: Callable[[str, Path, dict[str, object]], None] | None = None,
) -> tuple[int, int, list[dict[str, str]]]:
    """Run one serial chunk stream per endpoint, with atomic local checkpoints."""
    destination.mkdir(parents=True, exist_ok=True)

    def default_valid(path: Path, _expected: int) -> bool:
        try:
            header = path.read_bytes()[:12]
            return path.stat().st_size > 0 and len(header) >= 8 and header[4:8] == b"ftyp"
        except OSError:
            return False

    checkpoint_is_valid = validate_checkpoint or default_valid
    total_segments = len(chunks)
    total_frames = sum(frame_count for _, frame_count in chunks)
    completed_segments = 0
    completed_frames = 0
    missing: list[tuple[Path, int]] = []
    for chunk, frame_count in chunks:
        target = destination / chunk.name
        if checkpoint_is_valid(target, frame_count):
            completed_segments += 1
            completed_frames += frame_count
        else:
            target.unlink(missing_ok=True)
            missing.append((chunk, frame_count))
    if not missing:
        return completed_segments, completed_frames, []

    normalized = list(dict.fromkeys(normalize_endpoint(item) for item in endpoints))
    if not normalized or len(normalized) > MAX_ENDPOINTS:
        raise RemoteUpscalerError(f"Configura da 1 a {MAX_ENDPOINTS} endpoint attivi")
    work: queue.Queue[tuple[Path, int, int, str | None]] = queue.Queue()
    for chunk, frame_count in missing:
        work.put((chunk, frame_count, 0, None))
    lock = threading.Lock()
    failures: list[dict[str, str]] = []
    hard_failures: list[str] = []

    def worker(endpoint: str) -> None:
        nonlocal completed_segments, completed_frames
        while True:
            try:
                chunk, frame_count, attempt, last_endpoint = work.get(timeout=.2)
            except queue.Empty:
                if work.unfinished_tasks == 0:
                    return
                continue
            try:
                if last_endpoint == endpoint and len(normalized) > 1:
                    work.put((chunk, frame_count, attempt, last_endpoint))
                    time.sleep(.02)
                    continue
                if cancelled():
                    continue
                try:
                    on_endpoint(endpoint, "busy", chunk)
                    progress_callback = (
                        (lambda progress: on_endpoint_progress(endpoint, chunk, progress))
                        if on_endpoint_progress is not None else None
                    )

                    def run_remote_chunk() -> tuple[bytes, dict[str, object]]:
                        if progress_callback is None:
                            return upscale_video_chunk(
                                endpoint, chunk.read_bytes(), model, frame_count,
                                output_fps=output_fps,
                            )
                        return upscale_video_chunk(
                            endpoint, chunk.read_bytes(), model, frame_count,
                            output_fps=output_fps, on_progress=progress_callback,
                        )

                    output, _metadata = _cancellable_remote_call(
                        run_remote_chunk,
                        cancelled,
                    )
                    if cancelled():
                        raise InterruptedError("Job annullato prima del salvataggio del segmento")
                    partial = destination / f".{chunk.name}.partial"
                    partial.write_bytes(output)
                    if not checkpoint_is_valid(partial, frame_count):
                        partial.unlink(missing_ok=True)
                        raise RemoteUpscalerError("Il segmento restituito non supera il controllo frame/MP4")
                    partial.replace(destination / chunk.name)
                    with lock:
                        completed_segments += 1
                        completed_frames += frame_count
                        segment_done = completed_segments
                        frames_done = completed_frames
                    on_progress(segment_done, total_segments, frames_done, total_frames, endpoint, destination / chunk.name)
                    on_endpoint(endpoint, "idle", chunk)
                except Exception as error:
                    on_endpoint(endpoint, "error", chunk)
                    with lock:
                        failures.append({"endpoint": endpoint, "segment": chunk.name, "error": str(error)})
                    if not cancelled() and attempt < retries * max(1, len(normalized)):
                        work.put((chunk, frame_count, attempt + 1, endpoint))
                    else:
                        with lock:
                            hard_failures.append(f"{chunk.name}: {error}")
            finally:
                work.task_done()

    threads = [threading.Thread(target=worker, args=(endpoint,), daemon=True) for endpoint in normalized]
    for thread in threads:
        thread.start()
    work.join()
    for thread in threads:
        thread.join(timeout=1)
    if cancelled():
        raise InterruptedError("Job remoto annullato; i segmenti completati restano salvati")
    if hard_failures:
        raise RemoteUpscalerError(f"{len(hard_failures)} segmenti non completati. Puoi riprendere il job. Ultimo errore: {hard_failures[-1]}")
    return completed_segments, completed_frames, failures


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
