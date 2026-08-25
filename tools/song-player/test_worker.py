from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
from unittest import mock

SONG_PLAYER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SONG_PLAYER_DIR))

import audio_analysis
import worker


class YoutubeValidationTests(unittest.TestCase):
    def test_accepts_direct_https_watch_short_and_shorts_urls(self):
        expected = "dQw4w9WgXcQ"
        for url in (
            f"https://www.youtube.com/watch?v={expected}",
            f"https://youtu.be/{expected}?t=12",
            f"https://m.youtube.com/shorts/{expected}",
        ):
            self.assertEqual(worker.validate_youtube_url(url)[1], expected)

    def test_fails_closed_for_hosts_protocols_playlist_live_and_generic_fields(self):
        invalid = (
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "https://www.youtube.com/results?search_query=music",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=best",
            "https://user@www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com:invalid/watch?v=dQw4w9WgXcQ",
        )
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(worker.WorkerError):
                worker.validate_youtube_url(url)

    def test_protocol_rejects_unknown_flags(self):
        with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
            worker.validate_request(
                {
                    "protocolVersion": 1,
                    "action": "download",
                    "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ",
                    "jobRoot": "/tmp/job",
                    "libraryRoot": "/tmp/library",
                    "flags": ["--exec", "anything"],
                }
            )

    def test_match_request_uses_paths_without_hash_fields(self):
        request = {
            "protocolVersion": 1,
            "action": "match",
            "referencePath": "/tmp/full.wav",
            "targetPath": "/tmp/fragment.wav",
            "fragmentHash": "a" * 64,
        }
        with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
            worker.validate_request(request)

    def test_vocal_separation_request_is_strict_and_dispatches_only_that_action(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary) / "job"
            job.mkdir()
            request = {
                "protocolVersion": 1,
                "action": "separateVocals",
                "inputPath": "/music/full.wav",
                "jobRoot": str(job),
            }
            self.assertEqual(worker.validate_request(request)[0], "separateVocals")
            with mock.patch.object(worker, "separate_vocals", return_value={"kind": "separateVocals", "pitch": []}) as separate:
                self.assertEqual(worker.dispatch(request), {"kind": "separateVocals", "pitch": []})
                separate.assert_called_once_with(request)
            with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
                worker.validate_request({**request, "referencePath": "/music/mix.wav"})


class MusicalContextTests(unittest.TestCase):
    def test_removes_html_coverage_namespace_that_breaks_numba(self):
        with tempfile.TemporaryDirectory() as temporary:
            report = Path(temporary) / "coverage"
            report.mkdir()
            self.assertNotIn(temporary, worker.remove_coverage_namespace_shadows([temporary, "/safe/path"]))
            (report / "__init__.py").write_text("", encoding="utf-8")
            self.assertIn(temporary, worker.remove_coverage_namespace_shadows([temporary, "/safe/path"]))

    def test_musical_metadata_failure_does_not_discard_vocal_separation(self):
        with mock.patch.object(worker, "analyze_musical_context", side_effect=RuntimeError("chroma failed")):
            analysis, error = worker.optional_musical_context(Path("/audio.wav"), object(), object())
        self.assertIsNone(analysis)
        self.assertEqual(error, "chroma failed")

    def test_identifies_a_major_from_a_real_chroma_profile(self):
        chroma = [worker.MAJOR_KEY_PROFILE[(note - 9) % 12] for note in range(12)]
        result = worker.estimate_key_from_chroma(chroma)
        self.assertEqual(result["keyRoot"], 9)
        self.assertEqual(result["keyMode"], "major")
        self.assertGreater(result["keyConfidence"], 0.5)

    def test_rejects_an_empty_chromagram_instead_of_inventing_a_key(self):
        with self.assertRaisesRegex(worker.WorkerError, "cromagramma"):
            worker.estimate_key_from_chroma([0.0] * 12)


class FakeYoutubeDL:
    options = None

    def __init__(self, options):
        type(self).options = options
        self.path = Path(options["outtmpl"].replace("%(ext)s", "webm"))

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def extract_info(self, url, download):
        self.path.write_bytes(b"mock audio")
        for hook in self.options["progress_hooks"]:
            hook({"status": "downloading", "downloaded_bytes": 5, "total_bytes": 10})
            hook({"status": "finished"})
        return {
            "id": "dQw4w9WgXcQ",
            "extractor_key": "Youtube",
            "live_status": "not_live",
            "ext": "webm",
            "title": "Provider title",
        }

    def prepare_filename(self, _info):
        return str(self.path)


