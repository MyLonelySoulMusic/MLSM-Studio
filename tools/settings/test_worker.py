import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("settings_worker", Path(__file__).with_name("worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SettingsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.data = self.root / "private"
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def call(self, **kwargs):
        return worker.dispatch(kwargs, self.root, self.data)

    def test_env_key_is_used_without_being_returned(self):
        (self.root / ".env").write_text('NVIDIA_API_KEY="secret-test"\n', encoding="utf8")
        result = self.call(action="status")
        self.assertTrue(result["providers"]["nvidia"]["configured"])
        self.assertNotIn("secret-test", json.dumps(result))
        self.assertEqual(worker.configuration(self.root, self.data)["apiKey"], "secret-test")

    def test_ui_keys_are_private_and_selectable(self):
        self.call(action="configure", provider="openai", apiKey="test-openai", model="gpt-4.1", activeProvider="openai")
        config = worker.configuration(self.root, self.data)
        self.assertEqual(config["apiKey"], "test-openai")
        self.assertEqual(config["provider"], "openai")
        if os.name != "nt":
            self.assertEqual((self.data / "providers.json").stat().st_mode & 0o777, 0o600)
        self.assertNotIn("test-openai", json.dumps(self.call(action="status")))

    def test_keys_do_not_cross_providers(self):
        self.call(action="configure", provider="gemini", apiKey="google-secret", model="gemini-3.8-flash")
        self.call(action="configure", provider="xai", apiKey="xai-secret", model="grok-4.6", activeProvider="xai")
        self.assertEqual(worker.configuration(self.root, self.data)["apiKey"], "xai-secret")
        self.assertEqual(worker.configuration(self.root, self.data, "gemini")["apiKey"], "google-secret")

    def test_remove_key_blocks_env_fallback_until_explicit_reset(self):
        (self.root / ".env").write_text("NVIDIA_API_KEY=env-secret\n")
        self.call(action="configure", provider="nvidia", removeKey=True)
        self.assertFalse(self.call(action="status")["providers"]["nvidia"]["configured"])
        self.call(action="configure", provider="nvidia", apiKey="")
        self.assertTrue(self.call(action="status")["providers"]["nvidia"]["configured"])

    def test_local_provider_never_calls_network(self):
        self.call(action="configure", provider="nvidia", activeProvider="local")
        with patch.object(worker.urllib.request, "build_opener") as network:
            with self.assertRaises(ValueError):
                self.call(action="chat", messages=[{"role": "user", "content": "Hello"}])
            network.assert_not_called()

    def test_all_provider_payloads_and_hosts(self):
        for name, definition in worker.PROVIDERS.items():
            self.call(action="configure", provider=name, apiKey="sample-key", model=definition["model"], activeProvider=name)
            response = MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps({"choices": [{"message": {"content": "Hello"}}]}).encode()
            with patch.object(worker.urllib.request, "build_opener") as opener:
                opener.return_value.open.return_value = response
                result = self.call(action="chat", messages=[{"role": "user", "content": "Hello"}])
                request = opener.return_value.open.call_args.args[0]
                self.assertEqual(request.full_url, definition["endpoint"])
                self.assertEqual(request.headers["Authorization"], "Bearer sample-key")
                self.assertEqual(result["source"], name)

    def test_connection_check_uses_selected_model_and_reasoning_safe_completion(self):
        self.call(action="configure", provider="nvidia", apiKey="sample-key", model="moonshotai/kimi-k3")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({"choices": [{"message": {"content": "OK"}}]}).encode()
        with patch.object(worker.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = response
            result = self.call(action="test", provider="nvidia", model="nvidia/nemotron-3-super-120b-a12b")
        request = opener.return_value.open.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(result, {"ok": True, "model": "nvidia/nemotron-3-super-120b-a12b"})
        self.assertEqual(payload["model"], "nvidia/nemotron-3-super-120b-a12b")
        self.assertEqual(payload["max_tokens"], 128)

    def test_retired_nvidia_model_is_migrated_to_a_working_default(self):
        self.call(action="configure", provider="nvidia", apiKey="sample-key", model="meta/llama-3.3-70b-instruct")
        self.assertEqual(worker.configuration(self.root, self.data, "nvidia")["model"], "moonshotai/kimi-k3")
        self.assertEqual(self.call(action="status")["providers"]["nvidia"]["model"], "moonshotai/kimi-k3")

    def test_retired_provider_model_has_an_actionable_error(self):
        self.call(action="configure", provider="nvidia", apiKey="sample-key", model="meta/llama-3.3-70b-instruct")
        gone = worker.urllib.error.HTTPError("https://integrate.api.nvidia.com", 410, "Gone", {}, None)
        with patch.object(worker.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = gone
            with self.assertRaisesRegex(ValueError, r"endpoint del modello ritirato.*HTTP 410"):
                self.call(action="test", provider="nvidia", model="meta/llama-3.3-70b-instruct")

    def test_unknown_cache_and_symlink_refused(self):
        with self.assertRaises(ValueError):
            self.call(action="clearCache", id="../../")
        outside = self.root / "originals"
        outside.mkdir()
        (outside / "keep.txt").write_text("keep")
        (self.root / ".transformers-cache").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.call(action="clearCache", id="transformers")
        self.assertTrue((outside / "keep.txt").is_file())

    def test_cache_clearing_preserves_siblings(self):
        cache = self.root / ".transformers-cache"
        cache.mkdir()
        (cache / "model").write_bytes(b"123")
        original = self.root / "original.wav"
        original.write_bytes(b"original")
        result = self.call(action="clearCache", id="transformers")
        self.assertEqual(result["removedBytes"], 3)
        self.assertTrue(original.is_file())
        self.assertEqual(list(cache.iterdir()), [])

    def test_upscaler_caches_are_cleared_through_the_running_service(self):
        cache = self.root / "temp" / "upscaler"
        cache.mkdir(parents=True)
        (cache / "result.mp4").write_bytes(b"stale")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"removedBytes": 42}'
        with patch.object(worker.urllib.request, "urlopen", return_value=response) as request:
            result = self.call(action="clearCache", id="upscaler-local")
        self.assertEqual(result["removedBytes"], 42)
        sent = request.call_args.args[0]
        self.assertEqual(sent.full_url, "http://127.0.0.1:8765/cache/upscaler-video-temp")
        self.assertEqual(sent.get_method(), "DELETE")

    def test_upscaler_cache_falls_back_to_direct_clear_when_service_is_stopped(self):
        cache = self.root / ".upscaler-cache" / "pytorch"
        cache.mkdir(parents=True)
        (cache / "weights.pth").write_bytes(b"model")
        with patch.object(worker.urllib.request, "urlopen", side_effect=worker.urllib.error.URLError("stopped")):
            result = self.call(action="clearCache", id="upscaler-models")
        self.assertEqual(result["removedBytes"], 5)
        self.assertEqual(list(cache.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
