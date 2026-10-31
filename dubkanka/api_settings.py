"""Settings API extensions: translation providers (models list, a live test, finding what is already on this PC)."""
import asyncio

from fastapi import APIRouter, HTTPException, Request

from . import translate
from .access import body_json, host_only
from .config import load_settings, public_settings, save_settings

router = APIRouter()


def _provider_or_404(pid):
    pid = translate.ALIASES.get(pid, pid)
    if pid not in translate.REGISTRY:
        raise HTTPException(404, "Böyle bir çeviri servisi yok.")
    return pid


def _merged(pid, b):
    """Saved settings of a provider overridden by what the form holds right now (not saved yet)."""
    cfg = translate.provider_config(load_settings(), pid)
    for f in ("key", "url", "model"):
        if str(b.get(f) or "").strip():
            cfg[f] = str(b[f]).strip()
    return cfg


def fill_default_models(patch):
    """A key or address was saved without a model: pick one from the provider's list so it works right away."""
    for pid, conf in (patch.get("providers") or {}).items():
        p = translate.REGISTRY.get(pid)
        if not p or p["kind"] != "llm" or not isinstance(conf, dict) or not (conf.get("key") or conf.get("url")):
            continue
        cfg = translate.provider_config(load_settings(), pid)
        if cfg.get("model") and pid != "anthropic":
            continue
        try:
            model = translate.pick_model(pid, translate.list_models(pid, cfg))
        except translate.TranslateError:
            continue
        if model and model != cfg.get("model"):
            save_settings({"providers": {pid: {"model": model}}})


@router.get("/api/translators")
def translators(request: Request):
    host_only(request)
    return translate.registry_status(load_settings())


@router.get("/api/translators/{pid}/models")
async def translator_models(pid: str, request: Request):
    host_only(request)
    pid = _provider_or_404(pid)
    try:
        models = await asyncio.to_thread(translate.list_models, pid, translate.provider_config(load_settings(), pid))
    except translate.TranslateError as e:
        raise HTTPException(400, str(e))
    return {"models": models, "suggested": translate.pick_model(pid, models)}


@router.post("/api/translators/{pid}/test")
async def translator_test(pid: str, request: Request):
    host_only(request)
    pid = _provider_or_404(pid)
    cfg = _merged(pid, await body_json(request))
    try:
        sample = await asyncio.to_thread(translate.test_provider, pid, cfg)
    except translate.TranslateError as e:
        return {"ok": False, "message": str(e), "sample": ""}
    except Exception as e:  # an unexpected answer shape is still a failed test, not a server error
        return {"ok": False, "message": f"Beklenmeyen hata: {str(e)[:160]}", "sample": ""}
    if not sample.strip():
        return {"ok": False, "message": "Servis boş yanıt verdi.", "sample": ""}
    return {"ok": True, "message": "Çalışıyor.", "sample": sample}


@router.post("/api/translators/detect")
async def translator_detect(request: Request):
    host_only(request)
    return {"found": await asyncio.to_thread(translate.detect)}


@router.post("/api/translators/detect/apply")
async def translator_detect_apply(request: Request):
    host_only(request)
    ids = [i for i in (await body_json(request)).get("ids") or [] if i in translate.REGISTRY]
    applied = []
    for pid in ids:
        cfg = await asyncio.to_thread(translate.detected_config, pid)
        if cfg:
            save_settings({"providers": {pid: cfg}})
            applied.append(pid)
    return {"applied": applied, "settings": public_settings(), "translators": translate.registry_status(load_settings())}
