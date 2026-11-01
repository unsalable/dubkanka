"""Render the finished dub: mixdown + framing + subtitles, encoded with technical options, or the source video stream
copied untouched with only the new audio muxed in."""
import copy
import os
import re
import time
from pathlib import Path

import numpy as np

from . import media
from .config import EXPORTS_DIR, SAMPLE_RATE
from .i18n import tx
from .mixer import render, selected_take, take_window
from .projects import store

FORMATS = {
    "vertical_blur": "Dikey 9:16 - bulanık arka plan",
    "vertical_crop": "Dikey 9:16 - ekranı doldur (kırp)",
    "square": "Kare 1:1",
    "original": "Orijinal boyut",
}
SUBS = {"none": "Altyazı yok", "dub": "Dublaj metni", "both": "Dublaj + orijinal", "orig": "Orijinal metin"}
_FONTS_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts").replace("\\", "/")

VIDEO_DEFAULTS = {"mode": "encode", "codec": "h264", "encoder": "auto", "rc": "crf", "quality": 18, "bitrate": 12.0,
                  "preset": "medium", "fps": "source", "height": "source", "pixfmt": "yuv420p", "gop": 2.0}
AUDIO_DEFAULTS = {"codec": "aac", "bitrate": 192, "sampleRate": 48000, "loudnorm": True, "lufs": -14.0}
# Sharing starts from a copy of the source picture (the user's wish, 1.4): nothing is re-encoded, so nothing is lost.
# Another quality is one click away on the Paylaş screen.
EXPORT_DEFAULTS = {"format": "original", "subs": "dub", "subMode": "soft", "subFont": "Arial Black", "subSize": 1.0,
                   "subPos": None, "subColor": "white", "credits": True, "creditsText": "", "mix": "dub",
                   "preset": "copy", "container": "mp4", "video": {**VIDEO_DEFAULTS, "mode": "copy"},
                   "audio": {**AUDIO_DEFAULTS, "bitrate": 320}}

# In the order they are shown. "tiktok" is the id the standard preset had from the start: saved projects keep
# pointing at it.
PRESETS = {
    "copy": {"label": "Kaynak kopyası", "summary": "Görüntü yeniden kodlanmaz (-c:v copy), sadece ses değişir · AAC 320k",
             "settings": {"format": "original", "container": "mp4", "subMode": "soft",
                          "video": {**VIDEO_DEFAULTS, "mode": "copy"},
                          "audio": {**AUDIO_DEFAULTS, "bitrate": 320}}},
    "high": {"label": "Yüksek kalite", "summary": "H.264 High · CRF 14 · yavaş preset · AAC 320k · -14 LUFS",
             "settings": {"container": "mp4", "subMode": "burn",
                          "video": {**VIDEO_DEFAULTS, "quality": 14, "preset": "slow"},
                          "audio": {**AUDIO_DEFAULTS, "bitrate": 320}}},
    "tiktok": {"label": "Standart", "summary": "H.264 High · CRF 18 · kaynak fps (en fazla 60) · AAC 192k · -14 LUFS",
               "settings": {"container": "mp4", "subMode": "burn",
                            "video": {**VIDEO_DEFAULTS},
                            "audio": {**AUDIO_DEFAULTS}}},
    "small": {"label": "Küçük dosya", "summary": "H.265 · CRF 26 · 720p · AAC 128k",
              "settings": {"container": "mp4", "subMode": "burn",
                           "video": {**VIDEO_DEFAULTS, "codec": "hevc", "quality": 26, "height": 720},
                           "audio": {**AUDIO_DEFAULTS, "bitrate": 128}}},
}
X264_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]
_NV_PRESET = {"ultrafast": "p1", "superfast": "p1", "veryfast": "p2", "faster": "p3", "fast": "p4", "medium": "p5",
              "slow": "p6", "slower": "p7", "veryslow": "p7"}
_QSV_PRESET = {"ultrafast": "veryfast", "superfast": "veryfast", "veryfast": "veryfast", "faster": "faster",
               "fast": "fast", "medium": "medium", "slow": "slow", "slower": "slower", "veryslow": "veryslow"}
_AMF_QUALITY = {"ultrafast": "speed", "superfast": "speed", "veryfast": "speed", "faster": "speed", "fast": "balanced",
                "medium": "balanced", "slow": "quality", "slower": "quality", "veryslow": "quality"}
_AOM_CPU = {"ultrafast": 8, "superfast": 8, "veryfast": 8, "faster": 7, "fast": 6, "medium": 5, "slow": 4, "slower": 3,
            "veryslow": 2}
