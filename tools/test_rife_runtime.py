from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import tarfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import numpy as np
import torch

from tools.rife_runtime import engine, manifest
from tools import upscaler_server


UPSTREAM_MODEL = "rife-v4.26"


def _fake_runtime(root: Path) -> None:
    (root / "RIFE_HDv3.py").write_text(
        """import torch
class Model:
    def __init__(self): self.flownet = torch.nn.Identity()
    def load_model(self, path, rank): pass
    def eval(self): self.flownet.eval()
    def inference(self, first, second, timestep=0.5, scale=1.0):
        return first * (1.0 - timestep) + second * timestep
""",
        encoding="utf-8",
    )
    (root / "flownet.pkl").write_bytes(b"test-only-weights")


class RifeManifestTests(unittest.TestCase):
    def test_checked_in_manifest_pins_both_weights_and_compatible_official_source(self) -> None:
        item = manifest.get_manifest_model(UPSTREAM_MODEL)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["sha256"], "1fa9b9cda3d9b8c3e301359e2595960902f97bf926c08598b0e9957a3f3f760e")
        self.assertEqual(item["size"], 22869906)
        self.assertEqual(item["source"]["revision"], "ec6aba965312eb9fd08301436145c8ac47ec545a")
        self.assertEqual(item["source"]["sha256"], "03ec4a857bf9ad5bacffd51cbee3f9b1b9bd3c98c07a65e6e2f4ecd6a1f664ee")

    def test_source_archive_rejects_traversal_and_links(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-source-safety-") as temporary:
            root = Path(temporary)
            for name, member in (
                ("traversal.tar.gz", tarfile.TarInfo("../outside.py")),
                ("link.tar.gz", tarfile.TarInfo("runtime-link")),
            ):
                archive = root / name
                payload = b"unsafe"
                if name.startswith("link"):
                    member.type = tarfile.SYMTYPE
                    member.linkname = "/tmp"
                else:
                    member.size = len(payload)
                with tarfile.open(archive, "w:gz") as package:
                    package.addfile(member, None if member.issym() else io.BytesIO(payload))
                with self.assertRaisesRegex(RuntimeError, "percorso non sicuro"):
                    manifest._safe_extract_tar(archive, root / "output")

    def test_prepare_accepts_only_the_pinned_checksum_and_detects_tree_tampering(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-manifest-") as temporary:
            root = Path(temporary)
            source = root / "upstream.zip"
            content = root / "content"
            content.mkdir()
            _fake_runtime(content)
            with zipfile.ZipFile(source, "w") as package:
                package.write(content / "RIFE_HDv3.py", "train_log/RIFE_HDv3.py")
                package.write(content / "flownet.pkl", "train_log/flownet.pkl")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            model_manifest = root / "manifest.json"
            model_manifest.write_text(json.dumps({"models": {UPSTREAM_MODEL: {
                "runtime": "practical-rife", "upstream": "hzwer/Practical-RIFE", "revision": "pinned",
                "url": "https://huggingface.co/hzwer/RIFE/resolve/pinned/RIFE.zip",
                "sha256": digest, "artifact": "RIFE.zip",
            }}}), encoding="utf-8")
            with mock.patch.object(manifest, "MANIFEST_PATH", model_manifest), mock.patch.object(manifest, "CACHE_ROOT", root / "cache"):
                prepared = manifest.prepare_model(UPSTREAM_MODEL, source)
                self.assertTrue(prepared["verified"])
                runtime = Path(str(prepared["runtimePath"]))
                (runtime / "RIFE_HDv3.py").write_text("tampered", encoding="utf-8")
                status = manifest.manifest_status(UPSTREAM_MODEL)
                self.assertFalse(status["verified"])
                self.assertIn("checksum", str(status["reason"]))

    def test_prepare_rejects_an_archive_with_the_wrong_sha(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-checksum-") as temporary:
            root = Path(temporary)
            source = root / "artifact.zip"
            with zipfile.ZipFile(source, "w") as package:
                package.writestr("train_log/RIFE_HDv3.py", "pass")
                package.writestr("train_log/flownet.pkl", b"weights")
            model_manifest = root / "manifest.json"
            model_manifest.write_text(json.dumps({"models": {UPSTREAM_MODEL: {
                "url": "https://huggingface.co/hzwer/RIFE/resolve/pinned/RIFE.zip",
                "sha256": "0" * 64, "artifact": "RIFE.zip",
            }}}), encoding="utf-8")
            with mock.patch.object(manifest, "MANIFEST_PATH", model_manifest), mock.patch.object(manifest, "CACHE_ROOT", root / "cache"):
                with self.assertRaisesRegex(RuntimeError, "Checksum"):
                    manifest.prepare_model(UPSTREAM_MODEL, source)

    def test_remote_prepare_retries_a_truncated_download_and_publishes_only_verified_bytes(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-retry-") as temporary:
            root = Path(temporary)
            source = root / "upstream.zip"
            content = root / "content"
            content.mkdir()
            _fake_runtime(content)
            with zipfile.ZipFile(source, "w") as package:
                package.write(content / "RIFE_HDv3.py", "train_log/RIFE_HDv3.py")
                package.write(content / "flownet.pkl", "train_log/flownet.pkl")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            model_manifest = root / "manifest.json"
            model_manifest.write_text(json.dumps({"models": {UPSTREAM_MODEL: {
                "runtime": "practical-rife", "upstream": "hzwer/Practical-RIFE", "revision": "pinned",
                "url": "https://huggingface.co/hzwer/RIFE/resolve/pinned/RIFE.zip",
                "sha256": digest, "size": source.stat().st_size, "artifact": "RIFE.zip",
            }}}), encoding="utf-8")
            attempts: list[int] = []

            def flaky_download(_item: dict[str, object], destination: Path, attempt: int = 1) -> None:
                attempts.append(attempt)
                destination.write_bytes(b"truncated") if attempt == 1 else shutil.copyfile(source, destination)

            with mock.patch.object(manifest, "MANIFEST_PATH", model_manifest), mock.patch.object(manifest, "CACHE_ROOT", root / "cache"), mock.patch.object(manifest, "_download", side_effect=flaky_download), mock.patch.object(manifest.time, "sleep"):
                prepared = manifest.prepare_model(UPSTREAM_MODEL)

            self.assertTrue(prepared["verified"])
            self.assertEqual(attempts, [1, 2])
            self.assertEqual(Path(str(prepared["artifact"])).read_bytes(), source.read_bytes())

    def test_remote_prepare_removes_every_bad_download_after_bounded_retries(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-retry-fail-") as temporary:
            root = Path(temporary)
            model_manifest = root / "manifest.json"
            model_manifest.write_text(json.dumps({"models": {UPSTREAM_MODEL: {
                "runtime": "practical-rife", "upstream": "hzwer/Practical-RIFE", "revision": "pinned",
                "url": "https://huggingface.co/hzwer/RIFE/resolve/pinned/RIFE.zip",
                "sha256": "a" * 64, "size": 9, "artifact": "RIFE.zip",
            }}}), encoding="utf-8")
            attempts: list[int] = []

            def corrupt_download(_item: dict[str, object], destination: Path, attempt: int = 1) -> None:
                attempts.append(attempt)
                destination.write_bytes(b"corrupted")

            cache = root / "cache"
            with mock.patch.object(manifest, "MANIFEST_PATH", model_manifest), mock.patch.object(manifest, "CACHE_ROOT", cache), mock.patch.object(manifest, "_download", side_effect=corrupt_download), mock.patch.object(manifest.time, "sleep"):
                with self.assertRaisesRegex(RuntimeError, "dopo 3 tentativi"):
                    manifest.prepare_model(UPSTREAM_MODEL)

            self.assertEqual(attempts, [1, 2, 3])
            self.assertFalse(any(path.is_file() for path in cache.rglob("*") if path.suffix != ".lock"))

    def test_concurrent_prepare_serializes_and_publishes_one_complete_runtime(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-concurrent-") as temporary:
            root = Path(temporary)
            source = root / "upstream.zip"
            content = root / "content"
            content.mkdir()
            _fake_runtime(content)
            with zipfile.ZipFile(source, "w") as package:
                package.write(content / "RIFE_HDv3.py", "train_log/RIFE_HDv3.py")
                package.write(content / "flownet.pkl", "train_log/flownet.pkl")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            model_manifest = root / "manifest.json"
            model_manifest.write_text(json.dumps({"models": {UPSTREAM_MODEL: {
                "runtime": "practical-rife", "upstream": "hzwer/Practical-RIFE", "revision": "pinned",
                "url": "https://huggingface.co/hzwer/RIFE/resolve/pinned/RIFE.zip",
                "sha256": digest, "artifact": "RIFE.zip",
            }}}), encoding="utf-8")
            original_copy = shutil.copyfile
            copy_entries = 0
            copy_entries_lock = threading.Lock()
            second_copy = threading.Event()

            def observed_copy(source_path, destination_path, *args, **kwargs):
                nonlocal copy_entries
                if Path(source_path).resolve() == source.resolve():
                    with copy_entries_lock:
                        copy_entries += 1
                        if copy_entries >= 2:
                            second_copy.set()
                    # Without the per-model lock both installers enter this
                    # copy; with the lock the first continues after timeout.
                    second_copy.wait(.15)
                return original_copy(source_path, destination_path, *args, **kwargs)

            start = threading.Event()
            results: list[dict[str, object]] = []
            failures: list[BaseException] = []

            def install() -> None:
                start.wait()
                try:
                    results.append(manifest.prepare_model(UPSTREAM_MODEL, source))
                except BaseException as error:
                    failures.append(error)

            with mock.patch.object(manifest, "MANIFEST_PATH", model_manifest), mock.patch.object(manifest, "CACHE_ROOT", root / "cache"), mock.patch.object(manifest.shutil, "copyfile", side_effect=observed_copy):
                threads = [threading.Thread(target=install) for _ in range(2)]
                for thread in threads:
                    thread.start()
                start.set()
                for thread in threads:
                    thread.join(timeout=10)
                status = manifest.manifest_status(UPSTREAM_MODEL)
                configured = manifest._configured_paths(UPSTREAM_MODEL, manifest.get_manifest_model(UPSTREAM_MODEL) or {})

            self.assertFalse(any(thread.is_alive() for thread in threads))
            self.assertEqual(failures, [])
            self.assertEqual(len(results), 2)
            self.assertEqual(copy_entries, 1)
            self.assertTrue(status["ready"])
            self.assertIsNotNone(configured)
            base = configured[0]  # type: ignore[index]
            self.assertFalse(any("partial" in path.name or "retired" in path.name for path in base.iterdir()))


class RifeEngineTests(unittest.TestCase):
    def test_cpu_requires_explicit_selection(self) -> None:
        with mock.patch.object(engine, "device_available", side_effect=lambda device: device == "cpu"):
            self.assertIsNone(engine.automatic_device())
            with self.assertRaisesRegex(RuntimeError, "seleziona CPU esplicitamente"):
                engine.resolve_device("auto")
            self.assertEqual(engine.resolve_device("cpu"), "cpu")

    def test_mps_is_fp32_and_cuda_supports_fp16(self) -> None:
        with mock.patch.object(engine, "device_available", side_effect=lambda device: device in {"mps", "cpu"}):
            self.assertEqual(engine.automatic_device(), "mps")
            self.assertEqual(engine.resolve_precision("mps", "auto"), "fp32")
            with self.assertRaisesRegex(RuntimeError, "solo su CUDA"):
                engine.resolve_precision("mps", "fp16")
        self.assertEqual(engine.resolve_precision("cuda", "auto"), "fp16")
        self.assertEqual(engine.resolve_precision("cuda", "fp32"), "fp32")

    def test_real_cpu_tensor_inference_has_valid_shape_and_midpoint(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-engine-") as temporary:
            runtime = Path(temporary)
            _fake_runtime(runtime)
            instance = engine.PracticalRife(runtime, "cpu", "fp32")
            first = np.zeros((65, 67, 3), dtype=np.uint8)
            second = np.full_like(first, 200)
            output = instance.interpolate(first, second, .5)
        self.assertEqual(output.shape, first.shape)
        self.assertEqual(output.dtype, np.uint8)
        self.assertTrue(np.all(output == 100))

    def test_verified_runtime_runs_through_the_real_worker_entrypoint(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-rife-worker-") as temporary:
            root = Path(temporary)
            source_artifact = root / "upstream.zip"
            content = root / "content"
            content.mkdir()
            _fake_runtime(content)
            with zipfile.ZipFile(source_artifact, "w") as package:
                package.write(content / "RIFE_HDv3.py", "train_log/RIFE_HDv3.py")
                package.write(content / "flownet.pkl", "train_log/flownet.pkl")
            digest = hashlib.sha256(source_artifact.read_bytes()).hexdigest()
            model_manifest = root / "manifest.json"
            model_manifest.write_text(json.dumps({"models": {UPSTREAM_MODEL: {
                "runtime": "practical-rife", "upstream": "hzwer/Practical-RIFE", "revision": "pinned",
                "url": "https://huggingface.co/hzwer/RIFE/resolve/pinned/RIFE.zip",
                "sha256": digest, "artifact": "RIFE.zip",
            }}}), encoding="utf-8")
            cache = root / "cache"
            with mock.patch.object(manifest, "MANIFEST_PATH", model_manifest), mock.patch.object(manifest, "CACHE_ROOT", cache):
                prepared = manifest.prepare_model(UPSTREAM_MODEL, source_artifact)
            self.assertTrue(prepared["verified"])

            source = root / "source.mp4"
            destination = root / "result.mp4"
            writer = engine.cv2.VideoWriter(str(source), engine.cv2.VideoWriter_fourcc(*"mp4v"), 8, (64, 64))
            if not writer.isOpened():
                self.skipTest("Codec MP4V OpenCV non disponibile")
            for level in (0, 80, 160):
                writer.write(np.full((64, 64, 3), level, dtype=np.uint8))
            writer.release()

            command = upscaler_server._rife_worker_command(
                source, destination, 16, device="cpu", precision="fp32", model_id=UPSTREAM_MODEL,
            )
            self.assertEqual(command[6], UPSTREAM_MODEL)
            environment = os.environ.copy()
            environment.update({
                "MLSM_RIFE_MANIFEST": str(model_manifest),
                "MLSM_RIFE_CACHE": str(cache),
                "MLSM_UPSCALER_TEMP": str(root / "jobs"),
                "DSAS_UPSCALER_CACHE": str(root / "upscaler-cache"),
            })
            completed = subprocess.run(
                command, cwd=str(Path(__file__).resolve().parents[1]), env=environment,
                capture_output=True, text=True, timeout=120, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue(destination.is_file())
            self.assertGreater(destination.stat().st_size, 0)

    @unittest.skipUnless(hasattr(torch.backends, "mps") and torch.backends.mps.is_available(), "MPS non disponibile")
    def test_mps_mini_inference_when_hardware_is_available(self) -> None:
        status = manifest.manifest_status()
        if not status.get("ready"):
            self.skipTest("artifact upstream non installato")
        result = engine.mini_inference(Path(str(status["runtimePath"])), "mps", "fp32")
        self.assertEqual(result["device"], "mps")
        self.assertEqual(result["precision"], "fp32")

    @unittest.skipUnless(torch.cuda.is_available(), "CUDA non disponibile")
    def test_cuda_mini_inference_when_hardware_is_available(self) -> None:
        status = manifest.manifest_status()
        if not status.get("ready"):
            self.skipTest("artifact upstream non installato")
        result = engine.mini_inference(Path(str(status["runtimePath"])), "cuda", "fp16")
        self.assertEqual(result["device"], "cuda")
        self.assertEqual(result["precision"], "fp16")


if __name__ == "__main__":
    unittest.main()
