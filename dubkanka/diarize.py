"""Who speaks when: pyannote segmentation + WeSpeaker embeddings via sherpa-onnx (CPU, no tokens)."""
import os
import tarfile
import threading
import urllib.request

import numpy as np

from .config import MODELS_DIR

DIAR_DIR = MODELS_DIR / "diarization"
_REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
SEG_URL = _REL + "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB_NAME = "wespeaker_en_voxceleb_resnet34_LM.onnx"
EMB_URL = _REL + "speaker-recongition-models/" + EMB_NAME

_lock = threading.Lock()


def download(url, dst, progress=None):
    tmp = dst.with_name(dst.name + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "DubKanka"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if progress and total:
                progress(done / total)
    os.replace(tmp, dst)


def ensure_models(progress=None):
    DIAR_DIR.mkdir(parents=True, exist_ok=True)
    seg = DIAR_DIR / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"
    emb = DIAR_DIR / EMB_NAME
    if not seg.exists():
        arc = DIAR_DIR / "segmentation.tar.bz2"
        download(SEG_URL, arc, progress and (lambda f: progress(f * 0.2)))
        with tarfile.open(arc, "r:bz2") as t:
            t.extractall(DIAR_DIR, filter="data")
        arc.unlink(missing_ok=True)
    if not emb.exists():
        download(EMB_URL, emb, progress and (lambda f: progress(0.2 + f * 0.8)))
    return seg, emb


def diarize(audio16k, num_speakers=0, threshold=0.4, progress=None):
    # 0.4 rather than sherpa's 0.5: similar-sounding voices (same gender/age) are otherwise merged, and an
    # over-split character is one click to merge in the UI while an under-split one means re-tagging every line.
    """audio16k: mono float32 @16 kHz. Returns [(start, end, speaker_index)] sorted by start."""
    import sherpa_onnx

    with _lock:
        seg, emb = ensure_models()
        threads = max(1, min(8, (os.cpu_count() or 4) // 2))
        config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(seg)),
                num_threads=threads),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(emb), num_threads=threads),
            clustering=sherpa_onnx.FastClusteringConfig(
                num_clusters=int(num_speakers) if num_speakers and num_speakers > 0 else -1,
                threshold=threshold),
            min_duration_on=0.2,
            min_duration_off=0.4,
        )
        sd = sherpa_onnx.OfflineSpeakerDiarization(config)

        def cb(done, total):
            if progress and total:
                progress(done / total)
            return 0

        audio = np.ascontiguousarray(audio16k, dtype=np.float32)
        if len(audio) < 16000:
            return [(0.0, len(audio) / 16000, 0)] if len(audio) else []
        result = sd.process(audio, callback=cb).sort_by_start_time()
        return [(float(r.start), float(r.end), int(r.speaker)) for r in result]
