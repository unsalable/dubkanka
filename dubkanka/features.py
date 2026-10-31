"""Optional features: the heavy parts of DubKanka, added when someone wants them instead of on the first run.

The first run installs only the studio (Python, the web server, numpy/scipy, ffmpeg): enough to cut a scene, write
lines, record, mix and export. Each feature adds packages (pinned by requirements.lock), AI models (MODELS_DIR) or a
tool (BIN_DIR). A feature counts as installed when its modules import and its files are on disk, so nothing has to be
remembered and an install from an older version counts as soon as it is there. Installs run one at a time as jobs.
Removing a feature this process has loaded waits for the next start: Windows keeps loaded DLLs open.

python -m dubkanka.features refresh [--json]   (the desktop app, after an update changed requirements.lock)
"""
import importlib
import importlib.metadata as md
import importlib.util
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time

from . import prefetch
from .config import BIN_DIR, HOME, MODELS_DIR, PROJECTS_DIR, ROOT, load_settings, save_settings
from .gpu import gpu_info, reset as reset_gpu
from .jobs import JobCancelled, bus, jobs
from .media import NO_WINDOW

TORCH = "2.11.0"
TORCH_INDEX = "https://download.pytorch.org/whl/"
TORCH_BUILDS = {"cu128": "CUDA 12.8", "cu126": "CUDA 12.6", "cpu": "işlemci"}
TORCH_MB = {"cu128": 2700, "cu126": 2600, "cpu": 260}
TOOL_MB = {"cloudflared": 60}
LOCK = ROOT / "requirements.lock"
CORE = ROOT / "requirements-core.txt"
STATE = HOME / "features.json"

FEATURES = {
    "speech": {
        "name": "Yazıya dökme ve çeviri",
        "summary": "Kim ne zaman ne diyor bulunur; satırlar kendiliğinden yazılır, kişilere bölünür ve çevrilir.",
        "packages": ["faster-whisper", "sherpa-onnx"], "modules": ["faster_whisper", "ctranslate2", "sherpa_onnx"],
        "models": ["whisper", "diarize"], "mb": 95,
    },
    "separate": {
        "name": "Müziği ve efektleri koru",
        "summary": "Orijinal konuşmalar çıkarılır; müzik, efektler ve ortam sesleri dublajın altında kalır.",
        "packages": ["demucs", "sherpa-onnx"], "modules": ["torch", "demucs", "sherpa_onnx"], "torch": True,
        "models": ["demucs", "denoise"], "mb": 45,
    },
    "room": {
        "name": "Arkadaşlarla oda",
        "summary": "Arkadaşların bir linkle telefondan ya da tarayıcıdan katılır, kendi rolünü kaydeder.",
        "tools": ["cloudflared"],
    },
    "cleanup": {
        "name": "Kayıt temizleme",
        "summary": "Kayıtlardaki oda gürültüsü, uğultu ve fan sesi yapay zekayla silinir.",
        "packages": ["sherpa-onnx"], "modules": ["sherpa_onnx"], "models": ["denoise"], "mb": 20,
    },
}
ORDER = ["speech", "separate", "room", "cleanup"]


class FeatureError(Exception):
    pass


# ---------------------------------------------------------------- what is here
def _state():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(s):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, indent=2), encoding="utf-8")
    os.replace(tmp, STATE)


