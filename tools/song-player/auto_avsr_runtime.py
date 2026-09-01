"""Isolated Auto-AVSR visual-speech runtime used by MLSM Post Lipsync.

The upstream source and checkpoint are downloaded lazily into the MLSM cache,
never vendored into the application repository.  Timing comes from a
CTC-forced alignment over Auto-AVSR's visual encoder; the caller may then fuse
only confident, monotonic proposals with the existing audio alignment.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import math
import os
import re
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable

AUTO_AVSR_COMMIT = "182b62837773ab01052d4ac21ef1d2203ea7d267"
AUTO_AVSR_ARCHIVE = f"https://codeload.github.com/mpc001/auto_avsr/tar.gz/{AUTO_AVSR_COMMIT}"
AUTO_AVSR_MODEL_ID = "1r1kx7l9sWnDOCnaFHIGvOtzuhFyFA88_"
AUTO_AVSR_MODEL_NAME = "vsr_trlrs2lrs3vox2avsp_base.pth"
AUTO_AVSR_MODEL_MD5_PREFIX = "49f77"
AUTO_AVSR_MEDIAPIPE_VERSION = "0.10.21"
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024 * 1024

Progress = Callable[[float, str], None]
Cancelled = Callable[[], bool]


class VisualSpeechError(RuntimeError):
    pass


def visual_dependencies_ready() -> bool:
    # ``datamodule.transforms`` imports torchaudio even for the visual-only
    # transform. Keep it in the capability gate so setup cannot report a
    # runnable Auto-AVSR environment that fails on its first real import.
    required = ("torch", "torchvision", "torchaudio", "cv2", "mediapipe", "skimage", "sentencepiece", "gdown")
    if not all(importlib.util.find_spec(name) is not None for name in required):
        return False
    try:
        # Newer MediaPipe builds removed ``mediapipe.solutions``, while older
        # releases do not provide the required Apple Silicon wheel. Pin the
        # exact release exercised by the real MLSM inference probe.
        return importlib.metadata.version("mediapipe") == AUTO_AVSR_MEDIAPIPE_VERSION
    except importlib.metadata.PackageNotFoundError:
        return False


def visual_runtime_root(job_root: Path | None = None) -> Path:
    override = os.environ.get("MLSM_VISUAL_SPEECH_CACHE", "").strip()
    if override:
        value = Path(override).expanduser()
        if not value.is_absolute():
            raise VisualSpeechError("MLSM_VISUAL_SPEECH_CACHE deve essere un percorso assoluto")
        return value
    if job_root is not None and job_root.parent.name == "jobs" and job_root.parent.parent.name == "song-player":
        return job_root.parent.parent / "visual-speech"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "MLSM Studio" / "visual-speech"
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
        return base / "MLSM Studio" / "visual-speech"
    return Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "mlsm-studio" / "visual-speech"


def _throw_if_cancelled(cancelled: Cancelled) -> None:
    if cancelled():
        raise VisualSpeechError("Analisi visiva del labiale annullata")


def _safe_extract_tar(archive: Path, destination: Path) -> Path:
    with tarfile.open(archive, "r:gz") as handle:
        members = handle.getmembers()
        for member in members:
            if member.issym() or member.islnk():
                raise VisualSpeechError("L’archivio Auto-AVSR contiene collegamenti non consentiti")
            target = (destination / member.name).resolve()
            if destination.resolve() not in target.parents and target != destination.resolve():
                raise VisualSpeechError("L’archivio Auto-AVSR contiene un percorso non sicuro")
        handle.extractall(destination, members=members)
    roots = [item for item in destination.iterdir() if item.is_dir()]
    if len(roots) != 1 or not (roots[0] / "lightning.py").is_file():
        raise VisualSpeechError("Il sorgente Auto-AVSR scaricato non è valido")
    return roots[0]


def _download_limited(url: str, destination: Path, cancelled: Cancelled) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "MLSM-Studio/1.0"})
    size = 0
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("xb") as output:
        while True:
            _throw_if_cancelled(cancelled)
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_ARCHIVE_BYTES:
                raise VisualSpeechError("L’archivio Auto-AVSR supera il limite di sicurezza")
            output.write(chunk)
    if size < 32_000:
        raise VisualSpeechError("Download del sorgente Auto-AVSR incompleto")


def _md5_prefix(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[: len(AUTO_AVSR_MODEL_MD5_PREFIX)]


def ensure_auto_avsr_assets(job_root: Path, progress: Progress, cancelled: Cancelled) -> tuple[Path, Path]:
    root = visual_runtime_root(job_root)
    root.mkdir(parents=True, exist_ok=True)
    source = root / f"auto-avsr-{AUTO_AVSR_COMMIT}"
    checkpoint = root / AUTO_AVSR_MODEL_NAME
    if not (source / "lightning.py").is_file():
        progress(0.04, "Auto-AVSR · download del sorgente ufficiale")
        with tempfile.TemporaryDirectory(prefix="mlsm-auto-avsr-source-", dir=root) as temporary:
            temporary_root = Path(temporary)
            archive = temporary_root / "source.tar.gz"
            _download_limited(AUTO_AVSR_ARCHIVE, archive, cancelled)
            extracted = _safe_extract_tar(archive, temporary_root / "unpacked")
            staged = root / f".{source.name}.staging"
            if staged.exists():
                shutil.rmtree(staged)
            shutil.move(str(extracted), staged)
            os.replace(staged, source)
    _throw_if_cancelled(cancelled)
    valid_checkpoint = checkpoint.is_file() and 100 * 1024 * 1024 <= checkpoint.stat().st_size <= MAX_CHECKPOINT_BYTES
    if valid_checkpoint:
        progress(0.1, "Auto-AVSR · verifica del checkpoint visual-only")
        valid_checkpoint = _md5_prefix(checkpoint) == AUTO_AVSR_MODEL_MD5_PREFIX
    if not valid_checkpoint:
        checkpoint.unlink(missing_ok=True)
        progress(0.08, "Auto-AVSR · download automatico del checkpoint visual-only")
        import gdown
        staged_checkpoint = checkpoint.with_suffix(".download")
        staged_checkpoint.unlink(missing_ok=True)
        downloaded = gdown.download(id=AUTO_AVSR_MODEL_ID, output=str(staged_checkpoint), quiet=True)
        _throw_if_cancelled(cancelled)
        if not downloaded or not staged_checkpoint.is_file() or not 100 * 1024 * 1024 <= staged_checkpoint.stat().st_size <= MAX_CHECKPOINT_BYTES:
            staged_checkpoint.unlink(missing_ok=True)
            raise VisualSpeechError("Download del checkpoint Auto-AVSR incompleto")
        if _md5_prefix(staged_checkpoint) != AUTO_AVSR_MODEL_MD5_PREFIX:
            staged_checkpoint.unlink(missing_ok=True)
            raise VisualSpeechError("Checksum del checkpoint Auto-AVSR non valido")
        os.replace(staged_checkpoint, checkpoint)
    progress(0.14, "Auto-AVSR · sorgente e checkpoint verificati")
    return source, checkpoint


def _normalize_text(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9']+", value.lower()))


def _viseme_class(piece: str) -> str:
    token = re.sub(r"[^a-z]", "", piece.lower())
    if any(value in token for value in ("th",)):
        return "dental"
    if any(value in token for value in ("sh", "ch", "zh", "j")):
        return "postalveolar"
    if any(value in token for value in ("oo", "ou", "ow", "w", "u")):
        return "rounded"
    if any(value in token for value in ("f", "v")):
        return "labiodental"
    if any(value in token for value in ("b", "p", "m")):
        return "bilabial"
    if any(value in token for value in ("a", "e", "i", "o", "y")):
        return "open-vowel"
    return "spread-consonant"


def _ctc_state_path(log_probs: Any, token_ids: list[int]) -> list[int]:
    """Viterbi path over CTC states, retaining token positions (not only IDs)."""
    import numpy as np

    scores = log_probs.detach().float().cpu().numpy()
    if scores.ndim != 2 or not token_ids:
        raise VisualSpeechError("Logit visuali Auto-AVSR non validi")
    labels = np.zeros(len(token_ids) * 2 + 1, dtype=np.int64)
    labels[1::2] = np.asarray(token_ids, dtype=np.int64)
    frame_count, state_count = scores.shape[0], labels.shape[0]
    if frame_count < state_count:
        raise VisualSpeechError("Il frammento video è troppo corto per l’allineamento visivo richiesto")
    negative = -1.0e30
    dynamic = np.full((frame_count, state_count), negative, dtype=np.float64)
    back = np.full((frame_count, state_count), -1, dtype=np.int32)
    dynamic[0, 0] = float(scores[0, 0])
    dynamic[0, 1] = float(scores[0, labels[1]])
    for frame in range(1, frame_count):
        minimum_state = max(0, state_count - 2 * (frame_count - frame))
        maximum_state = min(state_count, 2 * frame + 2)
        for state in range(minimum_state, maximum_state):
            candidates = [(dynamic[frame - 1, state], state)]
            if state > 0:
                candidates.append((dynamic[frame - 1, state - 1], state - 1))
            if state > 1 and labels[state] != 0 and labels[state] != labels[state - 2]:
                candidates.append((dynamic[frame - 1, state - 2], state - 2))
            best_score, best_state = max(candidates, key=lambda item: item[0])
            dynamic[frame, state] = best_score + float(scores[frame, labels[state]])
            back[frame, state] = best_state
    state = state_count - 1 if dynamic[-1, -1] >= dynamic[-1, -2] else state_count - 2
    output = [state]
    for frame in range(frame_count - 1, 0, -1):
        state = int(back[frame, state])
        if state < 0:
            raise VisualSpeechError("Percorso CTC visuale incompleto")
        output.append(state)
    output.reverse()
    return output


def _greedy_transcript(log_probs: Any, text_transform: Any) -> str:
    token_ids = log_probs.argmax(dim=-1).detach().cpu().tolist()
    collapsed: list[int] = []
    previous = None
    for token_id in token_ids:
        if token_id != 0 and token_id != previous:
            collapsed.append(int(token_id))
        previous = token_id
    if not collapsed:
        return ""
    import torch
    return str(text_transform.post_process(torch.tensor(collapsed))).strip()


def _decode_video_window(video_path: Path, start: float, end: float, cancelled: Cancelled) -> tuple[list[Any], list[float], float]:
    import cv2

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise VisualSpeechError("Auto-AVSR non riesce a decodificare il video sorgente")
    source_fps = float(capture.get(cv2.CAP_PROP_FPS))
    if not math.isfinite(source_fps) or source_fps <= 0:
        source_fps = 25.0
    sample_fps = min(25.0, source_fps)
    frames: list[Any] = []
    times: list[float] = []
    next_sample = start
    frame_index = 0
    try:
        while True:
            _throw_if_cancelled(cancelled)
            ok, frame = capture.read()
            if not ok:
                break
            time_value = frame_index / source_fps
            frame_index += 1
            if time_value + 1.0 / source_fps < start:
                continue
            if time_value > end + 1.0 / source_fps:
                break
            if time_value + 0.5 / source_fps < next_sample:
                continue
            height, width = frame.shape[:2]
            maximum = max(height, width)
            if maximum > 768:
                scale = 768.0 / maximum
                frame = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            times.append(time_value)
            next_sample += 1.0 / sample_fps
    finally:
        capture.release()
    if len(frames) < 8:
        raise VisualSpeechError("Il video non contiene abbastanza frame utili per leggere il labiale")
    return frames, times, sample_fps


def _token_word_indexes(pieces: list[str], word_count: int) -> list[int]:
    current = -1
    indexes: list[int] = []
    for piece in pieces:
        if piece.startswith("▁") or current < 0:
            current += 1
        indexes.append(min(max(0, current), max(0, word_count - 1)))
    return indexes


def _visual_word_confidence(token_evidence: float, face_coverage: float, semantic_similarity: float) -> float:
    """Combine independent visual signals without trusting forced CTC alone.

    A forced token is often not the frame's greedy winner, so its relative CTC
    posterior can be tiny even when the phrase-level visual transcript is an
    excellent match. Conversely, face detection alone must never make a word
    trustworthy. A strong semantic match plus stable mouth tracking can cross
    the frontend's 0.5 fusion gate; a mismatched phrase cannot.
    """
    token = max(0.0, min(1.0, token_evidence))
    face = max(0.0, min(1.0, face_coverage))
    semantic = max(0.0, min(1.0, semantic_similarity))
    return max(0.0, min(1.0, token * 0.35 + face * 0.20 + semantic * 0.45))


def analyze_visual_speech(
    video_path: Path,
    anchors: list[dict[str, Any]],
    language: str,
    job_root: Path,
    progress: Progress,
    cancelled: Cancelled,
) -> dict[str, Any]:
    if not visual_dependencies_ready():
        raise VisualSpeechError("Dipendenze Auto-AVSR non installate nel runtime isolato")
    source_root, checkpoint = ensure_auto_avsr_assets(job_root, progress, cancelled)
    if str(source_root) not in sys.path:
        sys.path.insert(0, str(source_root))

    import numpy as np
    import torch
    from datamodule.transforms import TextTransform, VideoTransform
    from espnet.nets.pytorch_backend.e2e_asr_conformer import E2E
    from preparation.detectors.mediapipe.detector import LandmarksDetector
    from preparation.detectors.mediapipe.video_process import VideoProcess

    torch.set_num_threads(max(1, min(4, (os.cpu_count() or 2) // 2)))
    progress(0.17, "Auto-AVSR · caricamento del modello visual-only")
    text_transform = TextTransform()
    model = E2E(len(text_transform.token_list), "video", ctc_weight=0.1)
    weights = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(weights)
    device = "cuda" if torch.cuda.is_available() else "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"
    model = model.to(device).eval()
    detector = LandmarksDetector()
    video_process = VideoProcess(convert_gray=False)
    transform = VideoTransform(subset="test")

    ordered = sorted(anchors, key=lambda item: (int(item["cueIndex"]), int(item["canonicalIndex"])))
    groups: list[list[dict[str, Any]]] = []
    for anchor in ordered:
        if not groups or int(groups[-1][0]["cueIndex"]) != int(anchor["cueIndex"]):
            groups.append([anchor])
        else:
            groups[-1].append(anchor)
    has_recovery_anchor = any(float(item.get("sourceConfidence", 1.0)) < 0.5 for item in ordered)
    outer_padding = 2.0 if has_recovery_anchor else 1.25
    minimum_time = max(0.0, min(float(item["sourceStart"]) for item in ordered) - outer_padding)
    maximum_time = max(float(item["sourceEnd"]) for item in ordered) + outer_padding
    progress(0.23, "Auto-AVSR · decodifica controllata dei frame")
    frames, times, sample_fps = _decode_video_window(video_path, minimum_time, maximum_time, cancelled)
    progress(0.32, "Auto-AVSR · tracking volto e crop ufficiale della bocca")
    landmarks = detector(frames)
    detected = sum(item is not None for item in landmarks)
    face_coverage = detected / max(1, len(landmarks))
    if face_coverage < 0.45:
        raise VisualSpeechError(f"Volto/bocca rilevati soltanto nel {face_coverage * 100:.0f}% dei frame")
    mouth_frames = video_process(frames, landmarks)
    if mouth_frames is None or len(mouth_frames) != len(times):
        raise VisualSpeechError("Auto-AVSR non ha prodotto una sequenza stabile della bocca")

    word_events: list[dict[str, Any]] = []
    viseme_events: list[dict[str, Any]] = []
    transcripts: list[str] = []
    for group_index, group in enumerate(groups):
        _throw_if_cancelled(cancelled)
        padding = 1.5 if any(float(item.get("sourceConfidence", 1.0)) < 0.5 for item in group) else 0.5
        group_start = max(minimum_time, min(float(item["sourceStart"]) for item in group) - padding)
        group_end = min(maximum_time, max(float(item["sourceEnd"]) for item in group) + padding)
        selected = [index for index, time_value in enumerate(times) if group_start <= time_value <= group_end]
        if len(selected) < 8:
            continue
        group_times = [times[index] for index in selected]
        tensor = torch.as_tensor(np.asarray([mouth_frames[index] for index in selected])).permute(0, 3, 1, 2)
        tensor = transform(tensor).to(device)
        progress(0.38 + 0.48 * group_index / max(1, len(groups)), f"Auto-AVSR · analisi visiva frase {group_index + 1}/{len(groups)}")
        try:
            with torch.inference_mode():
                encoded = model.frontend(tensor.unsqueeze(0))
                encoded = model.proj_encoder(encoded)
                encoded, _ = model.encoder(encoded, None)
                log_probs = model.ctc.log_softmax(encoded).squeeze(0)
        except RuntimeError:
            if device == "cpu":
                raise
            progress(0.4 + 0.48 * group_index / max(1, len(groups)), "Auto-AVSR · fallback CPU dopo il tentativo GPU/MPS")
            device = "cpu"
            model = model.to(device)
            tensor = tensor.to(device)
            with torch.inference_mode():
                encoded = model.frontend(tensor.unsqueeze(0))
                encoded = model.proj_encoder(encoded)
                encoded, _ = model.encoder(encoded, None)
                log_probs = model.ctc.log_softmax(encoded).squeeze(0)
        phrase_text = " ".join(str(item["text"]) for item in group)
        pieces = list(text_transform.spm.EncodeAsPieces(_normalize_text(phrase_text)))
        token_ids = [int(value) for value in text_transform.tokenize(_normalize_text(phrase_text)).tolist()]
        if not token_ids or len(token_ids) != len(pieces):
            continue
        state_path = _ctc_state_path(log_probs, token_ids)
        greedy = _greedy_transcript(log_probs, text_transform)
        transcripts.append(greedy)
        semantic_similarity = SequenceMatcher(None, _normalize_text(phrase_text), _normalize_text(greedy)).ratio()
        word_indexes = _token_word_indexes(pieces, len(group))
        max_scores = log_probs.max(dim=-1).values.detach().cpu().numpy()

        def frame_time(frame_index: int) -> float:
            if len(state_path) <= 1:
                return group_times[0]
            position = frame_index / (len(state_path) - 1) * (len(group_times) - 1)
            left = int(math.floor(position)); right = min(len(group_times) - 1, left + 1); mix = position - left
            return group_times[left] * (1 - mix) + group_times[right] * mix

        per_word_frames: dict[int, list[tuple[int, float]]] = {index: [] for index in range(len(group))}
        per_token_frames: dict[int, list[tuple[int, float]]] = {index: [] for index in range(len(token_ids))}
        for frame_index, state in enumerate(state_path):
            if state % 2 == 0:
                continue
            token_index = (state - 1) // 2
            token_id = token_ids[token_index]
            relative = math.exp(min(0.0, float(log_probs[frame_index, token_id].item()) - float(max_scores[frame_index])))
            local_word = word_indexes[token_index]
            per_word_frames[local_word].append((frame_index, relative))
            per_token_frames[token_index].append((frame_index, relative))
        for token_index, frame_values in per_token_frames.items():
            if not frame_values:
                continue
            frame_ids = [item[0] for item in frame_values]
            token_confidence = sum(item[1] for item in frame_values) / len(frame_values)
            start_value = max(0.0, frame_time(min(frame_ids)) - 0.5 / sample_fps)
            end_value = frame_time(max(frame_ids)) + 0.5 / sample_fps
            center_value = sum(frame_time(frame) * weight for frame, weight in frame_values) / max(1e-8, sum(item[1] for item in frame_values))
            local_word = word_indexes[token_index]
            viseme_events.append({
                "canonicalIndex": int(group[local_word]["canonicalIndex"]),
                "label": pieces[token_index].lstrip("▁") or pieces[token_index],
                "visemeClass": _viseme_class(pieces[token_index]),
                "startSeconds": round(start_value, 4),
                "centerSeconds": round(center_value, 4),
                "endSeconds": round(max(center_value, end_value), 4),
                "confidence": round(token_confidence, 4),
            })
        for local_word, frame_values in per_word_frames.items():
            if not frame_values:
                continue
            frame_ids = [item[0] for item in frame_values]
            relatives = [item[1] for item in frame_values]
            start_seconds = max(0.0, frame_time(min(frame_ids)) - 0.5 / sample_fps)
            end_seconds = frame_time(max(frame_ids)) + 0.5 / sample_fps
            weighted = sum(frame_time(frame) * weight for frame, weight in frame_values) / max(1e-8, sum(relatives))
            token_evidence = sum(relatives) / len(relatives)
            confidence = _visual_word_confidence(token_evidence, face_coverage, semantic_similarity)
            anchor = group[local_word]
            word_events.append({
                "id": anchor["id"],
                "canonicalIndex": int(anchor["canonicalIndex"]),
                "text": anchor["text"],
                "startSeconds": round(start_seconds, 4),
                "centerSeconds": round(weighted, 4),
                "endSeconds": round(max(weighted, end_seconds), 4),
                "confidence": round(confidence, 4),
                "semanticSimilarity": round(semantic_similarity, 4),
            })
    progress(0.94, "Auto-AVSR · verifica monotona degli eventi visemici")
    word_events.sort(key=lambda item: int(item["canonicalIndex"]))
    viseme_events.sort(key=lambda item: (int(item["canonicalIndex"]), float(item["centerSeconds"])))
    return {
        "kind": "analyzeVisemes",
        "provider": "Auto-AVSR",
        "repository": "https://github.com/mpc001/auto_avsr",
        "revision": AUTO_AVSR_COMMIT,
        "model": AUTO_AVSR_MODEL_NAME,
        "language": language,
        "device": device,
        "faceCoverage": round(face_coverage, 4),
        "visualTranscript": " ".join(value for value in transcripts if value).strip(),
        "words": word_events,
        "visemes": viseme_events,
    }
