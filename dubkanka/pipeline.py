"""Background jobs: import a video, prepare a scene (cut, separate, transcribe, speakers, translate)."""
import json
import shutil
import time
from pathlib import Path

from . import media
from .config import SAMPLE_RATE, load_settings
from .projects import store

PREP_STEPS = [
    ("cut", "Sahne kesiliyor"),
    ("separate", "Konuşmalar fondan ayrılıyor, ortam sesleri korunuyor"),
    ("transcribe", "Konuşmalar yazıya dökülüyor"),
    ("speakers", "Kim konuşuyor, ayırt ediliyor"),
    ("translate", "Satırlar çevriliyor"),
]
_WEIGHTS = {"cut": 0.08, "separate": 0.32, "transcribe": 0.36, "speakers": 0.11, "translate": 0.13}
LITE_SR = 22050


def set_source(pid, path, original_name, job=None):
    """Probe an imported file, store it as the project's source and make a browser proxy when needed."""
    info = media.probe(path)
    if not info.get("hasVideo"):
        raise media.MediaError("Bu dosyada görüntü yok. Lütfen bir video dosyası seç.")
    if info["duration"] <= 0.5:
        raise media.MediaError("Video çok kısa ya da okunamadı.")
    d = store.dir(pid)
    proxy = None
    if not media.browser_playable(info):
        proxy = "source_proxy.mp4"
        if job:
            job.update(0.0, "Video tarayıcıda oynatılabilir hale getiriliyor...")
        media.make_proxy(path, d / proxy, info["duration"], job and (lambda f: job.update(f)))

    def fn(p):
        p["source"] = {"file": Path(path).name, "originalName": original_name, "info": info, "proxy": proxy}
        p["trim"] = {"start": 0.0, "end": round(info["duration"], 3)}
        p["status"] = "source"
    store.mutate(pid, fn)
    return info


def run_import_file(job, pid, path, original_name):
    set_source(pid, path, original_name, job)
    return {"projectId": pid}


def run_import_url(job, pid, url):
    import yt_dlp

    d = store.dir(pid)
    job.update(0.0, "Video indiriliyor...")

    def hook(s):
        if s.get("status") == "downloading":
            total = s.get("total_bytes") or s.get("total_bytes_estimate") or 0
            if total:
                job.update(min(0.95, s.get("downloaded_bytes", 0) / total),
                           f"Video indiriliyor... {s.get('downloaded_bytes', 0) / 2**20:.0f} / {total / 2**20:.0f} MB")

    opts = {
        "format": "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(d / "source.%(ext)s"),
        "ffmpeg_location": str(Path(media.ffmpeg_path()).parent),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
    }
    if shutil.which("node"):
        opts["js_runtimes"] = {"node": {}}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as e:
        raise media.MediaError("Bu bağlantıdan video indirilemedi. Videoyu bilgisayarına indirip dosya olarak "
                               f"yüklemeyi dene. ({str(e)[:160]})") from e
    files = sorted(d.glob("source.*"), key=lambda f: f.stat().st_size, reverse=True)
    if not files:
        raise media.MediaError("İndirilen dosya bulunamadı.")
    title = (info or {}).get("title") or "Video"
    store.mutate(pid, lambda p: p.update(name=p["name"] if p["name"] != "Yeni proje" else title[:60]))
    set_source(pid, files[0], title, job)
    return {"projectId": pid}


def _stepper(job, base, key):
    w = _WEIGHTS[key]

    def prog(frac, msg=None):
        job.update(base + w * max(0.0, min(1.0, frac)), msg)
    return prog


def write_ambience(d, voices, background, progress=None):
    """Split the vocals stem into speech + ambience (birds, wind, crowd...) and write both, plus the guests'
    lite files: speech, and a 'bed' = background + ambience they hear while recording."""
    from .ambience import split
    speech, amb = split(voices, SAMPLE_RATE, progress)
    m = d / "media"
    media.write_wav(m / "speech.wav", speech)
    media.write_wav(m / "ambience.wav", amb)
    media.write_wav(m / "speech_lite.wav", media.resample(speech.mean(axis=1), SAMPLE_RATE, LITE_SR), LITE_SR)
    media.write_wav(m / "bed_lite.wav", media.resample((background + amb).mean(axis=1), SAMPLE_RATE, LITE_SR), LITE_SR)
    return {"speech": "media/speech.wav", "ambience": "media/ambience.wav", "speechLite": "media/speech_lite.wav",
            "bedLite": "media/bed_lite.wav", "ver": int(time.time())}


