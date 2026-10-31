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
AUTO_MAX = 900  # longer videos wait on the scene picker: preparing a whole episode is rarely what anyone wants
# Without the "separate" feature the scene's own audio stays under the dub, turned down while someone speaks (and the
# original voice is already in it, so it is never added again for lines nobody recorded).
SEPARATED_MIX = {"duck": 0.0, "fillMissing": True}
UNSEPARATED_MIX = {"duck": 15.0, "fillMissing": False}


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


def auto_prepare(pid):
    """Start preparing the whole video with automatic settings, right after it was imported. Returns the job or
    None when the video is too long to guess the scene."""
    from .jobs import jobs
    info = store.get(pid)["source"]["info"]
    if info["duration"] > AUTO_MAX:
        return None
    app = load_settings()
    opts = {"start": 0.0, "end": info["duration"], "srcLang": "auto", "dstLang": app.get("defaultDstLang") or "en",
            "speakers": 0, "translator": app.get("translator") or "google", "style": "natural"}
    return jobs.submit("prepare", pid, "Sahne hazırlanıyor", lambda j: run_prepare(j, pid, opts), steps=PREP_STEPS)


def run_import_file(job, pid, path, original_name, auto=False):
    set_source(pid, path, original_name, job)
    # queued before this job ends, so the page goes straight from "reading" to "preparing"
    prep = auto_prepare(pid) if auto else None
    return {"projectId": pid, "autoPrepare": bool(prep)}


def run_import_url(job, pid, url, auto=False):
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
    prep = auto_prepare(pid) if auto else None
    return {"projectId": pid, "autoPrepare": bool(prep)}


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


def separated_stems(d, mix, sr, model, ver, prog):
    """Demucs split + the guests' lite copies + the ambience split. Returns (stems, voices at SAMPLE_RATE)."""
    from .separate import separate
    voices, background = separate(mix, sr, model, progress=lambda f, msg=None: prog(f * 0.72, msg))
    m = d / "media"
    media.write_wav(m / "voices.wav", voices)
    media.write_wav(m / "background.wav", background)
    media.write_wav(m / "voices_lite.wav", media.resample(voices.mean(axis=1), SAMPLE_RATE, LITE_SR), LITE_SR)
    media.write_wav(m / "background_lite.wav", media.resample(background.mean(axis=1), SAMPLE_RATE, LITE_SR), LITE_SR)
    stems = {"voices": "media/voices.wav", "background": "media/background.wav", "original": "media/audio.wav",
             "voicesLite": "media/voices_lite.wav", "backgroundLite": "media/background_lite.wav", "ver": ver,
             "separated": True}
    prog(0.72, "Kuş, rüzgar, kalabalık gibi ortam sesleri konuşmadan ayrılıyor...")
    stems.update(write_ambience(d, voices, background, lambda f, msg=None: prog(0.72 + f * 0.28, msg)))
    return stems, voices


def unseparated_stems(d, mix, sr, ver):
    """No separation: every stem is the scene's own audio (one file, one lite copy for guests)."""
    media.write_wav(d / "media" / "audio_lite.wav", media.resample(mix.mean(axis=1), sr, LITE_SR), LITE_SR)
    return {"voices": "media/audio.wav", "background": "media/audio.wav", "original": "media/audio.wav",
            "voicesLite": "media/audio_lite.wav", "backgroundLite": "media/audio_lite.wav", "ver": ver,
            "separated": False}


def run_separate(job, pid):
    """Separate a scene prepared without the feature: lines and takes stay, only the sound under them changes."""
    from . import features
    p = store.get(pid)
    d = store.dir(pid)
    if not p.get("stems"):
        raise media.MediaError("Önce sahneyi hazırla.")
    if not features.wait("separate", job):
        raise media.MediaError("Önce Ayarlar → Özellikler'den “Müziği ve efektleri koru” özelliğini ekle.")
    job.update(0.0, "Konuşmalar fondan ayrılıyor...")
    mix, sr = media.read_audio(d / p["stems"]["original"])
    stems, _ = separated_stems(d, mix, sr, load_settings().get("separationModel", "htdemucs_ft"), int(time.time()),
                               lambda f, msg=None: job.update(f * 0.99, msg))
    (d / "media" / "audio_lite.wav").unlink(missing_ok=True)

    def fn(p_):
        p_["stems"] = stems
        p_["mix"].update(SEPARATED_MIX)
    store.mutate(pid, fn)
    return {"message": "Konuşmalar ayrıldı: müzik ve efektler artık dublajın altında."}


