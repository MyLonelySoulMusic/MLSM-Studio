import json
import asyncio
import hashlib
import inspect
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest import mock
from pathlib import Path

import cv2
import numpy as np

from fastapi import HTTPException
from tools import upscaler_server
from tools.upscaler_server import (
    _frame_extraction_filter,
    _interpolation_media_audit,
    _resolve_interpolation_rates,
    _rotation_value,
    _stream_upload_limited,
    _terminate_subprocess,
    _wait_for_interpolation_process,
    expected_minterpolate_frame_count,
    minterpolate_filter,
    parse_ffprobe_geometry,
    validate_interpolation_audit,
)


class FfprobeGeometryTests(unittest.TestCase):
    def test_remote_video_preflight_returns_partial_availability_without_upload(self) -> None:
        expected = {
            "ok": True,
            "reachableEndpoints": ["https://ready.gradio.live"],
            "failures": [{"url": "https://offline.gradio.live", "error": "HTTP 404"}],
        }
        with mock.patch.object(upscaler_server, "inspect_video_chunk_endpoints", return_value=expected) as inspect_endpoints:
            result = upscaler_server.remote_video_endpoint_preflight({
                "endpoints": ["https://ready.gradio.live", "https://offline.gradio.live"],
                "model": "x4", "segmentFrames": 300,
            })
        self.assertEqual(result, expected)
        inspect_endpoints.assert_called_once_with(
            ["https://ready.gradio.live", "https://offline.gradio.live"],
            "x4", chunk_frames=300, output_fps=None,
        )

    def test_upscaler_cpu_budget_leaves_the_machine_responsive(self) -> None:
        self.assertEqual(upscaler_server.resolve_upscaler_cpu_threads(None, 10), 3)
        self.assertEqual(upscaler_server.resolve_upscaler_cpu_threads(None, 64), 4)
        self.assertEqual(upscaler_server.resolve_upscaler_cpu_threads("2", 64), 2)
        self.assertEqual(upscaler_server.resolve_upscaler_cpu_threads("invalid", 8), 2)
        prefix = upscaler_server.upscaler_ffmpeg_prefix("ffmpeg")
        self.assertEqual(prefix[-2:], ["-filter_threads", str(upscaler_server.UPSCALER_CPU_THREADS)])
        self.assertEqual(
            upscaler_server.upscaler_ffmpeg_codec_threads(),
            ["-threads", str(upscaler_server.UPSCALER_CPU_THREADS)],
        )

    def test_frame_count_probe_uses_the_same_cpu_budget(self) -> None:
        with mock.patch.object(upscaler_server, "ffprobe_binary", return_value="ffprobe"), mock.patch.object(
            upscaler_server.subprocess, "run",
            return_value=subprocess.CompletedProcess([], 0, stdout=b"42\n", stderr=b""),
        ) as run:
            self.assertEqual(upscaler_server.encoded_video_frame_count(Path("video.mp4")), 42)
        command = run.call_args.args[0]
        self.assertEqual(
            command[1:3], ["-threads", str(upscaler_server.UPSCALER_CPU_THREADS)]
        )

    def test_cancellable_ffmpeg_is_stopped_instead_of_burning_cpu(self) -> None:
        class Process:
            returncode = None

            def __init__(self) -> None:
                self.terminated = False
                self.calls = 0

            def communicate(self, timeout=None):
                self.calls += 1
                if self.calls == 1:
                    raise subprocess.TimeoutExpired("ffmpeg", timeout)
                self.returncode = -15 if self.terminated else 0
                return b"", b""

            def terminate(self) -> None:
                self.terminated = True
                self.returncode = -15

            def kill(self) -> None:
                self.terminated = True
                self.returncode = -9

            def poll(self):
                return self.returncode

            def wait(self, timeout=None):
                return self.returncode

        process = Process()
        checks = iter((False, True))
        with mock.patch.object(upscaler_server.subprocess, "Popen", return_value=process):
            with self.assertRaises(InterruptedError):
                upscaler_server.run_checked(["ffmpeg"], cancelled=lambda: next(checks))
        self.assertTrue(process.terminated)

    def test_frame_extraction_preserves_source_cadence_unless_fps_is_explicit(self) -> None:
        self.assertEqual(_frame_extraction_filter(), "scale=trunc(iw*sar/2)*2:ih,setsar=1")
        self.assertEqual(_frame_extraction_filter(59.94), "fps=59.94,scale=trunc(iw*sar/2)*2:ih,setsar=1")

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg non disponibile")
    def test_default_extraction_keeps_all_50fps_frames_and_explicit_fps_resamples(self) -> None:
        binary = str(shutil.which("ffmpeg"))
        with tempfile.TemporaryDirectory(prefix="mlsm-upscale-fps-") as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            original = root / "original"
            converted = root / "converted"
            original.mkdir(); converted.mkdir()
            subprocess.run([
                binary, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                "testsrc2=size=32x24:rate=50:duration=1", "-frames:v", "50",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, capture_output=True)
            for target, fps in ((original, None), (converted, 20.0)):
                subprocess.run([
                    binary, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                    "-vf", _frame_extraction_filter(fps), "-vsync", "0", str(target / "frame-%08d.png"),
                ], check=True, capture_output=True)
            self.assertEqual(len(list(original.glob("frame-*.png"))), 50)
            self.assertEqual(len(list(converted.glob("frame-*.png"))), 20)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe non disponibili")
    def test_remote_segmentation_streams_all_frames_without_png_extraction(self) -> None:
        binary = str(shutil.which("ffmpeg"))
        with tempfile.TemporaryDirectory(prefix="mlsm-upscale-direct-segments-") as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            progress: list[tuple[int, int, int]] = []
            subprocess.run([
                binary, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                "testsrc2=size=64x36:rate=50:duration=1", "-frames:v", "50",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, capture_output=True)
            total, fps, duration = upscaler_server.probe_video_timeline(source)
            chunks = upscaler_server.build_remote_video_segments_from_source(
                source, total, fps, root, chunk_frames=20,
                on_progress=lambda *value: progress.append(value),
            )
            self.assertEqual(total, 50)
            self.assertAlmostEqual(fps, 50, places=3)
            self.assertGreater(duration, 0)
            self.assertEqual([count for _, count in chunks], [20, 20, 10])
            self.assertEqual(
                [upscaler_server.encoded_video_frame_count(path) for path, _ in chunks],
                [20, 20, 10],
            )
            self.assertFalse((root / "original-frames").exists())
            self.assertEqual(progress[-1], (3, 3, 50))
            converted = root / "converted"; converted.mkdir()
            converted_total, converted_fps, _ = upscaler_server.probe_video_timeline(source, 20)
            converted_chunks = upscaler_server.build_remote_video_segments_from_source(
                source, converted_total, converted_fps, converted,
                chunk_frames=8, output_fps=20,
            )
            self.assertEqual(converted_total, 20)
            self.assertEqual([count for _, count in converted_chunks], [8, 8, 4])

    def test_displaymatrix_only_positive_quarter_turn(self) -> None:
        stream = {
            "side_data_list": [{
                "displaymatrix": (
                    "00000000:            0       65536           0\n"
                    "00000001:       -65536           0           0\n"
                    "00000002:            0           0  1073741824"
                )
            }]
        }

        self.assertEqual(_rotation_value(stream), 90)

    def test_displaymatrix_only_negative_quarter_turn(self) -> None:
        stream = {
            "side_data_list": [{
                "displaymatrix": (
                    "00000000:            0      -65536           0\n"
                    "00000001:        65536           0           0\n"
                    "00000002:            0           0  1073741824"
                )
            }]
        }

        self.assertEqual(_rotation_value(stream), 270)

    def test_explicit_rotation_remains_supported(self) -> None:
        stream = {"side_data_list": [{"rotation": -90.0}]}

        self.assertEqual(_rotation_value(stream), 270)

    def test_displaymatrix_quarter_turn_swaps_display_aspect_ratio(self) -> None:
        geometry = parse_ffprobe_geometry({
            "streams": [{
                "width": 1920,
                "height": 1080,
                "sample_aspect_ratio": "1:1",
                "side_data_list": [{
                    "displaymatrix": (
                        "00000000:            0      -65536           0\n"
                        "00000001:        65536           0           0\n"
                        "00000002:            0           0  1073741824"
                    )
                }],
            }]
        })

        self.assertEqual(geometry["display_width"], 1080)
        self.assertEqual(geometry["display_height"], 1920)
        self.assertAlmostEqual(float(geometry["display_aspect_ratio"]), 9 / 16)

    def test_interpolation_audit_reports_display_geometry_for_rotated_phone_video(self) -> None:
        payload = {"streams": [{
            "codec_type": "video", "width": 1920, "height": 1080,
            "sample_aspect_ratio": "1:1", "avg_frame_rate": "30/1",
            "nb_read_frames": "60", "duration": "2.0",
            "side_data_list": [{"rotation": -90}],
        }], "format": {"duration": "2.0"}}
        completed = subprocess.CompletedProcess(["ffprobe"], 0, stdout=json.dumps(payload).encode(), stderr=b"")
        with mock.patch.object(upscaler_server, "ffprobe_binary", return_value="ffprobe"), mock.patch.object(upscaler_server.subprocess, "run", return_value=completed):
            audit = _interpolation_media_audit(Path("phone.mov"))
        self.assertEqual((audit["width"], audit["height"]), (1080, 1920))
        self.assertEqual((audit["codedWidth"], audit["codedHeight"]), (1920, 1080))
        self.assertEqual(audit["rotation"], 270)
        self.assertAlmostEqual(float(audit["displayAspectRatio"]), 9 / 16)

    def test_fast_interpolation_audit_reads_declared_frames_without_scanning(self) -> None:
        payload = {"streams": [{
            "codec_type": "video", "width": 720, "height": 1280,
            "avg_frame_rate": "30000/1001", "nb_frames": "241", "duration": "8.0417",
        }], "format": {"duration": "8.0417"}}
        completed = subprocess.CompletedProcess(["ffprobe"], 0, stdout=json.dumps(payload).encode(), stderr=b"")
        with mock.patch.object(upscaler_server, "ffprobe_binary", return_value="ffprobe"), mock.patch.object(upscaler_server.subprocess, "run", return_value=completed) as run:
            audit = _interpolation_media_audit(Path("base.mp4"), count_frames=False)
        self.assertNotIn("-count_frames", run.call_args.args[0])
        self.assertEqual(audit["frameCount"], 241)
        self.assertAlmostEqual(float(audit["fps"]), 30000 / 1001)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe non disponibili")
    def test_extraction_uses_post_autorotation_sample_aspect_ratio(self) -> None:
        ffmpeg = str(shutil.which("ffmpeg"))
        ffprobe = str(shutil.which("ffprobe"))
        with tempfile.TemporaryDirectory(prefix="mlsm-rotation-test-") as temporary:
            root = Path(temporary)
            base = root / "anamorphic.mp4"
            rotated = root / "rotated.mp4"
            frame = root / "frame.png"
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                "testsrc2=size=160x90:rate=1", "-frames:v", "1", "-vf", "setsar=4/3",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(base),
            ], check=True, capture_output=True)
            rotation = subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-display_rotation:v:0", "90",
                "-i", str(base), "-c", "copy", str(rotated),
            ], check=False, capture_output=True)
            if rotation.returncode != 0:
                self.skipTest("questa versione di ffmpeg non supporta -display_rotation")
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(rotated),
                "-vf", _frame_extraction_filter(), "-frames:v", "1", "-update", "1", str(frame),
            ], check=True, capture_output=True)
            probe = subprocess.run([
                ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height,sample_aspect_ratio", "-of", "json", str(frame),
            ], check=True, capture_output=True)
            stream = json.loads(probe.stdout)["streams"][0]

        # Autorotation turns the 4:3 SAR into 3:4. The filter must therefore
        # produce trunc(90 * 3/4 / 2) * 2 = 66 square-pixel columns, not 120.
        self.assertEqual((stream["width"], stream["height"]), (66, 160))
        self.assertEqual(stream["sample_aspect_ratio"], "1:1")


