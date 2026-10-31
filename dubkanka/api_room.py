"""Room API extensions: what the host is doing (so friends see the role the room's owner took) and giving a role back."""
from fastapi import APIRouter, Request

from .access import body_json, host_only, member, mutate
from .projects import find_char
from .room import room

router = APIRouter()


@router.post("/api/room/presence")
async def room_presence(request: Request):
    host_only(request)
    b = await body_json(request)
    room.presence(b.get("projectId"), b.get("name"), b.get("char"), b.get("line"), b.get("view"))
    return {"ok": True}


@router.post("/api/projects/{pid}/characters/{cid}/unclaim")
async def char_unclaim(pid: str, cid: str, request: Request):
    role, g = member(request, pid)
    name = g["name"] if g else (str((await body_json(request)).get("name") or "").strip()[:30] or "Ben")

    def fn(p):
        c = find_char(p, cid)
        if not c:
            raise KeyError("Karakter bulunamadı")
        names = [n.strip() for n in (c.get("actor") or "").split(",") if n.strip() and n.strip() != name]
        c["actor"] = ", ".join(names)[:60]
        return c["name"]
    cname = mutate(pid, fn)
    if room.project_id == pid:
        room.log(f"{name}, {cname} rolünü bıraktı")
    return {"ok": True}
