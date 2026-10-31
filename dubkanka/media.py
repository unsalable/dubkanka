"""ffmpeg / ffprobe helpers and small audio utilities."""
import glob
import json
import os
import re
import shutil
import subprocess
import threading
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf

from .config import BIN_DIR, SAMPLE_RATE

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class MediaError(RuntimeError):
    pass


_bins = {}


def _find_bin(name):
    if name in _bins:
        return _bins[name]
    exe = name + (".exe" if os.name == "nt" else "")
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        BIN_DIR / exe,
        shutil.which(name),
        Path(local) / "Microsoft" / "WinGet" / "Links" / exe,
    ]
    candidates += sorted(glob.glob(os.path.join(local, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "*", "bin", exe)), reverse=True)
    for c in candidates:
        if c and Path(c).exists():
            _bins[name] = str(c)
            return _bins[name]
    return None


def ffmpeg_path():
    p = _find_bin("ffmpeg")
    if not p:
        raise MediaError("ffmpeg bulunamadı. Lütfen 'Kurulum.bat' dosyasını çalıştır.")
    return p


def ffprobe_path():
    p = _find_bin("ffprobe")
    if not p:
        raise MediaError("ffprobe bulunamadı. Lütfen 'Kurulum.bat' dosyasını çalıştır.")
    return p


def has_ffmpeg():
    return bool(_find_bin("ffmpeg") and _find_bin("ffprobe"))


_caps = {}


def ffmpeg_caps():
    """Detect optional ffmpeg features once (rubberband, libass, working NVENC)."""
    if _caps:
        return _caps
    ff = ffmpeg_path()
    filters = subprocess.run([ff, "-hide_banner", "-filters"], capture_output=True, text=True,
                             encoding="utf-8", errors="replace", creationflags=NO_WINDOW).stdout
    _caps["rubberband"] = " rubberband " in filters
    _caps["subtitles"] = " subtitles " in filters
    test = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                           "color=c=black:s=256x256:d=0.1", "-c:v", "h264_nvenc", "-f", "null", "-"],
                          capture_output=True, creationflags=NO_WINDOW)
    _caps["nvenc"] = test.returncode == 0
    return _caps


def _parse_time(s):
    m = re.match(r"(\d+):(\d+):(\d+(?:\.\d+)?)", s or "")
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def run_ffmpeg(args, duration=None, progress=None, cwd=None):
    """Run ffmpeg, report progress (0..1) when duration is known, raise MediaError on failure."""
    cmd = [ffmpeg_path(), "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
           "-progress", "pipe:1", "-nostats"] + [str(a) for a in args]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace", cwd=cwd, creationflags=NO_WINDOW)
    err_lines = []

    def _drain():
        for line in proc.stderr:
            err_lines.append(line.rstrip())
            del err_lines[:-40]

    t = threading.Thread(target=_drain, daemon=True)
    t.start()
    for line in proc.stdout:
        if progress and duration and line.startswith("out_time="):
            sec = _parse_time(line.split("=", 1)[1].strip())
            if sec is not None:
                progress(max(0.0, min(1.0, sec / duration)))
    proc.wait()
    t.join(timeout=2)
    if proc.returncode != 0:
        msg = "\n".join(err_lines[-8:]) or f"ffmpeg hata kodu {proc.returncode}"
        raise MediaError(msg)
    if progress:
        progress(1.0)


