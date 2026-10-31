"""Final mixdown: background + ambience + dub takes (+ original voice where nobody dubbed) + sound effects.

The browser preview (web/js/engine.js) follows exactly the same rules, keep them in sync.
"""
import numpy as np

from . import media

FILL_PRE, FILL_POST, FILL_FADE = 0.15, 0.25, 0.03


def _add(out, x, pos):
    if pos >= len(out) or pos + len(x) <= 0:
        return
    a, b = max(0, pos), min(len(out), pos + len(x))
    seg = x[a - pos:b - pos]
    if seg.ndim == 1:
        seg = seg[:, None]
    out[a:b] += seg


def _fade(x, sr, fin, fout):
    x = x.copy()
    n1, n2 = min(len(x), int(fin * sr)), min(len(x), int(fout * sr))
    shape = (-1,) + (1,) * (x.ndim - 1)
    if n1:
        x[:n1] *= np.linspace(0, 1, n1).reshape(shape)
    if n2:
        x[-n2:] *= np.linspace(1, 0, n2).reshape(shape)
    return x


def selected_take(line):
    tid = line.get("take")
    for t in line.get("takes", []):
        if t["id"] == tid and t.get("status") == "ready" and t.get("file"):
            return t
    return None


def take_window(t):
    """(start, end) in project time of the audible voice of a take."""
    s = float(t["start"]) + float(t.get("nudge") or 0)
    return s, s + float(t.get("duration") or 0)


def _duck_envelope(n, sr, windows, depth_db):
    rate = 100
    m = np.zeros(n * rate // sr + 2, dtype=np.float32)
    for s, e in windows:
        m[max(0, int((s - 0.05) * rate)):max(0, int((e + 0.1) * rate))] = 1.0
    env = np.empty_like(m)
    level = 0.0
    for i, v in enumerate(m):  # fast attack, slower release
        level += (v - level) * (0.5 if v > level else 0.12)
        env[i] = level
    g = 1.0 - env * (1.0 - media.db_to_gain(-depth_db))
    return np.interp(np.arange(n) / sr, np.arange(len(g)) / rate, g).astype(np.float32)


def dialog_stem(p):
    """The original dialogue: the clean speech stem when ambience was split off, else the whole vocals stem."""
    return p["stems"].get("speech") or p["stems"]["voices"]


def render(p, d, mode="dub"):
    """mode: 'dub' (final), 'original' (unchanged scene audio). Returns (n, 2) float32."""
    if mode == "original":
        x, _ = media.read_audio(d / p["stems"]["original"])
        return x
    bg, sr = media.read_audio(d / p["stems"]["background"])
    voices, _ = media.read_audio(d / dialog_stem(p))
    n = len(bg)
    mix = p["mix"]
    chars = {c["id"]: c for c in p["characters"]}
    out = np.zeros((n, 2), dtype=np.float32)

    windows = []
    for line in p["lines"]:
        t = selected_take(line)
        if t:
            windows.append(take_window(t))
    duck = _duck_envelope(n, sr, windows, float(mix["duck"]))[:, None] if mix.get("duck", 0) > 0 and windows else 1.0

    if not mix.get("bgMute"):
        out += bg * (media.db_to_gain(mix.get("bgGain", 0.0)) * duck)
    if p["stems"].get("ambience") and not mix.get("ambMute"):
        amb = media.read_audio(d / p["stems"]["ambience"])[0][:n]
        _add(out, amb * (media.db_to_gain(mix.get("ambGain", 0.0)) * (duck[: len(amb)] if np.ndim(duck) else duck)), 0)
    if not mix.get("origMute", True) and mix.get("origGain", -60) > -59:
        out += voices * media.db_to_gain(mix["origGain"])

    for line in p["lines"]:
        c = chars.get(line.get("char")) or {}
        t = selected_take(line)
        if t:
            if c.get("mute") or mix.get("dubMute"):
                continue
            x, tsr = media.read_audio(d / t["file"], mono=True)
            if tsr != sr:
                x = media.resample(x, tsr, sr)
            g = media.db_to_gain(float(t.get("gain") or 0) + float(c.get("gain") or 0) + float(mix.get("dubGain", 0)))
            _add(out, x * g, int(round(take_window(t)[0] * sr)))
        elif mix.get("fillMissing", True) and not mix.get("fillMute"):
            a = max(0.0, line["start"] - FILL_PRE)
            b = min(n / sr, line["end"] + FILL_POST)
            seg = voices[int(a * sr):int(b * sr)]
            if len(seg):
                seg = _fade(seg, sr, FILL_FADE, FILL_FADE) * media.db_to_gain(mix.get("fillGain", 0.0))
                _add(out, seg, int(a * sr))

    for s in mix.get("sfx", []):
        if s.get("mute"):
            continue
        x, ssr = media.read_audio(d / s["file"])
        if ssr != sr:
            x = media.resample(x, ssr, sr)
        if x.shape[1] == 1:
            x = np.repeat(x, 2, axis=1)
        _add(out, x[:, :2] * media.db_to_gain(float(s.get("gain") or 0)), int(round(float(s["start"]) * sr)))
    return out
