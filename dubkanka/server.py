"""HTTP API + static web app. Host = this PC (localhost); guests = friends coming through the room link."""
import asyncio
import os
import re
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import media
from . import __version__
from .config import DESKTOP, EXPORTS_DIR, HOME, MODELS_DIR, PROJECTS_DIR, RUNTIME, WEB_DIR, load_settings, public_settings, save_settings
from .gpu import gpu_info
from .access import GUEST_COOKIE, body_json, host_only, is_remote, member, mutate, project_or_404, save_body, who
from .jobs import bus, jobs
from .projects import add_character, find_char, find_line, find_take, new_id, sort_lines, store
from .room import download_cloudflared, room

VERSION = __version__
_SPLIT_TEXT = re.compile(r"\s+")


@asynccontextmanager
async def lifespan(app):
    bus.bind(asyncio.get_running_loop())
    yield
    room.stop()


class _RevalidatedStatic(StaticFiles):
    """The app is updated in place, so make browsers revalidate scripts instead of guessing freshness."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


app = FastAPI(title="DubKanka", lifespan=lifespan, docs_url=None, redoc_url=None)
app.mount("/web", _RevalidatedStatic(directory=str(WEB_DIR)), name="web")


@app.exception_handler(media.MediaError)
async def media_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


# ---------------------------------------------------------------- pages
_NO_CACHE = {"Cache-Control": "no-cache"}


@app.get("/")
async def index():
    return HTMLResponse((WEB_DIR / "index.html").read_text(encoding="utf-8"), headers=_NO_CACHE)


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(WEB_DIR / "icon.svg", media_type="image/svg+xml")


@app.get("/api/whoami")
async def whoami(request: Request):
    role, g = who(request)
    return {"role": role, "name": g["name"] if g else None,
            "projectId": room.project_id if role != "host" else None,
            "roomOpen": room.status in ("on", "starting")}


@app.get("/api/system")
def system(request: Request):
    host_only(request)
    from . import export, takes, translate
    ok = media.has_ffmpeg()
    whisper_dir = MODELS_DIR / "whisper"
    return {
        "version": VERSION, "ffmpeg": ok, "caps": media.ffmpeg_caps() if ok else {}, "gpu": gpu_info(),
        "settings": public_settings(), **translate.system_info(), **takes.system_info(), **export.system_info(),
        "desktop": DESKTOP, "dirs": {"home": str(HOME), "projects": str(PROJECTS_DIR), "exports": str(EXPORTS_DIR),
                                     "models": str(MODELS_DIR)},
        "whisperModels": [["small", "Hızlı (küçük model, ~0.5 GB)"],
                          ["large-v3-turbo", "Dengeli - önerilen (~1.6 GB)"],
                          ["large-v3", "En iyi doğruluk (~3 GB, daha yavaş)"]],
        "downloaded": {"whisper": [p.name for p in whisper_dir.glob("models--*")] if whisper_dir.exists() else []},
        "exportsDir": str(EXPORTS_DIR),
    }


@app.post("/api/settings")
async def settings_update(request: Request):
    host_only(request)
    body = await body_json(request)
    from . import translate
    from .api_settings import fill_default_models
    if isinstance(body.get("providers"), dict):
        body["providers"] = {k: v for k, v in body["providers"].items() if k in translate.REGISTRY}
    if "translator" in body and translate.ALIASES.get(body["translator"], body["translator"]) not in translate.REGISTRY:
        body.pop("translator")
    save_settings(body)
    await asyncio.to_thread(fill_default_models, body)
    return public_settings()


# ---------------------------------------------------------------- projects
@app.get("/api/projects")
def projects_list(request: Request):
    host_only(request)
    return store.list()


@app.post("/api/projects/upload")
async def projects_upload(request: Request, filename: str = "video.mp4", name: str = "", auto: int = 0):
    host_only(request)
    ext = (Path(filename).suffix or ".mp4").lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,5}", ext):
        ext = ".mp4"
    p = store.create(name or Path(filename).stem[:60])
    dst = store.dir(p["id"]) / f"source{ext}"
    try:
        await save_body(request, dst)
    except Exception:
        store.delete(p["id"])
        raise
    from .pipeline import run_import_file
    job = jobs.submit("import", p["id"], "Video okunuyor",
                      lambda j: run_import_file(j, p["id"], dst, filename, bool(auto)), heavy=False)
    return {"project": store.get(p["id"]), "job": job.to_dict()}


@app.post("/api/projects/url")
async def projects_url(request: Request):
    host_only(request)
    body = await body_json(request)
    url = str(body.get("url") or "").strip()
    if not re.match(r"https?://", url):
        raise HTTPException(400, "Geçerli bir bağlantı yapıştır (https://...).")
    p = store.create(str(body.get("name") or "").strip() or "Yeni proje")
    from .pipeline import run_import_url
    auto = bool(body.get("auto"))
    job = jobs.submit("import", p["id"], "Video indiriliyor", lambda j: run_import_url(j, p["id"], url, auto),
                      heavy=False)
    return {"project": store.get(p["id"]), "job": job.to_dict()}


@app.get("/api/projects/{pid}")
def project_get(pid: str, request: Request):
    member(request, pid)
    return project_or_404(pid)


@app.patch("/api/projects/{pid}")
async def project_patch(pid: str, request: Request):
    host_only(request)
    body = await body_json(request)

    def fn(p):
        if isinstance(body.get("name"), str) and body["name"].strip():
            p["name"] = body["name"].strip()[:80]
        for k in ("settings", "mix"):
            if isinstance(body.get(k), dict):
                p[k].update({kk: vv for kk, vv in body[k].items() if kk != "sfx"})
        if isinstance(body.get("export"), dict):  # nested video/audio options: merge, do not replace
            from .export import EXPORT_DEFAULTS, merge
            merge(p["export"], {kk: vv for kk, vv in body["export"].items() if kk in EXPORT_DEFAULTS})
    mutate(pid, fn)
    return store.get(pid)


@app.delete("/api/projects/{pid}")
def project_delete(pid: str, request: Request):
    host_only(request)
    project_or_404(pid)
    if room.project_id == pid:
        room.stop()
    store.delete(pid)
    return {"ok": True}


@app.post("/api/projects/{pid}/prepare")
async def project_prepare(pid: str, request: Request):
    host_only(request)
    project_or_404(pid)
    if jobs.active(pid, "prepare"):
        raise HTTPException(409, "Bu proje zaten hazırlanıyor.")
    opts = await body_json(request)
    from .pipeline import PREP_STEPS, run_prepare
    job = jobs.submit("prepare", pid, "Sahne hazırlanıyor", lambda j: run_prepare(j, pid, opts), steps=PREP_STEPS)
    return job.to_dict()


@app.post("/api/projects/{pid}/ambience")
async def project_ambience(pid: str, request: Request):
    host_only(request)
    project_or_404(pid)
    if jobs.active(pid, "ambience") or jobs.active(pid, "prepare"):
        raise HTTPException(409, "Bu proje şu an işleniyor.")
    from .pipeline import run_ambience
    job = jobs.submit("ambience", pid, "Ortam sesleri ayrılıyor", lambda j: run_ambience(j, pid))
    return job.to_dict()


@app.post("/api/projects/{pid}/translate")
async def project_translate(pid: str, request: Request):
    host_only(request)
    project_or_404(pid)
    b = await body_json(request)
    from .pipeline import run_translate
    job = jobs.submit("translate", pid, "Çeviri", lambda j: run_translate(
        j, pid, b.get("engine", "google"), b.get("style", "natural"), bool(b.get("onlyEmpty"))), heavy=False)
    return job.to_dict()


# ---------------------------------------------------------------- lines
def _clean_time(v, dur=None):
    v = round(max(0.0, float(v)), 3)
    return min(v, dur) if dur else v


@app.post("/api/projects/{pid}/lines")
async def line_add(pid: str, request: Request):
    host_only(request)
    b = await body_json(request)
    p = project_or_404(pid)
    dur = (p.get("clip") or {}).get("duration")
    s = _clean_time(b.get("start", 0), dur)
    e = _clean_time(b.get("end", s + 2), dur)
    if e - s < 0.2:
        e = s + 0.2

    def fn(p):
        cid = b.get("char") if find_char(p, b.get("char")) else None
        if not cid:
            cid = p["characters"][0]["id"] if p["characters"] else add_character(p)["id"]
        line = {"id": new_id("l", 7), "start": s, "end": e, "char": cid, "orig": str(b.get("orig") or ""),
                "text": str(b.get("text") or ""), "words": [], "takes": [], "take": None}
        p["lines"].append(line)
        sort_lines(p)
        return line
    return mutate(pid, fn)


@app.patch("/api/projects/{pid}/lines/{lid}")
async def line_patch(pid: str, lid: str, request: Request):
    host_only(request)
    b = await body_json(request)
    dur = (project_or_404(pid).get("clip") or {}).get("duration")

    def fn(p):
        line = find_line(p, lid)
        for k in ("text", "orig", "note"):
            if k in b:
                line[k] = str(b[k] or "")
        if "char" in b and find_char(p, b["char"]):
            line["char"] = b["char"]
        if "start" in b:
            line["start"] = _clean_time(b["start"], dur)
        if "end" in b:
            line["end"] = _clean_time(b["end"], dur)
        if line["end"] - line["start"] < 0.2:
            line["end"] = round(line["start"] + 0.2, 3)
        sort_lines(p)
        return line
    return mutate(pid, fn)


def _remove_take_files(pid, takes):
    d = store.dir(pid)
    for t in takes:
        for f in (t.get("raw"), t.get("file")):
            if f:
                (d / f).unlink(missing_ok=True)


@app.delete("/api/projects/{pid}/lines/{lid}")
def line_delete(pid: str, lid: str, request: Request):
    host_only(request)

    def fn(p):
        line = find_line(p, lid)
        p["lines"] = [l for l in p["lines"] if l["id"] != lid]
        return line
    line = mutate(pid, fn)
    _remove_take_files(pid, line.get("takes", []))
    return {"ok": True}


@app.post("/api/projects/{pid}/lines/{lid}/split")
async def line_split(pid: str, lid: str, request: Request):
    host_only(request)
    at = float((await body_json(request)).get("at", -1))

    def fn(p):
        line = find_line(p, lid)
        if not (line["start"] + 0.15 < at < line["end"] - 0.15):
            raise ValueError("Bölmek için oynatma çizgisini satırın içine getir.")
        words = line.get("words") or []
        w1 = [w for w in words if (w[0] + w[1]) / 2 < at]
        w2 = [w for w in words if (w[0] + w[1]) / 2 >= at]
        frac = (at - line["start"]) / (line["end"] - line["start"])
        dub = _SPLIT_TEXT.split(line.get("text", "").strip()) if line.get("text", "").strip() else []
        k = int(round(len(dub) * frac))
        new = {"id": new_id("l", 7), "start": round(at, 3), "end": line["end"], "char": line["char"],
               "orig": "".join(w[2] for w in w2).strip() if words else "",
               "text": " ".join(dub[k:]), "words": w2, "takes": [], "take": None}
        line["end"] = round(at, 3)
        if words:
            line["orig"] = "".join(w[2] for w in w1).strip()
        line["words"] = w1
        line["text"] = " ".join(dub[:k])
        p["lines"].append(new)
        sort_lines(p)
        return new
    return mutate(pid, fn)


@app.post("/api/projects/{pid}/lines/{lid}/merge-next")
def line_merge_next(pid: str, lid: str, request: Request):
    host_only(request)

    def fn(p):
        line = find_line(p, lid)
        i = p["lines"].index(line)
        if i + 1 >= len(p["lines"]):
            raise ValueError("Birleştirilecek sonraki satır yok.")
        nxt = p["lines"][i + 1]
        line["end"] = max(line["end"], nxt["end"])
        line["orig"] = (line.get("orig", "") + " " + nxt.get("orig", "")).strip()
        line["text"] = (line.get("text", "") + " " + nxt.get("text", "")).strip()
        line["words"] = (line.get("words") or []) + (nxt.get("words") or [])
        p["lines"].remove(nxt)
        return nxt
    nxt = mutate(pid, fn)
    _remove_take_files(pid, nxt.get("takes", []))
    return {"ok": True}


@app.post("/api/projects/{pid}/lines/{lid}/select")
async def line_select(pid: str, lid: str, request: Request):
    member(request, pid)
    tid = (await body_json(request)).get("take")

    def fn(p):
        line = find_line(p, lid)
        if tid is not None:
            find_take(line, tid)
        line["take"] = tid
    mutate(pid, fn)
    return {"ok": True}


# ---------------------------------------------------------------- characters
@app.post("/api/projects/{pid}/characters")
async def char_add(pid: str, request: Request):
    host_only(request)
    b = await body_json(request)
    return mutate(pid, lambda p: add_character(p, (str(b.get("name") or "").strip() or None)))


_CHAR_FIELDS = {"name": str, "color": str, "actor": str, "gain": float, "mute": bool, "effect": str,
                "pitch": float, "voice": str}


@app.patch("/api/projects/{pid}/characters/{cid}")
async def char_patch(pid: str, cid: str, request: Request):
    host_only(request)
    b = await body_json(request)

    def fn(p):
        c = find_char(p, cid)
        if not c:
            raise KeyError("Karakter bulunamadı")
        before = (c.get("effect"), c.get("pitch"))
        for k, typ in _CHAR_FIELDS.items():
            if k in b and b[k] is not None:
                c[k] = typ(b[k]) if typ is not str else str(b[k])[:60]
        return before != (c.get("effect"), c.get("pitch"))
    if mutate(pid, fn):
        _reprocess_where(pid, lambda line, t: line["char"] == cid and not t.get("effect"))
    return store.get(pid)


@app.post("/api/projects/{pid}/characters/{cid}/claim")
async def char_claim(pid: str, cid: str, request: Request):
    role, g = member(request, pid)
    name = g["name"] if g else (str((await body_json(request)).get("name") or "").strip()[:30] or "Ben")

    def fn(p):
        c = find_char(p, cid)
        if not c:
            raise KeyError("Karakter bulunamadı")
        names = [n.strip() for n in (c.get("actor") or "").split(",") if n.strip()]
        if name not in names:
            names.append(name)
        c["actor"] = ", ".join(names)[:60]
        return c["name"]
    cname = mutate(pid, fn)
    if g or room.project_id == pid:
        room.log(f"{name}, {cname} rolünü aldı")
    return {"ok": True}


@app.post("/api/projects/{pid}/characters/{cid}/merge")
async def char_merge(pid: str, cid: str, request: Request):
    host_only(request)
    into = (await body_json(request)).get("into")

    def fn(p):
        if cid == into or not find_char(p, cid) or not find_char(p, into):
            raise ValueError("Birleştirilecek karakteri seç.")
        for l in p["lines"]:
            if l["char"] == cid:
                l["char"] = into
        p["characters"] = [c for c in p["characters"] if c["id"] != cid]
    mutate(pid, fn)
    return store.get(pid)


@app.delete("/api/projects/{pid}/characters/{cid}")
def char_delete(pid: str, cid: str, request: Request):
    host_only(request)

    def fn(p):
        if any(l["char"] == cid for l in p["lines"]):
            raise ValueError("Bu karakterin satırları var. Önce başka bir karakterle birleştir.")
        p["characters"] = [c for c in p["characters"] if c["id"] != cid]
    mutate(pid, fn)
    return store.get(pid)


# ---------------------------------------------------------------- takes
def _submit_process(pid, lid, tid, title="Kayıt işleniyor"):
    from .takes import mark_take_error, process_take

    def run(job):
        try:
            return process_take(pid, lid, tid)
        except Exception as e:
            mark_take_error(pid, lid, tid, str(e)[:200])
            raise
    return jobs.submit("take", pid, title, run, heavy=False)


def _reprocess_where(pid, pred):
    p = store.get(pid)
    for line in p["lines"]:
        for t in line.get("takes", []):
            if t.get("raw") and pred(line, t):
                _submit_process(pid, line["id"], t["id"])


@app.post("/api/projects/{pid}/lines/{lid}/takes")
async def take_upload(pid: str, lid: str, request: Request, recStart: float = None, source: str = "booth",
                      by: str = "", align: str = "auto", fit: bool = False, filename: str = "kayit.wav",
                      denoise: int = 0, hpf: int = -1):
    role, g = member(request, pid)
    p = project_or_404(pid)
    try:
        line = find_line(p, lid)
    except KeyError:
        raise HTTPException(404, "Satır bulunamadı")
    ext = (Path(filename).suffix or ".wav").lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,5}", ext):
        ext = ".wav"
    fd, tmp = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    tmp = Path(tmp)
    try:
        await save_body(request, tmp, limit_mb=200)
        from .takes import add_take
        name = g["name"] if g else (by.strip() or "Ben")
        tid = await asyncio.to_thread(add_take, pid, lid, tmp, name, source if source in ("booth", "upload") else "upload",
                                      recStart, fit, align if align in ("auto", "recorded") else "auto", bool(denoise),
                                      None if hpf < 0 else bool(hpf))
    finally:
        tmp.unlink(missing_ok=True)
    _submit_process(pid, lid, tid)
    if g:
        n = next((i + 1 for i, l in enumerate(p["lines"]) if l["id"] == lid), "?")
        room.log(f"{g['name']}, {n}. satırı kaydetti")
    return {"takeId": tid, "lineId": line["id"]}


_TAKE_REPROCESS = {"effect": lambda v: v or None, "pitch": float, "fit": bool, "align": str, "matchLevel": bool,
                   "denoise": bool, "hpf": bool}
_TAKE_LIVE = {"gain": float, "nudge": float, "trimIn": float, "trimOut": float}


@app.patch("/api/projects/{pid}/lines/{lid}/takes/{tid}")
async def take_patch(pid: str, lid: str, tid: str, request: Request):
    role, g = member(request, pid)
    b = await body_json(request)

    def fn(p):
        t = find_take(find_line(p, lid), tid)
        if g and t.get("by") != g["name"]:
            raise ValueError("Sadece kendi kayıtlarını değiştirebilirsin.")
        changed = False
        for k, conv in _TAKE_REPROCESS.items():
            if k in b:
                v = conv(b[k])
                if k == "align" and (v not in ("auto", "recorded") or t.get("recStart") is None):
                    continue
                if t.get(k) != v:
                    t[k] = v
                    changed = True
        for k, conv in _TAKE_LIVE.items():
            if k in b:
                t[k] = round(conv(b[k]), 4)
        dur = float(t.get("duration") or 0)
        if dur and ("trimIn" in b or "trimOut" in b):  # always keep at least 50 ms of the take audible
            t["trimIn"] = round(min(max(0.0, float(t.get("trimIn") or 0)), max(0.0, dur - 0.05)), 4)
            t["trimOut"] = round(min(max(0.0, float(t.get("trimOut") or 0)), max(0.0, dur - t["trimIn"] - 0.05)), 4)
        if changed:
            t["status"] = "processing"
        return changed
    if mutate(pid, fn):
        _submit_process(pid, lid, tid)
    return {"ok": True}


@app.delete("/api/projects/{pid}/lines/{lid}/takes/{tid}")
def take_delete(pid: str, lid: str, tid: str, request: Request):
    role, g = member(request, pid)
    p = project_or_404(pid)
    try:
        t = find_take(find_line(p, lid), tid)
    except KeyError:
        raise HTTPException(404, "Kayıt bulunamadı")
    if g and t.get("by") != g["name"]:
        raise HTTPException(403, "Sadece kendi kayıtlarını silebilirsin.")
    from .takes import delete_take
    try:
        delete_take(pid, lid, tid)
    except KeyError:
        raise HTTPException(404, "Kayıt bulunamadı")
    return {"ok": True}


@app.post("/api/projects/{pid}/tts")
async def tts_lines(pid: str, request: Request):
    """AI placeholder voices: {lines: [ids] | null (= every line without a take), voices: {charId: voice}}"""
    host_only(request)
    b = await body_json(request)
    p = project_or_404(pid)
    voices = b.get("voices") or {}
    ids = b.get("lines")
    targets = [l for l in p["lines"] if (l["id"] in ids if ids else not l.get("take")) and l.get("text", "").strip()]
    if not targets:
        raise HTTPException(400, "Yapay zeka sesi verilecek satır yok (dublaj metni boş olabilir).")
    from .takes import TTS_VOICES, process_take, tts_take
    lang = p["settings"].get("dstLang", "en")
    defaults = [v for v, _ in TTS_VOICES.get(lang, TTS_VOICES["en"])]
    char_index = {c["id"]: i for i, c in enumerate(p["characters"])}
    char_voice = {c["id"]: c.get("voice") for c in p["characters"]}

    def run(job):
        for i, l in enumerate(targets):
            job.update(i / len(targets), f"Yapay zeka sesi: {i + 1}/{len(targets)}")
            voice = (voices.get(l["char"]) or char_voice.get(l["char"])
                     or defaults[char_index.get(l["char"], 0) % len(defaults)])
            tid = tts_take(pid, l["id"], voice)
            process_take(pid, l["id"], tid)
        return {"count": len(targets)}
    return jobs.submit("tts", pid, "Yapay zeka sesleri", run, heavy=False).to_dict()


# ---------------------------------------------------------------- sound effects
@app.post("/api/projects/{pid}/sfx")
async def sfx_add(pid: str, request: Request, start: float = 0.0, filename: str = "efekt.wav"):
    host_only(request)
    project_or_404(pid)
    d = store.dir(pid)
    (d / "sfx").mkdir(exist_ok=True)
    ext = (Path(filename).suffix or ".wav").lower()
    fd, tmp = tempfile.mkstemp(suffix=ext if re.fullmatch(r"\.[a-z0-9]{1,5}", ext) else ".wav")
    os.close(fd)
    tmp = Path(tmp)
    sid = new_id("s", 7)
    try:
        await save_body(request, tmp, limit_mb=200)
        await asyncio.to_thread(media.to_wav, tmp, d / "sfx" / f"{sid}.wav", 44100, 2)
    finally:
        tmp.unlink(missing_ok=True)
    info = media.probe(d / "sfx" / f"{sid}.wav")
    item = {"id": sid, "file": f"sfx/{sid}.wav", "name": Path(filename).stem[:40], "start": round(max(0.0, start), 3),
            "gain": 0.0, "duration": round(info["duration"], 3), "mute": False}
    mutate(pid, lambda p: p["mix"].setdefault("sfx", []).append(item))
    return item


@app.patch("/api/projects/{pid}/sfx/{sid}")
async def sfx_patch(pid: str, sid: str, request: Request):
    host_only(request)
    b = await body_json(request)

    def fn(p):
        for s in p["mix"].get("sfx", []):
            if s["id"] == sid:
                for k, conv in (("start", float), ("gain", float), ("mute", bool), ("name", str)):
                    if k in b:
                        s[k] = conv(b[k])
                return s
        raise KeyError("Efekt bulunamadı")
    return mutate(pid, fn)


@app.delete("/api/projects/{pid}/sfx/{sid}")
def sfx_delete(pid: str, sid: str, request: Request):
    host_only(request)

    def fn(p):
        p["mix"]["sfx"] = [s for s in p["mix"].get("sfx", []) if s["id"] != sid]
    mutate(pid, fn)
    (store.dir(pid) / "sfx" / f"{sid}.wav").unlink(missing_ok=True)
    return {"ok": True}


# ---------------------------------------------------------------- media files
_GUEST_FILES = re.compile(r"^(media/(preview\.mp4|thumb\.jpg|(voices|background|speech|bed)_lite\.wav)"
                          r"|takes/t[a-z0-9]+_\d+\.wav|sfx/s[a-z0-9]+\.wav)$")


@app.get("/api/projects/{pid}/file/{path:path}")
def project_file(pid: str, path: str, request: Request):
    role, _ = member(request, pid)
    if role != "host" and not _GUEST_FILES.match(path):
        raise HTTPException(403, "Bu dosyaya erişim yok.")
    base = store.dir(pid).resolve()
    f = (base / path).resolve()
    if base not in f.parents or not f.is_file() or f.name == "project.json":
        raise HTTPException(404, "Dosya bulunamadı")
    return FileResponse(f, headers={"Cache-Control": "private, max-age=3600"})


# ---------------------------------------------------------------- export
@app.post("/api/projects/{pid}/export")
async def project_export(pid: str, request: Request):
    host_only(request)
    project_or_404(pid)
    if jobs.active(pid, "export"):
        raise HTTPException(409, "Video zaten oluşturuluyor.")
    opts = await body_json(request)
    from .export import run_export
    return jobs.submit("export", pid, "Video oluşturuluyor", lambda j: run_export(j, pid, opts)).to_dict()


@app.get("/api/exports/{name}")
def export_file(name: str, request: Request, dl: int = 0):
    role, _ = who(request)
    if role == "anon":
        raise HTTPException(403, "Odaya katılman gerekiyor.")
    from .export import export_path, media_type
    try:
        f = export_path(name)
    except FileNotFoundError:
        raise HTTPException(404, "Video bulunamadı")
    if dl:
        return FileResponse(f, filename=name, media_type=media_type(name))
    return FileResponse(f, media_type=media_type(name))


@app.get("/api/projects/{pid}/srt")
def project_srt(pid: str, request: Request, which: str = "dub"):
    host_only(request)
    from .export import _safe_name, srt
    p = project_or_404(pid)
    name = f"{_safe_name(p['name'])}-{which}.srt"
    return PlainTextResponse(srt(p, which), headers={"Content-Disposition": f'attachment; filename="{name}"'.encode(
        "latin-1", "ignore").decode("latin-1")})


@app.get("/api/projects/{pid}/audio")
def project_audio(pid: str, request: Request, mode: str = "dub"):
    host_only(request)
    from .export import _safe_name, export_wav
    p = project_or_404(pid)
    f = export_wav(p, store.dir(pid), "original" if mode == "original" else "dub")
    return FileResponse(f, filename=f"{_safe_name(p['name'])}-{mode}.wav", media_type="audio/wav")


@app.post("/api/open-folder")
async def open_folder(request: Request):
    host_only(request)
    b = await body_json(request)
    target = EXPORTS_DIR
    if b.get("file"):
        from .export import export_path
        try:
            f = export_path(b["file"])
            subprocess.Popen(["explorer", "/select,", str(f)])
            return {"ok": True}
        except FileNotFoundError:
            pass
    os.startfile(str(target))
    return {"ok": True}


# ---------------------------------------------------------------- jobs + live updates
@app.get("/api/jobs/{jid}")
def job_get(jid: str, request: Request):
    role, _ = who(request)
    j = jobs.jobs.get(jid)
    if not j or (role != "host" and j.project_id != room.project_id):
        raise HTTPException(404, "İş bulunamadı")
    return j.to_dict()


@app.post("/api/jobs/{jid}/cancel")
def job_cancel(jid: str, request: Request):
    host_only(request)
    j = jobs.cancel(jid)
    return j.to_dict() if j else {}


@app.get("/api/watch")
async def watch(request: Request, project: str = "", v: int = -1):
    role, g = who(request)
    if role == "anon":
        raise HTTPException(403, "Odaya katılman gerekiyor.")
    if role == "guest":
        project = room.project_id or ""
    await bus.wait(v, timeout=20.0)
    out = {"v": bus.version, "rev": None, "jobs": []}
    if project:
        try:
            out["rev"] = store.get(project)["rev"]
        except KeyError:
            out["rev"] = -1
        out["jobs"] = [j for j in jobs.for_project(project) if role == "host" or j["kind"] == "take"]
    if role == "host":
        out["jobs"] += jobs.for_project(None)
        out["room"] = room.to_dict()
    else:
        r = room.to_dict()
        out["room"] = {"status": r["status"], "guests": [x for x in r["guests"] if x["online"]], "host": r["host"]}
    return out


# ---------------------------------------------------------------- room
@app.get("/api/room")
def room_get(request: Request):
    host_only(request)
    return room.to_dict()


@app.post("/api/room/start")
async def room_start(request: Request):
    host_only(request)
    pid = (await body_json(request)).get("projectId")
    project_or_404(pid)
    await asyncio.to_thread(room.start, pid, RUNTIME["port"] or load_settings()["port"])
    return room.to_dict()


@app.post("/api/room/stop")
def room_stop(request: Request):
    host_only(request)
    room.stop()
    return room.to_dict()


@app.post("/api/room/cloudflared")
def room_cloudflared(request: Request):
    host_only(request)
    return jobs.submit("download", None, "Bağlantı aracı indiriliyor", download_cloudflared, heavy=False).to_dict()


@app.get("/api/room/qr.svg")
def room_qr(request: Request):
    host_only(request)
    if not room.url:
        raise HTTPException(404, "Oda kapalı")
    import io
    import segno
    buf = io.BytesIO()
    segno.make(room.url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#111111", light="#ffffff")
    return Response(buf.getvalue(), media_type="image/svg+xml")


@app.post("/api/guest/join")
async def guest_join(request: Request):
    b = await body_json(request)
    client = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    try:
        token = room.join(b.get("name"), b.get("pin"), client)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    resp = JSONResponse({"ok": True, "projectId": room.project_id, "name": room.guests[token]["name"]})
    resp.set_cookie(GUEST_COOKIE, token, httponly=True, samesite="lax", secure=is_remote(request),
                    max_age=60 * 60 * 24)
    return resp


@app.post("/api/guest/heartbeat")
async def guest_heartbeat(request: Request):
    b = await body_json(request)
    g = room.heartbeat(request.cookies.get(GUEST_COOKIE), b.get("view"), b.get("line"), b.get("char"))
    if not g:
        raise HTTPException(403, "Oda kapandı ya da oturum süresi doldu.")
    return {"ok": True}


@app.post("/api/guest/leave")
def guest_leave(request: Request):
    token = request.cookies.get(GUEST_COOKIE)
    g = room.guests.pop(token, None) if token else None
    if g:
        room.log(f"{g['name']} odadan ayrıldı")
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(GUEST_COOKIE)
    return resp


from .api_export import router as export_router  # noqa: E402
from .api_room import router as room_router  # noqa: E402
from .api_settings import router as settings_router  # noqa: E402

app.include_router(export_router)
app.include_router(room_router)
app.include_router(settings_router)


@app.get("/api/ping")
def ping():
    return {"ok": True, "t": time.time(), "app": "DubKanka", "version": VERSION}
