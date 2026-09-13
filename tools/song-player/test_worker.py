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
                "startSeconds": 30.0,
                "endSeconds": 42.5,
            }
            self.assertEqual(worker.validate_request(request)[0], "separateVocals")
            with mock.patch.object(worker, "separate_vocals", return_value={"kind": "separateVocals", "pitch": []}) as separate:
                self.assertEqual(worker.dispatch(request), {"kind": "separateVocals", "pitch": []})
                separate.assert_called_once_with(request)
            with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
                worker.validate_request({**request, "referencePath": "/music/mix.wav"})

    def test_ffmpeg_audio_window_is_applied_before_decoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.wav"
            destination = Path(temporary) / "window.wav"
            source.write_bytes(b"source")
            completed = subprocess.CompletedProcess([], 0, b"", b"")
            with mock.patch.object(worker, "resolve_tool", return_value="/usr/bin/ffmpeg"), mock.patch.object(worker, "run_process", return_value=completed) as run:
                worker._run_ffmpeg(source, destination, 30.0, 42.5)
            command = run.call_args.args[0]
            self.assertEqual(command[command.index("-ss") + 1], "30.000000")
            self.assertEqual(command[command.index("-t") + 1], "12.500000")
            self.assertLess(command.index("-ss"), command.index("-i"))

    def test_alignment_refinement_request_is_strict_and_dispatches_only_that_action(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary) / "job"
            job.mkdir()
            request = {
                "protocolVersion": 1,
                "action": "refineAlignment",
                "sourcePath": "/music/source.wav",
                "targetPath": "/music/target.wav",
                "anchors": [{
                    "id": "word-1",
                    "cueIndex": 0,
                    "sourceStart": 1.0,
                    "sourceCenter": 1.1,
                    "sourceEnd": 1.2,
                    "targetStart": 1.02,
                    "targetCenter": 1.12,
                    "targetEnd": 1.22,
                    "maxShiftMs": 50,
                }],
                "jobRoot": str(job),
            }
            self.assertEqual(worker.validate_request(request)[0], "refineAlignment")
            expected = {"kind": "refineAlignment", "anchors": [], "algorithm": "mfcc-dtw-v1"}
            with mock.patch.object(worker, "refine_alignment", return_value=expected) as refine:
                self.assertEqual(worker.dispatch(request), expected)
                refine.assert_called_once_with(request)
            with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
                worker.validate_request({**request, "shellCommand": "anything"})

    def test_visual_speech_request_dispatches_only_the_pinned_auto_avsr_action(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary) / "job"
            job.mkdir()
            video = Path(temporary) / "source.mp4"
            video.write_bytes(b"video")
            request = {
                "protocolVersion": 1,
                "action": "analyzeVisemes",
                "inputPath": str(video),
                "jobRoot": str(job),
                "language": "en",
                "anchors": [{
                    "id": "word-1", "text": "Fallen", "canonicalIndex": 0, "cueIndex": 0,
                    "sourceStart": 1.0, "sourceCenter": 1.2, "sourceEnd": 1.5,
                    "sourceConfidence": 0.4,
                }],
            }
            expected = {"kind": "analyzeVisemes", "provider": "Auto-AVSR", "words": [], "visemes": []}
            with mock.patch.object(worker, "analyze_visemes", return_value=expected) as analyze:
                self.assertEqual(worker.dispatch(request), expected)
                analyze.assert_called_once_with(request)
            with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
                worker.validate_request({**request, "shellCommand": "anything"})

    def test_word_transcription_dispatches_the_requested_medium_model_and_range(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary) / "job"
            job.mkdir()
            audio = Path(temporary) / "master.wav"
            audio.write_bytes(b"audio")
            request = {
                "protocolVersion": 1,
                "action": "transcribeWords",
                "inputPath": str(audio),
                "jobRoot": str(job),
                "language": "en",
                "model": "whisper-medium_timestamped",
                "startSeconds": 4.0,
                "endSeconds": 12.0,
            }
            expected = {"kind": "transcribeWords", "model": "whisper-medium_timestamped", "words": []}
            self.assertEqual(worker.validate_request(request)[0], "transcribeWords")
            with mock.patch.object(worker, "transcribe_words", return_value=expected) as transcribe:
                self.assertEqual(worker.dispatch(request), expected)
                transcribe.assert_called_once_with(request)
            with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
                worker.validate_request({**request, "fallbackModel": "base"})

    def test_word_transcription_keeps_sung_passages_in_a_mastered_mix(self):
        options = worker.whisper_singing_transcription_options()
        self.assertFalse(options["vad_filter"])
        self.assertEqual(options["no_speech_threshold"], 1.0)
        self.assertTrue(options["word_timestamps"])
        self.assertFalse(options["condition_on_previous_text"])

    def test_whisper_precision_falls_back_when_cuda_cannot_use_float16(self):
        runtime = mock.Mock()
        runtime.get_cuda_device_count.return_value = 1
        runtime.get_supported_compute_types.return_value = {"int8_float32", "float32"}
        self.assertEqual(worker.whisper_device_and_compute_type(runtime), ("cuda", "int8_float32"))

    def test_whisper_uses_int8_on_cpu(self):
        runtime = mock.Mock()
        runtime.get_cuda_device_count.return_value = 0
        runtime.get_supported_compute_types.return_value = {"int8", "float32"}
        self.assertEqual(worker.whisper_device_and_compute_type(runtime), ("cpu", "int8"))


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


