"""Give the background back what Demucs took from it by mistake.

Demucs' vocals stem holds everything voice-like: the dialogue, but also birds, animals, crowd murmur, wind. A speech
enhancement model (DPDFNet, 48 kHz) estimates the pure speech in that stem, and a time-frequency mask built from it
splits the stem into `speech` (replaced by the dub) and `ambience` (mixed back under the dub on its own fader).
Outside detected speech the whole stem is ambience, so a model mistake can never eat a bird between two lines.
"""
import os
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import media
from .config import MODELS_DIR
from .diarize import download

MODEL_DIR = MODELS_DIR / "denoise"
MODEL_NAME = "dpdfnet2_48khz_hr.onnx"
MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/" + MODEL_NAME
SE_SR = 48000
GAMMA = 0.6  # < 1 leans the mask towards speech: a faint bird under a line beats a ghost of the old voice

_lock = threading.Lock()


def ensure_model(progress=None):
    path = MODEL_DIR / MODEL_NAME
    if not path.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        download(MODEL_URL, path, progress)
    return path


def _denoiser(path):
    import sherpa_onnx
    cfg = sherpa_onnx.OfflineSpeechDenoiserConfig(model=sherpa_onnx.OfflineSpeechDenoiserModelConfig(
        dpdfnet=sherpa_onnx.OfflineSpeechDenoiserDpdfNetModelConfig(model=str(path)), num_threads=1))
    return sherpa_onnx.OfflineSpeechDenoiser(cfg)


def _clean_speech(mono, sr, progress=None):
    """DPDFNet over 20 s chunks in parallel, one model per worker (the model itself barely uses a second core)."""
    path = ensure_model(progress and (lambda f: progress(0.1 * f, "Ortam sesi modeli indiriliyor (~11 MB)...")))
    x = media.resample(mono, sr, SE_SR)
    chunk, warm, xf = 20 * SE_SR, 2 * SE_SR, int(0.05 * SE_SR)
    starts = list(range(0, len(x), chunk))
    local = threading.local()
    done = [0]

    def job(a):
        if not hasattr(local, "den"):
            local.den = _denoiser(path)
        lo, hi = max(0, a - warm), min(len(x), a + chunk + xf)
        y = np.asarray(local.den.run(x[lo:hi], SE_SR).samples, dtype=np.float32)[a - lo:]
        done[0] += 1
        if progress:
            progress(0.1 + 0.9 * done[0] / len(starts))
        return a, y

    workers = max(1, min(6, (os.cpu_count() or 4) // 2, len(starts)))
    with ThreadPoolExecutor(workers) as ex:
        parts = list(ex.map(job, starts))
    out = np.zeros(len(x) + xf, np.float32)
    wsum = np.zeros(len(x) + xf, np.float32)
    for a, y in parts:  # short crossfades hide the seams between chunks
        w = np.ones(len(y), np.float32)
        if a > 0:
            w[:xf] = np.linspace(0, 1, xf)
        if a + len(y) < len(x):
            w[-xf:] = np.linspace(1, 0, xf)
        out[a:a + len(y)] += y * w
        wsum[a:a + len(y)] += w
    s = media.resample(out[: len(x)] / np.maximum(wsum[: len(x)], 1e-6), SE_SR, sr)
    return np.pad(s, (0, max(0, len(mono) - len(s))))[: len(mono)]


def _speech_gate(regions, n, sr, rate=100):
    """1 inside speech (a little before, a reverb tail after), 0 elsewhere; smooth so birds fade back in."""
    m = np.zeros(n * rate // sr + 2, np.float32)
    for b, e in regions:
        m[max(0, int((b - 0.08) * rate)):max(0, int((e + 0.25) * rate))] = 1.0
    env = np.empty_like(m)
    level = 0.0
    for i, v in enumerate(m):
        level += (v - level) * (0.6 if v > level else 0.07)
        env[i] = level
    return env, rate


def split(voices, sr, progress=None, gamma=GAMMA):
    """voices: (n, ch) Demucs vocals stem. Returns (speech, ambience) with speech + ambience == voices."""
    from scipy.ndimage import uniform_filter
    from scipy.signal import istft, stft

    from .transcribe import speech_regions

    mono = voices.mean(axis=1)
    with _lock:
        s = _clean_speech(mono, sr, progress and (lambda f, msg=None: progress(0.85 * f, msg)))
    regions = speech_regions(media.resample(s, sr, 16000)) + speech_regions(media.resample(mono, sr, 16000))
    env, rate = _speech_gate(regions, len(mono), sr)

    n, nfft, hop = len(mono), 2048, 512
    kw = dict(fs=sr, window="hann", nperseg=nfft, noverlap=nfft - hop)
    block, pad = 20 * sr, sr
    speech = np.zeros_like(voices)
    wsum = np.zeros(n, np.float32)
    for a in range(0, n, block):  # blocks keep memory flat for long scenes
        b = min(n, a + block)
        lo, hi = max(0, a - pad), min(n, b + pad)
        _, ft, zs = stft(s[lo:hi], **kw)
        _, _, zv = stft(mono[lo:hi], **kw)
        mask = np.clip(np.abs(zs) / (np.abs(zv) + 1e-6), 0.0, 1.0)
        mask = uniform_filter(mask, size=(3, 3), mode="nearest") ** gamma
        mask *= np.interp(lo / sr + ft, np.arange(len(env)) / rate, env)[None, :].astype(np.float32)
        w = np.ones(hi - lo, np.float32)
        if lo < a:
            w[: a - lo] = np.linspace(0, 1, a - lo)
        if hi > b:
            w[b - lo:] = np.linspace(1, 0, hi - b)
        for ch in range(voices.shape[1]):
            _, _, zc = stft(voices[lo:hi, ch], **kw)
            _, y = istft(zc * mask, **kw)
            speech[lo:hi, ch] += y[: hi - lo] * w
        wsum[lo:hi] += w
        if progress:
            progress(0.85 + 0.15 * b / n)
    speech /= np.maximum(wsum, 1e-6)[:, None]
    return speech, voices - speech
