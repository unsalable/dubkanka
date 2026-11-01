"""Give the background back what Demucs took from it by mistake, without letting a voice slip in with it.

Demucs' vocals stem holds everything voice-like: the dialogue, but also birds, animals, crowd murmur, wind. A speech
enhancement model (DPDFNet, 48 kHz) estimates the pure speech in that stem, and a time-frequency mask built from it
splits the stem into `speech` (replaced by the dub) and `ambience` (mixed back under the dub on its own fader).

The mask only works where there is speech; elsewhere the whole stem is ambience, so a model mistake can never eat a
bird between two lines. Users heard the opposite mistake too: a shout, a whisper or a laugh the speech detector missed
went whole into the ambience and was heard under the dub. So where speech is comes from several cues (a sensitive
voice detector on DPDFNet's speech and one on the stem, the frames where DPDFNet's speech carries most of the stem's
energy, and the scene's lines when they are known), and a second pass listens to the ambience it made: a stretch that
still clearly sounds like a voice goes to the speech whole. What is left is muted by hand in the Mikser.
"""
import os
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import media
from .config import MODELS_DIR
from .diarize import download
from .i18n import tx

MODEL_DIR = MODELS_DIR / "denoise"
MODEL_NAME = "dpdfnet2_48khz_hr.onnx"
MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/" + MODEL_NAME
SE_SR = 48000
GAMMA = 0.6  # < 1 leans the mask towards speech: a faint bird under a line beats a ghost of the old voice
VAD_SR = 16000

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
    path = ensure_model(progress and (lambda f: progress(0.1 * f, tx("Ortam sesi modeli indiriliyor (~11 MB)..."))))
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
        k = min(xf, len(y))  # the last chunk can be a few ms long (a scene of 20.01 s)
        if a > 0:
            w[:k] = np.linspace(0, 1, k)
        if a + len(y) < len(x):
            w[-k:] = np.linspace(1, 0, k)
        out[a:a + len(y)] += y * w
        wsum[a:a + len(y)] += w
    s = media.resample(out[: len(x)] / np.maximum(wsum[: len(x)], 1e-6), SE_SR, sr)
    return np.pad(s, (0, max(0, len(mono) - len(s))))[: len(mono)]


def denoise(mono, sr):
    """Room noise, hum and fan out of a recorded take: the same DPDFNet model, without the ambience split."""
    with _lock:
        return _clean_speech(np.asarray(mono, dtype=np.float32), sr)


