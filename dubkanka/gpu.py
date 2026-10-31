"""GPU detection and CUDA library wiring shared by Demucs (torch) and Whisper (ctranslate2)."""
import gc
import os
from pathlib import Path

from .config import load_settings

_dll_done = False
_info = None


def setup_cuda_dlls():
    """ctranslate2 needs cuBLAS/cuDNN; torch already ships them, so expose torch/lib to the DLL loader."""
    global _dll_done
    if _dll_done:
        return
    _dll_done = True
    try:
        import torch  # noqa: F401  (loading torch preloads its CUDA DLLs on Windows)
        lib = Path(torch.__file__).parent / "lib"
        if lib.exists() and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(lib))
            os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass


def gpu_info():
    global _info
    if _info is None:
        try:
            import torch
            if torch.cuda.is_available():
                p = torch.cuda.get_device_properties(0)
                _info = {"available": True, "name": p.name, "memoryGB": round(p.total_memory / 2**30, 1)}
            else:
                _info = {"available": False}
        except Exception as e:
            _info = {"available": False, "error": str(e)}
    return _info


def torch_device():
    if load_settings().get("device") == "cpu":
        return "cpu"
    return "cuda" if gpu_info().get("available") else "cpu"


def free_gpu():
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
