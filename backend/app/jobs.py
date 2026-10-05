import asyncio
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from time import monotonic
from uuid import uuid4
from . import config
from .errors import AnalysisError
from .schemas import JobResponse, ErrorDetail
from .service import analyze_recording, AnalysisCancelled


@dataclass
class Job:
    job_id: str = field(default_factory=lambda: str(uuid4()))
    state: str = 'queued'
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    segments_completed: int = 0
    segments_total: int = 0
    result: object = None
    error: ErrorDetail | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    task: asyncio.Task | None = None
    finished_at: float | None = None
    upload_bytes: int = 0

    def update_progress(self, completed, total):
        self.segments_completed, self.segments_total = completed, total

    def snapshot(self):
        return JobResponse(job_id=self.job_id, state=self.state, created_at=self.created_at,
            segments_completed=self.segments_completed, segments_total=self.segments_total,
            progress=self.segments_completed / self.segments_total if self.segments_total else 0,
            result=self.result, error=self.error)


class JobManager:
    def __init__(self, runtime, guard):
        self.runtime, self.guard, self.jobs = runtime, guard, {}

    def prune(self):
        now = monotonic()
        for key in [k for k, j in self.jobs.items() if j.finished_at is not None and now - j.finished_at > config.JOB_TTL_SECONDS]:
            del self.jobs[key]
        finished = sorted((j for j in self.jobs.values() if j.finished_at is not None), key=lambda j: j.finished_at)
        for job in finished[:max(0, len(self.jobs) - config.MAX_PENDING_JOBS * 5)]:
            del self.jobs[job.job_id]

    def check_capacity(self, count=1, upload_bytes=0):
        self.prune()
        pending = [j for j in self.jobs.values() if j.state in ('queued', 'processing')]
        if len(pending) + count > config.MAX_PENDING_JOBS or sum(j.upload_bytes for j in pending) + upload_bytes > config.MAX_UPLOAD_BYTES * 2:
            raise AnalysisError('QUEUE_FULL', 'The analysis queue is full. Retry after a job finishes.', 429)

    def submit(self, data, phone=False, compare=False):
        self.check_capacity(upload_bytes=len(data))
        job = Job(upload_bytes=len(data))
        self.jobs[job.job_id] = job
        job.task = asyncio.create_task(self._run(job, data, phone, compare))
        return job.snapshot()

    async def _run(self, job, data, phone, compare):
        loop = asyncio.get_running_loop()
        try:
            async with self.guard:
                if job.cancel.is_set():
                    raise AnalysisCancelled
                job.state = 'processing'
                work = asyncio.create_task(asyncio.to_thread(analyze_recording, data, self.runtime, phone, compare,
                    job.cancel, lambda done, total: loop.call_soon_threadsafe(job.update_progress, done, total)))
                try:
                    job.result = await asyncio.shield(work)
                except asyncio.CancelledError:
                    job.cancel.set()
                    try:
                        await work
                    except AnalysisCancelled:
                        pass
                    raise
                if job.cancel.is_set():
                    job.result = None
                    raise AnalysisCancelled
                job.state = 'completed'
        except (AnalysisCancelled, asyncio.CancelledError):
            job.state, job.result = 'cancelled', None
        except AnalysisError as exc:
            job.state, job.error = 'failed', ErrorDetail(code=exc.code, message=exc.message)
        except Exception:
            job.state, job.error = 'failed', ErrorDetail(code='INFERENCE_FAILED', message='Analysis failed. Please retry.')
        finally:
            job.upload_bytes = 0
            job.finished_at = monotonic()

    def get(self, job_id):
        self.prune()
        if job_id not in self.jobs:
            raise AnalysisError('JOB_NOT_FOUND', 'This job does not exist or has expired.', 404)
        return self.jobs[job_id]

    def cancel_job(self, job_id):
        job = self.get(job_id)
        if job.state in ('queued', 'processing'):
            job.cancel.set()
            if job.state == 'queued':
                job.state = 'cancelled'
                job.task.cancel()
                job.upload_bytes = 0
                job.finished_at = monotonic()
        return job.snapshot()

    async def shutdown(self):
        active = [j for j in self.jobs.values() if j.task and not j.task.done()]
        for job in active:
            self.cancel_job(job.job_id)
        if active:
            await asyncio.gather(*(j.task for j in active), return_exceptions=True)