_SVT_PRESET = {"ultrafast": 12, "superfast": 11, "veryfast": 10, "faster": 9, "fast": 8, "medium": 7, "slow": 5,
               "slower": 4, "veryslow": 2}
FPS_OPTIONS = ["source", 23.976, 24, 25, 29.97, 30, 50, 59.94, 60]
HEIGHT_OPTIONS = ["source", 2160, 1440, 1080, 720]
QUALITY_RANGE = {"h264": (10, 35, 18), "hevc": (10, 38, 22), "av1": (15, 50, 30)}  # min, max, default (CRF / CQ)
CONTAINERS = {"mp4": "MP4 (H.264/H.265/AV1 · her yerde açılır)", "mkv": "MKV (her codec, FLAC/PCM ses)",
              "mov": "MOV (QuickTime, PCM ses)"}
AUDIO_CODECS = {"aac": "AAC-LC", "libopus": "Opus", "flac": "FLAC (kayıpsız)", "pcm_s16le": "PCM 16-bit (kayıpsız)",
                "pcm_s24le": "PCM 24-bit (kayıpsız)"}
_AUDIO_IN = {"mp4": {"aac", "libopus"}, "mov": {"aac", "pcm_s16le", "pcm_s24le"},
             "mkv": {"aac", "libopus", "flac", "pcm_s16le", "pcm_s24le"}}
_COPY_IN = {"mp4": {"h264", "hevc", "av1", "vp9", "mpeg4"}, "mov": {"h264", "hevc", "prores", "mpeg4"}, "mkv": None}
_ISO639 = {"tr": "tur", "en": "eng", "de": "ger", "fr": "fre", "es": "spa", "it": "ita", "pt": "por", "ru": "rus",
           "ar": "ara", "az": "aze", "ja": "jpn", "ko": "kor", "zh": "chi", "nl": "dut", "pl": "pol", "uk": "ukr",
           "el": "gre", "fa": "per", "hi": "hin", "sv": "swe"}
_CODEC_NAMES = {"h264": "H.264", "hevc": "H.265", "av1": "AV1", "vp9": "VP9", "mpeg4": "MPEG-4", "prores": "ProRes"}
_MEDIA_TYPES = {".mp4": "video/mp4", ".mkv": "video/x-matroska", ".mov": "video/quicktime"}