def run_ambience(job, pid):
    """For scenes prepared before ambience existed: bring birds & co back without preparing again."""
    p = store.get(pid)
    d = store.dir(pid)
    if not p.get("stems"):
        raise media.MediaError("Önce sahneyi hazırla.")
    if p["stems"].get("separated") is False:
        raise media.MediaError("Bu sahnede konuşmalar fondan ayrılmadı; önce Mikser'den konuşmaları ayır.")
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

    # 2. dialogue / background separation (feature "separate"; without it the scene's audio stays under the dub)
    from . import features
    job.step("separate")
    prog = _stepper(job, base, "separate")
    mix, sr = media.read_audio(audio)
    notes = []
    if features.wait("separate", job):
        stems, voices = separated_stems(d, mix, sr, app.get("separationModel", "htdemucs_ft"), ver, prog)
        mix_mode = SEPARATED_MIX
        job.step("separate", "done")
    else:
        stems, voices = unseparated_stems(d, mix, sr, ver), mix
        mix_mode = UNSEPARATED_MIX
        notes.append("Müzik ayrılmadı: orijinal ses dublajın altında kısılarak çalar.")
        job.step("separate", "skipped")
    del mix

    def put_stems(p_):
        p_["stems"] = stems
        p_["mix"].update(mix_mode)
    store.mutate(pid, put_stems)
    base += _WEIGHTS["separate"]

    # 3. speech to text on the clean dialogue stem (feature "speech"; without it the lines are written by hand)
    job.step("transcribe")
    prog = _stepper(job, base, "transcribe")
    speech = features.wait("speech", job)
    tr = {"language": None, "words": []}
    v16 = media.resample(voices.mean(axis=1), SAMPLE_RATE, 16000)
    del voices
    if speech:
        from .transcribe import transcribe
        tr = transcribe(v16, language=settings.get("srcLang"), progress=prog)
        (d / "media" / "transcript.json").write_text(json.dumps(tr, ensure_ascii=False), encoding="utf-8")
        job.step("transcribe", "done")
    else:
        job.step("transcribe", "skipped")
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
    from .segment import make_project_lines
    from .vad import speech_regions
    regions = speech_regions(v16) if tr["words"] else []

    def build(p_):
        make_project_lines(p_, tr["words"], turns, regions)
        p_["detectedLang"] = tr["language"]
        return len(p_["lines"])
    n_lines = store.mutate(pid, build)
    job.step("speakers", "done" if speech else "skipped")
    base += _WEIGHTS["speakers"]

    # 5. translation (never fails the whole job: the script can be translated again later)
    job.step("translate")
    prog = _stepper(job, base, "translate")
    if not speech:
        job.step("translate", "skipped")
        notes.insert(0, "Satırlar yazılmadı: Yazıya dökme özelliği yüklü değil. Senaryo'da satırları kendin "
                        "ekleyebilirsin.")
    elif n_lines:
        src_lang = settings.get("srcLang") if settings.get("srcLang") not in (None, "", "auto") else tr["language"]
        try:
            prog(0, "Satırlar çevriliyor...")
            p = store.get(pid)
            from .translate import translate_lines
            tr_notes = []
            out = translate_lines(p["lines"], p["characters"], src_lang, settings.get("dstLang", "en"),
                                  settings.get("translator", "google"), settings.get("style", "natural"), app, prog,
                                  tr_notes)
            store.mutate(pid, lambda p_: [l.update(text=out.get(l["id"], l["text"])) for l in p_["lines"]])
            job.step("translate", "done")
            notes.extend(tr_notes)
        except Exception as e:
            notes.append(f"Çeviri yapılamadı: {e}. Senaryo ekranından tekrar deneyebilirsin.")
            job.step("translate", "error")
    else:
        job.step("translate", "done")
        notes.insert(0, "Bu sahnede konuşma bulunamadı. Senaryo ekranından satırları elle ekleyebilirsin.")

    warning = " ".join(notes) or None
    store.mutate(pid, lambda p_: p_.update(status="ready"))
    return {"lines": n_lines, "warning": warning, "message": warning or f"{n_lines} satır hazır"}


def run_translate(job, pid, engine, style, only_empty):
    p = store.get(pid)
    lines = [l for l in p["lines"] if not (only_empty and l.get("text", "").strip())]
    if not lines:
        return {"count": 0}
    st = p["settings"]
    src = st.get("srcLang") if st.get("srcLang") not in (None, "", "auto") else (p.get("detectedLang") or "auto")
    from .translate import ALIASES, translate_lines
    engine = ALIASES.get(engine, engine)
    job.update(0.0, "Satırlar çevriliyor...")
    notes = []
    out = translate_lines(lines, p["characters"], src, st.get("dstLang", "en"), engine, style, load_settings(),
                          lambda f, *_: job.update(f), notes)

    def fn(p_):
        p_["settings"]["translator"] = engine
        p_["settings"]["style"] = style
        for l in p_["lines"]:
            if l["id"] in out:
                l["text"] = out[l["id"]]
    store.mutate(pid, fn)
    return {"count": len(out), "message": " ".join(notes) or f"{len(out)} satır çevrildi."}
