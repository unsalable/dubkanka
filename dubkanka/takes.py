"""Dub takes: store raw recordings, then trim / align / fit / effects / level-match them to their line."""
import asyncio
import importlib.util
import tempfile
import time
from pathlib import Path

import numpy as np

from . import media
from .config import SAMPLE_RATE
from .projects import find_char, find_line, find_take, new_id, store

EFFECTS = {
    "none": "Efekt yok",
    "chipmunk": "Sincap (ince ses)",
    "giant": "Dev (kalın ses)",
    "robot": "Robot",
    "phone": "Telefon",
    "radio": "Telsiz",
    "megaphone": "Megafon",
    "echo": "Yankı",
    "hall": "Salon / mağara",
    "underwater": "Su altı",
}
_TAIL_EFFECTS = {"echo", "hall", "megaphone"}

TTS_VOICES = {
    "en": [("en-US-GuyNeural", "Guy (erkek, ABD)"), ("en-US-ChristopherNeural", "Christopher (erkek, ABD)"),
           ("en-GB-RyanNeural", "Ryan (erkek, İngiliz)"), ("en-US-JennyNeural", "Jenny (kadın, ABD)"),
           ("en-US-AriaNeural", "Aria (kadın, ABD)"), ("en-GB-SoniaNeural", "Sonia (kadın, İngiliz)")],
    "tr": [("tr-TR-AhmetNeural", "Ahmet (erkek)"), ("tr-TR-EmelNeural", "Emel (kadın)")],
    "de": [("de-DE-ConradNeural", "Conrad (erkek)"), ("de-DE-KatjaNeural", "Katja (kadın)")],
    "fr": [("fr-FR-HenriNeural", "Henri (erkek)"), ("fr-FR-DeniseNeural", "Denise (kadın)")],
    "es": [("es-ES-AlvaroNeural", "Álvaro (erkek)"), ("es-ES-ElviraNeural", "Elvira (kadın)")],
    "it": [("it-IT-DiegoNeural", "Diego (erkek)"), ("it-IT-ElsaNeural", "Elsa (kadın)")],
    "ru": [("ru-RU-DmitryNeural", "Dmitry (erkek)"), ("ru-RU-SvetlanaNeural", "Svetlana (kadın)")],
    "ar": [("ar-SA-HamedNeural", "Hamed (erkek)"), ("ar-SA-ZariyahNeural", "Zariyah (kadın)")],
    "az": [("az-AZ-BabekNeural", "Babək (erkek)"), ("az-AZ-BanuNeural", "Banu (kadın)")],
    "ja": [("ja-JP-KeitaNeural", "Keita (erkek)"), ("ja-JP-NanamiNeural", "Nanami (kadın)")],
    "ko": [("ko-KR-InJoonNeural", "InJoon (erkek)"), ("ko-KR-SunHiNeural", "SunHi (kadın)")],
    "pt": [("pt-BR-AntonioNeural", "Antônio (erkek)"), ("pt-BR-FranciscaNeural", "Francisca (kadın)")],
}


def effect_filters(effect, semitones, tempo):
    caps = media.ffmpeg_caps()
    f = []
    if effect in _TAIL_EFFECTS:
        f.append("apad=pad_dur=1.5")
    semitones += {"chipmunk": 7, "giant": -6}.get(effect, 0)
    if abs(tempo - 1.0) > 0.005 or semitones:
        ratio = 2 ** (semitones / 12.0)
        if caps.get("rubberband"):
            f.append(f"rubberband=tempo={tempo:.4f}:pitch={ratio:.5f}:pitchq=quality")
        else:
            if semitones:
                f += [f"asetrate={int(SAMPLE_RATE * ratio)}", f"aresample={SAMPLE_RATE}"]
            f.append(f"atempo={max(0.5, tempo / ratio):.5f}")
    if effect == "robot":
        f.append("afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75")
    elif effect == "phone":
        f += ["highpass=f=350", "lowpass=f=3400", "acompressor=threshold=0.1:ratio=6:attack=5:release=60",
              "volume=1.6"]
    elif effect == "radio":
        f += ["highpass=f=600", "lowpass=f=2600", "acrusher=bits=6:mix=0.25:mode=log", "volume=1.8"]
    elif effect == "megaphone":
        f += ["highpass=f=500", "lowpass=f=4200", "volume=3", "asoftclip=type=atan", "aecho=0.8:0.5:18:0.25"]
    elif effect == "echo":
        f.append("aecho=0.8:0.8:280|560:0.35|0.18")
    elif effect == "hall":
        f.append("aecho=0.8:0.88:45|73|109|151:0.32|0.26|0.21|0.17")
    elif effect == "underwater":
        f += ["lowpass=f=700", "vibrato=f=5:d=0.35", "volume=1.4"]
    return f


