from __future__ import annotations

import base64
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import remote_upscaler


class RemoteUpscalerTests(unittest.TestCase):
    def test_normalizes_gradio_route_and_rejects_private_hosts(self):
        with patch("tools.remote_upscaler.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("34.1.2.3", 443))]):
            self.assertEqual(remote_upscaler.normalize_endpoint("https://demo.gradio.live/gradio_api/call/upscale_image"), "https://demo.gradio.live")
        with patch("tools.remote_upscaler.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(remote_upscaler.RemoteUpscalerError):
                remote_upscaler.normalize_endpoint("https://localhost")

    def test_catalog_is_intersection_of_healthy_endpoints(self):
        catalogs = {
            "https://a.gradio.live": {"endpoint": "https://a.gradio.live", "defaultModel": "shared", "models": [{"name": "shared", "scale": 4, "description": "", "default": True}, {"name": "a-only", "scale": 2, "description": "", "default": False}]},
            "https://b.gradio.live": {"endpoint": "https://b.gradio.live", "defaultModel": "shared", "models": [{"name": "shared", "scale": 4, "description": "", "default": True}]},
        }
        with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch("tools.remote_upscaler.discover_models", side_effect=lambda value: catalogs[value]):
            result = remote_upscaler.aggregate_catalog(catalogs)
        self.assertEqual([item["name"] for item in result["models"]], ["shared"])
        self.assertEqual(result["defaultModel"], "shared")

    def test_decodes_gradio_sse_result(self):
        png = b"\x89PNG\r\n\x1a\ncontent"
        queued = {"event_id": "evt"}
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def __iter__(self):
                payload = [{"ok": True, "image": "data:image/png;base64," + base64.b64encode(png).decode("ascii")}]
                return iter([b"event: complete\n", f"data: {json.dumps(payload)}\n".encode(), b"\n"])
        with patch("tools.remote_upscaler.normalize_endpoint", return_value="https://demo.gradio.live"), patch("tools.remote_upscaler._request_json", return_value=queued), patch.object(remote_upscaler._safe_opener, "open", return_value=Response()):
            self.assertEqual(remote_upscaler.upscale_image("https://demo.gradio.live", png, "model"), png)

    def test_distributor_keeps_checkpoints_and_retries_on_another_worker(self):
        png = b"\x89PNG\r\n\x1a\ncontent"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; target = root / "target"; source.mkdir(); target.mkdir()
            frames = [source / f"frame-{index:08d}.png" for index in range(1, 4)]
            for frame in frames: frame.write_bytes(png)
            (target / frames[0].name).write_bytes(png)
            calls: list[tuple[str, str]] = []
            def upscale(endpoint: str, data: bytes, model: str, timeout: int = 180) -> bytes:
                calls.append((endpoint, model))
                if endpoint.endswith("bad"):
                    raise remote_upscaler.RemoteUpscalerError("offline")
                return data
            progress: list[int] = []
            with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch("tools.remote_upscaler.upscale_image", side_effect=upscale):
                completed, failures = remote_upscaler.distribute_frames(frames, ["https://bad", "https://good"], "shared", target, retries=1, on_progress=lambda done, *_: progress.append(done))
            self.assertEqual(completed, 3)
            self.assertTrue(failures)
            self.assertEqual(sorted(path.name for path in target.glob("frame-*.png")), [frame.name for frame in frames])
            self.assertNotIn(1, progress)  # first frame was recovered from disk

    def test_distributor_really_runs_one_request_per_endpoint_in_parallel(self):
        png = b"\x89PNG\r\n\x1a\ncontent"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; target = root / "target"; source.mkdir()
            frames = [source / f"frame-{index:08d}.png" for index in range(1, 3)]
            for frame in frames: frame.write_bytes(png)
            barrier = threading.Barrier(2, timeout=1)
            lock = threading.Lock(); active = 0; maximum_active = 0
            def upscale(_endpoint: str, data: bytes, _model: str, timeout: int = 180) -> bytes:
                nonlocal active, maximum_active
                with lock:
                    active += 1; maximum_active = max(maximum_active, active)
                try:
                    barrier.wait()
                    time.sleep(.03)
                    return data
                finally:
                    with lock: active -= 1
            with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch("tools.remote_upscaler.upscale_image", side_effect=upscale):
                completed, _ = remote_upscaler.distribute_frames(frames, ["https://first", "https://second"], "shared", target)
            self.assertEqual(completed, 2)
            self.assertEqual(maximum_active, 2, "gli endpoint devono avere richieste contemporaneamente in volo")

    def test_completed_checkpoints_are_reconstructed_after_colab_urls_expire(self):
        png = b"\x89PNG\r\n\x1a\ncontent"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; target = root / "target"; source.mkdir(); target.mkdir()
            frames = [source / f"frame-{index:08d}.png" for index in range(1, 4)]
            for frame in frames:
                frame.write_bytes(png)
                (target / frame.name).write_bytes(png)
            with patch("tools.remote_upscaler.normalize_endpoint", side_effect=remote_upscaler.RemoteUpscalerError("expired")) as normalize:
                completed, failures = remote_upscaler.distribute_frames(frames, ["https://expired.gradio.live"], "shared", target)
            self.assertEqual((completed, failures), (3, []))
            normalize.assert_not_called()

    def test_catalog_discovery_contacts_endpoints_in_parallel(self):
        barrier = threading.Barrier(2, timeout=1)
        def discover(endpoint: str):
            barrier.wait()
            return {"endpoint": endpoint, "defaultModel": "x4", "models": [{"name": "x4", "scale": 4, "description": "", "default": True}]}
        with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch("tools.remote_upscaler.discover_models", side_effect=discover):
            result = remote_upscaler.aggregate_catalog(["https://first", "https://second"])
        self.assertEqual(len(result["endpoints"]), 2)


if __name__ == "__main__":
    unittest.main()
