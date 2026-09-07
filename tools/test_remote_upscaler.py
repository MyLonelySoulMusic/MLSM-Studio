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
    def test_accepted_video_error_is_not_resubmitted_to_legacy_route(self):
        with patch.object(remote_upscaler, "normalize_endpoint", side_effect=lambda value: value), patch.object(remote_upscaler, "_request_json", return_value={"event_id": "accepted"}) as submit, patch.object(remote_upscaler, "_read_sse_result", return_value=[{"ok": False, "error": "CUDA out of memory"}]):
            with self.assertRaisesRegex(remote_upscaler.RemoteUpscalerError, "CUDA out of memory"):
                remote_upscaler.upscale_video_chunk("https://one", b"\x00\x00\x00\x18ftypisomsegment", "x4", 100)
            self.assertEqual(submit.call_count, 1)

    def test_healthy_endpoint_drains_remaining_segments_after_peer_failure(self):
        mp4 = b"\x00\x00\x00\x18ftypisomsegment"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chunks = [(root / f"segment-{index}.mp4", 10) for index in range(6)]
            for path, _ in chunks:
                path.write_bytes(mp4)
            failed = threading.Event()
            def upscale(endpoint, data, _model, count, **_kwargs):
                if endpoint == "https://broken":
                    failed.set()
                    raise RuntimeError("endpoint offline")
                self.assertTrue(failed.wait(2))
                time.sleep(.02)
                return data, {"frame_count": count}
            with patch.object(remote_upscaler, "normalize_endpoint", side_effect=lambda value: value), patch.object(remote_upscaler, "upscale_video_chunk", side_effect=upscale):
                segments, frames, errors = remote_upscaler.distribute_video_chunks(chunks, ["https://broken", "https://healthy"], "x4", root / "output")
            self.assertEqual((segments, frames), (6, 60))
            self.assertTrue(errors)
            self.assertEqual(len(list((root / "output").glob("*.mp4"))), 6)

    def test_normalizes_gradio_route_and_rejects_private_hosts(self):
        with patch("tools.remote_upscaler.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("34.1.2.3", 443))]):
            self.assertEqual(remote_upscaler.normalize_endpoint("https://demo.gradio.live/gradio_api/call/upscale_image"), "https://demo.gradio.live")
        with patch("tools.remote_upscaler.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(remote_upscaler.RemoteUpscalerError):
                remote_upscaler.normalize_endpoint("https://localhost")

    def test_catalog_keeps_union_so_preflight_can_skip_incompatible_endpoints(self):
        catalogs = {
            "https://a.gradio.live": {"endpoint": "https://a.gradio.live", "defaultModel": "shared", "models": [{"name": "shared", "scale": 4, "description": "", "default": True}, {"name": "a-only", "scale": 2, "description": "", "default": False}]},
            "https://b.gradio.live": {"endpoint": "https://b.gradio.live", "defaultModel": "shared", "models": [{"name": "shared", "scale": 4, "description": "", "default": True}]},
        }
        with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch("tools.remote_upscaler.discover_models", side_effect=lambda value: catalogs[value]):
            result = remote_upscaler.aggregate_catalog(catalogs)
        self.assertEqual([item["name"] for item in result["models"]], ["shared", "a-only"])
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

    def test_catalog_discovery_uses_gradio_queued_route(self):
        catalog = {
            "ok": True,
            "api_version": 4,
            "default_model": "x4",
            "capabilities": {"video_chunks": True},
            "models": [{"name": "x4", "scale": 4, "default": True}],
        }
        submitted: list[str] = []
        streamed: list[str] = []

        def request(url, _payload, _timeout):
            submitted.append(url)
            return {"event_id": "catalog-event"}

        def stream(url, _timeout):
            streamed.append(url)
            return [catalog]

        with patch("tools.remote_upscaler.normalize_endpoint", return_value="https://demo.gradio.live"), patch(
            "tools.remote_upscaler._request_json", side_effect=request
        ), patch("tools.remote_upscaler._read_sse_result", side_effect=stream):
            result = remote_upscaler.discover_models("https://demo.gradio.live")

        self.assertEqual(submitted, ["https://demo.gradio.live/gradio_api/call/upscale_models"])
        self.assertEqual(streamed, ["https://demo.gradio.live/gradio_api/call/upscale_models/catalog-event"])
        self.assertEqual(result["defaultModel"], "x4")
        self.assertTrue(result["capabilities"]["video_chunks"])

    def test_video_chunk_stream_forwards_frame_level_progress(self):
        mp4 = b"\x00\x00\x00\x18ftypisomsegment"
        queued = {"event_id": "evt-video"}
        progress = {
            "ok": True, "event": "progress", "state": "upscaling",
            "completed_frames": 37, "total_frames": 100, "progress": .37,
            "elapsed_seconds": 74, "estimated_remaining_seconds": 126,
            "seconds_per_frame": 2,
        }

        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def __iter__(self):
                result = [{
                    "ok": True,
                    "video": "data:video/mp4;base64," + base64.b64encode(mp4).decode("ascii"),
                    "frame_count": 100,
                }]
                return iter([
                    b"event: generating\n",
                    f"data: {json.dumps([progress])}\n".encode(),
                    b"\n",
                    b"event: generating\n",
                    f"data: {json.dumps(result)}\n".encode(),
                    b"\n",
                    b"event: complete\n",
                    b"data: [null]\n",
                    b"\n",
                ])

        received: list[dict[str, object]] = []
        with patch("tools.remote_upscaler.normalize_endpoint", return_value="https://demo.gradio.live"), patch(
            "tools.remote_upscaler._request_json", return_value=queued
        ), patch.object(remote_upscaler._safe_opener, "open", return_value=Response()):
            output, metadata = remote_upscaler.upscale_video_chunk(
                "https://demo.gradio.live", mp4, "model", 100,
                on_progress=received.append,
            )

        self.assertEqual(output, mp4)
        self.assertEqual(metadata["frame_count"], 100)
        self.assertEqual(received, [progress])

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

    def test_video_preflight_requires_every_endpoint_and_chunk_capability(self):
        def discover(endpoint: str):
            if endpoint.endswith("old"):
                return {"models": [{"name": "x4"}], "capabilities": {"video_chunks": False}}
            return {"models": [{"name": "x4"}], "capabilities": {"video_chunks": True}}
        with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch(
            "tools.remote_upscaler.discover_models", side_effect=discover
        ):
            with self.assertRaisesRegex(remote_upscaler.RemoteUpscalerError, "tutti gli endpoint"):
                remote_upscaler.validate_video_chunk_endpoints(["https://ready", "https://old"], "x4")

    def test_video_preflight_preserves_healthy_endpoints_for_an_explicit_skip(self):
        def discover(endpoint: str):
            if endpoint.endswith("offline"):
                raise remote_upscaler.RemoteUpscalerError("HTTP Error 404: Not Found")
            return {
                "models": [{"name": "x4"}],
                "capabilities": {"video_chunks": True, "max_chunk_frames": 5000},
            }
        with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch(
            "tools.remote_upscaler.discover_models", side_effect=discover
        ):
            result = remote_upscaler.inspect_video_chunk_endpoints(
                ["https://ready", "https://offline"], "x4", chunk_frames=300
            )
        self.assertEqual(result["reachableEndpoints"], ["https://ready"])
        self.assertEqual(result["failures"], [{
            "url": "https://offline", "error": "HTTP Error 404: Not Found",
        }])

    def test_video_preflight_validates_requested_chunk_size_and_optional_fps(self):
        catalog = {
            "models": [{"name": "x4"}],
            "capabilities": {
                "video_chunks": True,
                "chunk_frames": 100,
                "max_chunk_frames": 5000,
                "optional_output_fps": True,
            },
        }
        with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch(
            "tools.remote_upscaler.discover_models", return_value=catalog
        ):
            self.assertEqual(
                remote_upscaler.validate_video_chunk_endpoints(
                    ["https://ready"], "x4", chunk_frames=300, output_fps=59.94
                ),
                ["https://ready"],
            )

        legacy = {"models": [{"name": "x4"}], "capabilities": {"video_chunks": True, "chunk_frames": 100}}
        with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch(
            "tools.remote_upscaler.discover_models", return_value=legacy
        ):
            with self.assertRaisesRegex(remote_upscaler.RemoteUpscalerError, "massimo endpoint: 100"):
                remote_upscaler.validate_video_chunk_endpoints(["https://old"], "x4", chunk_frames=300)

    def test_video_chunk_sends_fps_only_when_explicit(self):
        source = b"\x00\x00\x00\x18ftypisomsegment"
        returned = "data:video/mp4;base64," + base64.b64encode(source).decode("ascii")
        captured: list[list[object]] = []

        def request(_url, payload, _timeout):
            captured.append(payload["data"])
            return {"event_id": "event"}

        result = [{"ok": True, "video": returned, "frame_count": 300}]
        with patch("tools.remote_upscaler.normalize_endpoint", return_value="https://ready"), patch(
            "tools.remote_upscaler._request_json", side_effect=request
        ), patch("tools.remote_upscaler._read_sse_result", return_value=result):
            remote_upscaler.upscale_video_chunk("https://ready", source, "x4", 300)
            remote_upscaler.upscale_video_chunk("https://ready", source, "x4", 300, output_fps=60)

        self.assertEqual(captured[0][-1], 0.0)
        self.assertEqual(captured[1][-1], 60.0)

    def test_video_chunks_are_parallel_and_atomically_checkpointed(self):
        mp4 = b"\x00\x00\x00\x18ftypisomsegment"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; target = root / "target"; source.mkdir()
            chunks = [(source / "segment-000001.mp4", 100), (source / "segment-000002.mp4", 40)]
            for chunk, _ in chunks:
                chunk.write_bytes(mp4)
            barrier = threading.Barrier(2, timeout=1)
            lock = threading.Lock(); active = 0; maximum_active = 0

            def upscale(_endpoint: str, data: bytes, _model: str, expected: int, output_fps=None, timeout: int = 3600):
                nonlocal active, maximum_active
                with lock:
                    active += 1; maximum_active = max(maximum_active, active)
                try:
                    barrier.wait()
                    return data, {"frame_count": expected}
                finally:
                    with lock:
                        active -= 1

            progress: list[tuple[int, int]] = []
            with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch(
                "tools.remote_upscaler.upscale_video_chunk", side_effect=upscale
            ):
                completed_segments, completed_frames, failures = remote_upscaler.distribute_video_chunks(
                    chunks, ["https://one", "https://two"], "x4", target,
                    validate_checkpoint=lambda path, _count: path.exists() and path.read_bytes() == mp4,
                    on_progress=lambda done, _total, frames, *_: progress.append((done, frames)),
                )
            self.assertEqual((completed_segments, completed_frames, failures), (2, 140, []))
            self.assertEqual(maximum_active, 2)
            self.assertEqual(len(list(target.glob("segment-*.mp4"))), 2)
            self.assertFalse(list(target.glob("*.partial")))
            self.assertEqual(progress[-1], (2, 140))

    def test_video_distributor_attributes_streamed_progress_to_each_endpoint_and_segment(self):
        mp4 = b"\x00\x00\x00\x18ftypisomsegment"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; target = root / "target"; source.mkdir()
            chunk = source / "segment-000001.mp4"; chunk.write_bytes(mp4)
            updates: list[tuple[str, str, int]] = []

            def upscale(_endpoint, data, _model, expected, output_fps=None, timeout=3600, on_progress=None):
                self.assertIsNotNone(on_progress)
                on_progress({"event": "progress", "state": "upscaling", "completed_frames": 12, "total_frames": expected, "progress": .12})
                return data, {"frame_count": expected}

            with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch(
                "tools.remote_upscaler.upscale_video_chunk", side_effect=upscale
            ):
                remote_upscaler.distribute_video_chunks(
                    [(chunk, 100)], ["https://one"], "x4", target,
                    validate_checkpoint=lambda path, _count: path.exists() and path.read_bytes() == mp4,
                    on_endpoint_progress=lambda endpoint, segment, item: updates.append(
                        (endpoint, segment.name, int(item["completed_frames"]))
                    ),
                )

            self.assertEqual(updates, [("https://one", "segment-000001.mp4", 12)])

    def test_completed_video_chunks_resume_without_contacting_expired_colabs(self):
        mp4 = b"\x00\x00\x00\x18ftypisomsegment"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; target = root / "target"; source.mkdir(); target.mkdir()
            chunk = source / "segment-000001.mp4"; chunk.write_bytes(mp4)
            (target / chunk.name).write_bytes(mp4)
            with patch("tools.remote_upscaler.normalize_endpoint", side_effect=AssertionError("network not expected")):
                result = remote_upscaler.distribute_video_chunks(
                    [(chunk, 12)], ["https://expired"], "x4", target,
                    validate_checkpoint=lambda path, _count: path.exists() and path.read_bytes() == mp4,
                )
            self.assertEqual(result, (1, 12, []))

    def test_cancelled_video_job_detaches_blocked_gradio_requests_immediately(self):
        mp4 = b"\x00\x00\x00\x18ftypisomsegment"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; target = root / "target"; source.mkdir()
            chunk = source / "segment-000001.mp4"; chunk.write_bytes(mp4)
            started = threading.Event(); release = threading.Event(); cancelled = threading.Event()

            def blocked(*_args, **_kwargs):
                started.set(); release.wait(5)
                return mp4, {"frame_count": 12}

            def cancel_soon() -> None:
                started.wait(1); cancelled.set()

            trigger = threading.Thread(target=cancel_soon, daemon=True); trigger.start()
            began = time.monotonic()
            try:
                with patch("tools.remote_upscaler.normalize_endpoint", side_effect=lambda value: value), patch(
                    "tools.remote_upscaler.upscale_video_chunk", side_effect=blocked
                ):
                    with self.assertRaises(InterruptedError):
                        remote_upscaler.distribute_video_chunks(
                            [(chunk, 12)], ["https://slow"], "x4", target,
                            cancelled=cancelled.is_set,
                        )
                self.assertLess(time.monotonic() - began, 1.5)
                self.assertFalse((target / chunk.name).exists())
            finally:
                release.set(); trigger.join(timeout=1)


if __name__ == "__main__":
    unittest.main()
