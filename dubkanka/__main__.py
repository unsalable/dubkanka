"""Start DubKanka: python -m dubkanka [--port N] [--no-browser] [--parent-pid PID]

Run from source it opens the browser; the desktop app passes --no-browser, a free port and its own PID so the server
(and the room tunnel it started) never outlive the window.
"""
import argparse
import os
import socket
import sys
import threading
import time
import webbrowser

from .config import RUNTIME, load_settings


def _port_in_use(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _quiet_dropped_connections():
    """Windows' asyncio prints a scary traceback whenever the browser drops a connection (video seeks, page
    reloads). Nothing is wrong when that happens, so keep the console window clean."""
    if sys.platform != "win32":
        return
    from asyncio import proactor_events
    original = proactor_events._ProactorBasePipeTransport._call_connection_lost

    def call_connection_lost(self, exc):
        try:
            original(self, exc)
        except ConnectionResetError:
            pass
    proactor_events._ProactorBasePipeTransport._call_connection_lost = call_connection_lost


def _pid_alive(pid):
    if sys.platform != "win32":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    import ctypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k32.GetExitCodeProcess(h, ctypes.byref(code))
    k32.CloseHandle(h)
    return bool(ok) and code.value == 259  # STILL_ACTIVE


def _watch_parent(pid):
    """Exit with the desktop shell: if it crashes, nothing else would stop this server."""
    while True:
        time.sleep(2)
        if not _pid_alive(pid):
            os._exit(0)


def _warm_encoders():
    """Testing which video encoders work takes a few seconds: do it before the first visit to the export page."""
    from . import media
    try:
        if media.has_ffmpeg():
            media.ffmpeg_caps()
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(prog="dubkanka")
    ap.add_argument("--port", type=int)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--parent-pid", type=int)
    args = ap.parse_args()

    settings = load_settings()
    port = args.port or int(settings["port"])
    url = f"http://127.0.0.1:{port}"
    if _port_in_use(port):
        print(f"DubKanka zaten açık: {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return
    RUNTIME["port"] = port
    if args.parent_pid:
        threading.Thread(target=_watch_parent, args=(args.parent_pid,), daemon=True).start()
    print("=" * 56)
    print("  DubKanka - arkadaşlarınla dublaj stüdyosu")
    print(f"  Adres: {url}")
    print("  Kapatmak için bu pencereyi kapat (veya Ctrl+C).")
    print("=" * 56, flush=True)
    if settings.get("openBrowser", True) and not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    import uvicorn
    from .gpu import gpu_info
    from .server import app
    threading.Thread(target=gpu_info, daemon=True).start()  # warm up torch/CUDA in the background
    threading.Thread(target=_warm_encoders, daemon=True).start()
    _quiet_dropped_connections()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", timeout_keep_alive=30)


if __name__ == "__main__":
    main()
