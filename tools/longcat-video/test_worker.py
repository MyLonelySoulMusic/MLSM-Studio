import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("longcat_worker", Path(__file__).with_name("worker.py"))
worker = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(worker)


class LongCatWorkerTests(unittest.TestCase):
    def base(self, output: Path):
        return {"protocolVersion": 1, "mode": "textToVideo", "prompt": "A cat walking", "negativePrompt": "blur", "outputPath": str(output), "width": 832, "height": 480, "numFrames": 93, "numInferenceSteps": 16, "guidanceScale": 1, "seed": 42, "useDistill": True, "enableCompile": False}

    def test_validates_text_request(self):
        with tempfile.TemporaryDirectory() as directory:
            request = worker.validate_request(self.base(Path(directory) / "result.mp4"))
            self.assertEqual(request["mode"], "textToVideo"); self.assertEqual(request["width"], 832)

    def test_rejects_path_and_shape_attacks(self):
        with tempfile.TemporaryDirectory() as directory:
            raw = self.base(Path(directory) / "result.txt")
            with self.assertRaises(worker.WorkerError): worker.validate_request(raw)
            raw = self.base(Path(directory) / "result.mp4"); raw["width"] = 833
            with self.assertRaises(worker.WorkerError): worker.validate_request(raw)
            raw = self.base(Path(directory) / "result.mp4"); raw["extra"] = "shell"
            with self.assertRaises(worker.WorkerError): worker.validate_request(raw)

    def test_image_mode_requires_supported_existing_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); image = root / "source.png"; image.write_bytes(b"fixture")
            raw = self.base(root / "result.mp4"); raw.update({"mode": "imageToVideo", "inputPath": str(image), "resolution": "480p"}); raw.pop("width"); raw.pop("height")
            self.assertEqual(worker.validate_request(raw)["inputPath"], image.resolve())

    def test_capabilities_are_fail_closed_without_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            old_repo, old_checkpoint = os.environ.get("MLSM_LONGCAT_REPOSITORY"), os.environ.get("MLSM_LONGCAT_CHECKPOINT")
            os.environ["MLSM_LONGCAT_REPOSITORY"] = str(Path(directory) / "repository"); os.environ["MLSM_LONGCAT_CHECKPOINT"] = str(Path(directory) / "checkpoint")
            try:
                result = worker.capabilities(); self.assertFalse(result["ready"]); self.assertFalse(result["repositoryReady"]); self.assertFalse(result["checkpointReady"])
            finally:
                if old_repo is None: os.environ.pop("MLSM_LONGCAT_REPOSITORY", None)
                else: os.environ["MLSM_LONGCAT_REPOSITORY"] = old_repo
                if old_checkpoint is None: os.environ.pop("MLSM_LONGCAT_CHECKPOINT", None)
                else: os.environ["MLSM_LONGCAT_CHECKPOINT"] = old_checkpoint


if __name__ == "__main__": unittest.main()
