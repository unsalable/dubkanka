"""Start DubKanka: python -m dubkanka [--no-browser]"""
import socket
import sys
import threading
import webbrowser

from .config import load_settings


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


def main():
    settings = load_settings()
    port = int(settings["port"])
    url = f"http://127.0.0.1:{port}"
    if _port_in_use(port):
        print(f"DubKanka zaten açık: {url}")
        webbrowser.open(url)
        return
    print("=" * 56)
    print("  DubKanka - arkadaşlarınla dublaj stüdyosu")
    print(f"  Adres: {url}")
    print("  Kapatmak için bu pencereyi kapat (veya Ctrl+C).")
    print("=" * 56)
    if settings.get("openBrowser", True) and "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    import uvicorn
    from .gpu import gpu_info
    from .server import app
    threading.Thread(target=gpu_info, daemon=True).start()  # warm up torch/CUDA in the background
    _quiet_dropped_connections()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", timeout_keep_alive=30)


if __name__ == "__main__":
    main()
