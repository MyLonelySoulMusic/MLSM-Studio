import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools.upscaler_server import _frame_extraction_filter, _rotation_value, parse_ffprobe_geometry


class FfprobeGeometryTests(unittest.TestCase):
    def test_displaymatrix_only_positive_quarter_turn(self) -> None:
        stream = {
            "side_data_list": [{
                "displaymatrix": (
                    "00000000:            0       65536           0\n"
                    "00000001:       -65536           0           0\n"
                    "00000002:            0           0  1073741824"
                )
            }]
        }

        self.assertEqual(_rotation_value(stream), 90)

    def test_displaymatrix_only_negative_quarter_turn(self) -> None:
        stream = {
            "side_data_list": [{
                "displaymatrix": (
                    "00000000:            0      -65536           0\n"
                    "00000001:        65536           0           0\n"
                    "00000002:            0           0  1073741824"
                )
            }]
        }

        self.assertEqual(_rotation_value(stream), 270)

    def test_explicit_rotation_remains_supported(self) -> None:
        stream = {"side_data_list": [{"rotation": -90.0}]}

        self.assertEqual(_rotation_value(stream), 270)

    def test_displaymatrix_quarter_turn_swaps_display_aspect_ratio(self) -> None:
        geometry = parse_ffprobe_geometry({
            "streams": [{
                "width": 1920,
                "height": 1080,
                "sample_aspect_ratio": "1:1",
                "side_data_list": [{
                    "displaymatrix": (
                        "00000000:            0      -65536           0\n"
                        "00000001:        65536           0           0\n"
                        "00000002:            0           0  1073741824"
                    )
                }],
            }]
        })

        self.assertEqual(geometry["display_width"], 1080)
        self.assertEqual(geometry["display_height"], 1920)
        self.assertAlmostEqual(float(geometry["display_aspect_ratio"]), 9 / 16)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe non disponibili")
    def test_extraction_uses_post_autorotation_sample_aspect_ratio(self) -> None:
        ffmpeg = str(shutil.which("ffmpeg"))
        ffprobe = str(shutil.which("ffprobe"))
        with tempfile.TemporaryDirectory(prefix="mlsm-rotation-test-") as temporary:
            root = Path(temporary)
            base = root / "anamorphic.mp4"
            rotated = root / "rotated.mp4"
            frame = root / "frame.png"
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                "testsrc2=size=160x90:rate=1", "-frames:v", "1", "-vf", "setsar=4/3",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(base),
            ], check=True, capture_output=True)
            rotation = subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-display_rotation:v:0", "90",
                "-i", str(base), "-c", "copy", str(rotated),
            ], check=False, capture_output=True)
            if rotation.returncode != 0:
                self.skipTest("questa versione di ffmpeg non supporta -display_rotation")
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(rotated),
                "-vf", _frame_extraction_filter(), "-frames:v", "1", "-update", "1", str(frame),
            ], check=True, capture_output=True)
            probe = subprocess.run([
                ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height,sample_aspect_ratio", "-of", "json", str(frame),
            ], check=True, capture_output=True)
            stream = json.loads(probe.stdout)["streams"][0]

        # Autorotation turns the 4:3 SAR into 3:4. The filter must therefore
        # produce trunc(90 * 3/4 / 2) * 2 = 66 square-pixel columns, not 120.
        self.assertEqual((stream["width"], stream["height"]), (66, 160))
        self.assertEqual(stream["sample_aspect_ratio"], "1:1")


if __name__ == "__main__":
    unittest.main()