def _module_ok(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _tool_ok(tool):
    from .room import cloudflared_path
    return bool(cloudflared_path()) if tool == "cloudflared" else False


def packages_ok(fid):
    return all(_module_ok(m) for m in FEATURES[fid].get("modules", []))


def missing_models(fid):
    return [m for m in FEATURES[fid].get("models", []) if not prefetch.PRESENT[m]()]


def missing_tools(fid):
    return [t for t in FEATURES[fid].get("tools", []) if not _tool_ok(t)]


def removing(fid):
    return fid in _state().get("remove", [])


def usable(fid):
    """Its code and tools are here (a missing model still downloads on first use)."""
    return not removing(fid) and packages_ok(fid) and not missing_tools(fid)


def ready(fid):
    return usable(fid) and not missing_models(fid)


def loaded(fid):
    return any(m in sys.modules for m in FEATURES[fid].get("modules", []))


def torch_variant():
    """The PyTorch build for this PC: CUDA 12.8 from Turing (RTX 20) on, 12.6 for Maxwell/Pascal/Volta, else CPU."""
    forced = os.environ.get("DUBKANKA_TORCH_VARIANT")
    if forced in TORCH_BUILDS:
        return forced
    g = gpu_info()
    if not g["available"]:
        return "cpu"
    cc = g.get("computeCap")
    return "cu128" if cc is None or cc >= 7.5 else "cu126" if cc >= 5.0 else "cpu"


def download_mb(fid):
    """What adding the feature downloads now (only the parts that are missing)."""
    f = FEATURES[fid]
    mb = TORCH_MB[torch_variant()] if f.get("torch") and not _module_ok("torch") else 0
    if f.get("packages") and not packages_ok(fid):
        mb += f["mb"]
    mb += sum(prefetch.size_mb(m) for m in missing_models(fid))
    return mb + sum(TOOL_MB[t] for t in missing_tools(fid))


def _job(fid, active=False):
    js = [j for j in jobs.jobs.values() if j.meta.get("feature") == fid]
    run = [j for j in js if j.status in ("queued", "running")]
    if run or active:
        return run[0] if run else None
    return max(js, key=lambda j: j.created) if js else None


def status(fid):
    f = FEATURES[fid]
    job = _job(fid)
    live = job if job and job.status in ("queued", "running") else None
    pk, mm, mt = packages_ok(fid), missing_models(fid), missing_tools(fid)
    if removing(fid) or (live and job.kind == "feature-remove"):
        state = "removing"
    elif live:
        state = "installing" if live.status == "running" else "queued"
    elif pk and not mm and not mt:
        state = "ready"
    elif job and job.status == "error" and job.kind == "feature" and time.time() - (job.finished or 0) < 900:
        state = "error"
    elif pk and not mt and f.get("models"):
        state = "partial"  # the code is here, a model is not (an older install that skipped models, or a new model)
    else:
        state = "missing"
    out = {"id": fid, "name": f["name"], "summary": f["summary"], "state": state,
           "mb": 0 if state == "ready" else download_mb(fid), "job": job.to_dict() if job else None,
           "restartToRemove": removing(fid)}
    if f.get("torch"):
        out["build"] = TORCH_BUILDS[torch_variant()]
    return out


def all_status():
    importlib.invalidate_caches()
    return [status(fid) for fid in ORDER]


# ---------------------------------------------------------------- installing
def _installer():
    """(install, uninstall) commands for this Python: the desktop app's bundled uv, uv on PATH, or pip."""
    uv = os.environ.get("DUBKANKA_UV") or shutil.which("uv")
    if uv and os.path.exists(uv):
        return ([uv, "pip", "install", "--python", sys.executable],
                [uv, "pip", "uninstall", "--python", sys.executable])
    if _module_ok("pip"):
        return ([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input"],
                [sys.executable, "-m", "pip", "uninstall", "-y", "--disable-pip-version-check"])
    raise FeatureError("Paket kurucu bulunamadı. Ayarlar → Sistem → Kurulumu onar ile düzelt.")


def _env():
    env = dict(os.environ, UV_HTTP_TIMEOUT="600", UV_NO_PROGRESS="1", NO_COLOR="1", PIP_PROGRESS_BAR="off",
               PYTHONIOENCODING="utf-8")
    if os.environ.get("DUBKANKA_UV_CACHE"):
        env["UV_CACHE_DIR"] = os.environ["DUBKANKA_UV_CACHE"]
    return env


def _friendly(tail):
    text = "\n".join(tail)
    if re.search(r"ENOTFOUND|ConnectError|connection|timed out|dns|Network|getaddrinfo|Failed to fetch", text, re.I):
        return "İnternet bağlantısı yok ya da çok yavaş. Bağlantını kontrol edip tekrar dene."
    if re.search(r"No space|not enough space|ENOSPC|os error 112", text, re.I):
        return "Diskte yer kalmadı."
    if re.search(r"Access is denied|os error 5|being used by another process|os error 32", text, re.I):
        return "Dosyalar kullanımda. Uygulamayı yeniden başlatıp tekrar dene."
    return " ".join(tail[-3:])[:400] or "Kurulum tamamlanamadı."


def _run(job, cmd, on_line=None, tick=None):
    """Run an installer command; lines go to the server log, cancelling the job kills it."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=_env(), creationflags=NO_WINDOW)
    lines = queue.Queue()

    def read():
        for raw in iter(proc.stdout.readline, b""):
            lines.put(raw.decode("utf-8", "replace").strip())
        lines.put(None)

    threading.Thread(target=read, daemon=True).start()
    tail, last_tick = [], 0.0
    try:
        while True:
            try:
                line = lines.get(timeout=0.5)
            except queue.Empty:
                line = ""
            if line is None:
                break
            if job and job.cancel_requested:
                raise JobCancelled()
            if line:
                tail = (tail + [line])[-40:]
                print(line, flush=True)
                if on_line:
                    on_line(line)
            if tick and time.time() - last_tick > 1.5:
                last_tick = time.time()
                tick()
    except BaseException:
        proc.kill()
        raise
    if proc.wait() != 0:
        raise FeatureError(_friendly(tail))
    return tail


def _free():
    try:
        return shutil.disk_usage(HOME).free
    except OSError:
        return None


def _install_torch(job, variant, prog):
    install, _ = _installer()
    gpu = gpu_info()
    label = f"PyTorch {TORCH} · {TORCH_BUILDS[variant]}" + (f" ({gpu['name']})" if variant != "cpu" and gpu.get("name") else "")
    prog(0.0, label + " indiriliyor")
    expected = (5.2 if variant != "cpu" else 0.9) * 2**30  # what it takes on disk
    start = _free()

    def tick():
        now = _free()
        if start is not None and now is not None:
            prog(min(0.97, (start - now) / expected), f"{label}: {max(0, start - now) / 2**20:.0f} MB yazıldı")

    _run(job, install + [f"torch=={TORCH}", "--index-url", TORCH_INDEX + variant], tick=tick)


def _install_packages(job, packages, prog):
    install, _ = _installer()
    n = [0]

    def line(text):
        if re.match(r"(Downloading|Downloaded|Collecting|Installed|Prepared|Successfully|\+ )", text):
            n[0] += 1
            prog(min(0.95, n[0] / 40), text[:120])

    prog(0.02, "Paketler indiriliyor")
    _run(job, install + packages + ["-c", str(LOCK)], on_line=line)
    importlib.invalidate_caches()


def _fetch_tool(tool, prog):
    from .diarize import download
    from .room import CLOUDFLARED_URL
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    download(CLOUDFLARED_URL, BIN_DIR / "cloudflared.exe", lambda f: prog(f, "Bağlantı aracı (cloudflared)"))


def _verify(fid):
    """Import the feature in a separate Python: a broken install shows up here instead of in the middle of a scene."""
    mods = FEATURES[fid].get("modules", [])
    if not mods:
        return
    r = subprocess.run([sys.executable, "-c", "import " + ", ".join(mods)], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=300, env=_env(), creationflags=NO_WINDOW)
    if r.returncode != 0:
        last = [l for l in (r.stderr or "").splitlines() if l.strip()][-1:] or ["?"]
        raise FeatureError(f"Kuruldu ama açılamadı: {last[0][:300]}")


def _changed():
    importlib.invalidate_caches()
    reset_gpu()
    bus.notify()


def _remember():
    """Note which features are installed: a repair rebuilds Python from scratch and brings these back (refresh)."""
    s = _state()
    s["installed"] = [fid for fid in ORDER if FEATURES[fid].get("packages") and packages_ok(fid)]
    _save_state(s)


def run_install(job, fid):
    f = FEATURES[fid]
    parts = []  # (download MB, step)
    if f.get("torch") and not _module_ok("torch"):
        variant = torch_variant()
        parts.append((TORCH_MB[variant], lambda prog, v=variant: _install_torch(job, v, prog)))
    if f.get("packages") and not packages_ok(fid):
        parts.append((f["mb"], lambda prog: _install_packages(job, list(f["packages"]), prog)))
    for m in f.get("models", []):  # after the packages: the downloads use them
        if not prefetch.PRESENT[m]():
            parts.append((prefetch.size_mb(m), lambda prog, m=m: prefetch.FETCH[m](prog)))
    for t in f.get("tools", []):
        if not _tool_ok(t):
            parts.append((TOOL_MB[t], lambda prog, t=t: _fetch_tool(t, prog)))
    total = sum(mb for mb, _ in parts) or 1
    done = 0
    try:
        for mb, step in parts:
            def prog(frac, msg=None, base=done, mb=mb):
                job.update((base + mb * max(0.0, min(1.0, frac))) / total, msg)
            step(prog)
            done += mb
            _changed()
        job.update(0.99, "Kontrol ediliyor...")
        _verify(fid)
        _remember()
    finally:
        _changed()
    return {"feature": fid, "message": f"{f['name']} hazır."}


def install(ids):
    """Queue the features that are not here yet; returns the jobs started."""
    started = []
    for fid in ids:
        if fid not in FEATURES or _job(fid, active=True):
            continue
        if removing(fid):  # asked back before the restart: keep it
            s = _state()
            s["remove"] = [x for x in s.get("remove", []) if x != fid]
            _save_state(s)
        if ready(fid):
            continue
        started.append(jobs.submit("feature", None, f"{FEATURES[fid]['name']} ekleniyor",
                                   lambda j, fid=fid: run_install(j, fid), meta={"feature": fid}, pool="setup"))
    bus.notify()
    return started


def cancel(fid):
    j = _job(fid, active=True)
    if j:
        jobs.cancel(j.id)


def wait(fid, job=None):
    """A scene prepared while its feature downloads waits for it; returns whether the feature can be used."""
    while True:
        j = _job(fid, active=True)
        if not j or j.kind != "feature":
            break
        if job:
            job.update(None, f"{FEATURES[fid]['name']} indiriliyor, bitince devam edilecek: %{round(j.progress * 100)}")
        time.sleep(1.0)
    importlib.invalidate_caches()
    return usable(fid)


# ---------------------------------------------------------------- removing
def _norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def _closure(names, extras=False):
    """Installed distributions these need, following Requires-Dist (optional extras only when asked)."""
    seen, stack = set(), list(names)
    while stack:
        n = _norm(stack.pop())
        if n in seen:
            continue
        seen.add(n)
        try:
            reqs = md.distribution(n).requires or []
        except md.PackageNotFoundError:
            continue
        for r in reqs:
            spec, _, marker = r.partition(";")
            if "extra" in marker and not extras:
                continue
            m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", spec)
            if m:
                stack.append(m.group(1))
    return seen


def _top_packages(fid):
    f = FEATURES[fid]
    return list(f.get("packages", [])) + (["torch"] if f.get("torch") else [])


def _exclusive_packages(fid):
    core = [m.group(1) for l in CORE.read_text(encoding="utf-8").splitlines()
            if (m := re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", l)) and not l.lstrip().startswith("#")]
    keep = _closure(core + ["pip", "uv", "setuptools"], extras=True)
    for other in FEATURES:
        if other != fid and usable(other):
            keep |= _closure(_top_packages(other))
    return sorted(_closure(_top_packages(fid)) - keep)


def _uses_loaded(packages):
    mods = md.packages_distributions()
    names = set(packages)
    return any(top in sys.modules for top, dists in mods.items() if any(_norm(d) in names for d in dists))


def _model_dirs(fid):
    """Model folders only this feature uses (DPDFNet stays while the other feature that needs it is here)."""
    from .ambience import MODEL_DIR as DENOISE_DIR
    from .diarize import DIAR_DIR
    dirs = {"whisper": [prefetch.WHISPER_DIR], "diarize": [DIAR_DIR],
            "demucs": [*prefetch.HF_HUB.glob("models--adefossez--*Demucs*"), MODELS_DIR / "torch"],
            "denoise": [DENOISE_DIR]}
    others = {m for o in FEATURES if o != fid and usable(o) for m in FEATURES[o].get("models", [])}
    return [d for m in FEATURES[fid].get("models", []) if m not in others for d in dirs[m]]


def _remove_now(job, fid):
    f = FEATURES[fid]
    if job:
        job.update(0.1, "Kaldırılıyor...")
    pkgs = _exclusive_packages(fid) if f.get("packages") else []
    if pkgs:
        _, uninstall = _installer()
        _run(job, uninstall + pkgs)
    for d in _model_dirs(fid):
        shutil.rmtree(d, ignore_errors=True)
    if "cloudflared" in f.get("tools", []):
        (BIN_DIR / "cloudflared.exe").unlink(missing_ok=True)
    s = _state()
    s["remove"] = [x for x in s.get("remove", []) if x != fid]
    _save_state(s)
    _remember()
    _changed()
    return {"feature": fid, "message": f"{f['name']} kaldırıldı."}


def remove(fid):
    """Returns {"restart": True} when the feature is in use by this process and goes on the next start."""
    if fid not in FEATURES:
        raise FeatureError("Böyle bir özellik yok.")
    if _job(fid, active=True):
        raise FeatureError("Önce süren işlemin bitmesini bekle.")
    if fid == "room":
        from .room import room
        if room.status in ("on", "starting"):
            raise FeatureError("Önce odayı kapat.")
    if loaded(fid) or (FEATURES[fid].get("packages") and _uses_loaded(_exclusive_packages(fid))):
        s = _state()
        s["remove"] = sorted(set(s.get("remove", [])) | {fid})
        _save_state(s)
        bus.notify()
        return {"restart": True}
    jobs.submit("feature-remove", None, f"{FEATURES[fid]['name']} kaldırılıyor", lambda j: _remove_now(j, fid),
                meta={"feature": fid}, pool="setup")
    return {"restart": False}


def keep(fid):
    """Undo a removal that waits for the restart."""
    s = _state()
    s["remove"] = [x for x in s.get("remove", []) if x != fid]
    _save_state(s)
    bus.notify()


# ---------------------------------------------------------------- start and updates
def boot():
    """Before the server starts: finish removals that waited for a restart, settle first-run state."""
    for fid in _state().get("remove", []):
        if fid in FEATURES:
            try:
                _remove_now(None, fid)
            except Exception as e:  # never keep the studio from opening over a leftover package
                print(f"{fid} kaldırılamadı: {e}", flush=True)
    _remember()
    if load_settings().get("onboarded") is None:  # installs from before the feature picker never see it
        old = any(PROJECTS_DIR.glob("*/project.json")) or packages_ok("speech") or packages_ok("separate")
        save_settings({"onboarded": bool(old)})


def _torch_version():
    try:
        return md.version("torch").split("+")[0]
    except md.PackageNotFoundError:
        return None


def _torch_build():
    try:
        local = md.version("torch").partition("+")[2]
    except md.PackageNotFoundError:
        return None
    return local if local in TORCH_BUILDS else None


def refresh(report):
    """After an update: installed features follow the new pins (and a new PyTorch version, in the same build). After a
    repair that rebuilt Python, the features that were installed come back; their models are still on disk."""
    known = set(_state().get("installed", []))
    todo = [fid for fid in ORDER
            if FEATURES[fid].get("packages") and not removing(fid) and (packages_ok(fid) or fid in known)]
    install, _ = _installer()
    for i, fid in enumerate(todo):
        f = FEATURES[fid]
        report(i / max(1, len(todo)), f"{f['name']} güncelleniyor")
        if f.get("torch") and _torch_version() != TORCH:
            _run(None, install + [f"torch=={TORCH}", "--index-url", TORCH_INDEX + (_torch_build() or torch_variant())])
        _run(None, install + list(f["packages"]) + ["-c", str(LOCK)], on_line=lambda l, i=i: report(i / max(1, len(todo)), l[:120]))
    _remember()
    report(1.0, "Özellikler güncel")


def main():
    if sys.argv[1:2] != ["refresh"]:
        print("python -m dubkanka.features refresh [--json]")
        return
    as_json = "--json" in sys.argv

    def report(progress, message):
        print(json.dumps({"progress": round(progress, 4), "message": message}, ensure_ascii=False) if as_json
              else f"[{progress * 100:5.1f}%] {message}", flush=True)

    refresh(report)


if __name__ == "__main__":
    main()