def _speech_gate(regions, n, sr, pre=0.12, tail=0.25, rate=100):
    """1 inside speech (a little before, a reverb tail after), 0 elsewhere; smooth so birds fade back in."""
    m = np.zeros(n * rate // sr + 2, np.float32)
    for b, e in regions:
        m[max(0, int((b - pre) * rate)):max(0, int((e + tail) * rate))] = 1.0
    env = np.empty_like(m)
    level = 0.0
    for i, v in enumerate(m):
        level += (v - level) * (0.6 if v > level else 0.07)
        env[i] = level
    return env, rate


def _runs(on, hop_s, min_len=8, max_gap=20, pad=0.04):
    """Stretches of True frames (frames of hop_s seconds) as [(start, end)] in seconds: blips under `min_len` frames
    dropped, gaps under `max_gap` frames joined."""
    runs, start = [], None
    for i, v in enumerate(np.append(on, False)):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                if runs and start - runs[-1][1] < max_gap:
                    runs[-1][1] = i
                else:
                    runs.append([start, i])
            start = None
    return [(max(0.0, a * hop_s - pad), b * hop_s + pad) for a, b in runs]


def _energy_regions(s16, m16):
    """Frames where DPDFNet's speech carries a good part of the stem's energy and is clearly audible: a shout, a
    whisper or a laugh that a voice detector can miss, but the speech model kept."""
    win, hop = 400, 160  # 25 ms every 10 ms
    n = min(len(s16), len(m16))
    if n < win * 4:
        return []
    fs = np.lib.stride_tricks.sliding_window_view(s16[:n], win)[::hop]
    fm = np.lib.stride_tricks.sliding_window_view(m16[:n], win)[::hop]
    es = np.mean(fs.astype(np.float64) ** 2, axis=1)
    em = np.mean(fm.astype(np.float64) ** 2, axis=1)
    db = 10 * np.log10(es + 1e-12)
    loud = np.percentile(db, 97)
    on = (es > 0.35 * em) & (db > max(loud - 30.0, -55.0))
    return _runs(on, hop / VAD_SR)


def _speech_evidence(s, mono, sr):
    """Where speech is: a sensitive voice detector on DPDFNet's speech, the usual one on the whole stem, and the
    energy cue above."""
    from .vad import speech_regions
    s16, m16 = media.resample(s, sr, VAD_SR), media.resample(mono, sr, VAD_SR)
    return speech_regions(s16, pad_ms=60, threshold=0.35) + speech_regions(m16) + _energy_regions(s16, m16)


def _leftover_speech(amb, sr):
    """Voices still in the ambience after the first pass. Only a clear voice over a third of a second counts, so a
    murmuring crowd stays ambience; without Silero (the speech feature) a loudness gate would take birds for voices,
    so then this pass is skipped."""
    from .vad import silero_available, speech_regions
    if not silero_available():
        return []
    a16 = media.resample(amb.mean(axis=1), sr, VAD_SR)
    return [(a, b) for a, b in speech_regions(a16, min_silence_ms=300, pad_ms=80, threshold=0.6) if b - a >= 0.3]


def _masked(voices, mono, s, env, rate, sr, gamma, progress=None, force=None):
    """The speech part of the stem: DPDFNet's mask inside the speech gate; inside `force` the whole stem."""
    from scipy.ndimage import uniform_filter
    from scipy.signal import istft, stft

    n, nfft, hop = len(mono), 2048, 512
    kw = dict(fs=sr, window="hann", nperseg=nfft, noverlap=nfft - hop)
    block, pad = 20 * sr, sr
    speech = np.zeros_like(voices)
    wsum = np.zeros(n, np.float32)
    grid = np.arange(len(env)) / rate
    for a in range(0, n, block):  # blocks keep memory flat for long scenes
        b = min(n, a + block)
        lo, hi = max(0, a - pad), min(n, b + pad)
        _, ft, zs = stft(s[lo:hi], **kw)
        _, _, zv = stft(mono[lo:hi], **kw)
        mask = np.clip(np.abs(zs) / (np.abs(zv) + 1e-6), 0.0, 1.0)
        mask = uniform_filter(mask, size=(3, 3), mode="nearest") ** gamma
        mask *= np.interp(lo / sr + ft, grid, env)[None, :].astype(np.float32)
        if force is not None:
            mask = np.maximum(mask, np.interp(lo / sr + ft, np.arange(len(force)) / rate, force)[None, :].astype(np.float32))
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
            progress(b / n)
    return speech / np.maximum(wsum, 1e-6)[:, None]


def split(voices, sr, progress=None, gamma=GAMMA, known=(), estimate=None):
    """voices: (n, ch) Demucs vocals stem. Returns (speech, ambience, estimate) with speech + ambience == voices.
    `known`: [(start, end)] where speech is known to be (the scene's lines); `estimate`: DPDFNet's speech from an
    earlier split of the same stem, so a second split with the lines costs seconds, not minutes."""
    mono = voices.mean(axis=1)
    if estimate is None:
        with _lock:
            estimate = _clean_speech(mono, sr, progress and (lambda f, msg=None: progress(0.7 * f, msg)))
    s = np.asarray(estimate, dtype=np.float32)[: len(mono)]
    s = np.pad(s, (0, len(mono) - len(s)))
    env, rate = _speech_gate(_speech_evidence(s, mono, sr) + list(known), len(mono), sr)
    speech = _masked(voices, mono, s, env, rate, sr, gamma, progress and (lambda f: progress(0.7 + 0.15 * f)))
    left = _leftover_speech(voices - speech, sr)
    if left:
        force, _ = _speech_gate(left, len(mono), sr, pre=0.05, tail=0.15)
        speech = _masked(voices, mono, s, env, rate, sr, gamma, progress and (lambda f: progress(0.85 + 0.15 * f)), force)
    return speech, voices - speech, s
