"""GPU detection and CUDA library wiring shared by Demucs (torch) and Whisper (ctranslate2).

The card itself comes from the NVIDIA driver (nvidia-smi), so it is known before PyTorch is installed: the
"Müziği koru" feature picks its PyTorch build from it. Whether work can run on it is a separate question, answered
by PyTorch once that feature is there (its CUDA libraries also serve Whisper).
"""
import gc
import os
import subprocess
import threading
from pathlib import Path

from .config import load_settings
from .media import NO_WINDOW

_dll_done = False
_info = None
_cuda = None
_lock = threading.Lock()


def _smi(fields):
    try:
        r = subprocess.run(["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"], capture_output=True,
                           text=True, timeout=20, creationflags=NO_WINDOW)
    except Exception:
        return None
    lines = (r.stdout or "").strip().splitlines()
    return [x.strip() for x in lines[0].split(",")] if r.returncode == 0 and lines else None


def gpu_info():
    """{"available": bool, "name", "memoryGB", "computeCap"} of the first NVIDIA card."""
    global _info
    with _lock:
        if _info is None:
            row = _smi("name,memory.total,compute_cap") or _smi("name,memory.total")  # old drivers lack compute_cap
            if not row:
                _info = {"available": False}
            else:
                _info = {"available": True, "name": row[0]}
                try:
                    _info["memoryGB"] = round(float(row[1]) / 1024, 1)
                    _info["computeCap"] = float(row[2]) if len(row) > 2 else None
                except ValueError:
                    pass
        return dict(_info)


def torch_cuda():
    """PyTorch is installed with CUDA and sees the card."""
    global _cuda
    if _cuda is None:
        if not gpu_info()["available"]:
            _cuda = False
        else:
            try:
                import torch
                _cuda = bool(torch.cuda.is_available())
            except Exception:
                return False  # not installed (yet): ask again after the feature arrives
    return _cuda


def reset():
    """Forget what was found (a feature was just installed or removed)."""
    global _cuda
    _cuda = None


def setup_cuda_dlls():
    """ctranslate2 needs cuBLAS/cuDNN; torch already ships them, so expose torch/lib to the DLL loader."""
    global _dll_done
    if _dll_done:
        return
    try:
        import torch  # noqa: F401  (loading torch preloads its CUDA DLLs on Windows)
        lib = Path(torch.__file__).parent / "lib"
        if lib.exists() and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(lib))
            os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")
        _dll_done = True
    except Exception:
        pass  # no PyTorch yet: try again once the feature that brings it is installed


def use_gpu():
    return load_settings().get("device") != "cpu" and torch_cuda()


def torch_device():
    return "cuda" if use_gpu() else "cpu"


def free_gpu():
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
