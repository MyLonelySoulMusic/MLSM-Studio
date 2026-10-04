import base64
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPT = Path(__file__).with_name("live_whisper.py")
spec = importlib.util.spec_from_file_location("live_whisper", SCRIPT)
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)

class LiveWhisperTests(unittest.TestCase):
    def test_platform_selection_includes_windows_and_intel(self):
        from whisper_streaming_runtime import platform_backend
        self.assertEqual(platform_backend("Darwin", "arm64")[0], "mlx")
        self.assertEqual(platform_backend("Darwin", "x86_64")[0], "cpu")
        self.assertEqual(platform_backend("Windows", "AMD64")[0], "cpu")
        self.assertEqual(platform_backend("Windows", "ARM64")[0], "cpu")
        self.assertEqual(platform_backend("Windows", "AMD64", True)[0], "cuda")

    def test_cache_does_not_download_again(self):
        from whisper_streaming_runtime import model_snapshot
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); model = root / "snapshot"; model.mkdir()
            (model / "config.json").write_text("{}"); (model / "model.bin").touch()
            (root / "Systran--faster-whisper-base.ready").write_text(str(model))
            with patch("huggingface_hub.snapshot_download", side_effect=AssertionError("Must not download")):
                self.assertEqual(model_snapshot("Systran/faster-whisper-base", lambda *args: None, root), model)

    def test_rejects_bad_pcm(self):
        import numpy as np
        for raw in (b"abc", np.array([float("nan")], dtype="<f4").tobytes(), bytes((live.MAX_SAMPLES + 1) * 4)):
            with self.assertRaises(ValueError): live.decode_pcm(base64.b64encode(raw).decode())

    def test_cuda_dll_failure_falls_back_to_light_cpu_model(self):
        from whisper_streaming_runtime import StreamingASR
        from types import SimpleNamespace
        asr = StreamingASR.__new__(StreamingASR)
        asr.backend = "cuda"; asr.path = "gpu-model"; asr.original_language = "en"; asr.progress = lambda *args: None
        broken = SimpleNamespace(transcribe=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")))
        fallback = SimpleNamespace(transcribe=lambda *args, **kwargs: ([], SimpleNamespace(language="en")))
        asr.model = broken
        with patch("whisper_streaming_runtime.model_snapshot", return_value=Path("cpu-base")) as download, patch.object(asr, "load_native", side_effect=lambda backend: setattr(asr, "model", fallback)):
            self.assertEqual(asr.transcribe([]), [])
            self.assertEqual(asr.backend, "cpu"); self.assertEqual(asr.path, "cpu-base")
            self.assertEqual(download.call_args.args[0], "Systran/faster-whisper-small")

    def test_partial_corrections_confirmation_and_final_flush(self):
        import numpy as np
        from whisper_streaming_runtime import upstream_module
        upstream = upstream_module(lambda *args: None)
        class ScriptedASR:
            sep = " "; backend = "test"; original_language = "en"
            outputs = [ [(0, .4, "Hello"), (.4, .8, "wrong")], [(0, .4, "Hello"), (.4, .8, "world")], [(0, .4, "Hello"), (.4, .8, "world"), (.8, 1.2, "music")] ]
            def transcribe(self, *args, **kwargs): return self.outputs.pop(0)
            def ts_words(self, result): return result
            def segments_end_ts(self, result): return [word[1] for word in result]
        processor = live.StreamingProcessor(upstream, ScriptedASR())
        first = processor.process(np.ones(16000, dtype=np.float32), "en")
        self.assertEqual(first["partial"]["text"], "Hello wrong"); self.assertFalse(first["phrases"])
        second = processor.process(np.ones(16000, dtype=np.float32), "en")
        self.assertEqual(second["phrases"][0]["text"], "Hello"); self.assertEqual(second["partial"]["text"], "world")
        third = processor.process(np.ones(16000, dtype=np.float32), "en", final=True)
        self.assertEqual([item["text"] for item in third["phrases"]], ["world", "music"]); self.assertFalse(third["partial"]["text"])
        self.assertEqual(third["processedUntil"], 3)

    def test_digital_silence_never_accumulates_or_runs_inference(self):
        import numpy as np
        from whisper_streaming_runtime import upstream_module
        class SilentASR:
            sep = " "; backend = "test"; original_language = None
            def transcribe(self, *args, **kwargs): raise AssertionError("Silence must not invoke the model")
        processor = live.StreamingProcessor(upstream_module(lambda *args: None), SilentASR())
        for _ in range(120):
            result = processor.process(np.zeros(16000, dtype=np.float32))
            self.assertEqual(result["phrases"], []); self.assertEqual(len(processor.online.audio_buffer), 0)
        self.assertEqual(result["processedUntil"], 120)

    @unittest.skipUnless(os.environ.get("MLSM_TEST_WHISPER_CPU") == "1", "opt-in Windows-compatible CPU model")
    def test_real_windows_compatible_cpu_engine(self):
        import numpy as np
        from whisper_streaming_runtime import upstream_module, model_snapshot, StreamingASR
        with tempfile.TemporaryDirectory(prefix="mlsm-whisper-cpu-") as directory:
            source = Path(directory) / "speech.aiff"
            subprocess.run(["say", "-o", str(source), "Hello world. This is a live transcription test."], check=True, timeout=15)
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"], check=True, capture_output=True, timeout=15).stdout
            asr = StreamingASR("cpu", model_snapshot("Systran/faster-whisper-small", lambda *args: None), lambda *args: None)
            processor = live.StreamingProcessor(upstream_module(lambda *args: None), asr)
            text = []
            # The lighter CPU model starts with two seconds of context, then
            # emits incremental updates every second (same as the frontend).
            for index in [0, *range(128000, len(raw), 64000)]:
                count = 128000 if index == 0 else 64000
                result = processor.process(np.frombuffer(raw[index:index+count], dtype="<f4"), "en", index+count >= len(raw))
                text.extend(phrase["text"] for phrase in result["phrases"])
            self.assertIn("hello", " ".join(text).lower()); print("Windows-compatible CPU text:", " ".join(text))

    @unittest.skipUnless(os.environ.get("MLSM_TEST_LIVE_WHISPER") == "1", "opt-in real cached-model inference")
    def test_real_streaming_model_with_incremental_speech(self):
        with tempfile.TemporaryDirectory(prefix="mlsm-live-whisper-test-") as directory:
            source = Path(directory) / "speech.aiff"
            subprocess.run(["say", "-o", str(source), "Hello world. This is a live audio transcription test. We are listening to music."], check=True, timeout=15)
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"], check=True, capture_output=True, timeout=15).stdout
            requests = [json.dumps({"pcm": base64.b64encode(raw[index:index+64000]).decode(), "language": "en", "final": index+64000 >= len(raw)}) for index in range(0, len(raw), 64000)]
            result = subprocess.run([sys.executable, str(SCRIPT)], input="\n".join(requests) + "\n", capture_output=True, text=True, timeout=90, env={**os.environ, "HF_HUB_OFFLINE": "1"})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            messages = [json.loads(line) for line in result.stdout.splitlines() if json.loads(line)["type"] != "progress"]
            self.assertEqual(messages[0]["type"], "ready"); self.assertEqual(messages[0]["engine"], "Whisper-Streaming")
            chunks = messages[1:]; self.assertEqual(len(chunks), len(requests))
            self.assertTrue(any(chunk["partial"]["text"] for chunk in chunks), chunks)
            text = " ".join(phrase["text"] for chunk in chunks for phrase in chunk["phrases"]).lower()
            self.assertIn("hello", text); self.assertIn("music", text)
            self.assertFalse(chunks[-1]["partial"]["text"])
            print("Real streaming:", messages[0]["model"], "seconds/update:", [chunk["elapsedSeconds"] for chunk in chunks], "text:", text)

if __name__ == "__main__": unittest.main()
