"""Speech to text with word timestamps (faster-whisper). Part of the "speech" feature (features.py)."""
import threading

from .config import MODELS_DIR, load_settings
from .i18n import tx
from .gpu import setup_cuda_dlls, use_gpu

WHISPER_DIR = MODELS_DIR / "whisper"
MODEL_MB = {"small": 484, "medium": 1530, "large-v3-turbo": 1620, "turbo": 1620, "large-v3": 3090}

_lock = threading.Lock()
_model = None
_key = None


def _dir_size_mb(path):
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            pass
    return total / 2**20


def _load(name, progress=None):
    global _model, _key
    device = "cuda" if use_gpu() else "cpu"
    if _model is not None and _key == (name, device):
        return _model
    _model = None
    setup_cuda_dlls()
    from faster_whisper import WhisperModel

    WHISPER_DIR.mkdir(parents=True, exist_ok=True)
    expected = MODEL_MB.get(name, 1500)
    start_size = _dir_size_mb(WHISPER_DIR)
    stop = threading.Event()

    def watch():  # turn the growing download folder into a progress bar
        while not stop.wait(0.7):
            got = _dir_size_mb(WHISPER_DIR) - start_size
            if got > 5 and progress:
                pct = min(99, int(got / expected * 100))
                progress(pct / 100, tx("Konuşma tanıma modeli indiriliyor (ilk sefere özel, ~{gb} GB): %{pct}",
                                       gb=f"{expected / 1024:.1f}", pct=pct))

    t = threading.Thread(target=watch, daemon=True)
    t.start()
    try:
        try:
            m = WhisperModel(name, device=device, compute_type="float16" if device == "cuda" else "int8",
                             download_root=str(WHISPER_DIR))
        except Exception:
            if device != "cuda":
                raise
            device = "cpu"
            m = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(WHISPER_DIR))
    finally:
        stop.set()
    _model, _key = m, (name, device)
    return m


def transcribe(audio16k, language=None, model_name=None, progress=None):
    """Returns {"language", "words": [{start,end,text,prob}], "segments": [...]} for mono 16 kHz audio."""
    model_name = model_name or load_settings().get("whisperModel", "large-v3-turbo")
    with _lock:
        if progress:
            progress(0.0, tx("Konuşma tanıma modeli yükleniyor..."))
        m = _load(model_name, progress and (lambda f, msg: progress(0.0, msg)))
        if progress:
            progress(0.0, tx("Konuşmalar yazıya dökülüyor..."))
        lang = None if language in (None, "", "auto") else language
        segments, info = m.transcribe(
            audio16k, language=lang, task="transcribe", beam_size=5, word_timestamps=True,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 200},
            condition_on_previous_text=False, hallucination_silence_threshold=2.0,
            no_speech_threshold=0.6)
        dur = max(0.1, len(audio16k) / 16000)
        words, segs = [], []
        for seg in segments:
            if progress:
                progress(min(0.99, seg.end / dur), None)
            if seg.no_speech_prob > 0.85 and seg.avg_logprob < -1.0:
                continue
            seg_words = []
            for w in seg.words or []:
                text = w.word
                if not text.strip():
                    continue
                s, e = float(w.start), float(w.end)
                if e - s < 0.05:
                    e = s + 0.05
                seg_words.append({"start": round(s, 3), "end": round(e, 3), "text": text,
                                  "prob": round(float(w.probability), 3)})
            if not seg_words and seg.text.strip():
                seg_words.append({"start": float(seg.start), "end": float(seg.end), "text": " " + seg.text.strip(),
                                  "prob": 0.5})
            words.extend(seg_words)
            segs.append({"start": float(seg.start), "end": float(seg.end), "text": seg.text.strip()})
        words.sort(key=lambda w: w["start"])
        return {"language": info.language, "languageProb": round(float(info.language_probability), 3),
                "words": words, "segments": segs, "model": model_name}
