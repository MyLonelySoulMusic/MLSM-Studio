from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import tarfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
import contextlib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = Path(os.environ.get("MLSM_RIFE_MANIFEST", ROOT / "models.manifest.json"))
CACHE_ROOT = Path(os.environ.get("MLSM_RIFE_CACHE", ROOT.parent.parent / ".upscaler-cache" / "rife")).resolve()
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_UNPACKED_BYTES = 1024 * 1024 * 1024
DOWNLOAD_ATTEMPTS = 3
_prepare_locks_guard = threading.Lock()
_prepare_locks: dict[str, threading.Lock] = {}


def _thread_prepare_lock(model_id: str) -> threading.Lock:
    """Return the process-local half of the per-model installation lock."""
    with _prepare_locks_guard:
        return _prepare_locks.setdefault(model_id, threading.Lock())


@contextlib.contextmanager
def _model_prepare_lock(model_id: str):
    """Serialize one model install across both threads and service processes.

    The lock lives outside the immutable SHA directory, so replacing a broken
    installation cannot invalidate the file descriptor used for locking.
    ``flock`` covers macOS/Linux (the supported MPS/CUDA hosts); the Windows
    branch uses the equivalent one-byte ``msvcrt`` lock.
    """
    local_lock = _thread_prepare_lock(model_id)
    with local_lock:
        lock_root = (CACHE_ROOT / ".locks").resolve()
        lock_root.mkdir(parents=True, exist_ok=True)
        lock_name = hashlib.sha256(model_id.encode("utf-8")).hexdigest() + ".lock"
        lock_path = lock_root / lock_name
        with lock_path.open("a+b") as handle:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                yield
            finally:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _load() -> dict[str, Any]:
    try:
        value = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def get_manifest_model(model_id: str) -> dict[str, Any] | None:
    value = _load().get("models", {}).get(model_id)
    return value if isinstance(value, dict) else None


