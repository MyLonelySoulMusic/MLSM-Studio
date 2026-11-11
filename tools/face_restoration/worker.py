"""Isolated inference process: official CodeFormer architecture and face helpers."""
import json
import os
import subprocess
import sys
import types
import time
from pathlib import Path
from runtime import prepare


def progress(**values):
    print('MLSM_FACE ' + json.dumps(values), flush=True)


def main():
    source, target, config_path = map(Path, sys.argv[1:4])
    options = json.loads(config_path.read_text())
    progress(phase='preparing', message='Preparazione CodeFormer e download dei pesi al primo utilizzo')
    runtime = prepare()
    os.chdir(runtime)
    sys.path.insert(0, str(runtime))
    import cv2
    import numpy as np
    import torch
    torch.set_num_threads(4)
    from torchvision.transforms.functional import normalize, rgb_to_grayscale
    compat = types.ModuleType('torchvision.transforms.functional_tensor')
    compat.rgb_to_grayscale = rgb_to_grayscale
    sys.modules[compat.__name__] = compat
    version = types.ModuleType('basicsr.version')
    version.__version__ = '1.3.2'
    version.__gitsha__ = 'b33cc7d'
    version.version_info = (1, 3, 2)
    sys.modules['basicsr.version'] = version
    from basicsr.utils import img2tensor, tensor2img
    from basicsr.utils.download_util import load_file_from_url
    from basicsr.utils.registry import ARCH_REGISTRY
    from facelib.utils.face_restoration_helper import FaceRestoreHelper
    from facelib.utils.misc import is_gray
    selected = options['device']
    device = ('cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu') if selected == 'auto' else selected
    net = ARCH_REGISTRY.get('CodeFormer')(dim_embd=512, codebook_size=1024, n_head=8, n_layers=9, connect_list=['32', '64', '128', '256']).to(device)
    weights = load_file_from_url('https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth', model_dir='weights/CodeFormer', progress=True)
    net.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True)['params_ema'])
    net.eval()
    helper = FaceRestoreHelper(options['upscale'], face_size=512, crop_ratio=(1, 1), det_model=options['detection_model'], save_ext='png', use_parse=True, device=device)
    upsampler = None
    if not options['has_aligned'] and (options['bg_upsampler'] or options['face_upsample']):
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from basicsr.utils.realesrgan_utils import RealESRGANer
        upsampler = RealESRGANer(scale=2, model_path='https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/RealESRGAN_x2plus.pth', model=RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2), tile=options['bg_tile'], tile_pad=40, pre_pad=0, half=False, device=torch.device(device))

    def restore(frame):
        helper.clean_all()
        if options['has_aligned']:
            frame = cv2.resize(frame, (512, 512))
            helper.is_gray = is_gray(frame, threshold=10)
            helper.cropped_faces = [frame]
        else:
            helper.read_image(frame)
            # Upstream silently enlarges small inputs to a 512px minimum.
            # Keep requested output scale relative to the actual source; the
            # detector and aligned 512px face crops still perform their own resize.
            helper.input_img = frame
            helper.get_face_landmarks_5(only_center_face=options['only_center_face'], resize=640, eye_dist_threshold=5)
            helper.align_warp_face()
        for face in helper.cropped_faces:
            tensor = img2tensor(face / 255., bgr2rgb=True, float32=True)
            normalize(tensor, (.5, .5, .5), (.5, .5, .5), inplace=True)
            with torch.inference_mode():
                result = net(tensor.unsqueeze(0).to(device), w=options['fidelity_weight'], adain=True)[0]
            helper.add_restored_face(tensor2img(result, rgb2bgr=True, min_max=(-1, 1)).astype('uint8'), face)
        if options['has_aligned']:
            return helper.restored_faces[0], 1
        background = upsampler.enhance(frame, outscale=options['upscale'])[0] if options['bg_upsampler'] else None
        helper.get_inverse_affine(None)
        restored = helper.paste_faces_to_input_image(upsample_img=background, draw_box=options['draw_box'], face_upsampler=upsampler if options['face_upsample'] else None)
        # draw_box can promote upstream output to float64; rawvideo requires
        # exactly three uint8 bytes per pixel, including with advanced options.
        return np.ascontiguousarray(np.clip(restored, 0, 255).astype(np.uint8)), len(helper.cropped_faces)

    progress(phase='restoring', message=f'Ripristino volti · {device}', device=device)
    if target.suffix == '.png':
        frame = cv2.imread(str(source))
        if frame is None:
            raise ValueError('Immagine non decodificabile')
        result, faces = restore(frame)
        if not cv2.imwrite(str(target), result):
            raise RuntimeError('Salvataggio immagine fallito')
        progress(currentFrame=1, totalFrames=1, faces=faces)
        return
    capture = cv2.VideoCapture(str(source))
    fps = capture.get(cv2.CAP_PROP_FPS)
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if not capture.isOpened() or not np.isfinite(fps) or fps <= 0:
        raise ValueError('Video non decodificabile o FPS non validi')
    encoder = None
    index = faces_total = 0
    decode_seconds = inference_seconds = pipe_seconds = 0.0
    log_path = target.with_suffix('.ffmpeg.log')
    try:
        with log_path.open('w') as log:
            while True:
                tick = time.perf_counter()
                ok, frame = capture.read()
                decode_seconds += time.perf_counter() - tick
                if not ok:
                    break
                tick = time.perf_counter()
                result, faces = restore(frame)
                inference_seconds += time.perf_counter() - tick
                if encoder is None:
                    height, width = result.shape[:2]
                    command = [options['ffmpeg'], '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{width}x{height}', '-r', str(fps), '-i', 'pipe:0', '-i', str(source), '-map', '0:v:0', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '4', '-crf', str(options['crf']), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(target)]
                    if options.get('save_video_fps', 0) > 0:
                        command[-1:-1] = ['-r', str(options['save_video_fps'])]
                    encoder = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log)
                tick = time.perf_counter()
                encoder.stdin.write(result.tobytes())
                pipe_seconds += time.perf_counter() - tick
                index += 1
                faces_total += faces
                progress(currentFrame=index, totalFrames=total, faces=faces_total)
            if encoder is None:
                raise ValueError('Il video non contiene fotogrammi')
            encoder.stdin.close()
            progress(phase='encoding', message='Finalizzazione video e audio')
            tick = time.perf_counter()
            if encoder.wait() != 0:
                raise RuntimeError(log_path.read_text()[-2000:])
            progress(timings={'decodeSeconds': round(decode_seconds, 3), 'inferenceSeconds': round(inference_seconds, 3), 'encodePipeSeconds': round(pipe_seconds, 3), 'finalizeSeconds': round(time.perf_counter() - tick, 3)})
    finally:
        capture.release()
        if encoder and encoder.poll() is None:
            encoder.kill()
            encoder.wait()
    if total > 0 and index < total:
        raise RuntimeError(f'Decodifica incompleta: {index}/{total} fotogrammi')


if __name__ == '__main__':
    main()