class AlignmentRefinementTests(unittest.TestCase):
    def test_phrase_activity_discards_noise_islands_and_keeps_the_central_take(self):
        intervals = [
            (0, 3270), (3380, 3470),
            (4460, 4700), (4750, 5010), (5020, 12430), (12610, 12660),
            (15000, 18270), (18380, 18450),
        ]
        groups = worker._merge_activity_intervals(intervals, 1000)
        self.assertEqual(groups, [(0.0, 3.27), (4.46, 12.43), (15.0, 18.27)])
        self.assertEqual(worker._center_activity_groups(groups, 1), [(4.46, 12.43)])
        self.assertAlmostEqual(worker._snap_to_acoustic_onset(7.91, [6.58, 7.78]), 7.78)
        self.assertAlmostEqual(worker._snap_to_acoustic_onset(6.50, [6.58, 7.78]), 6.50)

    def test_master_vocal_gate_delays_only_the_phrase_that_really_starts_late(self):
        anchors = [
            {"id": "the-fallen", "cueIndex": 0, "targetStart": .978, "targetCenter": 1.849, "targetEnd": 2.72},
            {"id": "still", "cueIndex": 1, "targetStart": 4.34, "targetCenter": 4.62, "targetEnd": 4.9},
            {"id": "loves", "cueIndex": 1, "targetStart": 5.598, "targetCenter": 5.8, "targetEnd": 6.0},
        ]
        groups = [(1.33, 2.91), (3.98, 6.01), (7.72, 9.0)]
        self.assertEqual(worker._delayed_target_cue_onsets(groups, anchors), {"the-fallen": 1.33})

    def test_refinement_validates_finite_timestamps_without_name_errors(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / "job"
            source = root / "source.wav"
            target = root / "target.wav"
            job.mkdir()
            source.write_bytes(b"RIFFsource")
            target.write_bytes(b"RIFFtarget")
            fake_librosa = mock.MagicMock()
            fake_librosa.load.return_value = ([0.0] * 256, 16_000)
            request = {
                "jobRoot": str(job),
                "sourcePath": str(source),
                "targetPath": str(target),
                "anchors": [{
                    "id": "word-1",
                    "cueIndex": 0,
                    "sourceStart": 1.0,
                    "sourceCenter": 1.1,
                    "sourceEnd": 1.2,
                    "targetStart": 1.02,
                    "targetCenter": 1.12,
                    "targetEnd": 1.22,
                    "maxShiftMs": 50,
                }],
            }
            with (
                mock.patch.object(worker, "prepare_librosa_import"),
                mock.patch.object(worker, "progress"),
                mock.patch.dict(sys.modules, {"librosa": fake_librosa, "numpy": mock.MagicMock()}),
            ):
                result = worker.refine_alignment(request)
            self.assertEqual(result["kind"], "refineAlignment")
            self.assertEqual(result["anchors"][0]["method"], "mfcc-dtw-unresolved")


class WaveformOverlayTests(unittest.TestCase):
    """The stage that overlays the two vocal waveforms without any transcript."""

    SAMPLE_RATE = 16_000

    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
        except ImportError:
            raise unittest.SkipTest("NumPy non disponibile; integrazione DSP saltata")
        try:
            worker.prepare_librosa_import()
            import librosa  # noqa: F401
        except Exception:
            raise unittest.SkipTest("librosa non disponibile; sovrapposizione onde saltata")
        cls.np = np

    def _syllables(self, scale, offset, duration, seed=11):
        """A sung-like burst train on the axis ``source = scale * target + offset``."""
        np = self.np
        rng = np.random.default_rng(seed)
        total = int(round(duration * self.SAMPLE_RATE))
        signal = np.zeros(total, dtype=np.float64)
        target_time = 0.35
        while target_time < 12.0:
            span = float(rng.uniform(0.14, 0.26))
            pitch = float(rng.uniform(150.0, 330.0))
            samples = int(round(scale * span * self.SAMPLE_RATE))
            first = int(round((scale * target_time + offset) * self.SAMPLE_RATE))
            target_time += span + float(rng.uniform(0.05, 0.35))
            if first < 0 or samples < 32:
                continue
            if first + samples >= total:
                break
            clock = np.arange(samples) / self.SAMPLE_RATE
            voiced = sum(gain * np.sin(2 * np.pi * pitch * harmonic * clock) for harmonic, gain in ((1, 1.0), (2, 0.5), (3, 0.28), (5, 0.12)))
            signal[first:first + samples] += 0.6 * np.hanning(samples) * voiced / 1.9
        return np.clip(signal + rng.normal(0.0, 0.004, total), -1.0, 1.0)

    def _write(self, path, samples):
        pcm = self.np.clip(samples * 32767, -32768, 32767).astype("<i2")
        with wave.open(str(path), "wb") as destination:
            destination.setnchannels(1)
            destination.setsampwidth(2)
            destination.setframerate(self.SAMPLE_RATE)
            destination.writeframes(pcm.tobytes())

    def _align(self, source_samples, target_samples):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            self._write(root / "source.wav", source_samples)
            self._write(root / "target.wav", target_samples)
            request = {
                "protocolVersion": 1,
                "action": "alignWaveform",
                "sourcePath": str(root / "source.wav"),
                "targetPath": str(root / "target.wav"),
                "jobRoot": str(root),
            }
            self.assertEqual(worker.validate_request(request)[0], "alignWaveform")
            with mock.patch.object(worker, "progress"):
                return worker.align_waveform(request)

    def test_recovers_a_known_offset_and_tempo_ratio_from_audio_alone(self):
        target = self._syllables(1.0, 0.0, 13.0)
        for scale, offset in ((1.0, 0.0), (1.0, 1.4), (1.08, 0.62), (0.93, 2.1), (1.0, -0.8)):
            with self.subTest(scale=scale, offset=offset):
                result = self._align(self._syllables(scale, offset, 13.0 * max(1.0, scale) + 3.0), target)
                self.assertTrue(result["aligned"])
                self.assertAlmostEqual(result["offsetSeconds"], offset, delta=0.05)
                self.assertAlmostEqual(result["scale"], scale, delta=0.01)
                self.assertGreater(result["confidence"], 0.9)
                self.assertGreater(result["clarity"], 0.3)
                self.assertLess(result["spreadMs"], 60.0)
                self.assertEqual(result["localAgreement"], 1.0)

    def test_reports_ambiguity_for_looped_material_instead_of_a_confident_guess(self):
        motif = self._syllables(1.0, 0.0, 3.0, seed=5)
        result = self._align(motif, self.np.tile(motif, 5))
        # The lag it picks is correct, but a whole loop away scores the same:
        # the pipeline must see that and refuse to anchor timings on it.
        self.assertTrue(result["aligned"])
        self.assertGreater(result["confidence"], 0.9)
        self.assertLess(result["clarity"], 0.15)

    def test_unrelated_vocals_stay_below_the_trust_threshold(self):
        result = self._align(self._syllables(1.0, 0.0, 8.0, seed=77), self._syllables(1.0, 0.0, 13.0))
        self.assertLess(result["confidence"], 0.7)
        self.assertLess(result["clarity"], 0.25)

    def test_material_too_short_to_measure_is_reported_not_invented(self):
        result = self._align(self.np.zeros(400), self._syllables(1.0, 0.0, 13.0))
        self.assertFalse(result["aligned"])
        self.assertEqual(result["reason"], "envelope_too_short")
        self.assertNotIn("offsetSeconds", result)

    def test_request_rejects_unknown_fields_and_out_of_range_scales(self):
        with self.assertRaisesRegex(worker.WorkerError, "Campi non consentiti"):
            worker.validate_request({"protocolVersion": 1, "action": "alignWaveform", "sourcePath": "/tmp/a.wav", "targetPath": "/tmp/b.wav", "anchors": []})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / "a.wav").write_bytes(b"RIFF")
            (root / "b.wav").write_bytes(b"RIFF")
            base = {"protocolVersion": 1, "action": "alignWaveform", "sourcePath": str(root / "a.wav"), "targetPath": str(root / "b.wav"), "jobRoot": str(root)}
            for invalid in ({"minimumScale": 0.05}, {"maximumScale": 9.0}, {"minimumScale": 1.0, "maximumScale": 1.0}):
                with self.subTest(invalid=invalid), self.assertRaises(worker.WorkerError):
                    worker.align_waveform({**base, **invalid})