def probe(path):
    out = subprocess.run([ffprobe_path(), "-v", "error", "-print_format", "json", "-show_format",
                          "-show_streams", str(path)], capture_output=True, text=True,
                         encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    if out.returncode != 0:
        raise MediaError("Dosya okunamadı: " + (out.stderr.strip()[-300:] or "bilinmeyen biçim"))
    info = json.loads(out.stdout or "{}")
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"
              and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = info.get("format", {})
    duration = float(fmt.get("duration") or 0) or float((v or a or {}).get("duration") or 0)
    res = {
        "duration": duration,
        "hasVideo": v is not None,
        "hasAudio": a is not None,
        "format": fmt.get("format_name", ""),
        "size": int(fmt.get("size") or 0),
    }
    if v:
        w, h = int(v.get("width") or 0), int(v.get("height") or 0)
        rot = 0
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
        rot = rot or int(float((v.get("tags") or {}).get("rotate", 0) or 0))
        if abs(rot) % 180 == 90:
            w, h = h, w
        fps = 25.0
        for key in ("avg_frame_rate", "r_frame_rate"):
            try:
                f = Fraction(v.get(key) or "0/1")
                if 1 <= f <= 240:
                    fps = float(f)
                    break
            except (ZeroDivisionError, ValueError):
                pass
        res.update(width=w, height=h, fps=round(fps, 3), vcodec=v.get("codec_name", ""))
    if a:
        res.update(acodec=a.get("codec_name", ""), channels=int(a.get("channels") or 2))
    return res


def browser_playable(info):
    fmt = info.get("format", "")
    vc = info.get("vcodec", "")
    ac = info.get("acodec", "")
    if not info.get("hasVideo"):
        return False
    if "mp4" in fmt or "mov" in fmt:
        return vc in ("h264", "av1", "vp9") and ac in ("", "aac", "mp3", "opus")
    if "webm" in fmt or "matroska" in fmt:
        return "webm" in fmt and vc in ("vp8", "vp9", "av1") and ac in ("", "opus", "vorbis")
    return False


def video_encoder_args(quality="high"):
    """H.264 encoder args, NVENC when the GPU can do it."""
    if ffmpeg_caps().get("nvenc"):
        cq = {"high": "19", "normal": "23", "preview": "30"}[quality]
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", cq, "-b:v", "0", "-pix_fmt", "yuv420p"]
    crf = {"high": "18", "normal": "22", "preview": "30"}[quality]
    preset = "veryfast" if quality == "preview" else "medium"
    return ["-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p"]


def make_proxy(src, dst, duration, progress=None):
    """Low-res, seek-friendly copy used only for picking the scene in the browser."""
    run_ffmpeg(["-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(480,ih)'",
                "-r", "30", "-g", "30"] + video_encoder_args("preview") +
               ["-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", dst],
               duration=duration, progress=progress)


def master_size(w, h, limit=1920):
    s = min(1.0, limit / max(w, h, 1))
    return max(2, int(round(w * s / 2)) * 2), max(2, int(round(h * s / 2)) * 2)


def cut_master(src, master, audio_wav, start, end, info, progress=None):
    """Frame-accurate cut of the chosen scene: high quality video + PCM audio from one decode."""
    dur = max(0.1, end - start)
    fps = min(60.0, info.get("fps") or 30.0)
    w, h = master_size(info.get("width") or 1280, info.get("height") or 720)
    args = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src,
            "-map", "0:v:0", "-r", f"{fps:.3f}", "-vf", f"scale={w}:{h},setsar=1"] + video_encoder_args("high") + \
           ["-an", "-movflags", "+faststart", master]
    if info.get("hasAudio"):
        args += ["-map", "0:a:0", "-vn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", audio_wav]
    run_ffmpeg(args, duration=dur, progress=progress)
    if not Path(audio_wav).exists():
        # Silent source: create an empty track so the rest of the pipeline keeps working.
        write_wav(audio_wav, np.zeros((int(dur * SAMPLE_RATE), 2), dtype=np.float32))


def make_preview(master, dst, duration, progress=None):
    run_ffmpeg(["-i", master, "-vf", "scale=-2:'min(720,ih)'", "-g", "25"] + video_encoder_args("preview") +
               ["-an", "-movflags", "+faststart", dst], duration=duration, progress=progress)


def make_thumb(master, dst, at):
    run_ffmpeg(["-ss", f"{max(0, at):.2f}", "-i", master, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", dst])


def to_wav(src, dst, sr=SAMPLE_RATE, channels=1):
    """Decode any audio/video file into a PCM wav."""
    run_ffmpeg(["-i", src, "-vn", "-ac", str(channels), "-ar", str(sr), "-c:a", "pcm_f32le", dst])


def read_audio(path, mono=False):
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    if mono:
        data = data.mean(axis=1)
    return data, sr


def read_segment(path, t0, t1, mono=True):
    """Read only [t0, t1) seconds of a wav file."""
    info = sf.info(str(path))
    a = max(0, int(t0 * info.samplerate))
    b = max(a, min(info.frames, int(t1 * info.samplerate)))
    data, sr = sf.read(str(path), start=a, stop=b, dtype="float32", always_2d=True)
    return (data.mean(axis=1) if mono else data), sr


def write_wav(path, data, sr=SAMPLE_RATE, subtype="PCM_16"):
    data = np.asarray(data, dtype=np.float32)
    if subtype == "PCM_16":
        data = np.clip(data, -1.0, 1.0)
    tmp = str(path) + ".tmp.wav"
    sf.write(tmp, data, sr, subtype=subtype)
    os.replace(tmp, path)


def resample(x, sr_from, sr_to):
    if sr_from == sr_to:
        return x
    from scipy.signal import resample_poly
    g = np.gcd(int(sr_from), int(sr_to))
    return resample_poly(x, sr_to // g, sr_from // g, axis=0).astype(np.float32)


def db_to_gain(db):
    return float(10 ** (db / 20.0))


def active_rms_db(x, sr, frame=0.02):
    """Loudness of the voiced part of a signal (frames within 30 dB of the loudest)."""
    if x.ndim > 1:
        x = x.mean(axis=1)
    n = int(sr * frame)
    if len(x) < n:
        return -90.0
    frames = x[: len(x) // n * n].reshape(-1, n)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    top = db.max()
    if top < -60:
        return -90.0
    voiced = rms[db > max(top - 30, -55)]
    return float(20 * np.log10(np.sqrt((voiced ** 2).mean()) + 1e-9))