def _apply_filters(x, filters):
    with tempfile.TemporaryDirectory() as td:
        a, b = Path(td) / "in.wav", Path(td) / "out.wav"
        media.write_wav(a, x, subtype="FLOAT")
        media.run_ffmpeg(["-i", a, "-af", ",".join(filters), "-ar", SAMPLE_RATE, "-ac", 1, "-c:a", "pcm_f32le", b])
        y, _ = media.read_audio(b, mono=True)
    return y


def _highpass(x, sr, hz=80.0):
    """Microphone low-cut: rumble, desk knocks and plosive thumps live below the voice."""
    from scipy.signal import butter, sosfilt
    return sosfilt(butter(2, hz, "highpass", fs=sr, output="sos"), x).astype(np.float32)


def _trim_tail(x, sr, floor_db=-55.0):
    if not len(x):
        return x
    n = int(sr * 0.02)
    env = np.abs(x)
    thr = 10 ** (floor_db / 20) * max(1e-4, env.max())
    loud = np.nonzero(env > thr)[0]
    end = min(len(x), (loud[-1] + n) if len(loud) else len(x))
    return x[:end]


def add_take(pid, lid, upload_path, by="Ben", source="booth", rec_start=None, fit=False, align="auto", denoise=False,
             hpf=None):
    """Store an uploaded/recorded file as a new take on the line and select it. Returns the take id."""
    d = store.dir(pid)
    store.get(pid)  # raises KeyError for unknown projects
    tid = new_id("t", 7)
    raw = f"takes/{tid}.raw.wav"
    (d / "takes").mkdir(exist_ok=True)
    try:
        media.to_wav(upload_path, d / raw, SAMPLE_RATE, 1)
    except media.MediaError as e:
        (d / raw).unlink(missing_ok=True)
        raise media.MediaError("Bu dosyada okunabilir bir ses yok. Ses kaydı ya da sesli bir video seç.") from e
    take = {
        "id": tid, "by": (by or "Ben")[:40], "created": time.time(), "source": source, "raw": raw,
        "file": None, "ver": 0, "recStart": rec_start, "align": align if rec_start is not None else "auto",
        "fit": bool(fit), "effect": None, "pitch": 0, "gain": 0.0, "nudge": 0.0, "matchLevel": True,
        "denoise": bool(denoise), "hpf": source == "booth" if hpf is None else bool(hpf), "trimIn": 0.0, "trimOut": 0.0,
        "status": "processing", "error": None,
    }

    def fn(p):
        line = find_line(p, lid)
        line.setdefault("takes", []).append(take)
        line["take"] = tid
    try:
        store.mutate(pid, fn)
    except KeyError:
        (d / raw).unlink(missing_ok=True)
        raise
    return tid


