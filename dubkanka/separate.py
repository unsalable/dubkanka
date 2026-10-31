"""Split a scene's audio into dialogue (voices) and everything else (music + effects) with Demucs.

Part of the "separate" feature (features.py). Demucs models live on the HuggingFace hub (adefossez/HTDemucs-ft:
a bag yaml and one safetensors file per member) and are cached under MODELS_DIR/hf.
"""
import threading

import numpy as np

from .config import SAMPLE_RATE
from .gpu import torch_device, free_gpu

SOURCES = ["drums", "bass", "other", "vocals"]  # stem order of every htdemucs model
_lock = threading.Lock()
_cache = {}


def hf_repo(name):
    """demucs.hf.hf_repo_name without importing torch: htdemucs_ft -> adefossez/HTDemucs-ft."""
    if name == "htdemucs":
        return "adefossez/HTDemucs"
    return "adefossez/" + ("HTDemucs-" + name[len("htdemucs_"):] if name.startswith("htdemucs_") else "Demucs-" + name)


def vocals_member(bag):
    """The bag member that alone makes the vocals stem (htdemucs_ft has one specialist per stem), else None."""
    models, weights = bag.get("models") or [], bag.get("weights")
    if not weights or len(weights) != len(models):
        return None
    vi = SOURCES.index("vocals")
    best = max(range(len(models)), key=lambda i: weights[i][vi])
    w = weights[best]
    return models[best] if w[vi] > 0 and sum(1 for x in w if x > 0) == 1 else None


def model_files(name):
    """Files of the hub repo this model needs: the bag yaml, then the vocals specialist or every member."""
    import yaml
    from huggingface_hub import hf_hub_download
    repo = hf_repo(name)
    with open(hf_hub_download(repo, f"{name}.yaml")) as f:
        bag = yaml.safe_load(f)
    sig = vocals_member(bag)
    return repo, [f"{s}.safetensors" for s in ([sig] if sig else bag["models"])]


def _vocals_model(name):
    """For fine-tuned bags (htdemucs_ft) only the vocals specialist is needed: 4x faster, a quarter of the download,
    same quality."""
    if name in _cache:
        return _cache[name]
    model = None
    try:
        from demucs.hf import load_safetensors_model
        from huggingface_hub import hf_hub_download
        repo, files = model_files(name)
        if len(files) == 1:
            m = load_safetensors_model(hf_hub_download(repo, files[0]))
            if "vocals" in getattr(m, "sources", []):
                model = m
    except Exception:
        model = None  # hub layout changed or offline with an old cache: the whole bag below still works
    if model is None:
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
            progress(0.0, "Ses ayırma modeli yükleniyor...")
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