def run_ambience(job, pid):
    """For scenes prepared before ambience existed: bring birds & co back without preparing again."""
    p = store.get(pid)
    d = store.dir(pid)
    if not p.get("stems"):
        raise media.MediaError("Önce sahneyi hazırla.")
    job.update(0.0, "Ortam sesleri ayrılıyor (kuş, rüzgar, kalabalık)...")
    voices, _ = media.read_audio(d / p["stems"]["voices"])
    background, _ = media.read_audio(d / p["stems"]["background"])
    stems = write_ambience(d, voices, background, lambda f, msg=None: job.update(f * 0.98, msg))
    store.mutate(pid, lambda p_: p_["stems"].update(stems))
    return {"message": "Ortam sesleri geri geldi. Mikser'deki Ortam sesleri izinden ayarlayabilirsin."}


def run_prepare(job, pid, opts):
    p = store.get(pid)
    d = store.dir(pid)
    if not p.get("source"):
        raise media.MediaError("Önce bir video yükle.")
    info = p["source"]["info"]
    src = d / p["source"]["file"]
    start = max(0.0, float(opts.get("start", 0)))
    end = min(info["duration"], float(opts.get("end", info["duration"])))
    if end - start < 1.0:
        raise media.MediaError("Seçilen sahne en az 1 saniye olmalı.")
    settings = {**p["settings"], **{k: opts[k] for k in ("srcLang", "dstLang", "speakers", "translator", "style")
                                    if k in opts}}
    app = load_settings()
    base = 0.0
    (d / "media").mkdir(exist_ok=True)

    # Re-preparing replaces all lines: drop old takes so they do not pile up on disk.
    takes_dir = d / "takes"
    if takes_dir.exists():
        shutil.rmtree(takes_dir, ignore_errors=True)
    takes_dir.mkdir(exist_ok=True)

    def begin(p_):
        p_["status"] = "preparing"
        p_["settings"] = settings
        p_["trim"] = {"start": round(start, 3), "end": round(end, 3)}
        p_["lines"] = []
        p_["characters"] = []
    store.mutate(pid, begin)

    # 1. cut the scene
    job.step("cut")
    prog = _stepper(job, base, "cut")
    prog(0, "Sahne kesiliyor...")
    master, audio = d / "media" / "master.mp4", d / "media" / "audio.wav"
    media.cut_master(src, master, audio, start, end, info, progress=lambda f: prog(f * 0.7))
    clip = media.probe(master)
    media.make_preview(master, d / "media" / "preview.mp4", clip["duration"], progress=lambda f: prog(0.7 + f * 0.28))
    media.make_thumb(master, d / "media" / "thumb.jpg", clip["duration"] * 0.3)
    ver = int(time.time())
    store.mutate(pid, lambda p_: p_.update(clip={
        "duration": round(clip["duration"], 3), "width": clip.get("width"), "height": clip.get("height"),
        "fps": clip.get("fps"), "master": "media/master.mp4", "preview": "media/preview.mp4",
        "thumb": "media/thumb.jpg", "ver": ver}))
    job.step("cut", "done")
    base += _WEIGHTS["cut"]

    # 2. dialogue / background separation
    job.step("separate")
    prog = _stepper(job, base, "separate")
    from .separate import separate
    mix, sr = media.read_audio(audio)
    voices, background = separate(mix, sr, app.get("separationModel", "htdemucs_ft"),
                                  progress=lambda f, msg=None: prog(f * 0.72, msg))
    media.write_wav(d / "media" / "voices.wav", voices)
    media.write_wav(d / "media" / "background.wav", background)
    media.write_wav(d / "media" / "voices_lite.wav", media.resample(voices.mean(axis=1), SAMPLE_RATE, LITE_SR), LITE_SR)
    media.write_wav(d / "media" / "background_lite.wav",
                    media.resample(background.mean(axis=1), SAMPLE_RATE, LITE_SR), LITE_SR)
    stems = {"voices": "media/voices.wav", "background": "media/background.wav", "original": "media/audio.wav",
             "voicesLite": "media/voices_lite.wav", "backgroundLite": "media/background_lite.wav", "ver": ver}
    prog(0.72, "Kuş, rüzgar, kalabalık gibi ortam sesleri konuşmadan ayrılıyor...")
    stems.update(write_ambience(d, voices, background, lambda f, msg=None: prog(0.72 + f * 0.28, msg)))
    store.mutate(pid, lambda p_: p_.update(stems=stems))
    job.step("separate", "done")
    base += _WEIGHTS["separate"]

    # 3. speech to text on the clean dialogue stem
    job.step("transcribe")
    prog = _stepper(job, base, "transcribe")
    from .transcribe import speech_regions, transcribe
    v16 = media.resample(voices.mean(axis=1), SAMPLE_RATE, 16000)
    del mix, background
    tr = transcribe(v16, language=settings.get("srcLang"), progress=prog)
    (d / "media" / "transcript.json").write_text(json.dumps(tr, ensure_ascii=False), encoding="utf-8")
    job.step("transcribe", "done")
    base += _WEIGHTS["transcribe"]

    # 4. speakers -> characters + lines
    job.step("speakers")
    prog = _stepper(job, base, "speakers")
    prog(0, "Konuşmacılar ayırt ediliyor...")
    turns = []
    if tr["words"]:
        from .diarize import diarize, ensure_models
        ensure_models(lambda f: prog(f * 0.3, "Konuşmacı modeli indiriliyor (ilk sefere özel, ~32 MB)..."))
        turns = diarize(v16, int(settings.get("speakers") or 0), progress=lambda f: prog(0.3 + f * 0.65))
    regions = speech_regions(v16)
    from .segment import make_project_lines

    def build(p_):
        make_project_lines(p_, tr["words"], turns, regions)
        p_["detectedLang"] = tr["language"]
        return len(p_["lines"])
    n_lines = store.mutate(pid, build)
    job.step("speakers", "done")
    base += _WEIGHTS["speakers"]

    # 5. translation (never fails the whole job: the script can be translated again later)
    job.step("translate")
    prog = _stepper(job, base, "translate")
    warning = None
    if n_lines:
        src_lang = settings.get("srcLang") if settings.get("srcLang") not in (None, "", "auto") else tr["language"]
        try:
            prog(0, "Satırlar çevriliyor...")
            p = store.get(pid)
            from .translate import translate_lines
            out = translate_lines(p["lines"], p["characters"], src_lang, settings.get("dstLang", "en"),
                                  settings.get("translator", "google"), settings.get("style", "natural"), app, prog)
            store.mutate(pid, lambda p_: [l.update(text=out.get(l["id"], l["text"])) for l in p_["lines"]])
            job.step("translate", "done")
        except Exception as e:
            warning = f"Çeviri yapılamadı: {e}. Senaryo ekranından tekrar deneyebilirsin."
            job.step("translate", "error")
    else:
        job.step("translate", "done")
        warning = "Bu sahnede konuşma bulunamadı. Senaryo ekranından satırları elle ekleyebilirsin."

    store.mutate(pid, lambda p_: p_.update(status="ready"))
    return {"lines": n_lines, "warning": warning, "message": warning or f"{n_lines} satır hazır!"}


def run_translate(job, pid, engine, style, only_empty):
    p = store.get(pid)
    lines = [l for l in p["lines"] if not (only_empty and l.get("text", "").strip())]
    if not lines:
        return {"count": 0}
    st = p["settings"]
    src = st.get("srcLang") if st.get("srcLang") not in (None, "", "auto") else (p.get("detectedLang") or "auto")
    from .translate import translate_lines
    job.update(0.0, "Satırlar çevriliyor...")
    out = translate_lines(lines, p["characters"], src, st.get("dstLang", "en"), engine, style, load_settings(),
                          lambda f, *_: job.update(f))

    def fn(p_):
        p_["settings"]["translator"] = engine
        p_["settings"]["style"] = style
        for l in p_["lines"]:
            if l["id"] in out:
                l["text"] = out[l["id"]]
    store.mutate(pid, fn)
    return {"count": len(out)}
