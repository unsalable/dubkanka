"""Paths, persistent settings and environment setup for DubKanka."""
import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
PROJECTS_DIR = ROOT / "projeler"
EXPORTS_DIR = ROOT / "Videolar"
MODELS_DIR = ROOT / "models"
BIN_DIR = ROOT / "bin"
SETTINGS_FILE = ROOT / "settings.json"

for _d in (PROJECTS_DIR, EXPORTS_DIR, MODELS_DIR, BIN_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Keep every downloaded model inside the app folder so it is easy to find / delete.
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR / "torch"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

SAMPLE_RATE = 44100  # every stem, take and mix inside a project uses this rate

DEFAULT_SETTINGS = {
    "port": 8765,
    "whisperModel": "large-v3-turbo",
    "device": "auto",
    "separationModel": "htdemucs_ft",
    "translator": "google",
    "anthropicKey": "",
    "claudeModel": "claude-opus-5-5",
    "openBrowser": True,
}

_lock = threading.Lock()
_settings = None


def load_settings():
    global _settings
    with _lock:
        if _settings is None:
            data = {}
            if SETTINGS_FILE.exists():
                try:
                    data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
                except Exception:
                    data = {}
            _settings = {**DEFAULT_SETTINGS, **data}
        return dict(_settings)


def save_settings(patch):
    global _settings
    load_settings()
    with _lock:
        for k, v in patch.items():
            if k in DEFAULT_SETTINGS:
                _settings[k] = v
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(_settings, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, SETTINGS_FILE)
        return dict(_settings)


def public_settings():
    s = load_settings()
    key = s.pop("anthropicKey", "")
    s["hasAnthropicKey"] = bool(key)
    return s
