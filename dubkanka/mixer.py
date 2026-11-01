"""Final mixdown: background + ambience + dub takes (+ original voice where nobody dubbed) + sound effects.

The browser preview (web/js/engine.js) follows exactly the same rules, keep them in sync.
"""
import secrets

import numpy as np

from . import media
from .i18n import tx

FILL_PRE, FILL_POST, FILL_FADE = 0.15, 0.25, 0.03
TRIM_FADE = 0.004
MUTE_FADE = 0.03  # the ramps around a muted stretch (engine.js MUTE_FADE)
MUTE_TRACKS = ("bg", "amb")


def clean_mutes(items, duration=None):
    """The Mikser's muted stretches of the background and the ambience, as the page sent them: typed, inside the
    scene, at most 300."""
    out = []
    for m in items if isinstance(items, list) else []:
        if not isinstance(m, dict) or m.get("track") not in MUTE_TRACKS:
            continue
        try:
            a, b = max(0.0, float(m.get("start"))), float(m.get("end"))
        except (TypeError, ValueError):
            continue
        if duration:
            b = min(b, float(duration))
        if b - a < 0.02:
            continue
        item = {"id": str(m.get("id") or "")[:16] or "m" + secrets.token_hex(4), "track": m["track"],
                "start": round(a, 3), "end": round(b, 3)}
        if m.get("line"):
            item["line"] = str(m["line"])[:16]
        out.append(item)
    return out[:300]


def mute_windows(p, track):
    """[start, end] stretches of a track to silence, sorted and joined where their ramps would touch."""
    ws = sorted((float(m["start"]), float(m["end"])) for m in (p.get("mix") or {}).get("mutes") or []
                if m.get("track") == track and float(m["end"]) > float(m["start"]))
    out = []
    for a, b in ws:
        if out and a - MUTE_FADE <= out[-1][1] + MUTE_FADE:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def mute_envelope(n, sr, windows):
    """Gain over n samples: 1, ramping to 0 in the MUTE_FADE before each window, 0 inside it, back up after."""
    g = np.ones(n, np.float32)
    f = max(1, int(MUTE_FADE * sr))
    down = np.linspace(1.0, 0.0, f, endpoint=False, dtype=np.float32)
    up = np.linspace(0.0, 1.0, f, endpoint=False, dtype=np.float32)

    def put(at, ramp):
        lo, hi = max(0, at), min(n, at + len(ramp))
        if hi > lo:
            g[lo:hi] = np.minimum(g[lo:hi], ramp[lo - at:hi - at])
    for a, b in windows:
        ia, ib = int(round(a * sr)), int(round(b * sr))
        put(ia - f, down)
        g[max(0, ia):max(0, min(n, ib))] = 0.0
        put(ib, up)
    return g


def _muted(x, sr, p, track):
    """A whole-scene track with its muted stretches silenced."""
    ws = mute_windows(p, track)
    return x * mute_envelope(len(x), sr, ws)[:, None] if ws else x


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
    """(start, end) in project time of the audible part of a take: its position, minus what was trimmed off."""
    s = float(t["start"]) + float(t.get("nudge") or 0)
    return s + float(t.get("trimIn") or 0), s + float(t.get("duration") or 0) - float(t.get("trimOut") or 0)


def trimmed(x, sr, t):
    """The audible slice of a processed take; short fades where a trim cuts into the voice."""
    a = int(round(float(t.get("trimIn") or 0) * sr))
    b = len(x) - int(round(float(t.get("trimOut") or 0) * sr))
    if a <= 0 and b >= len(x):
        return x
    return _fade(x[max(0, a):max(a + 1, b)], sr, TRIM_FADE if a > 0 else 0, TRIM_FADE if b < len(x) else 0)


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
    """mode: 'dub' (final), 'original' (unchanged scene audio), 'clean' (music, effects and ambience: every voice
    removed). Returns (n, 2) float32."""
    if mode == "original":
        x, _ = media.read_audio(d / p["stems"]["original"])
        return x
    if mode == "clean" and p["stems"].get("separated") is False:
        raise media.MediaError(tx("Bu sahnede konuşmalar fondan ayrılmadı, konuşmasız ses yok. Mikser'den konuşmaları ayırabilirsin."))
    bg, sr = media.read_audio(d / p["stems"]["background"])
    bg = _muted(bg, sr, p, "bg")
    n = len(bg)
    mix = p["mix"]
    out = np.zeros((n, 2), dtype=np.float32)
    if mode == "clean":
        if not mix.get("bgMute"):
            out += bg * media.db_to_gain(mix.get("bgGain", 0.0))
        if p["stems"].get("ambience") and not mix.get("ambMute"):
            amb = _muted(media.read_audio(d / p["stems"]["ambience"])[0][:n], sr, p, "amb")
            _add(out, amb * media.db_to_gain(mix.get("ambGain", 0.0)), 0)
        return out
    voices, _ = media.read_audio(d / dialog_stem(p))
    chars = {c["id"]: c for c in p["characters"]}

    windows = []
    for line in p["lines"]:
        t = selected_take(line)
        if t:
            windows.append(take_window(t))
    duck = _duck_envelope(n, sr, windows, float(mix["duck"]))[:, None] if mix.get("duck", 0) > 0 and windows else 1.0

    if not mix.get("bgMute"):
        out += bg * (media.db_to_gain(mix.get("bgGain", 0.0)) * duck)
    if p["stems"].get("ambience") and not mix.get("ambMute"):
        amb = _muted(media.read_audio(d / p["stems"]["ambience"])[0][:n], sr, p, "amb")
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
            _add(out, trimmed(x, sr, t) * g, int(round(take_window(t)[0] * sr)))
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
