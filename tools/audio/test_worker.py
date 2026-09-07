import importlib.util
import pathlib
import unittest


WORKER = pathlib.Path(__file__).with_name("worker.py")
SPEC = importlib.util.spec_from_file_location("mlsm_audio_worker", WORKER)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class AudioWorkerTagsTest(unittest.TestCase):
    def test_styles_and_real_pause_are_parsed_in_order(self):
        values = worker.styled_segments("[calm] Hello. [pause=650ms] [intense] Again!", {"exaggeration": .5, "cfgWeight": .5, "temperature": .8})
        self.assertEqual([item["kind"] for item in values], ["speech", "pause", "speech"])
        self.assertAlmostEqual(values[1]["seconds"], .65)
        self.assertLess(values[0]["exaggeration"], values[2]["exaggeration"])

    def test_invalid_pause_is_rejected(self):
        with self.assertRaises(worker.AudioWorkerError):
            worker.styled_segments("Hello [pause=12s] world", {"exaggeration": .5, "cfgWeight": .5, "temperature": .8})

    def test_tags_without_spoken_text_are_rejected(self):
        with self.assertRaises(worker.AudioWorkerError):
            worker.styled_segments("[calm] [pause=1s]", {"exaggeration": .5, "cfgWeight": .5, "temperature": .8})


class AudioWorkerModelLoaderTest(unittest.TestCase):
    def test_stable_chatterbox_api_is_loaded_without_v3_keyword(self):
        class StableModel:
            @classmethod
            def from_pretrained(cls, device):
                return {"device": device}

        model, engine = worker.load_multilingual_model(StableModel, "cpu")

        self.assertEqual(model, {"device": "cpu"})
        self.assertEqual(engine, "Chatterbox Multilingual")
        self.assertFalse(worker.supports_v3_loader(StableModel))

    def test_v3_chatterbox_api_receives_v3_selector(self):
        class V3Model:
            @classmethod
            def from_pretrained(cls, device, t3_model=None):
                return {"device": device, "t3_model": t3_model}

        model, engine = worker.load_multilingual_model(V3Model, "mps")

        self.assertEqual(model, {"device": "mps", "t3_model": "v3"})
        self.assertEqual(engine, "Chatterbox Multilingual V3")
        self.assertTrue(worker.supports_v3_loader(V3Model))


if __name__ == "__main__":
    unittest.main()
