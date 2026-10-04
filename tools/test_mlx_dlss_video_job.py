import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from tools import upscaler_server as server


class MlxDlssVideoFinalizationTests(unittest.TestCase):
    def run_job(self, directory, *, policy="preserve", packets=20, offset=0, resize=False):
        source = Path(directory) / "original video.mp4"
        output = Path(directory) / "preview.mp4"
        replacement = Path(directory) / "replacement.wav"
        source.write_bytes(b"source")
        replacement.write_bytes(b"audio")
        job = {"width": 320, "height": 180, "sourceStartSeconds": offset, "sourceDurationSeconds": 3,
               "providerConfig": {"audioPolicy": policy, "codec": "h264"}, "replacementAudioPath": str(replacement)}

        def native(_source, target, _config, **_kwargs): target.write_bytes(b"native video")
        def mux(command, **_kwargs): Path(command[-1]).write_bytes(b"muxed video")

        geometry = {"width": 640 if resize else 320, "height": 360 if resize else 180,
                    "sample_aspect_ratio": "1:1", "rotation": 0}
        with mock.patch.object(server, "probe_video_timeline", return_value=(600, 60.0, 10.0)), \
             mock.patch.object(server.mlx_dlss, "process_video", side_effect=native) as process, \
             mock.patch.object(server, "video_job_cancelled", return_value=False), \
             mock.patch.object(server, "probe_video_geometry", return_value=geometry), \
             mock.patch.object(server, "audio_packet_count", side_effect=[packets, 0 if policy == "mute" or packets == 0 and policy != "replace" else 20]), \
             mock.patch.object(server, "encoded_video_frame_count", return_value=180), \
             mock.patch.object(server, "encoded_video_duration", return_value=3.0), \
             mock.patch.object(server, "update_video_job") as update, \
             mock.patch.object(server, "log_upscaler_event"), \
             mock.patch.object(server, "run_checked", side_effect=mux) as run:
            server.process_mlx_dlss_video_job("test", job, source, output, "ffmpeg", time.monotonic())
        return source, output, replacement, process, run, update

    def test_preview_is_native_video_only_then_muxed_with_original_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output, _, process, run, update = self.run_job(directory)
            self.assertEqual(process.call_args.args[2]["audioPolicy"], "mute")
            self.assertEqual(process.call_args.args[2]["frames"], 180)
            command = run.call_args.args[0]
            self.assertIn(str(source), command)
            self.assertEqual(command[command.index("-c:v") + 1], "copy")
            self.assertEqual(command[command.index("-c:a") + 1], "aac")
            self.assertEqual(command[command.index("-t") + 1], "3.0")
            self.assertNotIn("-shortest", command)
            self.assertTrue(output.is_file())
            self.assertEqual(update.call_args.kwargs["phase"], "ready")
            self.assertEqual(update.call_args.kwargs["progress"], 1)

    def test_audio_seek_matches_the_rounded_native_start_frame(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, _, process, run, _ = self.run_job(directory, offset=2.009)
            config = process.call_args.args[2]
            self.assertEqual(config["startFrame"], 121)
            command = run.call_args.args[0]
            self.assertEqual(float(command[command.index("-ss") + 1]), 121 / 60)

    def test_mute_and_silent_source_need_no_audio_mux(self):
        for policy, packets in [("mute", 20), ("preserve", 0)]:
            with self.subTest(policy=policy), tempfile.TemporaryDirectory() as directory:
                _, output, _, _, run, update = self.run_job(directory, policy=policy, packets=packets)
                run.assert_not_called()
                self.assertTrue(output.is_file())
                self.assertTrue(update.call_args.kwargs["audioRestored"])

    def test_replacement_audio_and_resize_share_one_finalization(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, replacement, process, run, _ = self.run_job(directory, policy="replace", resize=True)
            self.assertEqual(process.call_args.args[2]["audioPolicy"], "mute")
            run.assert_called_once()
            command = run.call_args.args[0]
            self.assertIn(str(replacement), command)
            self.assertIn("scale=320:180:flags=lanczos,setsar=1", command)

    @unittest.skipUnless(os.environ.get("MLSM_TEST_MLX_DLSS_REAL") == "1", "opt-in installed Metal model test")
    def test_real_three_second_preview_keeps_all_frames_and_audio(self):
        binary = shutil.which("ffmpeg")
        self.assertIsNotNone(binary)
        models = [item for item in server.mlx_dlss.list_models() if item["kind"] == "neural-rendering"]
        self.assertTrue(models, "Import a real Neural Rendering model before running this test")
        with tempfile.TemporaryDirectory(prefix="mlsm-dlss-preview-") as directory:
            source = Path(directory) / "source.mp4"
            output = Path(directory) / "preview.mp4"
            subprocess.run([binary, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=192x128:rate=60:duration=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source)], check=True, timeout=30)
            job = {"width": 192, "height": 128, "sourceStartSeconds": 1.0, "sourceDurationSeconds": 3.0,
                   "providerConfig": {"audioPolicy": "preserve", "codec": "h264", "mode": "enhance", "neuralModel": models[0]["id"], "qualityPreset": "preview"}}
            with mock.patch.object(server, "update_video_job") as update, mock.patch.object(server, "log_upscaler_event"):
                server.process_mlx_dlss_video_job("real-preview", job, source, output, binary, time.monotonic())
            self.assertEqual(server.encoded_video_frame_count(output), 180)
            self.assertAlmostEqual(server.encoded_video_duration(output), 3.0, delta=.05)
            self.assertGreater(server.audio_packet_count(output), 0)
            self.assertEqual(update.call_args.kwargs["phase"], "ready")
            self.assertEqual(update.call_args.kwargs["progress"], 1)


if __name__ == "__main__":
    unittest.main()
