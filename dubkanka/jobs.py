"""Change notifications (long-poll) and background jobs with progress."""
import asyncio
import contextvars
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

from .i18n import tx


class Bus:
    """A global version counter; long-poll requests wait until it changes."""

    def __init__(self):
        self.version = 0
        self._lock = threading.Lock()
        self._loop = None
        self._event = None

    def bind(self, loop):
        self._loop = loop
        self._event = asyncio.Event()

    def notify(self):
        with self._lock:
            self.version += 1
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._fire)

    def _fire(self):
        ev, self._event = self._event, asyncio.Event()
        ev.set()

    async def wait(self, version, timeout=25.0):
        if self._event is None or self.version != version:
            return
        ev = self._event
        try:
            await asyncio.wait_for(ev.wait(), timeout)
        except asyncio.TimeoutError:
            pass


bus = Bus()


class JobCancelled(Exception):
    pass


class Job:
    def __init__(self, kind, project_id, title, steps=None, meta=None):
        self.id = uuid.uuid4().hex[:10]
        self.kind = kind
        self.project_id = project_id
        self.title = title
        self.status = "queued"
        self.progress = 0.0
        self.message = tx("Sırada bekliyor...")
        self.error = None
        self.result = None
        self.created = time.time()
        self.finished = None
        self.steps = [{"key": k, "label": tx(l), "status": "pending"} for k, l in (steps or [])]
        self.meta = meta or {}
        self.cancel_requested = False
        self._last_notify = 0.0

    def update(self, progress=None, message=None, force=False):
        if self.cancel_requested:
            raise JobCancelled()
        if progress is not None:
            self.progress = max(0.0, min(1.0, float(progress)))
        if message is not None:
            self.message = message
        now = time.time()
        if force or message is not None or now - self._last_notify > 0.25:
            self._last_notify = now
            bus.notify()

    def step(self, key, status="running"):
        for s in self.steps:
            if s["key"] == key:
                s["status"] = status
        bus.notify()

    def to_dict(self):
        return {
            "id": self.id, "kind": self.kind, "projectId": self.project_id, "title": self.title,
            "status": self.status, "progress": round(self.progress, 4), "message": self.message,
            "error": self.error, "result": self.result, "steps": self.steps, "meta": self.meta,
            "created": self.created, "finished": self.finished,
        }


class JobManager:
    def __init__(self):
        self.jobs = {}
        self._heavy = ThreadPoolExecutor(max_workers=1, thread_name_prefix="heavy")
        self._light = ThreadPoolExecutor(max_workers=4, thread_name_prefix="light")
        # feature installs: one at a time, and never behind a scene that is waiting for one of them
        self._setup = ThreadPoolExecutor(max_workers=1, thread_name_prefix="setup")

    def submit(self, kind, project_id, title, fn, heavy=True, steps=None, meta=None, pool=None):
        job = Job(kind, project_id, title, steps, meta)
        self.jobs[job.id] = job
        self._gc()

        def run():
            job.status = "running"
            job.update(message=tx("Başladı..."), force=True)
            try:
                job.result = fn(job)
                job.status = "done"
                job.progress = 1.0
                final = job.result.get("message") if isinstance(job.result, dict) else None
                job.message = final or tx("Tamamlandı")
            except JobCancelled:
                job.status = "cancelled"
                job.message = tx("İptal edildi")
            except Exception as e:  # surface every failure to the UI
                traceback.print_exc()
                job.status = "error"
                job.error = str(e) or e.__class__.__name__
                job.message = tx("Hata: {e}", e=job.error)
                for s in job.steps:
                    if s["status"] == "running":
                        s["status"] = "error"
            job.finished = time.time()
            bus.notify()

        # the job runs in a copy of this context: it speaks the language of the request that started it
        {"setup": self._setup}.get(pool, self._heavy if heavy else self._light).submit(contextvars.copy_context().run, run)
        bus.notify()
        return job

    def cancel(self, job_id):
        job = self.jobs.get(job_id)
        if job and job.status in ("queued", "running"):
            job.cancel_requested = True
            if job.status == "queued":
                job.status = "cancelled"
            bus.notify()
        return job

    def for_project(self, project_id):
        return [j.to_dict() for j in self.jobs.values()
                if j.project_id == project_id and (j.finished is None or time.time() - j.finished < 600)]

    def active(self, project_id, kind=None):
        return any(j.project_id == project_id and j.status in ("queued", "running") and (kind is None or j.kind == kind)
                   for j in self.jobs.values())

    def _gc(self):
        cutoff = time.time() - 3600
        for jid in [k for k, j in self.jobs.items() if j.finished and j.finished < cutoff]:
            del self.jobs[jid]


jobs = JobManager()
