import json
import asyncio
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock
from pathlib import Path

from fastapi import HTTPException
from tools import upscaler_server
from tools.upscaler_server import (
    _frame_extraction_filter,
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
    def test_motion_filter_synthesises_frames_and_blend_stays_explicit(self) -> None:
        motion = minterpolate_filter(120, "motion")
        self.assertIn("mi_mode=mci", motion)
        self.assertIn("fps=120", motion)
        self.assertIn("aobmc", motion)
        self.assertEqual(minterpolate_filter(60, "blend"), "minterpolate=fps=60:mi_mode=blend")

    def test_expected_minterpolate_counts_include_the_two_frame_lookahead(self) -> None:
        self.assertEqual(expected_minterpolate_frame_count(60, 30, 48), 93)
        self.assertEqual(expected_minterpolate_frame_count(60, 30, 60), 117)
        self.assertEqual(expected_minterpolate_frame_count(60, 30, 90), 175)

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


if __name__ == "__main__":
    unittest.main()