class PhraseShiftClampTests(unittest.TestCase):
    """A phrase-wide pass must still honour the radius the caller asked for."""

    SAMPLE_RATE = 16_000

    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
        except ImportError:
            raise unittest.SkipTest("NumPy non disponibile; integrazione DSP saltata")
        try:
            worker.prepare_librosa_import()
            import librosa  # noqa: F401
        except Exception:
            raise unittest.SkipTest("librosa non disponibile; micro allineamento saltato")
        cls.np = np

    def _track(self, spans, duration, pitch=220.0):
        np = self.np
        signal = np.zeros(int(duration * self.SAMPLE_RATE), dtype=np.float64)
        for start, end in spans:
            samples = int((end - start) * self.SAMPLE_RATE)
            clock = np.arange(samples) / self.SAMPLE_RATE
            voiced = np.sin(2 * np.pi * pitch * clock) + 0.4 * np.sin(2 * np.pi * pitch * 2 * clock)
            signal[int(start * self.SAMPLE_RATE):int(start * self.SAMPLE_RATE) + samples] = 0.6 * np.hanning(samples) * voiced / 1.4
        return signal

    def _write(self, path, samples):
        pcm = self.np.clip(samples * 32767, -32768, 32767).astype("<i2")
        with wave.open(str(path), "wb") as destination:
            destination.setnchannels(1)
            destination.setsampwidth(2)
            destination.setframerate(self.SAMPLE_RATE)
            destination.writeframes(pcm.tobytes())

    def _refine(self, max_shift_ms):
        """Seeds are deliberately ~4 s away from the real vocal activity."""
        source = self._track([(1.0, 2.0), (6.0, 7.0)], 8.0)
        target = self._track([(0.5, 1.5), (4.0, 5.0)], 5.5, pitch=233.0)
        anchors = [
            {"id": "cue-0", "cueIndex": 0, "sourceStart": 5.0, "sourceCenter": 5.2, "sourceEnd": 5.4, "targetStart": 0.5, "targetCenter": 1.0, "targetEnd": 1.5, "maxShiftMs": max_shift_ms},
            {"id": "cue-1", "cueIndex": 1, "sourceStart": 5.5, "sourceCenter": 5.7, "sourceEnd": 5.9, "targetStart": 4.0, "targetCenter": 4.5, "targetEnd": 5.0, "maxShiftMs": max_shift_ms},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            self._write(root / "source.wav", source)
            self._write(root / "target.wav", target)
            with mock.patch.object(worker, "progress"):
                result = worker.refine_alignment({"jobRoot": str(root), "sourcePath": str(root / "source.wav"), "targetPath": str(root / "target.wav"), "anchors": anchors})
        return {item["id"]: item for item in result["anchors"]}, result

    def test_phrase_boundaries_cannot_escape_a_narrow_requested_radius(self):
        refined, result = self._refine(350)
        self.assertEqual(result["algorithm"], "subtitle-constrained-phrase-dtw-v2")
        seeds = {"cue-0": (5.0, 5.2, 5.4), "cue-1": (5.5, 5.7, 5.9)}
        for identifier, (start, center, end) in seeds.items():
            item = refined[identifier]
            self.assertEqual(item["method"], "phrase-dtw-v2")
            # Before the clamp, ``candidate_start = phrase_start`` wrote the raw
            # activity boundary (1.0 s / 6.0 s) into a 350 ms request.
            self.assertLessEqual(abs(item["sourceStart"] - start), 0.351)
            self.assertLessEqual(abs(item["sourceCenter"] - center), 0.351)
            self.assertLessEqual(abs(item["sourceEnd"] - end), 0.351)

    def test_wide_recovery_radius_still_reaches_the_real_activity_boundary(self):
        refined, _ = self._refine(30_000)
        self.assertAlmostEqual(refined["cue-0"]["sourceStart"], 1.0, delta=0.25)
        self.assertAlmostEqual(refined["cue-1"]["sourceEnd"], 7.0, delta=0.25)


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

    def test_extract_audio_reuses_cancellable_ffmpeg_and_keeps_source_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / "job"
            job.mkdir()
            source = root / "source.mp4"
            source.write_bytes(b"original-video")

            def fake_ffmpeg(input_path, destination):
                self.assertEqual(input_path, source.resolve())
                destination.write_bytes(b"RIFF" + b"audio" * 20)

            with mock.patch.object(worker, "_run_ffmpeg", side_effect=fake_ffmpeg):
                result = worker.dispatch({
                    "protocolVersion": 1,
                    "action": "extractAudio",
                    "inputPath": str(source),
                    "jobRoot": str(job),
                })
            self.assertEqual(result["kind"], "extractAudio")
            self.assertEqual(Path(result["path"]), (job / "source-audio.wav").resolve())
            self.assertEqual(source.read_bytes(), b"original-video")

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
