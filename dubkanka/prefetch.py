"""Download every AI model DubKanka uses, so the first scene does not wait for them.

python -m dubkanka.prefetch [--json]   (the desktop installer runs it with --json and reads one progress line at a time)
"""
import json
import sys
import threading

from .config import MODELS_DIR, load_settings

JSON = "--json" in sys.argv
STEPS = [("whisper", "Konuşma tanıma modeli (Whisper)", 0.62), ("demucs", "Ses ayırma modeli (Demucs)", 0.28),
         ("diarize", "Konuşmacı modeli", 0.04), ("denoise", "Gürültü / ortam modeli (DPDFNet)", 0.06)]


def report(step, progress, message):
    if JSON:
        print(json.dumps({"step": step, "progress": round(progress, 4), "message": message}, ensure_ascii=False), flush=True)
    else:
        print(f"[{progress * 100:5.1f}%] {message}", flush=True)


def _whisper(prog):
    from faster_whisper.utils import download_model

    from .transcribe import MODEL_MB, WHISPER_DIR, _dir_size_mb
    name = load_settings().get("whisperModel", "large-v3-turbo")
    expected = MODEL_MB.get(name, 1600)
    before = _dir_size_mb(WHISPER_DIR) if WHISPER_DIR.exists() else 0
    stop = threading.Event()

    def watch():  # the hub downloads in place: the growing folder is the progress bar
        while not stop.wait(0.8):
            got = (_dir_size_mb(WHISPER_DIR) - before) if WHISPER_DIR.exists() else 0
            prog(min(0.99, got / expected), f"Whisper {name} indiriliyor: {got:.0f} / ~{expected} MB")

    t = threading.Thread(target=watch, daemon=True)
    t.start()
    try:
        download_model(name, cache_dir=str(WHISPER_DIR))
    finally:
        stop.set()


def _demucs(prog):
    from demucs.pretrained import get_model
    name = load_settings().get("separationModel", "htdemucs_ft")
    prog(0.05, f"Demucs {name} indiriliyor (~320 MB)...")
    get_model(name)


def _diarize(prog):
    from .diarize import ensure_models
    ensure_models(prog)


def _denoise(prog):
    from .ambience import ensure_model
    ensure_model(prog)


def main():
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    funcs = {"whisper": _whisper, "demucs": _demucs, "diarize": _diarize, "denoise": _denoise}
    base = 0.0
    for key, label, weight in STEPS:
        report(key, base, label + "...")
        funcs[key](lambda f, msg=None, b=base, w=weight, lb=label: report(key, b + w * max(0.0, min(1.0, f)), msg or lb))
        base += weight
        report(key, base, label + " hazır")
    report("done", 1.0, "Modeller hazır")


if __name__ == "__main__":
    main()
