"""Real MLX-DLSS native adapter.

The provider is optional and stores source, build products, the Python 3.11
weight-tool venv and user supplied models outside the repository.  Nothing in
this module emulates neural rendering: every media operation executes the
upstream native CLI and fails closed when it is unavailable.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

UPSTREAM_URL = "https://github.com/iamwavecut/MLX-DLSS.git"
MIN_MACOS = (26, 0)
BREW_FORMULAE = {"git": "git", "cmake": "cmake", "ninja": "ninja", "python311": "python@3.11"}
MODEL_EXTENSIONS = {
    "neural-rendering": (".dlssmodel",),
    "image-vsr": (".safetensors",),
    "video-sr": (".srmodel",),
}


def parse_native_video_progress(line: str) -> dict[str, object]:
    """Translate the native CLI's human progress line into stable telemetry.

    Current upstream builds print ``250/320 input frames, 250 output, 55.4 s``.
    Older builds used ``frame 250/320`` or a percentage, so keep all three
    formats to avoid pinning MLSM's UI to one CLI revision.
    """
    payload: dict[str, object] = {"message": line.strip()[-500:]}
    frame_match = (
        re.search(r"(\d+)\s*/\s*(\d+)\s+input\s+frames?", line, re.I)
        or re.search(r"(?:frame|frames?)\s+(\d+)\s*(?:/|of)\s*(\d+)", line, re.I)
    )
    if frame_match:
        current = int(frame_match.group(1))
        total = max(1, int(frame_match.group(2)))
        payload.update(currentFrame=min(current, total), totalFrames=total, progress=min(1.0, current / total))
    else:
        percent = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
        if percent:
            payload["progress"] = min(1.0, float(percent.group(1)) / 100)
    elapsed = re.search(r",\s*(\d+(?:\.\d+)?)\s*s(?:\s|$)", line, re.I)
    if elapsed:
        payload["elapsedSeconds"] = float(elapsed.group(1))
    return payload


class MlxDlssError(RuntimeError):
    pass


def _version_tuple(value: str) -> tuple[int, int]:
    match = re.match(r"\s*(\d+)(?:\.(\d+))?", value or "")
    return (int(match.group(1)), int(match.group(2) or 0)) if match else (0, 0)


def default_runtime_root() -> Path:
    override = os.environ.get("MLSM_MLX_DLSS_HOME")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / "Library" / "Application Support" / "MLSM Studio" / "backends" / "mlx-dlss"


def _xcode_developer_dir() -> Path | None:
    candidates: list[Path] = []
    override = os.environ.get("DEVELOPER_DIR")
    if override:
        candidates.append(Path(override).expanduser())
    try:
        selected = subprocess.run(["/usr/bin/xcode-select", "-p"], capture_output=True, text=True, timeout=5, check=False)
        if selected.returncode == 0 and selected.stdout.strip():
            candidates.append(Path(selected.stdout.strip()))
    except (OSError, subprocess.SubprocessError):
        pass
    candidates.extend((
        Path("/Applications/Xcode.app/Contents/Developer"),
        Path("/Applications/Xcode-beta.app/Contents/Developer"),
        Path.home() / "Applications" / "Xcode.app" / "Contents" / "Developer",
    ))
    for candidate in candidates:
        if candidate.name == "CommandLineTools":
            continue
        if (candidate / "usr/bin/xcodebuild").is_file():
            return candidate.resolve()
    return None


def _developer_environment() -> dict[str, str]:
    environment = os.environ.copy()
    developer_dir = _xcode_developer_dir()
    if developer_dir:
        environment["DEVELOPER_DIR"] = str(developer_dir)
    return environment


def _command_version(command: str, *args: str) -> str | None:
    resolved = shutil.which(command)
    if not resolved:
        for prefix in (Path("/opt/homebrew/bin"), Path("/usr/local/bin")):
            candidate = prefix / command
            if candidate.is_file() and os.access(candidate, os.X_OK):
                resolved = str(candidate)
                break
    if not resolved:
        return None
    try:
        result = subprocess.run([resolved, *args], capture_output=True, text=True, timeout=8, check=False, env=_developer_environment())
        if result.returncode != 0:
            return None
        return (result.stdout or result.stderr).strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _xcode_license_accepted() -> bool:
    developer_dir = _xcode_developer_dir()
    if not developer_dir:
        return False
    xcodebuild = developer_dir / "usr/bin/xcodebuild"
    try:
        result = subprocess.run([str(xcodebuild), "-license", "check"], capture_output=True, text=True, timeout=10, check=False, env=_developer_environment())
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _metal_toolchain_status() -> tuple[str | None, str]:
    """Return a usable Metal compiler, not merely the path to Xcode's shim.

    ``xcrun -f metal`` can succeed while the separately downloadable Metal
    Toolchain is still absent.  Running the compiler is therefore the only
    reliable readiness probe before starting the expensive native build.
    """
    if not _xcode_developer_dir():
        return None, "Xcode completo non è disponibile"
    resolved = _command_version("xcrun", "-f", "metal")
    if not resolved:
        return None, "Il compilatore Metal non è stato trovato"
    try:
        result = subprocess.run(
            ["/usr/bin/xcrun", "metal", "-v"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
            env=_developer_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        return None, f"Verifica Metal non riuscita: {error}"
    diagnostic = (result.stderr or result.stdout).strip()
    if result.returncode != 0:
        return None, diagnostic or "Il Metal Toolchain non è eseguibile"
    return resolved, diagnostic


def _brew_binary() -> str | None:
    for candidate in (shutil.which("brew"), "/opt/homebrew/bin/brew", "/usr/local/bin/brew"):
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def detect_support() -> dict[str, object]:
    system = platform.system()
    machine = platform.machine().lower()
    mac_version = platform.mac_ver()[0] if system == "Darwin" else ""
    apple_silicon = system == "Darwin" and machine in {"arm64", "aarch64"}
    xcode = _command_version("xcodebuild", "-version") if apple_silicon else None
    xcode_license = _xcode_license_accepted() if xcode else False
    metal_tool, metal_error = _metal_toolchain_status() if apple_silicon else (None, "")
    swift = _command_version("swift", "--version") if apple_silicon else None
    cmake = _command_version("cmake", "--version") if apple_silicon else None
    ninja = _command_version("ninja", "--version") if apple_silicon else None
    git = _command_version("git", "--version") if apple_silicon else None
    python311 = _command_version("python3.11", "--version") if apple_silicon else None
    memory_bytes = 0
    if apple_silicon:
        try:
            memory_bytes = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True, timeout=3).strip())
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    reasons: list[str] = []
    if system != "Darwin": reasons.append("MLX-DLSS nativo è disponibile solo su macOS")
    elif not apple_silicon: reasons.append("Serve un Mac Apple Silicon arm64")
    elif _version_tuple(mac_version) < MIN_MACOS: reasons.append("Serve macOS 26 o successivo per la pipeline media nativa")
    tools = {"git": git, "swift": swift, "cmake": cmake, "ninja": ninja, "python311": python311, "xcode": xcode, "xcodeLicense": xcode_license, "metal": metal_tool}
    missing_tools = [name for name in ("git", "swift", "cmake", "ninja", "python311") if not tools.get(name)]
    brew = _brew_binary() if apple_silicon else None
    automatic_install_tools = [name for name in missing_tools if name in BREW_FORMULAE and brew]
    manual_install_tools = [name for name in missing_tools if name not in automatic_install_tools]
    if apple_silicon and not xcode:
        manual_install_tools.append("Xcode completo")
    elif apple_silicon and not xcode_license:
        manual_install_tools.append("Licenza Xcode")
    elif apple_silicon and not metal_tool:
        automatic_install_tools.append("Metal Toolchain")
    missing_install_tools = [*automatic_install_tools, *manual_install_tools]
    return {
        "platform": system, "architecture": machine, "macOSVersion": mac_version,
        "appleSilicon": apple_silicon, "metal": bool(metal_tool), "memoryBytes": memory_bytes,
        "metalError": metal_error,
        "supported": not reasons, "reason": ". ".join(reasons), "tools": tools,
        "installReady": not reasons and not manual_install_tools,
        "missingInstallTools": missing_install_tools,
        "automaticInstallTools": automatic_install_tools,
        "manualInstallTools": manual_install_tools,
        "packageManager": "homebrew" if brew else None,
        "minimumMacOS": ".".join(map(str, MIN_MACOS)),
    }


class MlxDlssAdapter:
    provider_id = "mlx-dlss"

    def __init__(self, root: Path | None = None):
        self.root = (root or default_runtime_root()).resolve()
        self.source = self.root / "source"
        self.venv = self.root / "venv"
        self.models = self.root / "models"
        self.manifest = self.root / "manifest.json"
        self.log_path = self.root.parent / "mlx-dlss-provider.log"
        self.status_path = self.root.parent / "mlx-dlss-install-status.json"
        self.cli = self.source / ".build" / "release" / "mlxdlss"
        self._lock = threading.RLock()
        self._install: dict[str, object] = {"phase": "idle", "progress": 0.0, "message": ""}
        self._install_process: subprocess.Popen[str] | None = None

    def _safe_root(self) -> None:
        root = self.root
        if len(root.parts) < 6 or root.name != "mlx-dlss" or root.parent.name != "backends":
            raise MlxDlssError("Directory runtime MLX-DLSS non sicura")

    def _run(self, command: list[str], *, cwd: Path | None = None, timeout: float | None = None,
             cancelled: Callable[[], bool] | None = None,
             accepted_codes: tuple[int, ...] = (0,),
             progress: Callable[[dict[str, object]], None] | None = None) -> subprocess.CompletedProcess[str]:
        process_env = _developer_environment()
        preferred_paths = [path for path in ("/opt/homebrew/bin", "/usr/local/bin") if Path(path).is_dir()]
        process_env["PATH"] = os.pathsep.join([*preferred_paths, process_env.get("PATH", "")])
        process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, bufsize=1, start_new_session=True, env=process_env)
        lines: list[str] = []
        started = time.monotonic()
        assert process.stdout is not None
        line_queue: queue.Queue[str | None] = queue.Queue()
        def read_lines() -> None:
            assert process.stdout is not None
            for value in process.stdout: line_queue.put(value)
            line_queue.put(None)
        reader = threading.Thread(target=read_lines, name="mlx-dlss-output", daemon=True)
        reader.start()
        while process.poll() is None:
            try: line = line_queue.get(timeout=.1)
            except queue.Empty: line = ""
            if line:
                lines.append(line)
                if progress:
                    progress(parse_native_video_progress(line))
            if cancelled and cancelled():
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill()
                process.stdout.close()
                raise InterruptedError("Operazione MLX-DLSS annullata")
            if timeout and time.monotonic() - started > timeout:
                process.kill()
                raise MlxDlssError("Timeout MLX-DLSS")
        reader.join(timeout=5)
        while True:
            try: tail = line_queue.get_nowait()
            except queue.Empty: break
            if tail: lines.append(tail)
        output = "".join(lines)
        process.stdout.close()
        if process.returncode not in accepted_codes:
            try:
                self.log_path.parent.mkdir(parents=True, exist_ok=True)
                with self.log_path.open("a", encoding="utf-8") as log:
                    log.write(json.dumps({
                        "at": time.time(),
                        "phase": "command-error",
                        "command": command,
                        "cwd": str(cwd) if cwd else None,
                        "exitCode": process.returncode,
                        "output": output[-50000:],
                    }, ensure_ascii=False, default=str) + "\n")
            except OSError:
                pass
            raise MlxDlssError(f"MLX-DLSS ha terminato con codice {process.returncode}: {output[-6000:].strip()}")
        process.stdout.close()
        return subprocess.CompletedProcess(command, process.returncode, output, "")

    def _verify_cli(self, cli: Path) -> None:
        # Upstream has no --help command. With no arguments it returns code 2
        # and its supported commands; validate that exact protocol, not just 2.
        result = self._run([str(cli)], timeout=20, accepted_codes=(2,))
        if "usage error: expected process-video, process-image," not in result.stdout:
            raise MlxDlssError("Il binario MLX-DLSS non risponde con il protocollo previsto: " + result.stdout[-1000:])
        if not (cli.parent / "mlx.metallib").is_file():
            raise MlxDlssError("La libreria Metal compilata mlx.metallib non è presente accanto al binario")

    def capabilities(self) -> dict[str, object]:
        support = detect_support()
        installed = self.cli.is_file() and os.access(self.cli, os.X_OK)
        models = self.list_models()
        usable = bool(support["supported"] and installed)
        health_error = ""
        if usable:
            try: self._verify_cli(self.cli)
            except Exception as error:
                usable, health_error = False, str(error)
        return {
            "id": self.provider_id, "label": "MLX-DLSS · Apple Metal", **support,
            "installed": installed, "usable": usable, "healthError": health_error,
            "installStatus": self.install_status(),
            "runtimeRoot": str(self.root), "logPath": str(self.log_path), "version": self._manifest_value("revision"),
            "models": models,
            "modes": [
                {"id": "enhance", "label": "Enhance Only", "scale": 1, "requires": "neural-rendering"},
                {"id": "native-2x", "label": "Upscale 2×", "scale": 2, "requires": "image-vsr/video-sr"},
                {"id": "custom", "label": "Risoluzione personalizzata", "scale": None, "requires": "image-vsr/video-sr"},
            ],
            "profiles": ["standard", "natural", "cinematic", "neutral"],
            "codecs": ["h264", "hevc", "prores"],
            "containers": ["mp4", "mov"],
            "parameters": {
                "processingScale": {"min": 1, "max": 4, "step": 1, "default": 1},
                "detailStrength": {"min": 0, "max": 8, "step": 0.1, "default": 1},
                "colourStrength": {"min": 0, "max": 4, "step": 0.1, "default": 1},
                "intensity": {"min": 0, "max": 1, "step": 0.05, "default": 1},
                "sceneCutThreshold": {"min": 0, "max": 1, "step": 0.05, "default": 0.3},
            },
            "limitations": [
                "I pesi NVIDIA non sono inclusi e devono essere importati dall’utente.",
                "Video nativo SDR 8-bit; PNG/TIFF conservano output 16-bit.",
                "Super Resolution 2× sperimentale e basata su modelli separati.",
            ],
        }

    def _manifest_value(self, key: str) -> str:
        try: return str(json.loads(self.manifest.read_text(encoding="utf-8")).get(key, ""))
        except (OSError, ValueError, TypeError): return ""

    def install_status(self) -> dict[str, object]:
        with self._lock:
            if self._install.get("phase") == "idle" and self.status_path.is_file():
                try:
                    saved = json.loads(self.status_path.read_text(encoding="utf-8"))
                    if saved.get("phase") in {"ready", "error"}:
                        return saved
                    if saved.get("pid") != os.getpid():
                        try:
                            os.kill(int(saved["pid"]), 0)
                            return saved
                        except (OSError, KeyError, ValueError):
                            return {"phase": "error", "progress": 0, "message": "Installazione interrotta", "error": "Il servizio si è fermato durante l’installazione. Riprova; il dettaglio è conservato nel log."}
                except (OSError, ValueError, TypeError):
                    pass
            return dict(self._install)

    def start_install(self) -> dict[str, object]:
        support = detect_support()
        if not support["supported"]: raise MlxDlssError(str(support["reason"]))
        with self._lock:
            current = self.install_status()
            if current.get("phase") in {"preparing", "dependencies", "cloning", "venv", "building", "verifying"}: return current
            self._set_install("preparing", .02, "Preparazione cartella isolata")
        threading.Thread(target=self._install_worker, name="mlx-dlss-install", daemon=True).start()
        return self.install_status()

    def _set_install(self, phase: str, progress: float, message: str, **extra: object) -> None:
        entry = {"phase": phase, "progress": progress, "message": message, "pid": os.getpid(), "updatedAt": time.time(), **extra}
        with self._lock: self._install = entry
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.status_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
            temporary.replace(self.status_path)
            with self.log_path.open("a", encoding="utf-8") as log:
                log.write(json.dumps({"at": time.time(), **entry}, ensure_ascii=False, default=str) + "\n")
        except OSError:
            pass

    def _install_worker(self) -> None:
        staging = self.root.parent / f"mlx-dlss-install-{uuid.uuid4().hex}"
        try:
            support = detect_support()
            automatic = list(support.get("automaticInstallTools", []))
            brew_tools = [name for name in automatic if name in BREW_FORMULAE]
            if brew_tools:
                brew = _brew_binary()
                if not brew:
                    raise MlxDlssError("Homebrew non è disponibile per installare le dipendenze")
                formulae = list(dict.fromkeys(BREW_FORMULAE[name] for name in brew_tools))
                self._set_install("dependencies", .04, "Installazione automatica: " + ", ".join(brew_tools))
                self._run([brew, "install", *formulae], timeout=1800)
            if "Metal Toolchain" in automatic:
                xcodebuild = shutil.which("xcodebuild")
                if not xcodebuild:
                    raise MlxDlssError("Xcode completo non è disponibile")
                self._set_install("dependencies", .08, "Download Metal Toolchain da Apple")
                self._run([xcodebuild, "-downloadComponent", "MetalToolchain"], timeout=3600)
            refreshed = detect_support()
            if "Metal Toolchain" in refreshed.get("automaticInstallTools", []):
                detail = str(refreshed.get("metalError", "")).strip()
                raise MlxDlssError(
                    "Il download del Metal Toolchain è terminato, ma il compilatore non è ancora disponibile"
                    + (f": {detail}" if detail else ". Riprova dopo il completamento dei componenti Xcode.")
                )
            if refreshed.get("manualInstallTools") or refreshed.get("automaticInstallTools"):
                missing = list(refreshed.get("missingInstallTools", []))
                raise MlxDlssError("Prerequisiti ancora mancanti: " + ", ".join(missing))
            staging.mkdir(parents=True, exist_ok=False)
            self._set_install("cloning", .12, "Download sorgenti MLX-DLSS")
            self._run([shutil.which("git") or "git", "clone", "--depth", "1", UPSTREAM_URL, str(staging / "source")], timeout=900)
            self._set_install("venv", .22, "Creazione ambiente Python 3.11 per gli strumenti pesi")
            self._run([shutil.which("python3.11") or "python3.11", "-m", "venv", str(staging / "venv")], timeout=120)
            pip = staging / "venv" / "bin" / "python"
            self._run([str(pip), "-m", "pip", "install", "--disable-pip-version-check", str(staging / "source" / "python")], timeout=900)
            self._set_install("building", .45, "Compilazione backend Swift/Metal nativo")
            last_update = 0.0
            def build_progress(item: dict[str, object]) -> None:
                nonlocal last_update
                now = time.monotonic()
                if now - last_update >= 1:
                    self._set_install("building", .45, "Compilazione backend Swift/Metal nativo", detail=item.get("message", ""))
                    last_update = now
            self._run(["bash", "scripts/build-native-app.sh"], cwd=staging / "source", timeout=3600, progress=build_progress)
            cli = staging / "source" / ".build" / "release" / "mlxdlss"
            if not cli.is_file(): raise MlxDlssError("La build non ha prodotto il binario mlxdlss")
            self._set_install("verifying", .92, "Self-test del binario nativo")
            self._verify_cli(cli)
            revision = self._run([shutil.which("git") or "git", "rev-parse", "HEAD"], cwd=staging / "source", timeout=20).stdout.strip()
            (staging / "models").mkdir(exist_ok=True)
            if self.models.is_dir():
                shutil.copytree(self.models, staging / "models", dirs_exist_ok=True)
            (staging / "manifest.json").write_text(json.dumps({"source": UPSTREAM_URL, "revision": revision, "installedAt": time.time()}, indent=2), encoding="utf-8")
            self._safe_root()
            if self.root.exists(): shutil.rmtree(self.root)
            staging.replace(self.root)
            self._set_install("ready", 1.0, "MLX-DLSS installato e verificato", revision=revision)
        except Exception as error:
            # Keep compiled output available for diagnosis/recovery after a
            # failed final verification instead of destroying a costly build.
            self._set_install("error", 0.0, "Installazione non riuscita", error=str(error), recoveryPath=str(staging) if staging.exists() else None)

    def uninstall(self) -> None:
        self._safe_root()
        if self.root.exists(): shutil.rmtree(self.root)
        self._set_install("idle", 0.0, "Backend rimosso")

    def list_models(self) -> list[dict[str, object]]:
        if not self.models.exists(): return []
        result = []
        for path in sorted(item for item in self.models.iterdir() if item.suffix in {".dlssmodel", ".safetensors", ".srmodel"}):
            metadata = path.with_suffix(path.suffix + ".json")
            if metadata.exists():
                try: item = json.loads(metadata.read_text(encoding="utf-8"))
                except (OSError, ValueError): item = {}
            else: item = {}
            size = sum(child.stat().st_size for child in path.rglob("*") if child.is_file()) if path.is_dir() else path.stat().st_size
            result.append({"id": path.name, "name": item.get("originalName", path.name), "kind": item.get("kind", "unknown"), "bytes": size, "sha256": item.get("sha256", "")})
        return result

    def import_model(self, stream: BinaryIO, original_name: str, kind: str) -> dict[str, object]:
        if kind not in MODEL_EXTENSIONS: raise MlxDlssError("Tipo modello non riconosciuto")
        suffix = Path(original_name).suffix.lower()
        if suffix not in MODEL_EXTENSIONS[kind]: raise MlxDlssError(f"Estensione non valida per {kind}: {suffix or 'nessuna'}")
        self.models.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(); temporary = self.models / f".{uuid.uuid4().hex}.partial"
        with temporary.open("wb") as output:
            while chunk := stream.read(1024 * 1024): output.write(chunk); digest.update(chunk)
        if temporary.stat().st_size < 1024: temporary.unlink(missing_ok=True); raise MlxDlssError("File modello vuoto o non valido")
        destination = self.models / f"{kind}-{digest.hexdigest()[:12]}{suffix}"
        temporary.replace(destination)
        destination.with_suffix(destination.suffix + ".json").write_text(json.dumps({"kind": kind, "originalName": Path(original_name).name, "sha256": digest.hexdigest()}, indent=2), encoding="utf-8")
        return next(item for item in self.list_models() if item["id"] == destination.name)

    def extract_neural_model(self, stream: BinaryIO, original_name: str) -> dict[str, object]:
        if Path(original_name).name.lower() != "nvngx_dlssnr.dll":
            raise MlxDlssError("Seleziona esattamente nvngx_dlssnr.dll")
        weight_tool = self.venv / "bin" / "python"
        if not weight_tool.is_file() or not os.access(weight_tool, os.X_OK):
            raise MlxDlssError("Installa o ripara prima il backend MLX-DLSS")
        self.root.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="mlx-dlss-weights-", dir=self.root.parent) as directory:
            work = Path(directory)
            source = work / "nvngx_dlssnr.dll"
            with source.open("wb") as output:
                while chunk := stream.read(1024 * 1024):
                    output.write(chunk)
            if source.stat().st_size < 1024 * 1024:
                raise MlxDlssError("La DLL selezionata è vuota o troppo piccola")
            extracted = work / "weights"
            extracted.mkdir()
            self._run([str(weight_tool), "-m", "mlxdlss.tools.cli", "all", str(source), str(extracted)], timeout=1800)
            model = extracted / "NeuralRendering.dlssmodel"
            if not model.is_dir() or not (model / "manifest.json").is_file() or not (model / "weights.safetensors").is_file():
                raise MlxDlssError("L’estrattore non ha prodotto NeuralRendering.dlssmodel")
            self._run([str(self.cli), "inspect", str(model)], timeout=30)
            digest = hashlib.sha256()
            for name in ("manifest.json", "weights.safetensors"):
                with (model / name).open("rb") as generated:
                    while chunk := generated.read(1024 * 1024): digest.update(chunk)
            self.models.mkdir(parents=True, exist_ok=True)
            destination = self.models / f"neural-rendering-{digest.hexdigest()[:12]}.dlssmodel"
            if not destination.exists():
                temporary = self.models / f".{uuid.uuid4().hex}.partial"
                shutil.copytree(model, temporary)
                temporary.replace(destination)
            destination.with_suffix(".dlssmodel.json").write_text(json.dumps({"kind": "neural-rendering", "originalName": "NeuralRendering.dlssmodel", "sha256": digest.hexdigest()}), encoding="utf-8")
            return next(item for item in self.list_models() if item["id"] == destination.name)

    def model_path(self, model_id: str, kind: str) -> Path:
        if Path(model_id).name != model_id: raise MlxDlssError("Identificatore modello non valido")
        candidate = (self.models / model_id).resolve()
        if candidate.parent != self.models.resolve() or not candidate.exists(): raise MlxDlssError("Modello MLX-DLSS non trovato")
        metadata = candidate.with_suffix(candidate.suffix + ".json")
        try: actual = json.loads(metadata.read_text(encoding="utf-8"))["kind"]
        except (OSError, ValueError, KeyError): actual = "unknown"
        if actual != kind: raise MlxDlssError(f"Il modello selezionato non è di tipo {kind}")
        return candidate

    def remove_model(self, model_id: str) -> None:
        if Path(model_id).name != model_id: raise MlxDlssError("Identificatore modello non valido")
        candidate = (self.models / model_id).resolve()
        if candidate.parent != self.models.resolve(): raise MlxDlssError("Identificatore modello non valido")
        if candidate.is_dir(): shutil.rmtree(candidate)
        else: candidate.unlink(missing_ok=True)
        candidate.with_suffix(candidate.suffix + ".json").unlink(missing_ok=True)

    def _base_flags(self, options: dict[str, object]) -> list[str]:
        preset = str(options.get("qualityPreset", "auto"))
        if preset == "auto":
            memory = int(detect_support().get("memoryBytes", 0) or 0) / 1024 ** 3
            processing_scale = 3 if memory >= 64 else 2 if memory >= 32 else 1
        else:
            processing_scale = {"preview": 1, "balanced": 2, "high": 4}.get(preset, int(options.get("processingScale", 1) or 1))
        processing_scale = max(1, min(4, int(processing_scale)))
        return ["--profile", str(options.get("profile", "standard")), "--processing-scale", str(processing_scale), "--detail-strength", str(options.get("detailStrength", 1)), "--colour-strength", str(options.get("colourStrength", 1)), "--intensity", str(options.get("intensity", 1))]

    def process_image(self, source: Path, output: Path, options: dict[str, object], *, cancelled: Callable[[], bool] | None = None) -> None:
        if not self.capabilities()["usable"]: raise MlxDlssError("Backend MLX-DLSS non utilizzabile")
        mode = str(options.get("mode", "enhance")); command = [str(self.cli), "process-image", str(source), "--output", str(output)]
        nr_id = str(options.get("neuralModel", ""))
        if nr_id: command += ["--model", str(self.model_path(nr_id, "neural-rendering"))]
        if mode in {"native-2x", "custom"}: command += ["--vsr-weights", str(self.model_path(str(options.get("imageSrModel", "")), "image-vsr"))]
        command += self._base_flags(options)
        self._run(command, timeout=3600, cancelled=cancelled)
        if not output.is_file(): raise MlxDlssError("MLX-DLSS non ha prodotto l’immagine")

    def process_video(self, source: Path, output: Path, options: dict[str, object], *, cancelled: Callable[[], bool] | None = None, progress: Callable[[dict[str, object]], None] | None = None) -> None:
        if not self.capabilities()["usable"]: raise MlxDlssError("Backend MLX-DLSS non utilizzabile")
        mode = str(options.get("mode", "enhance")); command = [str(self.cli), "process-video", str(source), "--output", str(output)]
        nr_id = str(options.get("neuralModel", ""))
        if nr_id: command += ["--model", str(self.model_path(nr_id, "neural-rendering"))]
        if mode in {"native-2x", "custom"}: command += ["--sr-model", str(self.model_path(str(options.get("videoSrModel", "")), "video-sr"))]
        command += self._base_flags(options)
        command += ["--temporal", "on" if options.get("temporal", True) else "off", "--motion", str(options.get("motion", "automatic")), "--scene-cut-threshold", str(options.get("sceneCutThreshold", .3)), "--codec", str(options.get("codec", "h264"))]
        if int(options.get("startFrame", 0) or 0) > 0: command += ["--start-frame", str(int(options["startFrame"]))]
        if int(options.get("frames", 0) or 0) > 0: command += ["--frames", str(int(options["frames"]))]
        if options.get("audioPolicy") in {"mute", "replace"}: command += ["--audio", "off"]
        self._run(command, timeout=None, cancelled=cancelled, progress=progress)
        if not output.is_file(): raise MlxDlssError("MLX-DLSS non ha prodotto il video")
