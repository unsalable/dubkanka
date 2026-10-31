"""Split a scene's audio into dialogue (voices) and everything else (music + effects) with Demucs."""
import threading

import numpy as np

from .config import SAMPLE_RATE
from .gpu import torch_device, free_gpu

_lock = threading.Lock()
_cache = {}


def _vocals_model(name):
    """For fine-tuned bags (htdemucs_ft) only the vocals specialist is needed: 4x faster, same quality."""
    if name in _cache:
        return _cache[name]
    from demucs.apply import BagOfModels
    from demucs.pretrained import get_model
    model = get_model(name)
    if isinstance(model, BagOfModels):
        vi = model.sources.index("vocals")
        best = max(range(len(model.models)), key=lambda i: model.weights[i][vi])
        specialised = model.weights[best][vi] > 0 and sum(1 for w in model.weights[best] if w > 0) == 1
        if specialised:
            model = model.models[best]
    model.eval()
    _cache.clear()
    _cache[name] = model
    return model


def separate(mix, sr, model_name="htdemucs_ft", progress=None, shifts=None):
    """mix: (n, 2) float32 at `sr`. Returns (voices, background) as (n, 2) float32 at SAMPLE_RATE."""
    import torch
    from demucs.apply import apply_model
    from demucs.audio import convert_audio

    with _lock:
        if progress:
            progress(0.0, "Ses ayırma modeli yükleniyor (ilk seferde indirilir, ~80-300 MB)...")
        model = _vocals_model(model_name)
        device = torch_device()
        if shifts is None:
            shifts = 2 if device == "cuda" else 1
        wav = torch.from_numpy(np.ascontiguousarray(mix.T)).float()
        wav = convert_audio(wav, sr, model.samplerate, model.audio_channels)
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        total = wav.shape[1]

        def cb(d):
            if progress and d.get("state") == "end":
                done = d.get("shift_idx", 0) + min(1.0, (d.get("segment_offset", 0) + 1) / max(1, total))
                progress(min(0.99, done / max(1, shifts)), None)

        with torch.no_grad():
            out = apply_model(model, ((wav - mean) / std)[None], shifts=shifts, split=True, overlap=0.25,
                              device=device, callback=cb, progress=False)
        out = out * std + mean
        vocals = out[0, model.sources.index("vocals")]
        background = wav - vocals
        vocals = convert_audio(vocals, model.samplerate, SAMPLE_RATE, 2).numpy().T.astype(np.float32)
        background = convert_audio(background, model.samplerate, SAMPLE_RATE, 2).numpy().T.astype(np.float32)
        del out, wav
        free_gpu()
        n = min(len(vocals), len(background), int(round(len(mix) * SAMPLE_RATE / sr)))
        return vocals[:n], background[:n]
