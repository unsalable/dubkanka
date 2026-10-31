"""Project persistence: one folder + project.json per project."""
import copy
import json
import os
import secrets
import shutil
import string
import threading
import time
from pathlib import Path

from .config import PROJECTS_DIR, load_settings
from .jobs import bus

# Clip colours for characters: even brightness on the editor's graphite, none close to the blue accent or REC red.
# Highlighter tones for characters: even brightness on the graphite, none close to the yellow accent or REC red.
COLORS = ["#3bb4c1", "#e3a13b", "#a07cf0", "#6bbf4e", "#e66b93", "#5fa8e8",
          "#4cc49b", "#e57b58", "#7f9cbb", "#c86bd6", "#b58a5c", "#8fb35a"]
# Earlier palettes, mapped one-to-one so older projects keep their characters apart.
_OLD_COLORS = dict(zip(["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899",
                        "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#e11d48", "#6366f1"], COLORS))
_OLD_COLORS["#cdbd3d"] = "#5fa8e8"  # yellow-olive sat too close to the accent

_ALPHABET = string.ascii_lowercase + string.digits


def new_id(prefix="", n=8):
    return prefix + "".join(secrets.choice(_ALPHABET) for _ in range(n))


def default_project(pid, name):
    now = time.time()
    return {
        "id": pid,
        "name": name,
        "created": now,
        "updated": now,
        "rev": 1,
        "status": "new",
        "source": None,
        "trim": None,
        "clip": None,
        "stems": None,
        "settings": {"srcLang": "auto", "dstLang": "en", "speakers": 0, "translator": "google", "style": "natural"},
        "detectedLang": None,
        "characters": [],
        "lines": [],
        "mix": {"bgGain": 0.0, "bgMute": False, "ambGain": 0.0, "ambMute": False, "dubGain": 0.0, "dubMute": False,
                "origGain": -6.0,
                "origMute": True, "fillMissing": True, "fillGain": 0.0, "duck": 0.0, "sfx": []},
        "export": {"format": "vertical_blur", "subs": "dub", "subFont": "Arial Black", "subSize": 1.0,
                   "subPos": None, "subColor": "white", "credits": True, "creditsText": "", "quality": "high"},
        "exports": [],
    }


class ProjectStore:
    def __init__(self, root=PROJECTS_DIR):
        self.root = Path(root)
        self._cache = {}
        self._locks = {}
        self._glock = threading.RLock()

    def lock(self, pid):
        with self._glock:
            return self._locks.setdefault(pid, threading.RLock())

    def dir(self, pid):
        if not pid or any(c not in _ALPHABET for c in pid):
            raise KeyError(pid)
        return self.root / pid

    def _load(self, pid):
        if pid in self._cache:
            return self._cache[pid]
        f = self.dir(pid) / "project.json"
        if not f.exists():
            raise KeyError(pid)
        p = json.loads(f.read_text(encoding="utf-8"))
        for c in p.get("characters", []):
            c["color"] = _OLD_COLORS.get(c.get("color"), c.get("color"))
        self._cache[pid] = p
        return p

    def _save(self, p):
        d = self.dir(p["id"])
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "project.json.tmp"
        tmp.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, d / "project.json")

    def create(self, name):
        pid = new_id()
        p = default_project(pid, name or "Yeni proje")
        app = load_settings()  # a new scene starts from the dub language and translator used last
        p["settings"].update(dstLang=app.get("defaultDstLang") or "en", translator=app.get("translator") or "google")
        with self.lock(pid):
            (self.dir(pid) / "media").mkdir(parents=True, exist_ok=True)
            (self.dir(pid) / "takes").mkdir(exist_ok=True)
            self._cache[pid] = p
            self._save(p)
        bus.notify()
        return copy.deepcopy(p)

    def get(self, pid):
        with self.lock(pid):
            return copy.deepcopy(self._load(pid))

    def exists(self, pid):
        try:
            self.get(pid)
            return True
        except KeyError:
            return False

    def mutate(self, pid, fn):
        """Apply fn(project) under the project lock, bump rev, persist and notify watchers."""
        with self.lock(pid):
            p = self._load(pid)
            result = fn(p)
            p["rev"] = p.get("rev", 0) + 1
            p["updated"] = time.time()
            self._save(p)
        bus.notify()
        return result

    def list(self):
        out = []
        for d in self.root.iterdir() if self.root.exists() else []:
            if not (d / "project.json").exists():
                continue
            try:
                p = self.get(d.name)
            except Exception:
                continue
            lines = p.get("lines", [])
            out.append({
                "id": p["id"], "name": p["name"], "created": p["created"], "updated": p["updated"],
                "status": p.get("status"), "duration": (p.get("clip") or {}).get("duration"),
                "thumb": (p.get("clip") or {}).get("thumb"), "lines": len(lines),
                "recorded": sum(1 for l in lines if l.get("take")),
                "characters": len(p.get("characters", [])),
            })
        out.sort(key=lambda x: x["updated"], reverse=True)
        return out

    def delete(self, pid):
        with self.lock(pid):
            d = self.dir(pid)
            self._cache.pop(pid, None)
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)
        bus.notify()


store = ProjectStore()


def find_line(p, lid):
    for l in p["lines"]:
        if l["id"] == lid:
            return l
    raise KeyError("Satır bulunamadı")


def find_take(line, tid):
    for t in line.get("takes", []):
        if t["id"] == tid:
            return t
    raise KeyError("Kayıt bulunamadı")


def find_char(p, cid):
    for c in p["characters"]:
        if c["id"] == cid:
            return c
    return None


def sort_lines(p):
    p["lines"].sort(key=lambda l: (l["start"], l["end"]))


def next_color(p):
    used = {c["color"] for c in p["characters"]}
    for c in COLORS:
        if c not in used:
            return c
    return COLORS[len(p["characters"]) % len(COLORS)]


def add_character(p, name=None):
    n = len(p["characters"]) + 1
    existing = {c["id"] for c in p["characters"]}
    cid = f"c{n}"
    while cid in existing:
        n += 1
        cid = f"c{n}"
    c = {"id": cid, "name": name or f"Kişi {len(p['characters']) + 1}", "color": next_color(p),
         "actor": "", "gain": 0.0, "effect": "none", "voice": ""}
    p["characters"].append(c)
    return c
