"""AI model downloads, one function per model, each with progress. Features (features.py) fetch theirs when they are
added; checking what is on disk never imports the AI packages themselves.

python -m dubkanka.prefetch [--json] [whisper demucs diarize denoise]   (by hand: all models, or the ones named)
"""
import json
import os
import re
import sys
import threading
from pathlib import Path

from .config import MODELS_DIR, load_settings
from .i18n import tx
from .transcribe import MODEL_MB as WHISPER_MB, WHISPER_DIR, _dir_size_mb

HF_HUB = Path(os.environ.get("HF_HUB_CACHE") or Path(os.environ.get("HF_HOME") or MODELS_DIR / "hf") / "hub")
WHISPER_REPOS = {"small": "Systran/faster-whisper-small", "medium": "Systran/faster-whisper-medium",
                 "large-v3": "Systran/faster-whisper-large-v3",
                 "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
                 "turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo"}
DEMUCS_MB = {"htdemucs_ft": 81, "htdemucs": 84}
DIARIZE_MB, DENOISE_MB = 33, 11


def _grow(path, expected_mb, prog, label):
    """Turn a download folder that fills up in place into progress; returns the function that stops watching."""
    path.mkdir(parents=True, exist_ok=True)
    before = _dir_size_mb(path)
    stop = threading.Event()

    def watch():
        while not stop.wait(0.8):
            got = max(0.0, _dir_size_mb(path) - before)
            prog(min(0.99, got / expected_mb), f"{label}: {got:.0f} / ~{expected_mb} MB")

    threading.Thread(target=watch, daemon=True).start()
    return stop.set


def _hub_dir(repo):
    return HF_HUB / ("models--" + repo.replace("/", "--"))


def _snapshot_file(repo, name):
    hits = list(_hub_dir(repo).glob(f"snapshots/*/{name}"))
    return hits[0] if hits else None


# ---------------------------------------------------------------- whisper (speech)
def whisper_name():
    return load_settings().get("whisperModel", "large-v3-turbo")


def whisper_present(name=None):
    repo = WHISPER_REPOS.get(name or whisper_name())
    return bool(repo) and any((WHISPER_DIR / ("models--" + repo.replace("/", "--"))).glob("snapshots/*/model.bin"))


def whisper(prog, name=None):
    from faster_whisper.utils import download_model
    name = name or whisper_name()
    done = _grow(WHISPER_DIR, WHISPER_MB.get(name, 1600), prog, tx("Konuşma tanıma modeli ({name})", name=name))
    try:
        download_model(name, cache_dir=str(WHISPER_DIR))
    finally:
        done()


# ---------------------------------------------------------------- demucs (separate)
def demucs_name():
    return load_settings().get("separationModel", "htdemucs_ft")


def demucs_present(name=None):
    """The bag yaml and the members separation will load (separate.vocals_member, read without PyYAML)."""
    from .separate import hf_repo
    name = name or demucs_name()
    repo = hf_repo(name)
    y = _snapshot_file(repo, f"{name}.yaml")
    if not y:
        return False
    text = y.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"models:\s*\[([^\]]*)\]", text)
    sigs = re.findall(r"[0-9a-f]{8}", m.group(1)) if m else []
    rows = [[float(v) for v in re.findall(r"[-\d.]+", r)] for r in re.findall(r"\[([-\d.,\s]+)\]", text.split("weights", 1)[-1])]
    need = sigs
    if len(rows) == len(sigs) and sigs:
        best = max(range(len(sigs)), key=lambda i: rows[i][3] if len(rows[i]) > 3 else 0)
        if len(rows[best]) > 3 and rows[best][3] > 0 and sum(1 for x in rows[best] if x > 0) == 1:
            need = [sigs[best]]
    return bool(need) and all(_snapshot_file(repo, f"{s}.safetensors") for s in need)


def demucs(prog, name=None):
    from huggingface_hub import hf_hub_download

    from .separate import model_files
    name = name or demucs_name()
    done = _grow(MODELS_DIR / "hf", DEMUCS_MB.get(name, 84), prog, tx("Ses ayırma modeli"))
    try:
        repo, files = model_files(name)
        for f in files:
            hf_hub_download(repo, f)
    finally:
        done()


# ---------------------------------------------------------------- speakers + DPDFNet
def diarize_present():
    from .diarize import DIAR_DIR, EMB_NAME
    return (DIAR_DIR / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx").exists() and (DIAR_DIR / EMB_NAME).exists()


def diarize(prog):
    from .diarize import ensure_models
    ensure_models(lambda f: prog(f, tx("Konuşmacı modelleri")))


def denoise_present():
    from .ambience import MODEL_DIR, MODEL_NAME
    return (MODEL_DIR / MODEL_NAME).exists()


def denoise(prog):
    from .ambience import ensure_model
    ensure_model(lambda f: prog(f, tx("Gürültü / ortam modeli (DPDFNet)")))


FETCH = {"whisper": whisper, "demucs": demucs, "diarize": diarize, "denoise": denoise}
PRESENT = {"whisper": whisper_present, "demucs": demucs_present, "diarize": diarize_present, "denoise": denoise_present}


def size_mb(model):
    return {"whisper": lambda: WHISPER_MB.get(whisper_name(), 1600), "demucs": lambda: DEMUCS_MB.get(demucs_name(), 84),
            "diarize": lambda: DIARIZE_MB, "denoise": lambda: DENOISE_MB}[model]()


def main():
    as_json = "--json" in sys.argv
    names = [a for a in sys.argv[1:] if a in FETCH] or list(FETCH)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    def report(progress, message):
        if as_json:
            print(json.dumps({"progress": round(progress, 4), "message": message}, ensure_ascii=False), flush=True)
        else:
            print(f"[{progress * 100:5.1f}%] {message}", flush=True)

    for i, n in enumerate(names):
        FETCH[n](lambda f, msg=None, i=i: report((i + max(0.0, min(1.0, f))) / len(names), msg or n))
        report((i + 1) / len(names), tx("{name} hazır", name=n))


if __name__ == "__main__":
    main()