def _configured_paths(model_id: str, item: dict[str, Any]) -> tuple[Path, Path, Path] | None:
    sha = str(item.get("sha256", "")).lower()
    artifact = str(item.get("artifact", ""))
    if len(sha) != 64 or any(character not in "0123456789abcdef" for character in sha):
        return None
    if not artifact or Path(artifact).name != artifact:
        return None
    cache = CACHE_ROOT.resolve()
    base = (cache / model_id / sha).resolve()
    if base.parent.parent != cache:
        return None
    return base, base / artifact, base / "runtime"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _runtime_tree_sha256(runtime: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(
        path for path in runtime.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix.lower() != ".pyc"
    )
    for path in files:
        digest.update(path.relative_to(runtime).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def _runtime_dir(root: Path) -> Path | None:
    candidates = []
    for weights in root.rglob("flownet.pkl"):
        model_directory = weights.parent
        if not (model_directory / "RIFE_HDv3.py").is_file():
            continue
        runtime = model_directory.parent if model_directory.name == "train_log" and (model_directory.parent / "model").is_dir() else model_directory
        candidates.append(runtime)
    return min(candidates, key=lambda path: len(path.parts)) if candidates else None


def _safe_extract(archive: Path, destination: Path) -> None:
    if not zipfile.is_zipfile(archive):
        raise RuntimeError("L'artifact RIFE ufficiale non è un archivio ZIP valido.")
    with zipfile.ZipFile(archive) as package:
        members = package.infolist()
        if len(members) > 512 or sum(member.file_size for member in members) > MAX_UNPACKED_BYTES:
            raise RuntimeError("L'archivio RIFE supera i limiti di sicurezza.")
        for member in members:
            relative = Path(member.filename)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("L'archivio RIFE contiene un percorso non sicuro.")
            # Reject Unix symlinks: extraction must create only regular files.
            if ((member.external_attr >> 16) & 0o170000) == 0o120000:
                raise RuntimeError("L'archivio RIFE contiene link simbolici non consentiti.")
        package.extractall(destination)


def _safe_extract_tar(archive: Path, destination: Path) -> None:
    try:
        package = tarfile.open(archive, "r:gz")
    except (OSError, tarfile.TarError) as error:
        raise RuntimeError("Il sorgente Practical-RIFE ufficiale non è un archivio TAR valido.") from error
    with package:
        members = package.getmembers()
        if len(members) > 4096 or sum(member.size for member in members if member.isfile()) > MAX_UNPACKED_BYTES:
            raise RuntimeError("Il sorgente Practical-RIFE supera i limiti di sicurezza.")
        for member in members:
            relative = Path(member.name)
            if relative.is_absolute() or ".." in relative.parts or member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                raise RuntimeError("Il sorgente Practical-RIFE contiene un percorso non sicuro.")
        package.extractall(destination, members=members)


def _source_dir(root: Path) -> Path | None:
    candidates = [
        path.parent.parent for path in root.rglob("model/warplayer.py")
        if (path.parent / "loss.py").is_file()
    ]
    return min(candidates, key=lambda path: len(path.parts)) if candidates else None


def _assemble_runtime(weights: Path, source: Path, destination: Path) -> None:
    source_root = _source_dir(source)
    if source_root is None:
        raise RuntimeError("Il sorgente Practical-RIFE non contiene il package model ufficiale.")
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copytree(source_root / "model", destination / "model")
    license_path = source_root / "LICENSE"
    if license_path.is_file():
        shutil.copy2(license_path, destination / "LICENSE")
    train_log = destination / "train_log"
    train_log.mkdir()
    for path in weights.iterdir():
        if path.is_file() and path.name != ".DS_Store" and path.suffix.lower() not in {".pyc"}:
            shutil.copy2(path, train_log / path.name)


def _download(item: dict[str, Any], destination: Path, attempt: int = 1) -> None:
    url = str(item.get("url", ""))
    if not (
        url.startswith("https://huggingface.co/hzwer/RIFE/resolve/")
        or url.startswith("https://codeload.github.com/hzwer/Practical-RIFE/tar.gz/")
    ):
        raise RuntimeError("Il manifest RIFE non punta all'upstream ufficiale hzwer.")
    separator = "&" if "?" in url else "?"
    request_url = f"{url}{separator}download=true&mlsm_attempt={attempt}"
    request = urllib.request.Request(request_url, headers={
        "User-Agent": "MLSM-Studio-RIFE/1",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
    })
    expected_size = item.get("size")
    expected_size = expected_size if isinstance(expected_size, int) and expected_size > 0 else None
    written = 0
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        content_length = response.headers.get("Content-Length")
        if content_length and content_length.isdigit() and int(content_length) > MAX_ARCHIVE_BYTES:
            raise RuntimeError("Il download RIFE supera il limite previsto.")
        while chunk := response.read(1024 * 1024):
            written += len(chunk)
            if written > MAX_ARCHIVE_BYTES:
                raise RuntimeError("Il download RIFE supera il limite previsto.")
            output.write(chunk)
        output.flush()
        os.fsync(output.fileno())
    if expected_size is not None and written != expected_size:
        raise RuntimeError(f"Download RIFE incompleto: attesi {expected_size} byte, ricevuti {written}.")


def _download_verified(item: dict[str, Any], destination: Path, expected_sha: str) -> str:
    """Download an immutable upstream artifact, retrying only transport corruption.

    The manifest checksum remains authoritative. A retry receives a cache-busting
    query and the partial file is removed before another attempt, so a truncated
    CDN response can never be published or reused.
    """
    last_detail = "download non avviato"
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        destination.unlink(missing_ok=True)
        try:
            _download(item, destination, attempt)
            actual_sha = _sha256(destination)
            if actual_sha == expected_sha:
                return actual_sha
            last_detail = f"Checksum RIFE non valido: {actual_sha} ({destination.stat().st_size} byte)."
        except (OSError, RuntimeError, urllib.error.URLError) as error:
            last_detail = str(error)
        destination.unlink(missing_ok=True)
        if attempt < DOWNLOAD_ATTEMPTS:
            time.sleep(0.25 * attempt)
    raise RuntimeError(f"Download RIFE non verificabile dopo {DOWNLOAD_ATTEMPTS} tentativi. {last_detail}")


def prepare_model(model_id: str = "rife-v4.26", local_artifact: Path | None = None) -> dict[str, Any]:
    """Install the pinned upstream artifact and lock its extracted runtime.

    `local_artifact` exists for offline/managed installations.  It is accepted
    only when its SHA-256 equals the same upstream digest in the manifest.
    """
    item = get_manifest_model(model_id)
    if item is None:
        raise RuntimeError("Modello RIFE non presente nel manifest.")
    paths = _configured_paths(model_id, item)
    if paths is None:
        raise RuntimeError("Manifest RIFE privo di artifact o SHA-256 valido.")
    base, archive, runtime = paths
    expected_sha = str(item["sha256"]).lower()
    source_item = item.get("source")
    if source_item is not None and not isinstance(source_item, dict):
        raise RuntimeError("Manifest RIFE con sorgente non valido.")
    with _model_prepare_lock(model_id):
        # Another thread/process may have completed while this caller waited.
        status = manifest_status(model_id)
        if status.get("ready"):
            return status
        base.mkdir(parents=True, exist_ok=True)
        token = f"{os.getpid()}-{threading.get_ident()}-{uuid.uuid4().hex}"
        temporary = base / f".{archive.name}.{token}.partial"
        extracted = Path(tempfile.mkdtemp(prefix=f"rife-extract-{token}-", dir=base))
        source_temporary = base / f".source.{token}.partial"
        source_extracted = Path(tempfile.mkdtemp(prefix=f"rife-source-{token}-", dir=base))
        staged_runtime = base / f".runtime.{token}.partial"
        staged_receipt = base / f".receipt.{token}.partial"
        retired_runtime = base / f".runtime.{token}.retired"
        receipt = base / "receipt.json"
        try:
            if local_artifact is not None:
                candidate = local_artifact.expanduser().resolve()
                if not candidate.is_file():
                    raise RuntimeError("Artifact RIFE locale non trovato.")
                shutil.copyfile(candidate, temporary)
                actual_sha = _sha256(temporary)
                if actual_sha != expected_sha:
                    raise RuntimeError(f"Checksum RIFE non valido: {actual_sha}.")
            else:
                actual_sha = _download_verified(item, temporary, expected_sha)
            _safe_extract(temporary, extracted)
            source_runtime = _runtime_dir(extracted)
            if source_runtime is None:
                raise RuntimeError("L'artifact non contiene RIFE_HDv3.py e flownet.pkl.")
            source_sha = None
            if source_item is not None:
                source_sha = str(source_item.get("sha256", "")).lower()
                if len(source_sha) != 64 or any(character not in "0123456789abcdef" for character in source_sha):
                    raise RuntimeError("Manifest RIFE con checksum sorgente non valido.")
                _download_verified(source_item, source_temporary, source_sha)
                _safe_extract_tar(source_temporary, source_extracted)
                _assemble_runtime(source_runtime, source_extracted, staged_runtime)
            else:
                shutil.copytree(source_runtime, staged_runtime)
            tree_sha = _runtime_tree_sha256(staged_runtime)
            staged_receipt.write_text(json.dumps({
                "modelId": model_id,
                "artifactSha256": actual_sha,
                "sourceSha256": source_sha,
                "runtimeTreeSha256": tree_sha,
                "upstream": item.get("upstream"),
                "revision": item.get("revision"),
                "url": item.get("url"),
            }, indent=2), encoding="utf-8")

            # receipt.json is the commit marker. Remove an invalid old marker,
            # publish complete artifacts by rename, then publish the new marker
            # last so readers can never accept a half-copied runtime as ready.
            receipt.unlink(missing_ok=True)
            temporary.replace(archive)
            if runtime.exists():
                runtime.replace(retired_runtime)
            try:
                staged_runtime.replace(runtime)
            except BaseException:
                if retired_runtime.exists() and not runtime.exists():
                    retired_runtime.replace(runtime)
                raise
            shutil.rmtree(retired_runtime, ignore_errors=True)
            staged_receipt.replace(receipt)
            published = manifest_status(model_id)
            if not published.get("ready") or not published.get("verified"):
                raise RuntimeError(str(published.get("reason", "Installazione RIFE non verificata dopo la pubblicazione.")))
            return published
        finally:
            # Every transient name is unique to this caller. Cleanup therefore
            # cannot delete a concurrent install's download or runtime tree.
            temporary.unlink(missing_ok=True)
            source_temporary.unlink(missing_ok=True)
            staged_receipt.unlink(missing_ok=True)
            shutil.rmtree(extracted, ignore_errors=True)
            shutil.rmtree(source_extracted, ignore_errors=True)
            shutil.rmtree(staged_runtime, ignore_errors=True)
            shutil.rmtree(retired_runtime, ignore_errors=True)


def manifest_status(model_id: str = "rife-v4.26") -> dict[str, Any]:
    item = get_manifest_model(model_id)
    base_status: dict[str, Any] = {
        "installed": False,
        "ready": False,
        "verified": False,
        "modelId": model_id,
        "upstream": item.get("upstream") if item else None,
        "revision": item.get("revision") if item else None,
    }
    if item is None:
        return {**base_status, "reason": "manifest model missing"}
    paths = _configured_paths(model_id, item)
    if paths is None:
        return {**base_status, "reason": "manifest is unconfigured or unsafe"}
    base, archive, runtime = paths
    receipt_path = base / "receipt.json"
    if not archive.is_file() or not runtime.is_dir() or not receipt_path.is_file():
        return {**base_status, "reason": "artifact RIFE ufficiale non installato"}
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        artifact_sha = _sha256(archive)
        tree_sha = _runtime_tree_sha256(runtime)
    except (OSError, json.JSONDecodeError):
        return {**base_status, "installed": True, "reason": "installazione RIFE illeggibile"}
    expected = str(item.get("sha256", "")).lower()
    source_item = item.get("source") if isinstance(item.get("source"), dict) else None
    expected_source = str(source_item.get("sha256", "")).lower() if source_item else None
    verified = (
        artifact_sha == expected
        and receipt.get("artifactSha256") == expected
        and receipt.get("sourceSha256") == expected_source
        and receipt.get("runtimeTreeSha256") == tree_sha
        and _runtime_dir(runtime) == runtime
    )
    if not verified:
        return {**base_status, "installed": True, "reason": "checksum dell'installazione RIFE non valido"}
    return {
        **base_status,
        "installed": True,
        "ready": True,
        "verified": True,
        "artifact": str(archive),
        "runtimePath": str(runtime),
        "sha256": expected,
        "runtime": item.get("runtime", "practical-rife"),
    }
