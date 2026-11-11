"""Opt-in real inference test: python -m tools.face_restoration.smoke_test."""
import json
import shutil
import subprocess
import time
from pathlib import Path
import cv2
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tools.face_restoration.api import ROOT, router
from tools.face_restoration.runtime import prepare


def main():
    runtime = prepare()
    workspace = ROOT / 'temp' / 'face-restoration-smoke'
    workspace.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which('ffmpeg')
    ffprobe = shutil.which('ffprobe')
    assert ffmpeg and ffprobe, 'FFmpeg and ffprobe are required'
    image = runtime / 'inputs/whole_imgs/00.jpg'
    video = workspace / 'input.mp4'
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-loop', '1', '-i', str(image), '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.5', '-r', '8', '-vf', 'scale=320:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(video)], check=True)
    app = FastAPI()
    app.include_router(router)
    summary = []
    with TestClient(app) as client:
        cases = [(image, {'upscale': 1}), (video, {'upscale': 1}), (video, {'upscale': 1, 'detection_model': 'retinaface_mobile0.25', 'bg_upsampler': True, 'face_upsample': True, 'draw_box': True, 'only_center_face': True})]
        for source, settings in cases:
            started = time.monotonic()
            response = client.post('/face-restoration/jobs', files={'file': (source.name, source.read_bytes())}, data={'settings': json.dumps(settings)})
            response.raise_for_status()
            identifier = response.json()['id']
            try:
                while True:
                    job = client.get(f'/face-restoration/jobs/{identifier}').json()
                    if job['phase'] in ('ready', 'error', 'cancelled'):
                        break
                    assert time.monotonic() - started < 600, 'Inference timed out'
                    time.sleep(.5)
                assert job['phase'] == 'ready', job
                assert job['faces'] > 0, job
                output = workspace / (('advanced-' if settings.get('draw_box') else '') + job['outputName'])
                response = client.get(f'/face-restoration/jobs/{identifier}/result')
                response.raise_for_status()
                output.write_bytes(response.content)
                if source == video:
                    probe = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', str(output)]))
                    v = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
                    a = next(stream for stream in probe['streams'] if stream['codec_type'] == 'audio')
                    assert int(v['nb_read_frames']) == 4, v
                    assert v['r_frame_rate'] == '8/1', v
                    assert abs(float(v['duration']) - .5) < .02, v
                    assert abs(float(a['duration']) - .5) < .05, a
                    assert v['width'] == 320, v
                else:
                    restored, original = cv2.imread(str(output)), cv2.imread(str(source))
                    assert restored is not None and restored.shape == original.shape
                    assert cv2.absdiff(restored, original).mean() > .1, 'Output unchanged'
                summary.append({'source': source.name, 'settings': settings, 'elapsedSeconds': round(time.monotonic() - started, 3), **job})
            finally:
                client.delete(f'/face-restoration/jobs/{identifier}')
    (workspace / 'verification.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