def process_take(pid, lid, tid):
    d = store.dir(pid)
    p = store.get(pid)
    line = find_line(p, lid)
    take = find_take(line, tid)
    char = find_char(p, line["char"]) or {}
    raw, sr = media.read_audio(d / take["raw"], mono=True)
    if sr != SAMPLE_RATE:
        raw, sr = media.resample(raw, sr, SAMPLE_RATE), SAMPLE_RATE
    if take.get("denoise") and len(raw) and importlib.util.find_spec("sherpa_onnx"):  # the "cleanup" feature
        from .ambience import denoise
        raw = denoise(raw, sr)
    if take.get("hpf") and len(raw):
        raw = _highpass(raw, sr)
    total = len(raw) / sr

    from .vad import speech_regions
    regions = speech_regions(media.resample(raw, sr, 16000), min_silence_ms=350, pad_ms=30, threshold=0.45)
    silent = not regions
    v0, v1 = (0.0, total) if silent else (regions[0][0], regions[-1][1])
    head, tail = max(0.0, v0 - 0.06), min(total, v1 + 0.15)
    seg = raw[int(head * sr):int(tail * sr)].copy()
    voice_offset = v0 - head

    tempo = 1.0
    if take.get("fit") and not silent:
        tempo = float(np.clip((v1 - v0) / max(0.2, line["end"] - line["start"]), 0.7, 1.45))
        if abs(tempo - 1.0) < 0.03:
            tempo = 1.0
    effect = take.get("effect") or char.get("effect") or "none"
    semis = float(char.get("pitch") or 0) + float(take.get("pitch") or 0)
    filters = effect_filters(effect, semis, tempo)
    if filters and len(seg):
        seg = _apply_filters(seg, filters)
        voice_offset /= tempo
        seg = _trim_tail(seg, sr)

    auto_gain = 0.0
    if take.get("matchLevel", True) and len(seg):
        ref, _ = media.read_segment(d / (p["stems"].get("speech") or p["stems"]["voices"]), line["start"], line["end"])
        ref_db, take_db = media.active_rms_db(ref, sr), media.active_rms_db(seg, sr)
        if ref_db > -60 and take_db > -70:
            auto_gain = float(np.clip(ref_db - take_db, -18.0, 24.0))
    seg = seg * media.db_to_gain(auto_gain)
    peak = float(np.abs(seg).max()) if len(seg) else 0.0
    if peak > 0.97:
        seg *= 0.97 / peak
        auto_gain += 20 * np.log10(0.97 / peak)
    fi, fo = min(len(seg), int(0.006 * sr)), min(len(seg), int(0.025 * sr))
    if fi:
        seg[:fi] *= np.linspace(0, 1, fi)
    if fo:
        seg[-fo:] *= np.linspace(1, 0, fo)

    if take.get("align", "auto") == "auto" or take.get("recStart") is None:
        start = line["start"] - voice_offset
    else:
        start = float(take["recStart"]) + head
    ver = int(take.get("ver") or 0) + 1
    fname = f"takes/{tid}_{ver}.wav"
    media.write_wav(d / fname, seg)

    def fn(p_):
        t = find_take(find_line(p_, lid), tid)
        old = t.get("file")
        dur = round(len(seg) / sr, 4)
        # trims survive a reprocess, but never eat the whole (possibly shorter) new take
        t_in = min(float(t.get("trimIn") or 0), max(0.0, dur - 0.05))
        t_out = min(float(t.get("trimOut") or 0), max(0.0, dur - t_in - 0.05))
        t.update(file=fname, ver=ver, start=round(start, 4), duration=dur, trimIn=round(t_in, 4),
                 trimOut=round(t_out, 4), voiceOffset=round(voice_offset, 4), autoGain=round(float(auto_gain), 2),
                 tempo=round(tempo, 3), silent=silent, status="ready", error=None)
        return old
    try:
        old = store.mutate(pid, fn)
    except KeyError:  # take or line deleted meanwhile
        (d / fname).unlink(missing_ok=True)
        return None
    if old and old != fname:
        (d / old).unlink(missing_ok=True)
    return fname


def mark_take_error(pid, lid, tid, msg):
    def fn(p):
        t = find_take(find_line(p, lid), tid)
        t.update(status="error", error=msg)
    try:
        store.mutate(pid, fn)
    except KeyError:
        pass


def delete_take(pid, lid, tid):
    d = store.dir(pid)

    def fn(p):
        line = find_line(p, lid)
        t = find_take(line, tid)
        line["takes"] = [x for x in line["takes"] if x["id"] != tid]
        if line.get("take") == tid:
            line["take"] = line["takes"][-1]["id"] if line["takes"] else None
        return t
    t = store.mutate(pid, fn)
    for f in (t.get("raw"), t.get("file")):
        if f:
            (d / f).unlink(missing_ok=True)


async def _edge_tts(text, voice, path):
    import edge_tts
    await edge_tts.Communicate(text, voice).save(str(path))


def tts_take(pid, lid, voice):
    p = store.get(pid)
    line = find_line(p, lid)
    text = (line.get("text") or "").strip()
    if not text:
        raise ValueError("Bu satırın dublaj metni boş.")
    with tempfile.TemporaryDirectory() as td:
        mp3 = Path(td) / "tts.mp3"
        try:
            asyncio.run(_edge_tts(text, voice, mp3))
        except Exception as e:
            raise RuntimeError("Yapay zeka sesi oluşturulamadı (internet bağlantısı gerekli).") from e
        tid = add_take(pid, lid, mp3, by="Yapay zeka", source="tts", fit=True)
    return tid


def system_info():
    return {"effects": EFFECTS, "ttsVoices": TTS_VOICES}
