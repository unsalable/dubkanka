"""Where speech is in a clip: Silero VAD when the speech feature is installed, a loudness gate otherwise.

The booth trims and aligns every take with this, so it has to work on a fresh install too. A recorded take is a
close microphone in a quiet room: a gate relative to the clip's own noise floor finds the voice reliably there.
"""
import importlib.util

import numpy as np

SR = 16000


def _silero(audio16k, min_silence_ms, pad_ms, threshold):
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    opts = VadOptions(threshold=threshold, min_silence_duration_ms=min_silence_ms, speech_pad_ms=pad_ms,
                      min_speech_duration_ms=60)
    ts = get_speech_timestamps(np.ascontiguousarray(audio16k, dtype=np.float32), opts)
    return [(t["start"] / SR, t["end"] / SR) for t in ts]


def _gate(audio16k, min_silence_ms, pad_ms, threshold):
    """Frames louder than a point between the noise floor and the loud parts, joined across short pauses."""
    win, hop = 400, 160  # 25 ms frames every 10 ms
    x = np.ascontiguousarray(audio16k, dtype=np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, win)[::hop]
    db = 10 * np.log10(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12)
    floor, loud = np.percentile(db, 10), np.percentile(db, 98)
    if loud - floor < 9:  # no level difference anywhere: silence, or noise without a voice in it
        return []
    on = db > max(floor + (0.2 + 0.4 * threshold) * (loud - floor), -55.0)
    regions, start = [], None
    for i, v in enumerate(np.append(on, False)):
        if v and start is None:
            start = i
        elif not v and start is not None:
            regions.append([start * hop / SR, (i * hop + win) / SR])
            start = None
    merged = []
    for r in regions:
        if merged and r[0] - merged[-1][1] < min_silence_ms / 1000:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    pad, dur = pad_ms / 1000, len(x) / SR
    return [(max(0.0, a - pad), min(dur, b + pad)) for a, b in merged if b - a >= 0.06]


def silero_available():
    return importlib.util.find_spec("faster_whisper") is not None


def speech_regions(audio16k, min_silence_ms=200, pad_ms=30, threshold=0.5):
    """Speech regions [(start_s, end_s)] in mono 16 kHz float32 audio."""
    if len(audio16k) < 1600:
        return []
    if silero_available():
        try:
            return _silero(audio16k, min_silence_ms, pad_ms, threshold)
        except Exception:  # a half-installed feature must not stop the booth
            pass
    return _gate(audio16k, min_silence_ms, pad_ms, threshold)
