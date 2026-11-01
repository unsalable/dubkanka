"""Who is calling (host = this PC, guest = a friend in the room, anon) and the small request helpers every API module
shares."""
from pathlib import Path

from fastapi import HTTPException, Request

from .i18n import tx
from .projects import store
from .room import room

GUEST_COOKIE = "dk_guest"


def is_remote(request: Request):
    h = request.headers
    if "cf-ray" in h or "cf-connecting-ip" in h:
        return True
    host = request.client.host if request.client else ""
    return host not in ("127.0.0.1", "::1", "localhost")


def who(request: Request):
    if not is_remote(request):
        return "host", None
    g = room.guest(request.cookies.get(GUEST_COOKIE))
    return ("guest", g) if g else ("anon", None)


def host_only(request: Request):
    if is_remote(request):
        raise HTTPException(403, tx("Bu işlem sadece odayı açan bilgisayardan yapılabilir."))


def member(request: Request, pid):
    role, g = who(request)
    if role == "host":
        return role, g
    if role == "guest" and pid == room.project_id:
        return role, g
    raise HTTPException(403, tx("Odaya katılman gerekiyor."))


def project_or_404(pid):
    try:
        return store.get(pid)
    except KeyError:
        raise HTTPException(404, tx("Proje bulunamadı"))


def mutate(pid, fn):
    try:
        return store.mutate(pid, fn)
    except KeyError as e:
        raise HTTPException(404, str(e.args[0]) if e.args else tx("Bulunamadı"))
    except ValueError as e:
        raise HTTPException(400, str(e))


async def body_json(request: Request):
    try:
        return await request.json()
    except Exception:
        return {}


async def save_body(request: Request, dst: Path, limit_mb=8000):
    size = 0
    with open(dst, "wb") as f:
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit_mb * 2**20:
                f.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(413, tx("Dosya çok büyük."))
            f.write(chunk)
    if size == 0:
        dst.unlink(missing_ok=True)
        raise HTTPException(400, tx("Boş dosya geldi."))
    return size