class DownloadTests(unittest.TestCase):
    def test_download_is_mocked_confined_and_uses_no_shell(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / "job"
            library = root / "library"
            job.mkdir()
            library.mkdir()

            def fake_ffmpeg(_source, destination):
                destination.write_bytes(b"RIFFmock wav")

            metadata = {
                "durationSeconds": 10.0,
                "sampleRate": 44_100,
                "channels": 2,
                "codec": "pcm_s16le",
                "fileSize": 12,
            }
            stdout = io.StringIO()
            with (
                mock.patch.object(worker, "_load_yt_dlp", return_value=type("Ydl", (), {"YoutubeDL": FakeYoutubeDL})),
                mock.patch.object(worker, "_run_ffmpeg", side_effect=fake_ffmpeg),
                mock.patch.object(worker, "probe_media", return_value=metadata),
                contextlib.redirect_stdout(stdout),
            ):
                result = worker.dispatch(
                    {
                        "protocolVersion": 1,
                        "action": "download",
                        "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ",
                        "jobRoot": str(job),
                        "libraryRoot": str(library),
                    }
                )
            self.assertEqual(result["videoId"], "dQw4w9WgXcQ")
            self.assertEqual(result["title"], "Provider title")
            self.assertEqual(Path(result["path"]).parent, library.resolve())
            self.assertTrue(Path(result["path"]).is_file())
            self.assertTrue(FakeYoutubeDL.options["noplaylist"])
            self.assertEqual(FakeYoutubeDL.options["socket_timeout"], 30)
            self.assertIsNotNone(FakeYoutubeDL.options["match_filter"]({"is_live": True}))
            self.assertIsNotNone(FakeYoutubeDL.options["match_filter"]({"_type": "playlist"}))
            self.assertIsNone(FakeYoutubeDL.options["match_filter"]({"live_status": "not_live"}))
            self.assertNotIn("postprocessor_args", FakeYoutubeDL.options)
            self.assertFalse((job / "staging").exists())
            messages = [line for line in stdout.getvalue().splitlines() if line]
            self.assertGreaterEqual(len(messages), 3)

    def test_download_rejects_a_symlink_job_root(self):
        if not hasattr(Path, "symlink_to"):
            self.skipTest("symlinks unavailable")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "real"
            real.mkdir()
            link = root / "link"
            try:
                link.symlink_to(real, target_is_directory=True)
            except OSError:
                self.skipTest("symlinks unavailable")
            with self.assertRaises(worker.WorkerError):
                worker._validate_root(str(link), "Job root")


class MatchingHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
        except ImportError:
            raise unittest.SkipTest("NumPy non disponibile; integrazione DSP saltata")
        cls.np = np

    def _sequence(self, length=420, seed=7):
        rng = self.np.random.default_rng(seed)
        sequence = rng.random((length, 12), dtype=self.np.float32)
        sequence /= self.np.linalg.norm(sequence, axis=1, keepdims=True)
        return sequence

    def test_crop_gain_and_noise(self):
        rng = self.np.random.default_rng(9)
        reference = self._sequence()
        target = reference[120:250] * 1.8 + rng.normal(0, 0.015, (130, 12))
        target = self.np.clip(target, 0, None).astype(self.np.float32)
        target /= self.np.linalg.norm(target, axis=1, keepdims=True)
        result = audio_analysis.match_chroma(reference, target)
        self.assertAlmostEqual(result["offsetSeconds"], 120 * audio_analysis.HOP_SIZE / audio_analysis.SAMPLE_RATE, delta=0.1)
        self.assertEqual(result["status"], "matched")

    def test_repeated_audio_is_manual_friendly_and_unrelated_is_rejected(self):
        motif = self._sequence(length=60)
        repeated = self.np.tile(motif, (6, 1))
        ambiguous = audio_analysis.match_chroma(repeated, motif)
        self.assertEqual(ambiguous["status"], "ambiguous")
        self.assertTrue(ambiguous["needsManualReview"])
        unrelated = audio_analysis.match_chroma(self._sequence(seed=10), self._sequence(length=130, seed=99))
        self.assertEqual(unrelated["status"], "unrelated")
        self.assertTrue(unrelated["needsManualReview"])

    def test_fragment_longer_than_full_track_is_rejected_without_sequence_swap(self):
        with self.assertRaisesRegex(audio_analysis.AnalysisError, "durata almeno pari"):
            audio_analysis.match_chroma(self._sequence(length=100), self._sequence(length=130))

    def _write_wav(self, path, samples):
        pcm = self.np.clip(samples * 32767, -32768, 32767).astype("<i2")
        with wave.open(str(path), "wb") as destination:
            destination.setnchannels(1)
            destination.setsampwidth(2)
            destination.setframerate(audio_analysis.SAMPLE_RATE)
            destination.writeframes(pcm.tobytes())

    def test_ffmpeg_stft_fixture_matches_a_noisy_gained_crop(self):
        sample_rate = audio_analysis.SAMPLE_RATE
        segment_samples = sample_rate // 2
        note_rng = self.np.random.default_rng(314)
        note_steps = note_rng.integers(0, 24, size=(28, 2))
        segments = []
        for index in range(28):
            frequency = 165.0 * 2.0 ** (float(note_steps[index, 0]) / 12.0)
            companion = 165.0 * 2.0 ** (float(note_steps[index, 1]) / 12.0)
            time = self.np.arange(segment_samples, dtype=self.np.float32) / sample_rate
            envelope = self.np.hanning(segment_samples).astype(self.np.float32)
            tone = (
                self.np.sin(2 * self.np.pi * frequency * time)
                + 0.43 * self.np.sin(2 * self.np.pi * companion * time)
                + 0.25 * self.np.sin(4 * self.np.pi * frequency * time)
            )
            segments.append((tone * envelope * 0.45).astype(self.np.float32))
        reference = self.np.concatenate(segments)
        crop_start_seconds = 3.0
        crop = reference[int(crop_start_seconds * sample_rate) : int(9.0 * sample_rate)].copy()
        crop = crop * 0.55 + self.np.random.default_rng(42).normal(0, 0.004, crop.shape)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference_path = root / "reference.wav"
            crop_path = root / "crop.wav"
            self._write_wav(reference_path, reference)
            self._write_wav(crop_path, crop)
            result = audio_analysis.match_files(str(reference_path), str(crop_path))
        self.assertAlmostEqual(result["offsetSeconds"], crop_start_seconds, delta=0.25)
        self.assertEqual(result["status"], "matched")
        self.assertGreater(result["confidence"], 0.55)


class JsonlProtocolTests(unittest.TestCase):
    def test_subprocess_is_one_shot_and_returns_versioned_jsonl(self):
        completed = subprocess.run(
            [sys.executable, str(SONG_PLAYER_DIR / "worker.py")],
            input=(
                b'{"protocolVersion":1,"action":"capabilities"}\n'
                b'{"protocolVersion":1,"action":"capabilities"}\n'
            ),
            capture_output=True,
            check=False,
            timeout=10,
        )
        self.assertEqual(completed.returncode, 2)
        messages = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual(messages[-1]["protocolVersion"], 1)
        self.assertEqual(messages[-1]["type"], "error")
        self.assertEqual(messages[-1]["error"]["code"], "multiple_requests")


class ChildProcessCancellationTests(unittest.TestCase):
    def tearDown(self):
        audio_analysis.clear_cancellation()

    def test_tracked_processes_are_reaped_on_worker_cancellation(self):
        outcome = []

        def run_child():
            try:
                audio_analysis.run_process(
                    [sys.executable, "-c", "import time; time.sleep(30)"], timeout=60
                )
            except audio_analysis.ProcessCancelled:
                outcome.append("cancelled")

        thread = threading.Thread(target=run_child)
        thread.start()
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            with audio_analysis._PROCESS_LOCK:
                if audio_analysis._ACTIVE_PROCESSES:
                    break
            time.sleep(0.01)
        audio_analysis.request_cancellation()
        thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(outcome, ["cancelled"])
        with audio_analysis._PROCESS_LOCK:
            self.assertFalse(audio_analysis._ACTIVE_PROCESSES)


if __name__ == "__main__":
    unittest.main()
