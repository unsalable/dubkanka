"""Friends room: a public HTTPS link (Cloudflare quick tunnel) + PIN so friends can record from their phones."""
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import urllib.request

from .config import BIN_DIR
from .jobs import bus
from .media import NO_WINDOW

CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
_URL_RE = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com")


def _kill_with_us_job():
    """Windows job object: children assigned to it die when DubKanka exits, even if its console is closed."""
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                        ("SchedulingClass", wintypes.DWORD)]

        class Io(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ("r", "w", "o", "rb", "wb", "ob")]

        class Extended(ctypes.Structure):
            _fields_ = [("Basic", Basic), ("Io", Io), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        job = k32.CreateJobObjectW(None, None)
        info = Extended()
        info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info))
        return k32, job
    except Exception:
        return None


_JOB = _kill_with_us_job()


def _bind_to_us(proc):
    if _JOB:
        k32, job = _JOB
        try:
            import ctypes.wintypes as wt
            k32.AssignProcessToJobObject(wt.HANDLE(job), wt.HANDLE(int(proc._handle)))
        except Exception:
            pass


def cloudflared_path():
    for c in (BIN_DIR / "cloudflared.exe", shutil.which("cloudflared"),
              os.path.join(os.environ.get("ProgramFiles(x86)", ""), "cloudflared", "cloudflared.exe"),
              os.path.join(os.environ.get("ProgramFiles", ""), "cloudflared", "cloudflared.exe")):
        if c and os.path.exists(c):
            return str(c)
    return None


class Room:
    def __init__(self):
        self.project_id = None
        self.pin = None
        self.url = None
        self.status = "off"  # off | starting | on | error
        self.error = None
        self.guests = {}  # token -> {name, joined, seen, view, line, char}
        self.host = None  # what the PC that opened the room is doing: {name, char, line, view, seen}
        self.activity = []
        self._proc = None
        self._lock = threading.Lock()

    # ---- lifecycle -------------------------------------------------------
    def start(self, project_id, port):
        with self._lock:
            if self.project_id != project_id:
                self.guests.clear()
                self.activity.clear()
                self.host = None
            self.project_id = project_id
            self.pin = self.pin or f"{secrets.randbelow(9000) + 1000}"
            if self._proc and self._proc.poll() is None and self.url:
                self.status = "on"
                bus.notify()
                return
            exe = cloudflared_path()
            if not exe:
                self.status, self.error = "error", "cloudflared-missing"
                bus.notify()
                return
            self.status, self.error, self.url = "starting", None, None
            self._proc = subprocess.Popen(
                [exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                creationflags=NO_WINDOW)
            _bind_to_us(self._proc)
            threading.Thread(target=self._read, args=(self._proc,), daemon=True).start()
        bus.notify()

    def _read(self, proc):
        tail = []
        for line in proc.stdout:
            tail = (tail + [line.strip()])[-15:]
            m = _URL_RE.search(line)
            if m and proc is self._proc and not self.url:
                self.url = m.group(0)
                threading.Thread(target=self._wait_reachable, args=(proc, self.url), daemon=True).start()
        if proc is self._proc and self.status != "off":
            self.status = "error"
            self.error = "Bağlantı koptu: " + " ".join(tail[-3:])[-300:]
            self.url = None
            bus.notify()

    def _wait_reachable(self, proc, url):
        """A fresh quick-tunnel URL needs a few seconds before it resolves; only then hand it to friends."""
        deadline = time.time() + 45
        while time.time() < deadline and proc is self._proc:
            try:
                req = urllib.request.Request(url + "/api/ping", headers={"User-Agent": "DubKanka"})
                with urllib.request.urlopen(req, timeout=6) as r:
                    if r.status == 200:
                        break
            except Exception:
                time.sleep(2)
        if proc is self._proc and self.url == url:
            self.status = "on"
            self.log("Oda açıldı")
            bus.notify()

    def stop(self):
        with self._lock:
            proc, self._proc = self._proc, None
            self.status, self.url, self.error = "off", None, None
            self.pin = None
            self.guests.clear()
            self.host = None
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        bus.notify()

    # ---- guests ----------------------------------------------------------
    def join(self, name, pin, client="?"):
        if self.status not in ("on", "starting") or not self.project_id:
            raise PermissionError("Oda şu an kapalı.")
        now = time.time()
        # The link is public, so slow down PIN guessing: 5 misses per client / 30 overall per 10 minutes.
        self._fails = [(t, c) for t, c in getattr(self, "_fails", []) if now - t < 600]
        if sum(1 for _, c in self._fails if c == client) >= 5 or len(self._fails) >= 30:
            raise PermissionError("Çok fazla hatalı deneme. Birkaç dakika sonra tekrar dene.")
        if str(pin).strip() != self.pin:
            self._fails.append((now, client))
            raise PermissionError("PIN yanlış.")
        name = re.sub(r"\s+", " ", (name or "").strip())[:30] or "Misafir"
        token = secrets.token_urlsafe(24)
        now = time.time()
        self.guests[token] = {"name": name, "joined": now, "seen": now, "view": "", "line": None, "char": None}
        self.log(f"{name} odaya katıldı")
        return token

    def guest(self, token):
        g = self.guests.get(token or "")
        if g and self.status != "off":
            g["seen"] = time.time()
            return g
        return None

    def heartbeat(self, token, view=None, line=None, char=None):
        g = self.guest(token)
        if g:
            changed = (g.get("view"), g.get("line"), g.get("char")) != (view, line, char)
            g["view"], g["line"], g["char"] = view, line, char
            if changed:
                bus.notify()
        return g

    def presence(self, project_id, name=None, char=None, line=None, view=None):
        """The host records too: friends see which role the room's owner took and where they are."""
        if project_id != self.project_id:
            return
        h = {"name": re.sub(r"\s+", " ", (name or "").strip())[:30] or "Oda sahibi", "char": char, "line": line,
             "view": view}
        changed = not self.host or any(self.host.get(k) != v for k, v in h.items())
        self.host = {**h, "seen": time.time()}
        if changed:
            bus.notify()

    def log(self, text):
        self.activity.insert(0, {"t": time.time(), "text": text})
        del self.activity[60:]
        bus.notify()

    def to_dict(self):
        now = time.time()
        return {
            "status": self.status, "url": self.url, "pin": self.pin, "projectId": self.project_id,
            "error": self.error, "hasCloudflared": bool(cloudflared_path()),
            "guests": [{"name": g["name"], "online": now - g["seen"] < 20, "view": g.get("view"),
                        "line": g.get("line"), "char": g.get("char")} for g in self.guests.values()],
            "host": {k: v for k, v in self.host.items() if k != "seen"} | {"online": now - self.host["seen"] < 20}
            if self.host else None,
            "activity": self.activity[:30],
        }


room = Room()


def download_cloudflared(job):
    from .diarize import download
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    job.update(0.0, "Bağlantı aracı (cloudflared) indiriliyor, ~60 MB...")
    download(CLOUDFLARED_URL, BIN_DIR / "cloudflared.exe", lambda f: job.update(f))
    bus.notify()
    return {"path": str(BIN_DIR / "cloudflared.exe")}
