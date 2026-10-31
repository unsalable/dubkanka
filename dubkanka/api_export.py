"""Export API: what the source video is and whether its picture can be copied without re-encoding."""
import asyncio

from fastapi import APIRouter, Request

from .access import host_only, project_or_404
from .export import export_info
from .projects import store

router = APIRouter()


@router.get("/api/projects/{pid}/export/info")
async def project_export_info(pid: str, request: Request):
    host_only(request)
    p = project_or_404(pid)
    return await asyncio.to_thread(export_info, p, store.dir(pid))