class InterpolationJobTests(unittest.TestCase):
    def test_frame_booster_health_never_depends_on_rife(self) -> None:
        with mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="/usr/bin/ffmpeg"), mock.patch.object(
            upscaler_server, "get_rife_capabilities", side_effect=RuntimeError("checksum RIFE non valido")
        ) as rife:
            result = upscaler_server.interpolation_health()
        self.assertTrue(result["interpolation"]["ffmpeg"])
        self.assertTrue(result["interpolation"]["jobs"])
        self.assertNotIn("rife", result["interpolation"])
        rife.assert_not_called()

    def test_general_health_degrades_only_rife_when_its_runtime_is_broken(self) -> None:
        with mock.patch.dict(upscaler_server.os.environ, {"MLSM_UPSCALER_PARENT_PID": "4321", "MLSM_UPSCALER_OWNER_KIND": "tauri"}), mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="/usr/bin/ffmpeg"), mock.patch.object(
            upscaler_server, "get_rife_capabilities", side_effect=RuntimeError("checksum RIFE non valido")
        ), mock.patch.object(upscaler_server, "hardware", return_value={"mps": False, "cuda": False, "recommendedBackend": "cpu", "gpuName": "CPU"}):
            result = upscaler_server.health()
        self.assertEqual(result["apiVersion"], 7)
        self.assertTrue(result["capabilities"]["remoteVideoPartialEndpointPreflight"])
        self.assertTrue(result["capabilities"]["canvasVideoStreaming"])
        self.assertEqual(result["ownerKind"], "tauri")
        self.assertEqual(result["parentPid"], 4321)
        self.assertEqual(result["pid"], upscaler_server.os.getpid())
        self.assertTrue(result["interpolation"]["ffmpeg"])
        self.assertFalse(result["interpolation"]["rife"]["ready"])
        self.assertIn("checksum", result["interpolation"]["rife"]["reason"])

    class CancelOnFirstPollProcess:
        """Small Popen fixture that requests cancellation while being polled."""

        pid = 9182

        def __init__(self, job_id: str) -> None:
            self.job_id = job_id
            self.alive = True
            self.terminated = False
            self.stdout = None
            self.stderr = None
            self.poll_count = 0

        def poll(self):
            self.poll_count += 1
            if self.poll_count == 1:
                with upscaler_server.interpolation_job_lock:
                    upscaler_server.interpolation_jobs[self.job_id]["cancelRequested"] = True
            return None if self.alive else -15

        def wait(self, timeout=None):
            return self.poll()

        def terminate(self) -> None:
            self.terminated = True
            self.alive = False

        def kill(self) -> None:
            self.terminated = True
            self.alive = False

    def _with_cancellable_job(self, job_id: str = "interpolation-runner-cancel") -> None:
        with upscaler_server.interpolation_job_lock:
            upscaler_server.interpolation_jobs[job_id] = {
                "id": job_id, "phase": "interpolating", "cancelRequested": False,
            }

    def _remove_job(self, job_id: str) -> None:
        with upscaler_server.interpolation_job_lock:
            upscaler_server.interpolation_jobs.pop(job_id, None)
            upscaler_server.interpolation_processes.pop(job_id, None)

    def test_job_runner_cancels_ffprobe_probe_and_cleans_registry(self) -> None:
        job_id = "interpolation-probe-cancel"
        process = self.CancelOnFirstPollProcess(job_id)
        self._with_cancellable_job(job_id)
        try:
            with mock.patch.object(upscaler_server, "ffprobe_binary", return_value="ffprobe"), mock.patch.object(upscaler_server.subprocess, "Popen", return_value=process):
                with self.assertRaises(InterruptedError):
                    upscaler_server._interpolation_probe(Path("source.mp4"), job_id)
            self.assertTrue(process.terminated)
            with upscaler_server.interpolation_job_lock:
                self.assertNotIn(job_id, upscaler_server.interpolation_processes)
        finally:
            self._remove_job(job_id)

    def test_job_runner_cancels_all_ffmpeg_methods_without_live_process(self) -> None:
        for method in ("motion", "motion-obmc", "blend"):
            job_id = f"interpolation-{method}-cancel"
            process = self.CancelOnFirstPollProcess(job_id)
            self._with_cancellable_job(job_id)
            try:
                with mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="ffmpeg"), mock.patch.object(upscaler_server.subprocess, "Popen", return_value=process):
                    with self.assertRaises(InterruptedError):
                        upscaler_server._run_ffmpeg_interpolation_job(
                            job_id, Path("source.mp4"), Path("output.mp4"),
                            60, method, 120, 30, 2,
                        )
                self.assertTrue(process.terminated)
                with upscaler_server.interpolation_job_lock:
                    self.assertNotIn(job_id, upscaler_server.interpolation_processes)
            finally:
                self._remove_job(job_id)

    def test_job_runner_cancels_media_audit_without_live_process(self) -> None:
        job_id = "interpolation-audit-cancel"
        process = self.CancelOnFirstPollProcess(job_id)
        self._with_cancellable_job(job_id)
        try:
            with mock.patch.object(upscaler_server, "ffprobe_binary", return_value="ffprobe"), mock.patch.object(upscaler_server.subprocess, "Popen", return_value=process):
                with self.assertRaises(InterruptedError):
                    upscaler_server._interpolation_media_audit(Path("output.mp4"), job_id)
            self.assertTrue(process.terminated)
            with upscaler_server.interpolation_job_lock:
                self.assertNotIn(job_id, upscaler_server.interpolation_processes)
        finally:
            self._remove_job(job_id)

    def test_job_runner_cancels_audio_remux_and_removes_partial_temp(self) -> None:
        job_id = "interpolation-remux-cancel"
        process = self.CancelOnFirstPollProcess(job_id)
        self._with_cancellable_job(job_id)
        with tempfile.TemporaryDirectory(prefix="mlsm-remux-cancel-") as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            destination = root / "destination.mp4"
            source.write_bytes(b"source")
            destination.write_bytes(b"video")
            temporary_result = destination.with_suffix(".audio-remux.mp4")
            try:
                with mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="ffmpeg"), mock.patch.object(upscaler_server.subprocess, "Popen", return_value=process):
                    with self.assertRaises(InterruptedError):
                        upscaler_server._remux_interpolation_audio(source, destination, job_id)
                self.assertTrue(process.terminated)
                self.assertFalse(temporary_result.exists())
                with upscaler_server.interpolation_job_lock:
                    self.assertNotIn(job_id, upscaler_server.interpolation_processes)
            finally:
                self._remove_job(job_id)

    def test_job_runner_terminates_when_cancel_arrives_during_wait(self) -> None:
        job_id = "interpolation-wait-cancel"
        self._with_cancellable_job(job_id)
        wait_started = threading.Event()

        class WaitingProcess:
            pid = 7211

            def __init__(self) -> None:
                self.alive = True
                self.terminated = False
                self.stdout = None
                self.stderr = None

            def poll(self):
                return None if self.alive else -15

            def wait(self, timeout=None):
                wait_started.set()
                # Simulate a blocking wait that returns its timeout while the
                # DELETE request races in another thread.
                time.sleep(.01)
                if self.alive:
                    raise subprocess.TimeoutExpired("ffprobe", timeout)
                return -15

            def terminate(self) -> None:
                self.terminated = True
                self.alive = False

            def kill(self) -> None:
                self.terminated = True
                self.alive = False

        process = WaitingProcess()

        def cancel_during_wait() -> None:
            self.assertTrue(wait_started.wait(timeout=1))
            with upscaler_server.interpolation_job_lock:
                upscaler_server.interpolation_jobs[job_id]["cancelRequested"] = True

        canceller = threading.Thread(target=cancel_during_wait)
        canceller.start()
        try:
            with mock.patch.object(upscaler_server.subprocess, "Popen", return_value=process):
                with self.assertRaises(InterruptedError):
                    upscaler_server._run_interpolation_subprocess(job_id, ["ffprobe", "source.mp4"])
            canceller.join(timeout=1)
            self.assertFalse(canceller.is_alive())
            self.assertTrue(process.terminated)
            with upscaler_server.interpolation_job_lock:
                self.assertNotIn(job_id, upscaler_server.interpolation_processes)
        finally:
            self._remove_job(job_id)

    def test_multiplier_rates_are_derived_from_authoritative_probe(self) -> None:
        source, target = _resolve_interpolation_rates(
            probed_source_fps=30000 / 1001,
            declared_source_fps=30,
            target_fps=None,
            target_multiplier=2,
        )
        self.assertAlmostEqual(source, 30000 / 1001)
        self.assertAlmostEqual(target, 60000 / 1001)

    def test_motion_filters_synthesise_frames_and_blend_stays_explicit(self) -> None:
        motion = minterpolate_filter(120, "motion")
        self.assertIn("mi_mode=mci", motion)
        self.assertIn("fps=120", motion)
        self.assertIn("aobmc", motion)
        self.assertEqual(
            minterpolate_filter(60, "motion-obmc"),
            "minterpolate=fps=60:mi_mode=mci:mc_mode=obmc:me_mode=bidir",
        )
        self.assertEqual(minterpolate_filter(60, "blend"), "minterpolate=fps=60:mi_mode=blend")
        complete = upscaler_server.complete_minterpolate_filter(60, "blend", 30)
        self.assertEqual(complete, "tpad=stop_mode=clone:stop_duration=0.0666666666667,minterpolate=fps=60:mi_mode=blend")

    def test_expected_minterpolate_counts_include_the_two_frame_lookahead(self) -> None:
        self.assertEqual(expected_minterpolate_frame_count(60, 30, 48), 93)
        self.assertEqual(expected_minterpolate_frame_count(60, 30, 60), 117)
        self.assertEqual(expected_minterpolate_frame_count(60, 30, 90), 175)
        self.assertEqual(upscaler_server.complete_interpolation_frame_count(6, 6, 1, 12), 12)

    def test_result_download_keeps_verified_artifact_available_for_desktop_save(self) -> None:
        job_id = "interpolation-ready-save"
        with tempfile.TemporaryDirectory(prefix="mlsm-interpolation-result-") as temporary:
            result = Path(temporary) / "interpolated.mp4"
            result.write_bytes(b"verified-video")
            with upscaler_server.interpolation_job_lock:
                upscaler_server.interpolation_jobs[job_id] = {
                    "id": job_id, "phase": "ready", "resultPath": str(result),
                }
            try:
                response = upscaler_server.interpolation_job_result(job_id)
                self.assertIsNone(response.background)
                self.assertTrue(result.exists())
                with upscaler_server.interpolation_job_lock:
                    self.assertIn(job_id, upscaler_server.interpolation_jobs)
            finally:
                self._remove_job(job_id)

    def test_audit_accepts_small_filter_tolerance_but_rejects_half_outputs(self) -> None:
        validate_interpolation_audit(
            source_frames=60, source_fps=30, source_duration=2,
            output_frames=116, output_fps=60, output_duration=117 / 60,
            target_fps=60,
        )
        with self.assertRaisesRegex(RuntimeError, "Conteggio interpolato incompleto"):
            validate_interpolation_audit(
                source_frames=60, source_fps=30, source_duration=2,
                output_frames=61, output_fps=60, output_duration=1.02,
                target_fps=60,
            )
        with self.assertRaisesRegex(RuntimeError, "Conteggio interpolato incompleto"):
            validate_interpolation_audit(
                source_frames=4149, source_fps=30, source_duration=138.3,
                output_frames=4150, output_fps=60, output_duration=69.2,
                target_fps=60,
            )

    def test_audit_rejects_wrong_target_rate_and_truncated_duration(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Frame rate interpolato non valido"):
            validate_interpolation_audit(
                source_frames=60, source_fps=30, source_duration=2,
                output_frames=117, output_fps=30, output_duration=1.95,
                target_fps=60,
            )
        with self.assertRaisesRegex(RuntimeError, "Durata interpolata troncata"):
            validate_interpolation_audit(
                source_frames=60, source_fps=30, source_duration=2,
                output_frames=117, output_fps=60, output_duration=.98,
                target_fps=60,
            )
        with self.assertRaisesRegex(RuntimeError, "Durata interpolata troncata rispetto alla sorgente"):
            validate_interpolation_audit(
                source_frames=6, source_fps=6, source_duration=1,
                output_frames=9, output_fps=12, output_duration=.75,
                target_fps=12,
            )

    def test_streaming_upload_stops_before_writing_beyond_the_limit(self) -> None:
        class Upload:
            def __init__(self) -> None:
                self.chunks = [b"1234", b"5678"]

            async def read(self, _size: int) -> bytes:
                return self.chunks.pop(0) if self.chunks else b""

        with tempfile.TemporaryDirectory() as workspace:
            destination = Path(workspace) / "partial.mp4"
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(_stream_upload_limited(Upload(), destination, max_bytes=6))  # type: ignore[arg-type]
            self.assertEqual(raised.exception.status_code, 413)
            self.assertFalse(destination.exists())

    def test_termination_escalates_from_terminate_to_kill(self) -> None:
        class StubbornProcess:
            def __init__(self) -> None:
                self.calls: list[str] = []
                self.alive = True

            def poll(self):
                return None if self.alive else -9

            def terminate(self) -> None:
                self.calls.append("terminate")

            def wait(self, timeout=None):
                self.calls.append("wait")
                if self.alive:
                    raise subprocess.TimeoutExpired("rife", timeout)
                return -9

            def kill(self) -> None:
                self.calls.append("kill")
                self.alive = False

        process = StubbornProcess()
        _terminate_subprocess(process, grace_seconds=0)  # type: ignore[arg-type]
        self.assertEqual(process.calls[:3], ["terminate", "wait", "kill"])
        self.assertFalse(process.alive)

    def test_timeout_terminates_the_isolated_worker(self) -> None:
        class WaitingProcess:
            def __init__(self) -> None:
                self.terminated = False

            def poll(self):
                return -15 if self.terminated else None

            def terminate(self) -> None:
                self.terminated = True

            def wait(self, timeout=None):
                return -15

            def kill(self) -> None:
                self.terminated = True

        process = WaitingProcess()
        with self.assertRaises(TimeoutError):
            _wait_for_interpolation_process(process, timeout_seconds=0)  # type: ignore[arg-type]
        self.assertTrue(process.terminated)

    def test_delete_terminates_the_registered_worker(self) -> None:
        class RunningProcess:
            def __init__(self) -> None:
                self.terminated = False

            def poll(self):
                return -15 if self.terminated else None

            def terminate(self) -> None:
                self.terminated = True

            def wait(self, timeout=None):
                return -15

            def kill(self) -> None:
                self.terminated = True

        process = RunningProcess()
        job_id = "interpolation-delete-test"
        with upscaler_server.interpolation_job_lock:
            upscaler_server.interpolation_jobs[job_id] = {"id": job_id, "phase": "interpolating", "cancelRequested": False}
            upscaler_server.interpolation_processes[job_id] = process  # type: ignore[assignment]
        try:
            response = upscaler_server.cancel_interpolation_job(job_id)
            self.assertTrue(response["cancelRequested"])
            self.assertTrue(process.terminated)
        finally:
            with upscaler_server.interpolation_job_lock:
                upscaler_server.interpolation_jobs.pop(job_id, None)
                upscaler_server.interpolation_processes.pop(job_id, None)

    def test_rife_command_is_an_isolated_worker_entrypoint(self) -> None:
        with mock.patch.object(upscaler_server, "device_from", return_value="cpu"):
            command = upscaler_server._rife_worker_command(Path("source.mp4"), Path("result.mp4"), 60)
        self.assertEqual(command[1:3], [str(Path(upscaler_server.__file__).resolve()), "--rife-worker"])

    def test_isolated_rife_uses_the_explicitly_validated_device(self) -> None:
        class FinishedProcess:
            pid = 42

            def poll(self): return 0
            def wait(self, timeout=None): return 0
            def terminate(self): raise AssertionError("finished process must not be terminated")
            def kill(self): raise AssertionError("finished process must not be killed")

        with tempfile.TemporaryDirectory(prefix="mlsm-rife-device-") as temporary:
            destination = Path(temporary) / "result.mp4"
            destination.write_bytes(b"video")
            with mock.patch.object(upscaler_server, "validate_rife_request", return_value={"device": "cuda", "precision": "fp16"}), mock.patch.object(upscaler_server, "_rife_worker_command", return_value=["worker"]) as worker_command, mock.patch.object(upscaler_server.subprocess, "Popen", return_value=FinishedProcess()):
                backend = upscaler_server._run_isolated_rife(Path("source.mp4"), destination, 60, device="auto", precision="auto")
        worker_command.assert_called_once_with(Path("source.mp4"), destination, 60, "cuda", "fp16", "rife-v4.26")
        self.assertEqual(backend, "rife · cuda/fp16")


class RemoteVideoJobPersistenceTests(unittest.TestCase):
    def test_remote_cancel_releases_admission_immediately_and_cannot_be_resurrected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-cancel-admission-") as temporary:
            root = Path(temporary) / "remote-video-jobs"; root.mkdir()
            workspace = root / "active-job"; workspace.mkdir()
            record = {
                "id": "active-job", "remote": True, "phase": "upscaling",
                "phaseLabel": "Gradio in corso", "tempDirectory": str(workspace),
                "cancelRequested": False, "cancelled": False, "manifestRevision": 0,
            }
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear(); upscaler_server.video_jobs["active-job"] = record
            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root):
                    cancelled = upscaler_server.cancel_video_upscale_job("active-job")
                    self.assertEqual(cancelled["phase"], "cancelled")
                    self.assertEqual(upscaler_server.active_video_upscale_jobs(), {"jobs": []})
                    upscaler_server.update_video_job(
                        "active-job", phase="upscaling", phaseLabel="risposta Gradio tardiva",
                        currentFrame=100,
                    )
                    current = upscaler_server.video_upscale_job_status("active-job")
                self.assertEqual(current["phase"], "cancelled")
                self.assertNotIn("currentFrame", current)
                self.assertEqual(json.loads((workspace / "job.json").read_text(encoding="utf-8"))["phase"], "cancelled")
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear(); upscaler_server.video_jobs.update(previous_jobs)

    @staticmethod
    def _create_remote_video_job(file, *, client_id: str, checkpoint_policy: str):
        return upscaler_server.create_video_upscale_job(
            file=file,
            model="canvas",
            backend="auto",
            tile=256,
            width=128,
            height=72,
            tta=False,
            quality="maximum",
            client_id=client_id,
            preserve_aspect_ratio=True,
            remote_config=json.dumps({
                "endpoints": ["https://colab.gradio.live"],
                "model": "remote-x4",
                "retries": 2,
            }),
            adjustments="{}",
            checkpoint_policy=checkpoint_policy,
        )

    def test_remote_checkpoint_reuse_requires_explicit_resume_and_identical_bytes(self) -> None:
        first_bytes = b"video-one"
        same_bytes = bytes(first_bytes)
        different_same_size_bytes = b"video-two"
        first_hash = hashlib.sha256(first_bytes).hexdigest()
        same_hash = hashlib.sha256(same_bytes).hexdigest()
        different_hash = hashlib.sha256(different_same_size_bytes).hexdigest()
        item = {
            "id": "cached-job",
            "remote": True,
            "phase": "error",
            "sourceHash": first_hash,
            "model": "remote-x4",
            "completedFrames": 20,
        }

        self.assertEqual(len(first_bytes), len(different_same_size_bytes))
        self.assertEqual(first_hash, same_hash)
        self.assertNotEqual(first_hash, different_hash)
        self.assertIs(
            upscaler_server.select_remote_video_job_candidate(
                [item], source_hash=same_hash, model="remote-x4",
                render_settings={}, checkpoint_policy="resume",
            ),
            item,
        )
        self.assertIsNone(upscaler_server.select_remote_video_job_candidate(
            [item], source_hash=same_hash, model="remote-x4",
            render_settings={}, checkpoint_policy="restart",
        ))
        self.assertIsNone(upscaler_server.select_remote_video_job_candidate(
            [item], source_hash=different_hash, model="remote-x4",
            render_settings={}, checkpoint_policy="resume",
        ))

    def test_video_route_defaults_to_restart_and_rejects_unknown_policy(self) -> None:
        parameter = inspect.signature(upscaler_server.create_video_upscale_job).parameters["checkpoint_policy"]
        self.assertEqual(parameter.default.default, "restart")
        self.assertEqual(upscaler_server.normalize_remote_checkpoint_policy(" RESUME "), "resume")
        with self.assertRaisesRegex(ValueError, "resume.*restart"):
            upscaler_server.normalize_remote_checkpoint_policy("automatic")

    def test_remote_checkpoint_identity_includes_chunk_size_and_explicit_fps(self) -> None:
        item = {
            "remote": True, "phase": "error", "sourceHash": "same", "model": "x4",
            "remoteChunkFrames": 300, "remoteOutputFps": 60,
        }
        matching = json.dumps({"segmentFrames": 300, "outputFps": 60}, sort_keys=True, separators=(",", ":"))
        original_fps = json.dumps({"segmentFrames": 300, "outputFps": None}, sort_keys=True, separators=(",", ":"))
        self.assertTrue(upscaler_server.remote_video_job_checkpoint_matches(
            item, source_hash="same", model="x4", processing_key=matching
        ))
        self.assertFalse(upscaler_server.remote_video_job_checkpoint_matches(
            item, source_hash="same", model="x4", processing_key=original_fps
        ))

    def test_reuse_prefers_a_verified_ready_artifact_over_newer_failed_checkpoints(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-ready-reuse-") as temporary:
            result = Path(temporary) / "upscaled-video.mp4"
            result.write_bytes(b"verified")
            ready = {"phase": "ready", "resultPath": str(result), "completedFrames": 30, "manifestRevision": 2}
            failed = {"phase": "error", "completedFrames": 30, "manifestRevision": 999}
            self.assertGreater(upscaler_server.remote_video_job_reuse_rank(ready), upscaler_server.remote_video_job_reuse_rank(failed))

    def test_resolution_change_reuses_remote_ai_checkpoints(self) -> None:
        item = {
            "id": "nearly-complete",
            "remote": True,
            "phase": "error",
            "sourceHash": "same-video",
            "model": "RealESRGAN_x4plus_anime_6B",
            "requestedWidth": 720,
            "requestedHeight": 1280,
            "width": 720,
            "height": 1280,
            "preserveAspectRatio": True,
            "quality": "maximum",
            "adjustmentsKey": "old",
            "currentFrame": 359,
            "completedFrames": 359,
            "totalFrames": 361,
        }
        render_settings = {
            "requestedWidth": 2160,
            "requestedHeight": 3840,
            "width": 2160,
            "height": 3840,
            "preserveAspectRatio": True,
            "quality": "maximum",
            "adjustments": {"sharpness": 12.0},
            "adjustmentsKey": "new",
            "backend": "auto",
            "tile": 256,
            "tta": False,
        }

        self.assertTrue(upscaler_server.remote_video_job_checkpoint_matches(
            item,
            source_hash="same-video",
            model="RealESRGAN_x4plus_anime_6B",
        ))
        should_resume = upscaler_server.prepare_remote_video_job_reuse(
            item,
            render_settings=render_settings,
            endpoints=["https://new.gradio.live"],
            retries=3,
            client_id="new-client",
        )

        self.assertTrue(should_resume)
        self.assertEqual(item["phase"], "queued")
        self.assertEqual(item["phaseLabel"], "Ripresa dai frame AI salvati")
        self.assertEqual(item["completedFrames"], 359)
        self.assertEqual(item["requestedWidth"], 2160)
        self.assertEqual(item["requestedHeight"], 3840)
        self.assertEqual(item["remoteEndpoints"], ["https://new.gradio.live"])

    def test_reuse_prefers_359_old_size_frames_over_13_new_size_frames(self) -> None:
        render_settings = {"requestedWidth": 2160, "requestedHeight": 3840}
        nearly_complete_old_size = {
            "phase": "error",
            "completedFrames": 359,
            "manifestRevision": 20,
            "requestedWidth": 720,
            "requestedHeight": 1280,
        }
        barely_started_new_size = {
            "phase": "cancelled",
            "completedFrames": 13,
            "manifestRevision": 30,
            **render_settings,
        }

        self.assertGreater(
            upscaler_server.remote_video_job_candidate_rank(
                nearly_complete_old_size, render_settings
            ),
            upscaler_server.remote_video_job_candidate_rank(
                barely_started_new_size, render_settings
            ),
        )

    def test_exact_ready_remote_render_is_returned_without_processing(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-ready-render-") as temporary:
            result = Path(temporary) / "upscaled-video.mp4"
            result.write_bytes(b"verified")
            render_settings = {
                "requestedWidth": 2160,
                "requestedHeight": 3840,
                "adjustmentsKey": "same",
            }
            item = {
                "remote": True,
                "phase": "ready",
                "resultPath": str(result),
                **render_settings,
            }

            should_resume = upscaler_server.prepare_remote_video_job_reuse(
                item,
                render_settings=render_settings,
                endpoints=["https://new.gradio.live"],
                retries=2,
                client_id="new-client",
            )

        self.assertFalse(should_resume)
        self.assertEqual(item["phase"], "ready")
        self.assertEqual(item["resultPath"], str(result))

    def test_result_response_does_not_delete_before_native_save_can_copy(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-result-retention-") as temporary:
            result = Path(temporary) / "upscaled-video.mp4"; result.write_bytes(b"video")
            with upscaler_server.video_job_lock:
                upscaler_server.video_jobs["ready-local"] = {"id": "ready-local", "phase": "ready", "remote": False, "resultPath": str(result)}
            try:
                response = upscaler_server.video_upscale_job_result("ready-local")
                self.assertIsNone(response.background)
                self.assertTrue(result.exists())
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.pop("ready-local", None)

    def test_adjustments_are_validated_and_change_real_pixels(self) -> None:
        parsed = upscaler_server.parse_upscaler_adjustments(json.dumps({"exposure": 1, "contrast": 25, "saturation": -30, "sharpness": 40}))
        source = np.full((8, 8, 3), 80, dtype=np.uint8)
        output = upscaler_server.apply_upscaler_adjustments(source, parsed)
        self.assertEqual(output.shape, source.shape)
        self.assertGreater(float(output.mean()), float(source.mean()))
        with self.assertRaises(ValueError):
            upscaler_server.parse_upscaler_adjustments('{"exposure":"bright"}')

    def test_video_adjustments_require_explicit_opt_in(self) -> None:
        legacy = {"adjustments": {"sharpness": 40}}
        self.assertTrue(upscaler_server.video_adjustments_are_neutral(
            upscaler_server.effective_video_adjustments(legacy)
        ))
        enabled = {"applyVideoAdjustments": True, "adjustments": {"sharpness": 40}}
        self.assertFalse(upscaler_server.video_adjustments_are_neutral(
            upscaler_server.effective_video_adjustments(enabled)
        ))

    def test_ffmpeg_progress_timestamp_is_parsed(self) -> None:
        self.assertAlmostEqual(upscaler_server._ffmpeg_timestamp_seconds("00:01:02.500000"), 62.5)
        self.assertIsNone(upscaler_server._ffmpeg_timestamp_seconds("not-a-time"))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe non disponibili")
    def test_matching_remote_segments_are_stream_copied_with_original_audio(self) -> None:
        ffmpeg = str(shutil.which("ffmpeg"))
        with tempfile.TemporaryDirectory(prefix="mlsm-fast-segment-join-") as temporary:
            workspace = Path(temporary)
            source = workspace / "source.mp4"
            result = workspace / "upscaled-video.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=30:duration=1",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, capture_output=True)
            job_id = "fast-join"
            job = {
                "id": job_id, "tempDirectory": str(workspace), "width": 64, "height": 36,
                "quality": "maximum", "remote": True, "remoteChunkFrames": 30,
                "applyVideoAdjustments": False, "adjustments": {"sharpness": 80},
                "cancelRequested": False,
            }
            with upscaler_server.video_job_lock:
                upscaler_server.video_jobs[job_id] = dict(job)
            try:
                with mock.patch.object(
                    upscaler_server, "run_checked_with_progress",
                    wraps=upscaler_server.run_checked_with_progress,
                ) as run:
                    upscaler_server.process_remote_segment_video_job(
                        job_id, job, source, [(source, 30)], result, ffmpeg,
                        total=30, fps=30, expected_duration=1, started=time.monotonic(),
                    )
                command = run.call_args.args[0]
                self.assertEqual(command[command.index("-c:v") + 1], "copy")
                self.assertNotIn("-vf", command)
                status = upscaler_server.video_upscale_job_status(job_id)
                self.assertEqual(status["phase"], "ready")
                self.assertGreater(status["audioPacketCount"], 0)
                self.assertEqual(status["encodedFrameCount"], 30)
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.pop(job_id, None)

    def test_canvas_processing_mode_canonicalises_model_and_false_remote_strings(self) -> None:
        self.assertEqual(
            upscaler_server.video_processing_mode({"model": " canvas ", "remote": False}),
            upscaler_server.CANVAS_VIDEO_PROCESSING_MODE,
        )
        self.assertEqual(
            upscaler_server.video_processing_mode({"model": "CANVAS", "remote": "false"}),
            upscaler_server.CANVAS_VIDEO_PROCESSING_MODE,
        )
        self.assertEqual(
            upscaler_server.video_processing_mode({"model": "canvas", "remote": True}),
            upscaler_server.REMOTE_VIDEO_PROCESSING_MODE,
        )
        self.assertEqual(
            upscaler_server.video_processing_mode({"model": "RealESRGAN_x4plus", "remote": False}),
            upscaler_server.LOCAL_AI_VIDEO_PROCESSING_MODE,
        )

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe non disponibili")
    def test_canvas_video_uses_streaming_ffmpeg_without_png_frames(self) -> None:
        ffmpeg = str(shutil.which("ffmpeg"))
        with tempfile.TemporaryDirectory(prefix="mlsm-canvas-stream-") as temporary:
            workspace = Path(temporary) / "canvas-job"; workspace.mkdir()
            source = workspace / "source.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=30:duration=0.4",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.4",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, capture_output=True)
            job = {
                "id": "canvas-stream", "phase": "queued", "phaseLabel": "Job in coda", "progress": 0,
                "currentFrame": 0, "totalFrames": 0, "tempDirectory": str(workspace),
                "sourcePath": str(source), "model": "canvas", "backend": "auto", "tile": 256,
                "width": 96, "height": 54, "tta": False, "quality": "high",
                "adjustments": upscaler_server.parse_upscaler_adjustments('{"contrast":12,"saturation":8}'),
                "cancelRequested": False, "cancelled": False, "remote": False,
            }
            with upscaler_server.video_job_lock:
                upscaler_server.video_jobs["canvas-stream"] = job
            try:
                upscaler_server.process_video_upscale_job("canvas-stream")
                status = upscaler_server.video_upscale_job_status("canvas-stream")
                self.assertEqual(status["phase"], "ready")
                self.assertEqual(status["encodedFrameCount"], 12)
                self.assertEqual(status["currentFrame"], 12)
                self.assertTrue(status["audioRestored"])
                self.assertGreater(status["audioPacketCount"], 0)
                self.assertEqual(status["processingMode"], upscaler_server.CANVAS_VIDEO_PROCESSING_MODE)
                self.assertEqual(status["frameStorageMode"], "none")
                self.assertEqual(status["originalFramesDirectory"], "")
                self.assertEqual(status["upscaledFramesDirectory"], "")
                self.assertTrue(Path(status["resultPath"]).is_file())
                self.assertFalse((workspace / "original-frames").exists())
                self.assertFalse((workspace / "upscaled-frames").exists())
                self.assertFalse(list(workspace.rglob("frame-*.png")))
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.pop("canvas-stream", None)

    def test_remote_manifest_restores_an_interrupted_job_as_resumable(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-job-") as temporary:
            root = Path(temporary)
            workspace = root / "job-one"
            record = {
                "id": "job-one", "remote": True, "phase": "upscaling", "phaseLabel": "Frame 4/10",
                "tempDirectory": str(workspace), "sourcePath": str(workspace / "source.mp4"),
                "originalFramesDirectory": str(workspace / "original-frames"), "upscaledFramesDirectory": str(workspace / "upscaled-frames"),
                "currentFrame": 4, "totalFrames": 10, "cancelRequested": False,
                "activeEndpoints": ["https://stale.gradio.live"], "activeEndpoint": "https://stale.gradio.live",
                "endpointActivity": [{"url": "https://stale.gradio.live", "state": "busy"}],
            }
            with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root):
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs["job-one"] = record
                upscaler_server.persist_remote_video_job(record)
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.pop("job-one", None)
                upscaler_server.restore_remote_video_jobs()
                with upscaler_server.video_job_lock:
                    restored = dict(upscaler_server.video_jobs.pop("job-one"))
            self.assertEqual(restored["phase"], "error")
            self.assertTrue(restored["resumable"])
            self.assertEqual(restored["currentFrame"], 4)
            self.assertEqual(restored["activeEndpoints"], [])
            self.assertEqual(restored["endpointActivity"], [])
            self.assertIsNone(restored["activeEndpoint"])

    def test_remote_cache_clear_deletes_terminal_jobs_and_orphans_but_keeps_root(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-cache-clear-") as temporary:
            root = Path(temporary) / "remote-video-jobs"
            root.mkdir()
            first = root / "first-job"; first.mkdir(); (first / "job.json").write_bytes(b"manifest")
            orphan = root / "orphan-job"; orphan.mkdir(); (orphan / "frame.png").write_bytes(b"frame")
            expected_bytes = len(b"manifest") + len(b"frame")
            records = {
                "first-job": {"id": "first-job", "remote": True, "phase": "ready", "tempDirectory": str(first)},
                "missing-job": {"id": "missing-job", "remote": True, "phase": "error", "tempDirectory": str(root / "missing-job")},
            }
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs.update(records)
            with upscaler_server.remote_manifest_lock:
                previous_revisions = dict(upscaler_server.remote_manifest_written_revision)
                previous_writes = dict(upscaler_server.remote_manifest_last_write)
                upscaler_server.remote_manifest_written_revision.update({"first-job": 4, "missing-job": 2, "unrelated": 8})
                upscaler_server.remote_manifest_last_write.update({"first-job": 1.0, "missing-job": 1.0, "unrelated": 1.0})
            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(upscaler_server, "log_upscaler_event"):
                    before = upscaler_server.remote_video_cache_status()
                    result = upscaler_server.clear_remote_video_cache()
                self.assertEqual(before["jobs"], 2)
                self.assertEqual(before["entries"], 2)
                self.assertEqual(before["bytes"], expected_bytes)
                self.assertEqual(result["removedJobs"], 2)
                self.assertEqual(result["deletedEntries"], 2)
                self.assertEqual(result["removedBytes"], expected_bytes)
                self.assertTrue(root.is_dir())
                self.assertEqual(list(root.iterdir()), [])
                with upscaler_server.video_job_lock:
                    self.assertNotIn("first-job", upscaler_server.video_jobs)
                    self.assertNotIn("missing-job", upscaler_server.video_jobs)
                with upscaler_server.remote_manifest_lock:
                    self.assertNotIn("first-job", upscaler_server.remote_manifest_written_revision)
                    self.assertNotIn("missing-job", upscaler_server.remote_manifest_written_revision)
                    self.assertEqual(upscaler_server.remote_manifest_written_revision["unrelated"], 8)
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)
                with upscaler_server.remote_manifest_lock:
                    upscaler_server.remote_manifest_written_revision.clear()
                    upscaler_server.remote_manifest_written_revision.update(previous_revisions)
                    upscaler_server.remote_manifest_last_write.clear()
                    upscaler_server.remote_manifest_last_write.update(previous_writes)

    def test_local_temp_cache_can_be_cleared_while_idle_service_stays_online(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-local-cache-clear-") as temporary:
            root = Path(temporary) / "upscaler"
            root.mkdir()
            workspace = root / "finished-job"
            workspace.mkdir()
            (workspace / "result.mp4").write_bytes(b"video")
            (root / "orphan.tmp").write_bytes(b"old")
            record = {"id": "finished-job", "remote": False, "phase": "ready", "tempDirectory": str(workspace)}
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs["finished-job"] = record
            with upscaler_server.interpolation_job_lock:
                previous_interpolation = dict(upscaler_server.interpolation_jobs)
                upscaler_server.interpolation_jobs.clear()
            try:
                with mock.patch.object(upscaler_server, "VIDEO_TEMP_ROOT", root), mock.patch.object(upscaler_server, "log_upscaler_event"):
                    result = upscaler_server.clear_local_video_temp_cache()
                self.assertEqual(result["removedBytes"], 8)
                self.assertTrue(root.is_dir())
                self.assertEqual(list(root.iterdir()), [])
                with upscaler_server.video_job_lock:
                    self.assertNotIn("finished-job", upscaler_server.video_jobs)
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)
                with upscaler_server.interpolation_job_lock:
                    upscaler_server.interpolation_jobs.clear()
                    upscaler_server.interpolation_jobs.update(previous_interpolation)

    def test_local_temp_cache_refuses_an_active_frame_booster_job(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-local-cache-active-") as temporary:
            root = Path(temporary) / "upscaler"
            root.mkdir()
            artifact = root / "active.mp4"
            artifact.write_bytes(b"keep")
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
            with upscaler_server.interpolation_job_lock:
                previous_interpolation = dict(upscaler_server.interpolation_jobs)
                upscaler_server.interpolation_jobs.clear()
                upscaler_server.interpolation_jobs["active"] = {"id": "active", "phase": "interpolating"}
            try:
                with mock.patch.object(upscaler_server, "VIDEO_TEMP_ROOT", root):
                    with self.assertRaises(HTTPException) as raised:
                        upscaler_server.clear_local_video_temp_cache()
                self.assertEqual(raised.exception.status_code, 409)
                self.assertTrue(artifact.is_file())
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)
                with upscaler_server.interpolation_job_lock:
                    upscaler_server.interpolation_jobs.clear()
                    upscaler_server.interpolation_jobs.update(previous_interpolation)

    def test_model_cache_clear_drops_loaded_models_and_preserves_root(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-model-cache-clear-") as temporary:
            root = Path(temporary) / "models"
            root.mkdir()
            (root / "weights.pth").write_bytes(b"model")
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
            with upscaler_server.interpolation_job_lock:
                previous_interpolation = dict(upscaler_server.interpolation_jobs)
                upscaler_server.interpolation_jobs.clear()
            with upscaler_server.lock:
                previous_status = dict(upscaler_server.status)
                previous_loaded = dict(upscaler_server.loaded)
                upscaler_server.status.clear()
                upscaler_server.loaded.clear()
                upscaler_server.loaded[("model", "cpu", 0)] = object()
            try:
                with mock.patch.object(upscaler_server, "CACHE", root), mock.patch.object(upscaler_server.torch.cuda, "is_available", return_value=False):
                    result = upscaler_server.clear_upscaler_model_cache()
                self.assertEqual(result["removedBytes"], 5)
                self.assertTrue(root.is_dir())
                self.assertEqual(list(root.iterdir()), [])
                self.assertEqual(upscaler_server.loaded, {})
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)
                with upscaler_server.interpolation_job_lock:
                    upscaler_server.interpolation_jobs.clear()
                    upscaler_server.interpolation_jobs.update(previous_interpolation)
                with upscaler_server.lock:
                    upscaler_server.status.clear()
                    upscaler_server.status.update(previous_status)
                    upscaler_server.loaded.clear()
                    upscaler_server.loaded.update(previous_loaded)

    def test_stale_manifest_writer_cannot_recreate_cache_after_clear(self) -> None:
        class GateLock:
            def __init__(self) -> None:
                self.inner = threading.Lock()
                self.writer_waiting = threading.Event()
                self.release_writer = threading.Event()

            def __enter__(self):
                if threading.current_thread().name == "stale-manifest-writer":
                    self.writer_waiting.set()
                    if not self.release_writer.wait(timeout=2):
                        raise TimeoutError("writer non rilasciato dal test")
                self.inner.acquire()
                return self

            def __exit__(self, _type, _value, _traceback) -> None:
                self.inner.release()

        with tempfile.TemporaryDirectory(prefix="mlsm-stale-manifest-") as temporary:
            root = Path(temporary) / "remote-video-jobs"; root.mkdir()
            workspace = root / "terminal-job"; workspace.mkdir(); (workspace / "result.mp4").write_bytes(b"video")
            record = {
                "id": "terminal-job", "remote": True, "phase": "ready",
                "tempDirectory": str(workspace), "manifestRevision": 7,
            }
            snapshot = dict(record)
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs["terminal-job"] = record
            with upscaler_server.remote_manifest_lock:
                previous_revisions = dict(upscaler_server.remote_manifest_written_revision)
                previous_writes = dict(upscaler_server.remote_manifest_last_write)
                upscaler_server.remote_manifest_written_revision.clear()
                upscaler_server.remote_manifest_last_write.clear()
            gate = GateLock()
            writer_errors: list[BaseException] = []

            def stale_writer() -> None:
                try:
                    upscaler_server.persist_remote_video_job(snapshot)
                except BaseException as error:
                    writer_errors.append(error)

            writer = threading.Thread(target=stale_writer, name="stale-manifest-writer")
            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(upscaler_server, "video_job_lock", gate), mock.patch.object(upscaler_server, "log_upscaler_event"):
                    writer.start()
                    self.assertTrue(gate.writer_waiting.wait(timeout=1))
                    result = upscaler_server.clear_remote_video_cache()
                    self.assertEqual(result["removedJobs"], 1)
                    self.assertEqual(list(root.iterdir()), [])
                    gate.release_writer.set()
                    writer.join(timeout=2)
                self.assertFalse(writer.is_alive())
                self.assertEqual(writer_errors, [])
                self.assertEqual(list(root.iterdir()), [])
                self.assertFalse((workspace / "job.json").exists())
            finally:
                gate.release_writer.set()
                writer.join(timeout=2)
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)
                with upscaler_server.remote_manifest_lock:
                    upscaler_server.remote_manifest_written_revision.clear()
                    upscaler_server.remote_manifest_written_revision.update(previous_revisions)
                    upscaler_server.remote_manifest_last_write.clear()
                    upscaler_server.remote_manifest_last_write.update(previous_writes)

    def test_remote_cache_clear_refuses_active_job_without_deleting_files(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-cache-active-") as temporary:
            root = Path(temporary) / "remote-video-jobs"; root.mkdir()
            workspace = root / "active-job"; workspace.mkdir(); source = workspace / "source.mp4"; source.write_bytes(b"video")
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs["active-job"] = {
                    "id": "active-job", "remote": True, "phase": "upscaling", "tempDirectory": str(workspace),
                }
            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root):
                    with self.assertRaises(HTTPException) as raised:
                        upscaler_server.clear_remote_video_cache()
                self.assertEqual(raised.exception.status_code, 409)
                self.assertTrue(source.is_file())
                with upscaler_server.video_job_lock:
                    self.assertIn("active-job", upscaler_server.video_jobs)
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)

    def test_remote_cache_clear_refuses_a_deferred_upload_and_client_cancel_cleans_it(self) -> None:
        class DeferredUpload:
            filename = "deferred.mp4"

            def __init__(self) -> None:
                self.started = asyncio.Event()
                self.release = asyncio.Event()
                self.sent = False
                self.closed = False

            async def read(self, _size: int) -> bytes:
                if self.sent:
                    return b""
                self.started.set()
                await self.release.wait()
                self.sent = True
                return b"deferred-video"

            async def close(self) -> None:
                self.closed = True

        with tempfile.TemporaryDirectory(prefix="mlsm-remote-cache-upload-") as temporary:
            root = Path(temporary) / "remote-video-jobs"; root.mkdir()
            upload = DeferredUpload()
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                previous_cancelled = dict(upscaler_server.cancelled_video_clients)
                upscaler_server.video_jobs.clear()
                upscaler_server.cancelled_video_clients.clear()

            async def scenario() -> None:
                task = asyncio.create_task(self._create_remote_video_job(
                    upload, client_id="deferred-client", checkpoint_policy="restart"
                ))
                await upload.started.wait()
                with self.assertRaises(HTTPException) as clear_error:
                    upscaler_server.clear_remote_video_cache()
                self.assertEqual(clear_error.exception.status_code, 409)
                status = upscaler_server.remote_video_cache_status()
                self.assertEqual(status["activeJobs"], 1)
                released = upscaler_server.release_video_upscale_client("deferred-client")
                self.assertEqual(len(released["released"]), 1)
                upload.release.set()
                with self.assertRaises(HTTPException) as upload_error:
                    await task
                self.assertEqual(upload_error.exception.status_code, 409)

            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(upscaler_server, "normalize_endpoint", side_effect=lambda value: value), mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="ffmpeg"), mock.patch.object(upscaler_server, "probe_video_geometry", return_value={"display_aspect_ratio": 16 / 9}), mock.patch.object(upscaler_server, "log_upscaler_event"):
                    asyncio.run(scenario())
                self.assertTrue(upload.closed)
                self.assertEqual(list(root.iterdir()), [])
                with upscaler_server.video_job_lock:
                    self.assertEqual(upscaler_server.video_jobs, {})
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)
                    upscaler_server.cancelled_video_clients.clear()
                    upscaler_server.cancelled_video_clients.update(previous_cancelled)

    def test_second_remote_video_is_rejected_before_upload_while_one_job_is_active(self) -> None:
        class NeverReadUpload:
            filename = "second.mp4"

            def __init__(self) -> None:
                self.read_called = False
                self.closed = False

            async def read(self, _size: int) -> bytes:
                self.read_called = True
                raise AssertionError("il secondo video non deve essere letto")

            async def close(self) -> None:
                self.closed = True

        with tempfile.TemporaryDirectory(prefix="mlsm-single-video-job-") as temporary:
            root = Path(temporary) / "remote-video-jobs"; root.mkdir()
            upload = NeverReadUpload()
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs["first-job"] = {
                    "id": "first-job", "remote": True, "phase": "extracting",
                    "tempDirectory": str(root / "first-job"),
                }
            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(
                    upscaler_server, "normalize_endpoint", side_effect=lambda value: value
                ), mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="ffmpeg"), mock.patch.object(
                    upscaler_server, "log_upscaler_event"
                ):
                    with self.assertRaises(HTTPException) as raised:
                        asyncio.run(self._create_remote_video_job(
                            upload, client_id="second-client", checkpoint_policy="restart"
                        ))
                self.assertEqual(raised.exception.status_code, 409)
                self.assertIn("già attivo", str(raised.exception.detail))
                self.assertFalse(upload.read_called)
                self.assertTrue(upload.closed)
                self.assertEqual(list(root.iterdir()), [])
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)

    def test_remote_upload_and_probe_failures_remove_placeholder_and_workspace(self) -> None:
        class Upload:
            filename = "broken.mp4"

            def __init__(self, *, fail_read: bool) -> None:
                self.fail_read = fail_read
                self.sent = False
                self.closed = False

            async def read(self, _size: int) -> bytes:
                if self.fail_read:
                    raise RuntimeError("upload interrotto")
                if self.sent:
                    return b""
                self.sent = True
                return b"invalid-video"

            async def close(self) -> None:
                self.closed = True

        with tempfile.TemporaryDirectory(prefix="mlsm-remote-upload-failures-") as temporary:
            base = Path(temporary)
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
            try:
                for failure in ("upload", "probe"):
                    with self.subTest(failure=failure):
                        root = base / failure; root.mkdir()
                        upload = Upload(fail_read=failure == "upload")
                        probe = RuntimeError("probe fallito") if failure == "probe" else {"display_aspect_ratio": 16 / 9}
                        with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(upscaler_server, "normalize_endpoint", side_effect=lambda value: value), mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="ffmpeg"), mock.patch.object(upscaler_server, "probe_video_geometry", side_effect=probe if isinstance(probe, Exception) else None, return_value=None if isinstance(probe, Exception) else probe), mock.patch.object(upscaler_server, "log_upscaler_event"):
                            if failure == "upload":
                                with self.assertRaisesRegex(RuntimeError, "upload interrotto"):
                                    asyncio.run(self._create_remote_video_job(upload, client_id=f"{failure}-client", checkpoint_policy="restart"))
                            else:
                                with self.assertRaises(HTTPException) as raised:
                                    asyncio.run(self._create_remote_video_job(upload, client_id=f"{failure}-client", checkpoint_policy="restart"))
                                self.assertEqual(raised.exception.status_code, 400)
                        self.assertTrue(upload.closed)
                        self.assertEqual(list(root.iterdir()), [])
                        with upscaler_server.video_job_lock:
                            self.assertEqual(upscaler_server.video_jobs, {})
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)

    def test_resume_replaces_upload_placeholder_without_a_cache_visibility_gap(self) -> None:
        class Upload:
            filename = "same.mp4"

            def __init__(self, content: bytes) -> None:
                self.content = content
                self.sent = False

            async def read(self, _size: int) -> bytes:
                if self.sent:
                    return b""
                self.sent = True
                return self.content

            async def close(self) -> None:
                return None

        content = b"same-video-content"
        digest = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-resume-upload-") as temporary:
            root = Path(temporary) / "remote-video-jobs"; root.mkdir()
            cached = root / "cached-job"; cached.mkdir(); (cached / "source.mp4").write_bytes(content)
            cached_record = {
                "id": "cached-job", "remote": True, "phase": "error",
                "tempDirectory": str(cached), "sourcePath": str(cached / "source.mp4"),
                "sourceHash": digest, "sourceName": "same.mp4", "sourceBytes": len(content),
                "model": "remote-x4", "currentFrame": 4, "completedFrames": 4,
                "requestedWidth": 128, "requestedHeight": 72,
            }
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs["cached-job"] = cached_record
            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(upscaler_server, "normalize_endpoint", side_effect=lambda value: value), mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="ffmpeg"), mock.patch.object(upscaler_server, "probe_video_geometry", return_value={"display_aspect_ratio": 16 / 9}), mock.patch.object(upscaler_server.threading, "Thread") as thread, mock.patch.object(upscaler_server, "log_upscaler_event"):
                    result = asyncio.run(self._create_remote_video_job(
                        Upload(content), client_id="resume-client", checkpoint_policy="resume"
                    ))
                self.assertEqual(result["id"], "cached-job")
                self.assertEqual(result["phase"], "queued")
                self.assertEqual(result["checkpointPolicy"], "resume")
                self.assertEqual([path.name for path in root.iterdir()], ["cached-job"])
                with upscaler_server.video_job_lock:
                    self.assertEqual(list(upscaler_server.video_jobs), ["cached-job"])
                thread.assert_called_once()
                thread.return_value.start.assert_called_once()
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)

    def test_cancel_between_probe_and_resume_selection_cannot_reset_the_cancellation(self) -> None:
        class Upload:
            filename = "same.mp4"

            def __init__(self, content: bytes) -> None:
                self.content = content
                self.sent = False

            async def read(self, _size: int) -> bytes:
                if self.sent:
                    return b""
                self.sent = True
                return self.content

            async def close(self) -> None:
                return None

        content = b"same-video-content"
        digest = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-late-cancel-") as temporary:
            root = Path(temporary) / "remote-video-jobs"; root.mkdir()
            cached = root / "cached-job"; cached.mkdir(); (cached / "source.mp4").write_bytes(content)
            cached_record = {
                "id": "cached-job", "remote": True, "phase": "error",
                "tempDirectory": str(cached), "sourcePath": str(cached / "source.mp4"),
                "sourceHash": digest, "sourceName": "same.mp4", "sourceBytes": len(content),
                "model": "remote-x4", "currentFrame": 4, "completedFrames": 4,
            }
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                previous_cancelled = dict(upscaler_server.cancelled_video_clients)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs["cached-job"] = cached_record
                upscaler_server.cancelled_video_clients.clear()

            def cancel_after_early_check(_source: str, event: str, **_details) -> None:
                if event == "upload-verified":
                    upscaler_server.release_video_upscale_client("late-cancel-client")

            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(upscaler_server, "normalize_endpoint", side_effect=lambda value: value), mock.patch.object(upscaler_server, "ffmpeg_binary", return_value="ffmpeg"), mock.patch.object(upscaler_server, "probe_video_geometry", return_value={"display_aspect_ratio": 16 / 9}), mock.patch.object(upscaler_server.threading, "Thread") as thread, mock.patch.object(upscaler_server, "log_upscaler_event", side_effect=cancel_after_early_check):
                    with self.assertRaises(HTTPException) as raised:
                        asyncio.run(self._create_remote_video_job(
                            Upload(content), client_id="late-cancel-client", checkpoint_policy="resume"
                        ))
                self.assertEqual(raised.exception.status_code, 409)
                self.assertEqual(cached_record["phase"], "error")
                self.assertEqual([path.name for path in root.iterdir()], ["cached-job"])
                with upscaler_server.video_job_lock:
                    self.assertEqual(list(upscaler_server.video_jobs), ["cached-job"])
                thread.assert_not_called()
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)
                    upscaler_server.cancelled_video_clients.clear()
                    upscaler_server.cancelled_video_clients.update(previous_cancelled)

    def test_remote_cache_clear_refuses_workspace_outside_root(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-cache-safety-") as temporary:
            base = Path(temporary); root = base / "remote-video-jobs"; root.mkdir()
            outside = base / "outside-job"; outside.mkdir(); protected = outside / "keep.txt"; protected.write_text("keep", encoding="utf-8")
            with upscaler_server.video_job_lock:
                previous_jobs = dict(upscaler_server.video_jobs)
                upscaler_server.video_jobs.clear()
                upscaler_server.video_jobs["outside-job"] = {
                    "id": "outside-job", "remote": True, "phase": "error", "tempDirectory": str(outside),
                }
            try:
                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root):
                    with self.assertRaises(HTTPException) as raised:
                        upscaler_server.clear_remote_video_cache()
                self.assertEqual(raised.exception.status_code, 409)
                self.assertTrue(protected.is_file())
                self.assertTrue(root.is_dir())
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.clear()
                    upscaler_server.video_jobs.update(previous_jobs)

    def test_remote_catalog_route_delegates_all_endpoints(self) -> None:
        expected = {"ok": True, "models": [{"name": "x4"}], "endpoints": []}
        with mock.patch.object(upscaler_server, "aggregate_catalog", return_value=expected) as aggregate:
            self.assertEqual(upscaler_server.remote_upscale_catalog({"endpoints": ["https://a.gradio.live", "https://b.gradio.live"]}), expected)
        aggregate.assert_called_once_with(["https://a.gradio.live", "https://b.gradio.live"])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe non disponibili")
    def test_colab_frames_are_reconstructed_with_audio_and_exposed_as_result(self) -> None:
        ffmpeg = str(shutil.which("ffmpeg"))
        with tempfile.TemporaryDirectory(prefix="mlsm-remote-reconstruct-") as temporary:
            root = Path(temporary); workspace = root / "job-colab"; workspace.mkdir()
            source = workspace / "source.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=30:duration=1",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.72", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", str(source),
            ], check=True, capture_output=True)
            job = {
                "id": "job-colab", "phase": "queued", "phaseLabel": "Job in coda", "progress": 0,
                "currentFrame": 0, "totalFrames": 0, "tempDirectory": str(workspace), "sourcePath": str(source),
                "originalFramesDirectory": str(workspace / "original-frames"), "upscaledFramesDirectory": str(workspace / "upscaled-frames"),
                "model": "remote-x2", "backend": "auto", "tile": 256, "width": 128, "height": 72, "tta": False,
                "quality": "high", "cancelRequested": False, "cancelled": False, "remote": True, "resumable": True,
                "error": "stale failure from a previous reconstruction",
                "remoteEndpoints": ["https://colab.gradio.live"], "remoteRetries": 1,
                "adjustments": upscaler_server.parse_upscaler_adjustments('{"contrast":20,"saturation":15}'),
            }
            with upscaler_server.video_job_lock:
                upscaler_server.video_jobs["job-colab"] = job

            try:
                def echo_chunk(_endpoint, payload, _model, expected_frames, output_fps=None, timeout=3600, on_progress=None):
                    if on_progress is not None:
                        on_progress({
                            "event": "progress", "state": "upscaling",
                            "completed_frames": expected_frames // 2,
                            "total_frames": expected_frames, "progress": .5,
                            "elapsed_seconds": 1, "estimated_remaining_seconds": 1,
                            "seconds_per_frame": 1 / max(1, expected_frames // 2),
                        })
                    return payload, {"frame_count": expected_frames}

                with mock.patch.object(upscaler_server, "REMOTE_VIDEO_ROOT", root), mock.patch.object(
                    upscaler_server, "validate_video_chunk_endpoints", return_value=["https://colab.gradio.live"]
                ), mock.patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), mock.patch(
                    "tools.remote_upscaler.upscale_video_chunk", side_effect=echo_chunk
                ):
                    upscaler_server.process_video_upscale_job("job-colab")
                    status = upscaler_server.video_upscale_job_status("job-colab")
                    response = upscaler_server.video_upscale_job_result("job-colab")
                self.assertEqual(status["phase"], "ready")
                self.assertIsNone(status["error"])
                self.assertEqual(status["currentFrame"], status["totalFrames"])
                self.assertEqual(status["encodedFrameCount"], status["totalFrames"])
                self.assertEqual(status["totalFrames"], 30)
                self.assertAlmostEqual(status["durationSeconds"], 1, delta=.05)
                self.assertTrue(status["audioRestored"])
                self.assertGreater(status["audioPacketCount"], 0)
                self.assertEqual(status["completedSegments"], 1)
                self.assertEqual(status["totalSegments"], 1)
                self.assertEqual(status["endpointActivity"][0]["segmentFrame"], 30)
                self.assertEqual(status["endpointActivity"][0]["segmentProgress"], 1)
                self.assertEqual(status["endpointActivity"][0]["segmentPhase"], "ready")
                self.assertTrue(Path(status["upscaledSegmentsDirectory"]).is_dir())
                self.assertEqual(Path(status["resultPath"]), response.path)
                self.assertGreater(Path(response.path).stat().st_size, 0)
                self.assertFalse(list(workspace.rglob("frame-*.png")))
                self.assertEqual(len(list((workspace / "upscaled-segments").glob("segment-*.mp4"))), 1)
            finally:
                with upscaler_server.video_job_lock:
                    upscaler_server.video_jobs.pop("job-colab", None)


if __name__ == "__main__":
    unittest.main()
