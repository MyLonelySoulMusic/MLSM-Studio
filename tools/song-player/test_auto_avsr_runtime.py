from __future__ import annotations

import os
import sys
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    import numpy as np
except ImportError:  # The production Song Player runtime always installs it.
    np = None

SONG_PLAYER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SONG_PLAYER_DIR))

import auto_avsr_runtime


class FakeTensor:
    def __init__(self, values):
        self.values = np.asarray(values, dtype=np.float32)

    def detach(self):
        return self

    def float(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.values


class AutoAvsrRuntimeTests(unittest.TestCase):
    def test_dependency_gate_includes_every_module_imported_by_visual_transforms(self):
        available = {"torch", "torchvision", "cv2", "mediapipe", "skimage", "sentencepiece", "gdown"}
        with mock.patch.object(auto_avsr_runtime.importlib.util, "find_spec", side_effect=lambda name: object() if name in available else None):
            self.assertFalse(auto_avsr_runtime.visual_dependencies_ready())
        available.add("torchaudio")
        with (
            mock.patch.object(auto_avsr_runtime.importlib.util, "find_spec", side_effect=lambda name: object() if name in available else None),
            mock.patch.object(auto_avsr_runtime.importlib.metadata, "version", return_value=auto_avsr_runtime.AUTO_AVSR_MEDIAPIPE_VERSION),
        ):
            self.assertTrue(auto_avsr_runtime.visual_dependencies_ready())
        with (
            mock.patch.object(auto_avsr_runtime.importlib.util, "find_spec", return_value=object()),
            mock.patch.object(auto_avsr_runtime.importlib.metadata, "version", return_value="0.10.35"),
        ):
            self.assertFalse(auto_avsr_runtime.visual_dependencies_ready())

    @unittest.skipIf(np is None, "numpy is installed by the isolated Song Player runtime")
    def test_ctc_path_retains_repeated_token_positions(self):
        # blank, token 1, blank, token 1: the returned state indexes must keep
        # the two identical tokens distinct instead of collapsing their IDs.
        scores = np.full((7, 3), -8.0, dtype=np.float32)
        for frame, token in enumerate((0, 1, 1, 0, 1, 1, 0)):
            scores[frame, token] = 0.0
        path = auto_avsr_runtime._ctc_state_path(FakeTensor(scores), [1, 1])
        self.assertEqual(len(path), 7)
        self.assertIn(1, path)
        self.assertIn(3, path)
        self.assertLess(path.index(1), path.index(3))

    def test_sentencepiece_units_map_to_words_and_visible_classes(self):
        self.assertEqual(auto_avsr_runtime._token_word_indexes(["▁the", "▁fall", "en"], 2), [0, 1, 1])
        self.assertEqual(auto_avsr_runtime._viseme_class("map"), "bilabial")
        self.assertEqual(auto_avsr_runtime._viseme_class("▁five"), "labiodental")

    def test_visual_confidence_accepts_a_matching_phrase_but_rejects_a_mismatch(self):
        self.assertGreater(auto_avsr_runtime._visual_word_confidence(0.0, 1.0, 0.963), 0.5)
        self.assertLess(auto_avsr_runtime._visual_word_confidence(0.01, 1.0, 0.154), 0.5)

    def test_source_archive_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "source.tar.gz"
            payload = b"unsafe"
            with tarfile.open(archive, "w:gz") as handle:
                member = tarfile.TarInfo("../escape.txt")
                member.size = len(payload)
                handle.addfile(member, io.BytesIO(payload))
            with self.assertRaisesRegex(auto_avsr_runtime.VisualSpeechError, "percorso non sicuro"):
                auto_avsr_runtime._safe_extract_tar(archive, root / "unpacked")

    def test_runtime_assets_are_kept_outside_the_project_when_overridden(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(os.environ, {"MLSM_VISUAL_SPEECH_CACHE": temporary}):
            self.assertEqual(auto_avsr_runtime.visual_runtime_root(), Path(temporary))


if __name__ == "__main__":
    unittest.main()
