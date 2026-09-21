from __future__ import annotations

import io
import json
import os
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from tools.mlx_dlss_runtime.adapter import MlxDlssAdapter, MlxDlssError, detect_support, parse_native_video_progress


class MlxDlssAdapterTests(unittest.TestCase):
    def test_native_progress_parses_the_current_upstream_format(self):
        progress = parse_native_video_progress("250/320 input frames, 250 output, 55.4 s")
        self.assertEqual(progress["currentFrame"], 250)
        self.assertEqual(progress["totalFrames"], 320)
        self.assertAlmostEqual(progress["progress"], 250 / 320)
        self.assertEqual(progress["elapsedSeconds"], 55.4)

    def test_native_progress_keeps_legacy_frame_and_percent_formats(self):
        self.assertEqual(parse_native_video_progress("frame 7/10")["progress"], .7)
        self.assertEqual(parse_native_video_progress("building 42%")["progress"], .42)

    def test_non_macos_is_hidden_with_clear_reason(self):
        with mock.patch("platform.system", return_value="Windows"), mock.patch("platform.machine", return_value="AMD64"):
            capability = detect_support()
        self.assertFalse(capability["supported"])
        self.assertFalse(capability["appleSilicon"])
        self.assertIn("macOS", capability["reason"])

    def test_old_macos_is_rejected_without_hardcoding_chip_generation(self):
        with mock.patch("platform.system", return_value="Darwin"), mock.patch("platform.machine", return_value="arm64"), mock.patch("platform.mac_ver", return_value=("15.6", ("", "", ""), "")), mock.patch("tools.mlx_dlss_runtime.adapter._command_version", return_value="available"), mock.patch("tools.mlx_dlss_runtime.adapter._metal_toolchain_status", return_value=("/usr/bin/metal", "")), mock.patch("tools.mlx_dlss_runtime.adapter._xcode_license_accepted", return_value=True):
            capability = detect_support()
        self.assertFalse(capability["supported"])
        self.assertIn("macOS 26", capability["reason"])

    def test_homebrew_dependency_is_automatic_not_a_first_use_blocker(self):
        def version(command, *_args):
            return None if command == "ninja" else "available"
        with mock.patch("platform.system", return_value="Darwin"), mock.patch("platform.machine", return_value="arm64"), mock.patch("platform.mac_ver", return_value=("26.1", ("", "", ""), "")), mock.patch("tools.mlx_dlss_runtime.adapter._command_version", side_effect=version), mock.patch("tools.mlx_dlss_runtime.adapter._metal_toolchain_status", return_value=("/usr/bin/metal", "")), mock.patch("tools.mlx_dlss_runtime.adapter._xcode_license_accepted", return_value=True), mock.patch("tools.mlx_dlss_runtime.adapter._brew_binary", return_value="/opt/homebrew/bin/brew"):
            capability = detect_support()
        self.assertTrue(capability["installReady"])
        self.assertEqual(capability["automaticInstallTools"], ["ninja"])
        self.assertEqual(capability["manualInstallTools"], [])

    def test_missing_full_xcode_is_reported_instead_of_generic_metal(self):
        def version(command, *_args):
            return None if command in {"xcodebuild", "xcrun"} else "available"
        with mock.patch("platform.system", return_value="Darwin"), mock.patch("platform.machine", return_value="arm64"), mock.patch("platform.mac_ver", return_value=("26.1", ("", "", ""), "")), mock.patch("tools.mlx_dlss_runtime.adapter._command_version", side_effect=version), mock.patch("tools.mlx_dlss_runtime.adapter._metal_toolchain_status", return_value=(None, "Xcode completo non è disponibile")), mock.patch("tools.mlx_dlss_runtime.adapter._xcode_license_accepted", return_value=True), mock.patch("tools.mlx_dlss_runtime.adapter._brew_binary", return_value="/opt/homebrew/bin/brew"):
            capability = detect_support()
        self.assertFalse(capability["installReady"])
        self.assertEqual(capability["manualInstallTools"], ["Xcode completo"])
        self.assertNotIn("metal", capability["missingInstallTools"])

    def test_metal_toolchain_is_automatic_when_full_xcode_is_available(self):
        with mock.patch("platform.system", return_value="Darwin"), mock.patch("platform.machine", return_value="arm64"), mock.patch("platform.mac_ver", return_value=("26.1", ("", "", ""), "")), mock.patch("tools.mlx_dlss_runtime.adapter._command_version", return_value="available"), mock.patch("tools.mlx_dlss_runtime.adapter._metal_toolchain_status", return_value=(None, "missing Metal Toolchain")), mock.patch("tools.mlx_dlss_runtime.adapter._xcode_license_accepted", return_value=True), mock.patch("tools.mlx_dlss_runtime.adapter._brew_binary", return_value="/opt/homebrew/bin/brew"):
            capability = detect_support()
        self.assertTrue(capability["installReady"])
        self.assertIn("Metal Toolchain", capability["automaticInstallTools"])
        self.assertEqual(capability["manualInstallTools"], [])
        self.assertIn("missing Metal Toolchain", capability["metalError"])

    def test_installed_xcode_with_pending_license_is_reported_separately(self):
        with mock.patch("platform.system", return_value="Darwin"), mock.patch("platform.machine", return_value="arm64"), mock.patch("platform.mac_ver", return_value=("26.1", ("", "", ""), "")), mock.patch("tools.mlx_dlss_runtime.adapter._command_version", return_value="available"), mock.patch("tools.mlx_dlss_runtime.adapter._metal_toolchain_status", return_value=("/usr/bin/metal", "")), mock.patch("tools.mlx_dlss_runtime.adapter._xcode_license_accepted", return_value=False), mock.patch("tools.mlx_dlss_runtime.adapter._brew_binary", return_value="/opt/homebrew/bin/brew"):
            capability = detect_support()
        self.assertFalse(capability["installReady"])
        self.assertEqual(capability["manualInstallTools"], ["Licenza Xcode"])
        self.assertNotIn("Xcode completo", capability["missingInstallTools"])

    def test_failed_tool_probe_is_not_reported_as_available(self):
        completed = subprocess.CompletedProcess(["xcrun"], 1, "", "tool not found")
        with mock.patch("shutil.which", return_value="/usr/bin/xcrun"), mock.patch("subprocess.run", return_value=completed):
            from tools.mlx_dlss_runtime.adapter import _command_version
            self.assertIsNone(_command_version("xcrun", "-f", "metal"))

    def test_metal_path_is_not_enough_when_compiler_cannot_execute(self):
        from tools.mlx_dlss_runtime.adapter import _metal_toolchain_status
        failed = subprocess.CompletedProcess(["xcrun", "metal", "-v"], 1, "", "missing Metal Toolchain")
        with mock.patch("tools.mlx_dlss_runtime.adapter._xcode_developer_dir", return_value=Path("/Applications/Xcode.app/Contents/Developer")), mock.patch("tools.mlx_dlss_runtime.adapter._command_version", return_value="/Applications/Xcode.app/metal"), mock.patch("subprocess.run", return_value=failed):
            executable, diagnostic = _metal_toolchain_status()
        self.assertIsNone(executable)
        self.assertIn("missing Metal Toolchain", diagnostic)

    def test_install_can_start_while_manual_prerequisites_are_still_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            support = {"supported": True, "reason": "", "installReady": False, "missingInstallTools": ["Xcode completo"]}
            with mock.patch("tools.mlx_dlss_runtime.adapter.detect_support", return_value=support), mock.patch("tools.mlx_dlss_runtime.adapter.threading.Thread") as thread:
                status = adapter.start_install()
            self.assertEqual(status["phase"], "preparing")
            thread.return_value.start.assert_called_once()

    def test_model_import_accepts_unicode_and_stores_a_safe_content_addressed_name(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            item = adapter.import_model(io.BytesIO(b"x" * 4096), "modello ü con spazi.dlssmodel", "neural-rendering")
            self.assertNotIn(" ", item["id"])
            self.assertNotIn("ü", item["id"])
            self.assertEqual(item["name"], "modello ü con spazi.dlssmodel")
            self.assertEqual(adapter.model_path(str(item["id"]), "neural-rendering").stat().st_size, 4096)

    def test_wrong_model_kind_and_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            item = adapter.import_model(io.BytesIO(b"x" * 4096), "image.safetensors", "image-vsr")
            with self.assertRaises(MlxDlssError): adapter.model_path(str(item["id"]), "video-sr")
            with self.assertRaises(MlxDlssError): adapter.model_path("../outside", "image-vsr")

    def test_neural_dll_is_extracted_without_being_persisted(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            tool = adapter.venv / "bin" / "python"
            tool.parent.mkdir(parents=True); tool.write_text("#!/bin/sh\n", encoding="utf-8"); tool.chmod(tool.stat().st_mode | stat.S_IXUSR)
            def fake_run(command, **_kwargs):
                if command[1] == "inspect":
                    self.assertTrue((Path(command[2]) / "manifest.json").is_file())
                    return subprocess.CompletedProcess(command, 0, "{}", "")
                self.assertEqual(command[1:4], ["-m", "mlxdlss.tools.cli", "all"])
                output = Path(command[-1]) / "NeuralRendering.dlssmodel"
                output.mkdir()
                (output / "manifest.json").write_text('{"schemaVersion": 1}')
                (output / "weights.safetensors").write_bytes(b"m" * 4096)
                return subprocess.CompletedProcess(command, 0, "ok", "")
            with mock.patch.object(adapter, "_run", side_effect=fake_run):
                item = adapter.extract_neural_model(io.BytesIO(b"d" * (1024 * 1024 + 1)), "nvngx_dlssnr.dll")
            self.assertEqual(item["kind"], "neural-rendering")
            self.assertTrue(adapter.model_path(item["id"], "neural-rendering").is_dir())
            self.assertEqual(len(adapter.list_models()), 1)
            adapter.remove_model(item["id"])
            self.assertEqual(adapter.list_models(), [])
            self.assertFalse(any(adapter.root.parent.glob("mlx-dlss-weights-*")))

    def test_native_command_keeps_paths_with_spaces_as_single_arguments(self):
        with tempfile.TemporaryDirectory(prefix="MLSM Studio ") as directory:
            root = Path(directory) / "backends" / "mlx-dlss"; adapter = MlxDlssAdapter(root)
            adapter.cli.parent.mkdir(parents=True); adapter.cli.write_text("#!/bin/sh\n", encoding="utf-8"); adapter.cli.chmod(adapter.cli.stat().st_mode | stat.S_IXUSR)
            nr = adapter.import_model(io.BytesIO(b"n" * 4096), "Neural Rendering.dlssmodel", "neural-rendering")
            source = Path(directory) / "sorgente ü.png"; source.write_bytes(b"png")
            output = Path(directory) / "risultato con spazi.png"
            commands: list[list[str]] = []
            def fake_run(command, **_kwargs):
                commands.append(command)
                if "process-image" in command: output.write_bytes(b"result")
                return type("Result", (), {"stdout": "ok"})()
            with mock.patch.object(adapter, "capabilities", return_value={"usable": True}), mock.patch.object(adapter, "_run", side_effect=fake_run):
                adapter.process_image(source, output, {"mode": "enhance", "neuralModel": nr["id"]})
            self.assertIn(str(source), commands[0])
            self.assertIn(str(output), commands[0])

    def test_image_native_2x_combines_dlss5_neural_rendering_and_rtx_vsr(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            neural = adapter.import_model(io.BytesIO(b"n" * 4096), "NeuralRendering.dlssmodel", "neural-rendering")
            vsr = adapter.import_model(io.BytesIO(b"v" * 4096), "vsr.safetensors", "image-vsr")
            source = Path(directory) / "photo.png"; source.write_bytes(b"png")
            output = Path(directory) / "photo-2x.png"
            commands: list[list[str]] = []
            def fake_run(command, **_kwargs):
                commands.append(command); output.write_bytes(b"result")
                return subprocess.CompletedProcess(command, 0, "ok", "")
            with mock.patch.object(adapter, "capabilities", return_value={"usable": True}), mock.patch.object(adapter, "_run", side_effect=fake_run):
                adapter.process_image(source, output, {"mode": "native-2x", "neuralModel": neural["id"], "imageSrModel": vsr["id"]})
            self.assertIn("--model", commands[0])
            self.assertIn("--vsr-weights", commands[0])
            self.assertTrue(output.is_file())

    def test_cancel_terminates_even_when_child_is_silent(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            started = time.monotonic()
            with self.assertRaises(InterruptedError):
                adapter._run([os.environ.get("PYTHON", os.sys.executable), "-c", "import time; time.sleep(10)"], cancelled=lambda: time.monotonic() - started > .2)
            self.assertLess(time.monotonic() - started, 3)

    def test_uninstall_refuses_an_unscoped_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "unsafe")
            with self.assertRaises(MlxDlssError): adapter.uninstall()

    def test_cli_probe_accepts_real_upstream_usage_but_not_other_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            adapter.cli.parent.mkdir(parents=True)
            adapter.cli.write_text("#!/bin/sh\necho 'error: usage error: expected process-video, process-image, preview-stream, inspect' >&2\nexit 2\n")
            adapter.cli.chmod(0o755)
            (adapter.cli.parent / "mlx.metallib").write_bytes(b"compiled")
            adapter._verify_cli(adapter.cli)
            adapter.cli.write_text("#!/bin/sh\necho 'error: GPU unavailable' >&2\nexit 2\n")
            with self.assertRaisesRegex(MlxDlssError, "protocollo previsto"):
                adapter._verify_cli(adapter.cli)

    def test_install_error_survives_adapter_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "backends" / "mlx-dlss"
            adapter = MlxDlssAdapter(root)
            adapter._set_install("error", 0, "Installazione non riuscita", error="Compiler failed")
            self.assertEqual(MlxDlssAdapter(root).install_status()["error"], "Compiler failed")

    def test_failed_verification_preserves_build_for_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = MlxDlssAdapter(Path(directory) / "backends" / "mlx-dlss")
            def run(command, **kwargs):
                if command[:2] == ["bash", "scripts/build-native-app.sh"]:
                    cli = kwargs["cwd"] / ".build/release/mlxdlss"
                    cli.parent.mkdir(parents=True)
                    cli.write_bytes(b"built")
                return subprocess.CompletedProcess(command, 0, "revision", "")
            with mock.patch("tools.mlx_dlss_runtime.adapter.detect_support", return_value={}), mock.patch.object(adapter, "_run", side_effect=run), mock.patch.object(adapter, "_verify_cli", side_effect=MlxDlssError("verification failed")):
                adapter._install_worker()
            status = adapter.install_status()
            self.assertEqual(status["phase"], "error")
            self.assertTrue((Path(status["recoveryPath"]) / "source/.build/release/mlxdlss").is_file())


if __name__ == "__main__":
    unittest.main()
