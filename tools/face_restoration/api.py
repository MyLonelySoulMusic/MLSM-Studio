"""Extensible face restoration job API hosted by the existing local service."""
import atexit
import json
import os
import shutil
import signal
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / '.venv-face-restoration' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
JOBS_ROOT = ROOT / 'temp' / 'face-restoration'
router = APIRouter(prefix='/face-restoration')
lock = threading.RLock()
jobs = {}


class CodeFormerOptions(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    model: Literal['codeformer'] = 'codeformer'
    fidelity_weight: float = Field(default=.5, ge=0, le=1)
    upscale: int = Field(default=2, ge=1, le=4)
    detection_model: Literal['retinaface_resnet50', 'retinaface_mobile0.25', 'YOLOv5l', 'YOLOv5n'] = 'retinaface_resnet50'
    has_aligned: bool = False
    only_center_face: bool = False
    draw_box: bool = False
    bg_upsampler: bool = False
    face_upsample: bool = False
    bg_tile: int = Field(default=400, ge=64, le=1024)
    device: Literal['auto', 'cpu', 'mps', 'cuda'] = 'auto'
    save_video_fps: float = Field(default=0, ge=0, le=120)
    crf: int = Field(default=18, ge=0, le=35)


MODELS = {'codeformer': {'id': 'codeformer', 'label': 'CodeFormer', 'defaults': CodeFormerOptions().model_dump()}}


def public(job):
    return {key: value for key, value in job.items() if key not in ('process', 'directory')}


def stop(process):
    if process and process.poll() is None:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            if os.name != 'nt':
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                process.kill()
            process.wait()


@atexit.register
def shutdown():
    with lock:
        pending = list(jobs.values())
        for job in pending:
            job['phase'] = 'cancelled'
    for job in pending:
        stop(job.get('process'))
        shutil.rmtree(job['directory'], ignore_errors=True)


def execute(job, source, options):
    directory = job['directory']
    try:
        config = directory / 'options.json'
        config.write_text(json.dumps(options))
        with (directory / 'worker.log').open('w') as log:
            with lock:
                if job['phase'] == 'cancelled':
                    return
                env = {key: value for key, value in os.environ.items() if key not in ('PYTHONPATH', 'PYTHONHOME')}
                env['PYTHONNOUSERSITE'] = '1'
                process = subprocess.Popen([str(PYTHON), '-u', str(Path(__file__).with_name('worker.py')), str(source), str(directory / job['outputName']), str(config)], stdout=subprocess.PIPE, stderr=log, text=True, env=env, start_new_session=os.name != 'nt')
                job['process'] = process
            for line in process.stdout:
                if line.startswith('MLSM_FACE '):
                    with lock:
                        if job['phase'] != 'cancelled':
                            job.update(json.loads(line[len('MLSM_FACE '):]))
            code = process.wait()
        with lock:
            if job['phase'] != 'cancelled':
                if code or not (directory / job['outputName']).is_file():
                    raise RuntimeError((directory / 'worker.log').read_text()[-3000:] or 'CodeFormer non ha prodotto un risultato')
                job.update(phase='ready', message='Restauro completato')
    except Exception as error:
        with lock:
            if job['phase'] != 'cancelled':
                job.update(phase='error', message=str(error))
    finally:
        source.unlink(missing_ok=True)
        if job['phase'] == 'cancelled':
            shutil.rmtree(directory, ignore_errors=True)


@router.get('/models')
def models():
    return {'models': list(MODELS.values()), 'runtimeReady': PYTHON.is_file()}


@router.post('/jobs')
def create_job(file: UploadFile = File(...), settings: str = Form('{}')):
    if not PYTHON.is_file():
        raise HTTPException(503, 'Installa il runtime dedicato con npm run face-restoration:setup')
    try:
        options = CodeFormerOptions.model_validate_json(settings).model_dump()
    except ValidationError as error:
        raise HTTPException(400, 'Parametri Face restoration non validi: ' + str(error)) from error
    extension = Path(file.filename or '').suffix.lower()
    if extension not in ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.mp4', '.mov', '.avi', '.mkv'):
        raise HTTPException(400, 'Formato non supportato')
    video = extension in ('.mp4', '.mov', '.avi', '.mkv')
    ffmpeg = os.environ.get('DSAS_FFMPEG') or shutil.which('ffmpeg')
    if video and not ffmpeg:
        raise HTTPException(503, 'FFmpeg non disponibile nel runtime locale')
    options['ffmpeg'] = ffmpeg
    with lock:
        if any(job['phase'] not in ('ready', 'error', 'cancelled') for job in jobs.values()):
            raise HTTPException(409, 'Un restauro è già in esecuzione')
        identifier = uuid.uuid4().hex
        directory = JOBS_ROOT / identifier
        directory.mkdir(parents=True)
        source = directory / ('source' + extension)
        try:
            with source.open('wb') as output:
                size = 0
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > 2 * 1024 ** 3:
                        raise HTTPException(413, 'Il limite per file è 2 GB')
                    output.write(chunk)
            if not size:
                raise HTTPException(400, 'File vuoto')
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise
        finally:
            file.file.close()
        job = {'id': identifier, 'phase': 'queued', 'message': 'Avvio CodeFormer', 'currentFrame': 0, 'totalFrames': 0, 'faces': 0, 'outputName': 'restored.mp4' if video else 'restored.png', 'directory': directory}
        jobs[identifier] = job
        threading.Thread(target=execute, args=(job, source, options), daemon=True).start()
        return public(job)


def get_job(identifier):
    with lock:
        job = jobs.get(identifier)
        if job is None:
            raise HTTPException(404, 'Restauro non trovato')
        return job


@router.get('/jobs/{identifier}')
def status(identifier: str):
    with lock:
        return public(get_job(identifier))


@router.get('/jobs/{identifier}/result')
def result(identifier: str):
    job = get_job(identifier)
    if job['phase'] != 'ready':
        raise HTTPException(409, 'Risultato non ancora disponibile')
    return FileResponse(job['directory'] / job['outputName'], filename=job['outputName'], media_type='video/mp4' if job['outputName'].endswith('.mp4') else 'image/png')


@router.delete('/jobs/{identifier}')
def delete(identifier: str):
    with lock:
        job = get_job(identifier)
        job['phase'] = 'cancelled'
    stop(job.get('process'))
    shutil.rmtree(job['directory'], ignore_errors=True)
    return {'ok': True}
