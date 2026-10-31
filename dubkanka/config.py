"""Paths, persistent settings and environment setup for DubKanka.

The code lives next to this package (ROOT). The data lives in DUBKANKA_HOME: the code folder itself when the app
runs from source (Baslat.bat), %LOCALAPPDATA%\\DubKanka in the desktop app (the Electron shell sets it).
"""
import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
HOME = Path(os.environ.get("DUBKANKA_HOME") or ROOT)
DESKTOP = os.environ.get("DUBKANKA_DESKTOP") == "1"
SETTINGS_FILE = HOME / "settings.json"
MODELS_DIR = Path(os.environ.get("DUBKANKA_MODELS") or HOME / "models")
BIN_DIR = Path(os.environ.get("DUBKANKA_BIN") or HOME / "bin")
LOGS_DIR = HOME / "logs"

SAMPLE_RATE = 44100  # every stem, take and mix inside a project uses this rate

# Filled in by __main__ once the server knows where it listens (the room tunnel points at this port).
RUNTIME = {"port": None}

DEFAULT_SETTINGS = {
    "port": 8765,
    "whisperModel": "large-v3-turbo",
    "device": "auto",
    "separationModel": "htdemucs_ft",
    "translator": "google",
    "anthropicKey": "",
    "claudeModel": "claude-opus-5-5",
    "openBrowser": True,
    "projectsDir": "",  # empty = default folder; a change applies after a restart
    "exportsDir": "",
    "defaultDstLang": "en",  # dub language for scenes prepared automatically
    "autoPrepare": True,  # a dropped video is prepared right away with automatic settings
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
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(_settings, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, SETTINGS_FILE)
        return dict(_settings)


def public_settings():
    s = load_settings()
    key = s.pop("anthropicKey", "")
    s["hasAnthropicKey"] = bool(key)
    return s


def _folder(setting, default):
    p = str(load_settings().get(setting) or "").strip()
    return Path(p).expanduser() if p else default


PROJECTS_DIR = _folder("projectsDir", HOME / "projeler")
EXPORTS_DIR = _folder("exportsDir", Path(os.environ.get("DUBKANKA_EXPORTS") or HOME / "Videolar"))

for _d in (PROJECTS_DIR, EXPORTS_DIR, MODELS_DIR, BIN_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Keep every downloaded model inside the data folder so it is easy to find / delete.
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR / "torch"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