def _ts(t):
    t = max(0.0, t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def _srt_ts(t):
    ms = int(round(max(0.0, t) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ass_color(hex_rgb, alpha=0):
    h = hex_rgb.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def _ass_text(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s.replace("\\", "/").replace("{", "(").replace("}", ")")


def subtitle_events(p):
    """[(start, end, line)] using the dub take timing when there is one."""
    dur = (p.get("clip") or {}).get("duration") or 0
    out = []
    for line in p["lines"]:
        t = selected_take(line)
        if t:
            s, e = take_window(t)
            s += float(t.get("voiceOffset") or 0) - 0.05
            e += 0.15
        else:
            s, e = line["start"] - 0.05, line["end"] + 0.25
        out.append((max(0.0, s), min(dur or e, e), line))
    out.sort(key=lambda x: x[0])
    for i in range(len(out) - 1):  # avoid stacked subtitles when lines touch
        s, e, l = out[i]
        if e > out[i + 1][0] - 0.02 and out[i + 1][0] > s + 0.3:
            out[i] = (s, out[i + 1][0] - 0.02, l)
    return out


def credits_text(p):
    if p["export"].get("creditsText", "").strip():
        return p["export"]["creditsText"].strip()
    names = {}
    for line in p["lines"]:
        t = selected_take(line)
        if t and t.get("source") != "tts":
            names.setdefault(line["char"], []).append(t.get("by") or "")
    parts = []
    for c in p["characters"]:
        actors = [a for a in dict.fromkeys(names.get(c["id"], [])) if a]
        if actors:
            parts.append(f"{c['name']}: {', '.join(actors)}")
    return (tx("Seslendirenler — ") + "  •  ".join(parts)) if parts else ""


def build_ass(p, W, H, fmt, fg_box):
    ex = p["export"]
    size = max(24, int(min(W, H) * 0.058 * float(ex.get("subSize") or 1.0)))
    pos = ex.get("subPos")
    if pos is None:
        if fmt == "vertical_blur" and fg_box[3] < H * 0.8:
            pos = min(0.86, (fg_box[1] + fg_box[3]) / H + 2.6 * size / H)
        elif fmt == "vertical_crop":
            pos = 0.74
        else:
            pos = 0.93
    margin_v = max(10, int(H * (1.0 - float(pos))))
    font = ex.get("subFont") or "Arial Black"
    outline = max(2, int(size * 0.09))
    side = int(W * 0.06)
    styles = [
        f"Style: Dub,{font},{size},&H00FFFFFF,&H000000FF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,1,{outline},1,2,{side},{side},{margin_v},1",
        f"Style: Orig,Arial,{int(size * 0.62)},&H00E6E6E6,&H000000FF,&H00000000,&H78000000,0,-1,0,0,100,100,0,0,1,{max(2, outline - 2)},0,2,{side},{side},{margin_v + int(size * 1.35)},1",
        f"Style: Credits,Arial,{int(size * 0.55)},&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,{max(2, outline // 2)},0,8,{side},{side},{int(H * 0.06)},1",
    ]
    chars = {c["id"]: c for c in p["characters"]}
    mode = ex.get("subs", "dub")
    events = []
    for s, e, line in subtitle_events(p):
        if e - s < 0.1:
            continue
        dub, orig = _ass_text(line.get("text")), _ass_text(line.get("orig"))
        color = ""
        if ex.get("subColor") == "character" and chars.get(line["char"]):
            color = "{\\c" + _ass_color(chars[line["char"]]["color"]).replace("&H00", "&H") + "&}"
        if mode in ("dub", "both") and dub:
            events.append(f"Dialogue: 1,{_ts(s)},{_ts(e)},Dub,,0,0,0,,{color}{dub}")
        if mode == "orig" and orig:
            events.append(f"Dialogue: 1,{_ts(s)},{_ts(e)},Dub,,0,0,0,,{color}{orig}")
        if mode == "both" and orig:
            events.append(f"Dialogue: 0,{_ts(s)},{_ts(e)},Orig,,0,0,0,,{orig}")
    if ex.get("credits", True):
        txt = _ass_text(credits_text(p))
        dur = (p.get("clip") or {}).get("duration") or 0
        if txt and dur:
            events.append(f"Dialogue: 2,{_ts(max(0, dur - 3.5))},{_ts(dur)},Credits,,0,0,0,,{txt}")
    head = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0",
            "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
            "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
            "MarginL, MarginR, MarginV, Encoding"] + styles + [
            "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    return "\n".join(head + events) + "\n", bool(events)


def srt(p, which="dub", offset=0.0, credits=False):
    rows = []
    events = [(s, e, (line.get("orig") if which == "orig" else line.get("text")) or "") for s, e, line in subtitle_events(p)]
    if credits and credits_text(p):
        dur = (p.get("clip") or {}).get("duration") or 0
        events.append((max(0.0, dur - 3.5), dur, credits_text(p)))
    for s, e, text in events:
        if text.strip():
            rows.append(f"{len(rows) + 1}\n{_srt_ts(s + offset)} --> {_srt_ts(e + offset)}\n{text.strip()}\n")
    return "\n".join(rows)


def _even(x):
    return max(2, int(round(x / 2)) * 2)


def _geometry(fmt, w0, h0, height="source"):
    """Output size and the box (x, y, w, h) the scene occupies inside it. `height` is the resolution class (the short
    side): the source's for original size, 1080 for the 9:16 and square canvases unless a bigger one is asked for."""
    if fmt == "original":
        s = 1.0 if height == "source" else int(height) / max(1, min(w0, h0))
        W, H = _even(w0 * s), _even(h0 * s)
        return W, H, (0, 0, W, H)
    short = 1080 if height == "source" else int(height)
    W, H = (short, short) if fmt == "square" else (short, _even(short * 16 / 9))
    if fmt == "vertical_crop":
        return W, H, (0, 0, W, H)
    s = min(W / w0, H / h0)
    fw, fh = int(w0 * s) // 2 * 2, int(h0 * s) // 2 * 2
    return W, H, ((W - fw) // 2, (H - fh) // 2, fw, fh)


def _safe_name(s):
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", s or "dublaj").strip().rstrip(".")
    return (s or "dublaj")[:60]


# ---------------------------------------------------------------- settings
def merge(dst, src):
    """Deep merge for the nested export settings (video, audio) so a partial patch keeps the other fields."""
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            merge(dst[k], v)
        else:
            dst[k] = copy.deepcopy(v)
    return dst


def normalize_export(ex):
    """A complete, typed copy of a project's export settings. Projects from 1.0 only had quality: high|normal."""
    ex = ex or {}
    out = copy.deepcopy(EXPORT_DEFAULTS)
    if "video" not in ex and ex.get("quality") == "normal":
        out["preset"], out["video"]["quality"] = "custom", 23
    merge(out, {k: v for k, v in ex.items() if k in EXPORT_DEFAULTS})
    v, a = out["video"], out["audio"]
    v["mode"] = "copy" if v.get("mode") == "copy" else "encode"
    v["codec"] = v.get("codec") if v.get("codec") in QUALITY_RANGE else "h264"
    lo, hi, default = QUALITY_RANGE[v["codec"]]
    v["quality"] = int(min(hi, max(lo, round(_num(v.get("quality"), default)))))
    v["bitrate"] = round(min(200.0, max(0.5, _num(v.get("bitrate"), 12.0))), 2)
    v["rc"] = v.get("rc") if v.get("rc") in ("crf", "vbr", "cbr") else "crf"
    v["preset"] = v.get("preset") if v.get("preset") in X264_PRESETS else "medium"
    v["encoder"] = str(v.get("encoder") or "auto")
    fps = v.get("fps")
    v["fps"] = "source" if fps in (None, "", "source") or _num(fps, 0) not in [f for f in FPS_OPTIONS if f != "source"] else _num(fps, 0)
    h = v.get("height")
    v["height"] = "source" if h in (None, "", "source") or int(_num(h, 0)) not in HEIGHT_OPTIONS[1:] else int(_num(h, 0))
    v["pixfmt"] = "yuv420p10le" if v.get("pixfmt") == "yuv420p10le" else "yuv420p"
    v["gop"] = min(10.0, max(0.5, _num(v.get("gop"), 2.0)))
    a["codec"] = a.get("codec") if a.get("codec") in AUDIO_CODECS else "aac"
    a["bitrate"] = int(min(512, max(48, _num(a.get("bitrate"), 192))))
    a["sampleRate"] = 44100 if int(_num(a.get("sampleRate"), 48000)) == 44100 else 48000
    a["loudnorm"] = bool(a.get("loudnorm", True))
    a["lufs"] = min(-5.0, max(-30.0, _num(a.get("lufs"), -14.0)))
    for key, allowed, default in (("container", CONTAINERS, "mp4"), ("format", FORMATS, "vertical_blur"),
                                  ("subs", SUBS, "dub")):
        out[key] = out.get(key) if out.get(key) in allowed else default
    out["mix"] = out.get("mix") if out.get("mix") in ("dub", "clean", "original") else "dub"
    out["subMode"] = "soft" if out.get("subMode") == "soft" else "burn"
    return out


def _num(v, default):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def pick_encoder(v):
    """The encoder for the chosen codec: the asked one, or the best working one (hardware first)."""
    encs = [e for e in media.ffmpeg_caps()["encoders"] if e["codec"] == v["codec"]]
    if v["encoder"] not in ("", "auto"):
        e = next((e for e in encs if e["id"] == v["encoder"]), None)
        if not e:
            raise media.MediaError(tx("{enc} kodlayıcısı bu bilgisayarda çalışmıyor. Otomatik seçimi kullan.", enc=v["encoder"]))
        return e
    ten = v["pixfmt"] == "yuv420p10le"
    pool = [e for e in encs if e["tenBit"] or not ten]
    if not pool:
        raise media.MediaError(tx("Bu bilgisayarda {codec} kodlayabilen bir kodlayıcı yok.",
                                  codec=_CODEC_NAMES[v["codec"]] + (" 10-bit" if ten else "")))
    return pool[0]


def problems(ex, src_info):
    """Why these settings cannot be exported (Turkish, for the user), or None."""
    v, a, box = ex["video"], ex["audio"], ex["container"]
    if v["mode"] == "copy":
        if ex["format"] != "original":
            return tx("Kaynak kopyası sadece orijinal boyutta olur: 9:16 ve kare için görüntünün yeniden çizilmesi gerekir.")
        if ex["subs"] != "none" and ex["subMode"] == "burn":
            return tx("Kaynak kopyasında altyazı görüntüye yakılamaz. Altyazıyı ayrı iz yap ya da kapat.")
        if not src_info:
            return tx("Projenin kaynak videosu bulunamadı, görüntü kopyalanamaz.")
        allowed = _COPY_IN[box]
        if allowed is not None and src_info.get("vcodec") not in allowed:
            name = _CODEC_NAMES.get(src_info.get("vcodec"), src_info.get("vcodec") or "?")
            return tx("{codec} görüntüsü {box} içine kopyalanamaz. Kapsayıcı olarak MKV seç.", codec=name, box=box.upper())
    else:
        if v["pixfmt"] == "yuv420p10le" and v["codec"] == "h264":
            return tx("10-bit sadece H.265 ve AV1 ile olur.")
        if v["codec"] == "av1" and box == "mov":
            return tx("AV1, MOV içine konamaz. MP4 ya da MKV seç.")
        try:
            enc = pick_encoder(v)
        except media.MediaError as e:
            return str(e)
        if v["pixfmt"] == "yuv420p10le" and not enc["tenBit"]:
            return tx("{enc} 10-bit kodlayamıyor. 8-bit seç ya da başka bir kodlayıcı kullan.", enc=tx(enc["label"]))
    if a["codec"] not in _AUDIO_IN[box]:
        fit = [c.upper() for c, codecs in _AUDIO_IN.items() if a["codec"] in codecs]
        return tx("{codec} sesi {box} içine konamaz. Kapsayıcı olarak {fit} seç.", codec=tx(AUDIO_CODECS[a["codec"]]),
                  box=box.upper(), fit=tx(" ya da ").join(fit))
    return None


# ---------------------------------------------------------------- ffmpeg arguments
def _fps_expr(fps):
    for ntsc, frac in ((23.976, "24000/1001"), (29.97, "30000/1001"), (59.94, "60000/1001")):
        if abs(fps - ntsc) < 0.01:
            return frac
    return f"{fps:g}"


def _rate_args(rc, br):
    if rc == "vbr":
        return ["-b:v", f"{br:g}M", "-maxrate", f"{br * 1.5:g}M", "-bufsize", f"{br * 2:g}M"]
    return ["-b:v", f"{br:g}M", "-maxrate", f"{br:g}M", "-bufsize", f"{br:g}M"]


def video_args(v, enc, fps, box):
    e, q, ten, pre = enc["id"], str(v["quality"]), v["pixfmt"] == "yuv420p10le", v["preset"]
    crf = v["rc"] == "crf"
    if e in ("libx264", "libx265"):
        args = ["-c:v", e, "-preset", pre] + (["-crf", q] if crf else _rate_args(v["rc"], v["bitrate"]))
        args += ["-profile:v", "high", "-pix_fmt", "yuv420p"] if e == "libx264" else [
            "-pix_fmt", "yuv420p10le" if ten else "yuv420p", "-x265-params", "log-level=error"]
    elif e.endswith("_nvenc"):
        args = ["-c:v", e, "-preset", _NV_PRESET[pre], "-tune", "hq", "-spatial-aq", "1"]
        if crf:
            args += ["-rc", "vbr", "-cq", q, "-b:v", "0"]
        else:
            args += ["-rc", "vbr" if v["rc"] == "vbr" else "cbr"] + _rate_args(v["rc"], v["bitrate"])
        args += ["-pix_fmt", "p010le" if ten else "yuv420p"]
        if e != "av1_nvenc":
            args += ["-profile:v", "high" if e == "h264_nvenc" else "main10" if ten else "main"]
    elif e.endswith("_qsv"):
        args = ["-c:v", e, "-preset", _QSV_PRESET[pre]] + (["-global_quality", q] if crf else _rate_args(v["rc"], v["bitrate"]))
        args += ["-pix_fmt", "p010le" if ten else "nv12"]
    elif e.endswith("_amf"):
        args = ["-c:v", e, "-quality", _AMF_QUALITY[pre]]
        if crf:
            args += ["-rc", "cqp", "-qp_i", q, "-qp_p", q] + ([] if e == "av1_amf" else ["-qp_b", q])
        else:
            args += ["-rc", "vbr_peak" if v["rc"] == "vbr" else "cbr"] + _rate_args(v["rc"], v["bitrate"])
        args += ["-pix_fmt", "p010le" if ten else "nv12"]
    elif e == "libsvtav1":
        args = ["-c:v", e, "-preset", str(_SVT_PRESET[pre])] + (["-crf", q] if crf else _rate_args(v["rc"], v["bitrate"]))
        args += ["-pix_fmt", "yuv420p10le" if ten else "yuv420p"]
    else:  # libaom-av1
        args = ["-c:v", e, "-cpu-used", str(_AOM_CPU[pre]), "-row-mt", "1"]
        args += ["-crf", q, "-b:v", "0"] if crf else _rate_args(v["rc"], v["bitrate"])
        args += ["-pix_fmt", "yuv420p10le" if ten else "yuv420p"]
    args += ["-g", str(max(1, int(round(fps * v["gop"]))))]
    if v["codec"] == "hevc" and box in ("mp4", "mov"):
        args += ["-tag:v", "hvc1"]  # Apple players and TikTok want hvc1, not hev1
    return args


def audio_args(a):
    c = a["codec"]
    rate = 48000 if c == "libopus" else a["sampleRate"]
    args = ["-c:a", c, "-ar", str(rate), "-ac", "2"]
    if c in ("aac", "libopus"):
        args += ["-b:a", f"{a['bitrate']}k"]
    return args


def _loudness_filter(path, lufs):
    m = media.measure_loudness(path, lufs, -1.0)
    try:
        if float(m["input_i"]) < -70:  # silence or nearly: nothing to normalise
            return None
    except ValueError:
        return None
    return (f"loudnorm=I={lufs:g}:TP=-1:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
            f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")


def _source_audio(src, at, dur, has_audio):
    """Stereo float audio of the source between `at` and `at + dur` (silence when the source has none)."""
    n = int(round(dur * SAMPLE_RATE))
    if not has_audio or n <= 0:
        return np.zeros((max(0, n), 2), np.float32)
    tmp = Path(str(src) + ".gap.wav")
    try:
        media.run_ffmpeg(["-ss", f"{at:.6f}", "-t", f"{dur:.6f}", "-i", src, "-vn", "-ac", 2, "-ar", SAMPLE_RATE,
                          "-c:a", "pcm_f32le", tmp])
        x, _ = media.read_audio(tmp)
    finally:
        tmp.unlink(missing_ok=True)
    x = x[:n] if len(x) >= n else np.pad(x, ((0, n - len(x)), (0, 0)))
    return x.astype(np.float32)


def _join(pre, mix):
    """Original audio up to the cut, then the mix; 10 ms fades so the seam never clicks."""
    f = min(len(pre), len(mix), int(0.01 * SAMPLE_RATE))
    if f:
        pre = pre.copy()
        mix = mix.copy()
        pre[-f:] *= np.linspace(1, 0, f)[:, None]
        mix[:f] *= np.linspace(0, 1, f)[:, None]
    return np.concatenate([pre, mix]).astype(np.float32)


def _summary(path, copied):
    """What actually came out: read back from the file, not from the settings."""
    try:
        i = media.probe(path)
    except media.MediaError:
        return ""
    v = f"{_CODEC_NAMES.get(i.get('vcodec'), (i.get('vcodec') or '').upper())}"
    if i.get("profile"):
        v += f" {i['profile']}"
    if "10" in (i.get("pixfmt") or ""):
        v += " 10-bit"
    if copied:
        v += tx(" (kaynaktan kopya)")
    parts = [v, f"{i.get('width')}×{i.get('height')}", f"{i.get('fps', 0):g} fps"]
    if i.get("acodec"):
        a = {"aac": "AAC", "opus": "Opus", "flac": "FLAC"}.get(i["acodec"], i["acodec"].upper())
        parts.append(f"{a} {round(i['abitrate'] / 1000)}k" if i.get("abitrate") and i["acodec"] in ("aac", "opus") else a)
    return " · ".join(parts)


# ---------------------------------------------------------------- export
def _source_of(p, d):
    """The imported file (for stream copy and first-generation encodes) and its probe, or (None, None)."""
    src = d / p["source"]["file"] if p.get("source") and p["source"].get("file") else None
    if not src or not src.exists():
        return None, None
    try:
        return src, media.probe(src)
    except media.MediaError:
        return None, None


def run_export(job, pid, opts):
    p = store.get(pid)
    d = store.dir(pid)
    if not p.get("clip") or not p.get("stems"):
        raise media.MediaError(tx("Önce sahneyi hazırla."))
    if opts:
        store.mutate(pid, lambda p_: merge(p_["export"], {k: v for k, v in opts.items() if k in EXPORT_DEFAULTS}))
        p = store.get(pid)
    ex = p["export"] = normalize_export(p["export"])
    v, a = ex["video"], ex["audio"]
    fmt, box = ex["format"], ex["container"]
    clip = p["clip"]
    dur = clip["duration"]
    src, info = _source_of(p, d)
    err = problems(ex, info)
    if err:
        raise media.MediaError(err)
    copying = v["mode"] == "copy"
    start = float((p.get("trim") or {}).get("start") or 0)

    job.update(0.02, tx("Sesler karıştırılıyor..."))
    audio = render(p, d, ex["mix"])
    gap, key = 0.0, start
    if copying:  # the copy has to begin on a keyframe: the original audio fills the frames before the cut
        key = media.keyframe_before(src, start, info.get("startTime", 0.0))
        gap = max(0.0, start - key)
        if gap > 0.0005:
            audio = _join(_source_audio(src, key, gap, info.get("hasAudio")), audio)
    out_dur = gap + dur
    mix_path = d / "media" / "export_mix.wav"
    media.write_wav(mix_path, audio, SAMPLE_RATE, subtype="FLOAT")
    del audio

    af = None
    if a["loudnorm"] and media.ffmpeg_caps().get("loudnorm"):
        job.update(0.05, tx("Ses seviyesi ölçülüyor (EBU R128)..."))
        af = _loudness_filter(mix_path, a["lufs"])
    af = (af or "alimiter=limit=0.95:level=false") + f",aresample={48000 if a['codec'] == 'libopus' else a['sampleRate']}"

    sub_in, sub_map, sub_args = [], [], []
    if ex["subs"] != "none" and ex["subMode"] == "soft":
        tracks = [("dub", p["settings"].get("dstLang"))] if ex["subs"] in ("dub", "both") else []
        if ex["subs"] in ("orig", "both"):
            tracks.append(("orig", p["settings"].get("srcLang") if p["settings"].get("srcLang") not in (None, "auto")
                           else p.get("detectedLang")))
        for i, (which, lang) in enumerate(tracks):
            f = d / "media" / f"subs_{which}.srt"
            f.write_text(srt(p, which, gap, credits=ex["credits"] and which == "dub"), encoding="utf-8")
            sub_in += ["-i", f"media/subs_{which}.srt"]
            sub_map += ["-map", f"{2 + i}:s:0"]
            sub_args += [f"-metadata:s:s:{i}", f"language={_ISO639.get(lang or '', 'und')}",
                         f"-metadata:s:s:{i}", "title=" + (tx("Dublaj") if which == "dub" else tx("Orijinal"))]
        sub_args = (["-c:s", "srt" if box == "mkv" else "mov_text"] + sub_args) if tracks else []

    dst_lang = _ISO639.get(p["settings"].get("dstLang") or "", "und") if ex["mix"] == "dub" else "und"
    tail = ["-af", af, *audio_args(a), *sub_args, "-metadata:s:a:0", f"language={dst_lang}", "-t", f"{out_dur:.3f}"]
    if box in ("mp4", "mov"):
        tail += ["-movflags", "+faststart"]

    if copying:
        W, H = info["width"], info["height"]
        args = ["-ss", f"{key:.6f}", "-i", str(src), "-i", "media/export_mix.wav", *sub_in,
                "-map", "0:v:0", "-map", "1:a:0", *sub_map, "-c:v", "copy", *tail]
        msg = tx("Görüntü kaynaktan kopyalanıyor, ses ekleniyor...")
    else:
        enc = pick_encoder(v)
        if info:  # first generation: decode the original, not the scene's working copy
            vin = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(src)]
            w0, h0, src_fps = info["width"], info["height"], info.get("fps")
        else:
            vin = ["-i", "media/master.mp4"]
            w0, h0, src_fps = clip.get("width") or 1280, clip.get("height") or 720, clip.get("fps")
        fps = min(60.0, src_fps or 30.0) if v["fps"] == "source" else float(v["fps"])
        W, H, fg = _geometry(fmt, w0, h0, v["height"])
        rate = f"fps={_fps_expr(fps)}"
        if fmt in ("vertical_blur", "square"):
            graph = (f"[0:v]{rate},split=2[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                     f"gblur=sigma={26 * W / 1080:.1f},eq=brightness=-0.07[bg];[b]scale={fg[2]}:{fg[3]}:flags=lanczos[fg];"
                     f"[bg][fg]overlay={fg[0]}:{fg[1]},setsar=1[v0]")
        elif fmt == "vertical_crop":
            graph = f"[0:v]{rate},scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},setsar=1[v0]"
        else:
            graph = f"[0:v]{rate},scale={W}:{H}:flags=lanczos,setsar=1[v0]"
        last = "v0"
        if ex["subMode"] == "burn" and (ex["subs"] != "none" or ex["credits"]):
            ass, has_events = build_ass(p, W, H, fmt, fg)
            if has_events:
                (d / "media" / "subs.ass").write_text(ass, encoding="utf-8")
                fonts = _FONTS_DIR.replace(":", "\\:")
                graph += f";[v0]ass=media/subs.ass:fontsdir='{fonts}'[v1]"
                last = "v1"
        args = [*vin, "-i", "media/export_mix.wav", *sub_in, "-filter_complex", graph, "-map", f"[{last}]",
                "-map", "1:a:0", *sub_map, *video_args(v, enc, fps, box), *tail]
        msg = tx("Video oluşturuluyor ({enc})...", enc=tx(enc["label"]))

    stamp = time.strftime("%Y%m%d-%H%M%S")
    short = tx("Kaynak") if copying else tx({"vertical_blur": "Dikey", "vertical_crop": "Dikey-kirp", "square": "Kare",
                                             "original": "Orijinal"}[fmt])
    tag = {"dub": "", "clean": " - " + tx("Konusmasiz"), "original": " - " + tx("Orijinal ses")}[ex["mix"]]
    name = f"{_safe_name(p['name'])} - {short}{tag} - {stamp}.{box}"
    out = EXPORTS_DIR / name
    tmp = EXPORTS_DIR / f"{name}.part.{box}"
    job.update(0.08, msg)
    try:
        media.run_ffmpeg([*args, str(tmp)], duration=out_dur, progress=lambda f: job.update(0.08 + 0.9 * f), cwd=str(d))
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)
        mix_path.unlink(missing_ok=True)
    entry = {"file": name, "created": time.time(), "format": fmt, "size": out.stat().st_size, "width": W, "height": H,
             "duration": round(out_dur, 3), "container": box, "mix": ex["mix"], "summary": _summary(out, copying)}
    if copying:
        entry["keyframe"] = {"requested": round(start, 3), "actual": round(key, 3), "offset": round(gap, 3)}
    store.mutate(pid, lambda p_: p_.setdefault("exports", []).insert(0, entry))
    job.update(1.0, tx("Video hazır."))
    return entry


def export_info(p, d):
    """Source details and whether a stream copy is possible (and where it would have to start)."""
    src, info = _source_of(p, d)
    trim = p.get("trim") or {}
    out = {"source": None, "clip": {"start": trim.get("start"), "end": trim.get("end"),
                                    "duration": (p.get("clip") or {}).get("duration")},
           "copy": {"possible": False, "reason": None, "keyframe": None}}
    if info:
        out["source"] = {k: info.get(k) for k in ("width", "height", "fps", "vcodec", "profile", "pixfmt", "acodec",
                                                  "sampleRate", "channels", "duration", "size", "rotation")}
        out["source"].update(bitrate=info.get("vbitrate") or info.get("bitrate"), abitrate=info.get("abitrate"),
                             container=Path(src).suffix.lstrip(".").lower(), file=p["source"].get("originalName"))
        start = float(trim.get("start") or 0)
        key = media.keyframe_before(src, start, info.get("startTime", 0.0))
        frame = 1.0 / max(1.0, info.get("fps") or 25.0)
        out["copy"]["keyframe"] = {"requested": round(start, 3), "actual": round(key, 3), "offset": round(start - key, 3),
                                   "exact": start - key < frame / 2}
    ex = normalize_export(p.get("export"))
    test = merge(copy.deepcopy(ex), {"format": "original", "video": {"mode": "copy"},
                                     "subMode": "soft" if ex["subs"] != "none" else ex["subMode"]})
    out["copy"]["reason"] = problems(test, info)
    out["copy"]["possible"] = out["copy"]["reason"] is None
    out["problem"] = problems(ex, info)
    return out


def export_path(name):
    f = (EXPORTS_DIR / name).resolve()
    if f.parent != EXPORTS_DIR.resolve() or not f.exists():
        raise FileNotFoundError(name)
    return f


def media_type(name):
    return _MEDIA_TYPES.get(Path(name).suffix.lower(), "application/octet-stream")


def export_wav(p, d, mode="dub"):
    out = d / "media" / f"download_{mode}.wav"
    media.write_wav(out, render(p, d, mode), SAMPLE_RATE)
    return Path(out)


def system_info():
    """The export options, their names in the request's language."""
    caps = media.ffmpeg_caps() if media.has_ffmpeg() else {"encoders": []}
    names = lambda d: {k: tx(v) for k, v in d.items()}  # noqa: E731
    presets = {k: {**v, "label": tx(v["label"]), "summary": tx(v["summary"])} for k, v in PRESETS.items()}
    return {"formats": names(FORMATS), "subs": names(SUBS), "exportPresets": presets, "exportDefaults": EXPORT_DEFAULTS,
            "encoders": [{**e, "label": tx(e["label"])} for e in caps["encoders"]], "containers": names(CONTAINERS),
            "audioCodecs": names(AUDIO_CODECS),
            "fpsOptions": FPS_OPTIONS, "heightOptions": HEIGHT_OPTIONS, "qualityRange": QUALITY_RANGE,
            "encoderPresets": X264_PRESETS}
