"""Pinned, on-demand CodeFormer runtime. All upstream files stay in ignored cache."""
import io
import shutil
import urllib.request
import zipfile
from pathlib import Path

REVISION = 'b33cc7d639d6545bfcccc7e0bc6ae51f24e79c2b'
ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.upscaler-cache' / 'CodeFormer'


def prepare():
    if (RUNTIME / 'inference_codeformer.py').is_file():
        return RUNTIME
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    url = f'https://codeload.github.com/sczhou/CodeFormer/zip/{REVISION}'
    with urllib.request.urlopen(url, timeout=120) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    staging = RUNTIME.parent / f'CodeFormer-{REVISION}'
    try:
        archive.extractall(RUNTIME.parent)
        staging.rename(RUNTIME)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return RUNTIME
