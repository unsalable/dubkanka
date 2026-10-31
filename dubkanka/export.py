"""Render the finished dub: mixdown + TikTok-ready framing + burned-in subtitles."""
import os
import re
import time
from pathlib import Path

from . import media
from .config import EXPORTS_DIR, SAMPLE_RATE
from .mixer import render, selected_take, take_window
from .projects import store

FORMATS = {
    "vertical_blur": "TikTok / Reels 9:16 - bulanık arka plan",
    "vertical_crop": "TikTok / Reels 9:16 - ekranı doldur (kırp)",
    "square": "Kare 1:1",
    "original": "Orijinal boyut",
}
SUBS = {"none": "Altyazı yok", "dub": "Dublaj metni", "both": "Dublaj + orijinal", "orig": "Orijinal metin"}
_FONTS_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts").replace("\\", "/")


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
    return ("Seslendirenler — " + "  •  ".join(parts)) if parts else ""


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


def srt(p, which="dub"):
    rows = []
    for i, (s, e, line) in enumerate(subtitle_events(p), 1):
        text = (line.get("orig") if which == "orig" else line.get("text")) or ""
        if text.strip():
            rows.append(f"{len(rows) + 1}\n{_srt_ts(s)} --> {_srt_ts(e)}\n{text.strip()}\n")
    return "\n".join(rows)


def _geometry(fmt, w0, h0):
    """Output size and the box (x, y, w, h) the scene occupies inside it."""
    if fmt == "original":
        return w0, h0, (0, 0, w0, h0)
    W, H = (1080, 1080) if fmt == "square" else (1080, 1920)
    if fmt == "vertical_crop":
        return W, H, (0, 0, W, H)
    s = min(W / w0, H / h0)
    fw, fh = int(w0 * s) // 2 * 2, int(h0 * s) // 2 * 2
    return W, H, ((W - fw) // 2, (H - fh) // 2, fw, fh)


def _safe_name(s):
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", s or "dublaj").strip().rstrip(".")
    return (s or "dublaj")[:60]


def run_export(job, pid, opts):
    p = store.get(pid)
    d = store.dir(pid)
    if not p.get("clip") or not p.get("stems"):
        raise media.MediaError("Önce sahneyi hazırla.")
    if opts:
        store.mutate(pid, lambda p_: p_["export"].update({k: v for k, v in opts.items() if k in p_["export"]}))
        p = store.get(pid)
    ex = p["export"]
    fmt = ex.get("format", "vertical_blur")
    clip = p["clip"]
    dur = clip["duration"]

    job.update(0.02, "Sesler karıştırılıyor...")
    mix = render(p, d, "dub")
    mix_path = d / "media" / "export_mix.wav"
    media.write_wav(mix_path, mix, SAMPLE_RATE, subtype="FLOAT")
    del mix

    w0, h0 = clip.get("width") or 1280, clip.get("height") or 720
    W, H, box = _geometry(fmt, w0, h0)
    if fmt in ("vertical_blur", "square"):
        graph = (f"[0:v]split=2[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                 f"gblur=sigma=26,eq=brightness=-0.07[bg];[b]scale={box[2]}:{box[3]}[fg];"
                 f"[bg][fg]overlay={box[0]}:{box[1]},setsar=1[v0]")
    elif fmt == "vertical_crop":
        graph = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[v0]"
    else:
        graph = f"[0:v]scale={W}:{H},setsar=1[v0]"
    last = "v0"
    if ex.get("subs", "dub") != "none" or ex.get("credits", True):
        ass, has_events = build_ass(p, W, H, fmt, box)
        if has_events:
            (d / "media" / "subs.ass").write_text(ass, encoding="utf-8")
            fonts = _FONTS_DIR.replace(":", "\\:")
            graph += f";[v0]ass=media/subs.ass:fontsdir='{fonts}'[v1]"
            last = "v1"
    fps = min(60.0, clip.get("fps") or 30.0)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    short = {"vertical_blur": "TikTok", "vertical_crop": "TikTok-kirp", "square": "Kare", "original": "Orijinal"}[fmt]
    name = f"{_safe_name(p['name'])} - {short} - {stamp}.mp4"
    out = EXPORTS_DIR / name
    tmp = EXPORTS_DIR / (name + ".part.mp4")
    quality = "high" if ex.get("quality", "high") == "high" else "normal"
    args = ["-i", "media/master.mp4", "-i", "media/export_mix.wav", "-filter_complex", graph,
            "-map", f"[{last}]", "-map", "1:a:0", "-r", f"{fps:.3f}"] + media.video_encoder_args(quality) + \
           ["-g", str(int(fps * 2)), "-af", "alimiter=limit=0.95:level=false",
            "-c:a", "aac", "-b:a", "192k", "-ar", str(SAMPLE_RATE), "-shortest", "-movflags", "+faststart", str(tmp)]
    job.update(0.08, "Video oluşturuluyor...")
    media.run_ffmpeg(args, duration=dur, progress=lambda f: job.update(0.08 + 0.9 * f), cwd=str(d))
    os.replace(tmp, out)
    entry = {"file": name, "created": time.time(), "format": fmt, "size": out.stat().st_size,
             "width": W, "height": H, "duration": dur}
    store.mutate(pid, lambda p_: p_.setdefault("exports", []).insert(0, entry))
    mix_path.unlink(missing_ok=True)
    job.update(1.0, "Video hazır!")
    return entry


def export_path(name):
    f = (EXPORTS_DIR / name).resolve()
    if f.parent != EXPORTS_DIR.resolve() or not f.exists():
        raise FileNotFoundError(name)
    return f


def export_wav(p, d, mode="dub"):
    out = d / "media" / f"download_{mode}.wav"
    media.write_wav(out, render(p, d, mode), SAMPLE_RATE)
    return Path(out)


def system_info():
    return {"formats": FORMATS, "subs": SUBS}
