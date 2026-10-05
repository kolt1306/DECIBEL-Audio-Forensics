import asyncio
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from . import config
from .errors import AnalysisError, analysis_error_handler, validation_error_handler, http_error_handler, unexpected_error_handler
from starlette.exceptions import HTTPException
from .jobs import JobManager
from .model import ModelRuntime
from .limits import UploadLimitMiddleware
from .schemas import DetailedAnalysis, ComparisonResult, JobResponse, ErrorResponse
from .service import analyze_recording, AnalysisCancelled

runtime = ModelRuntime()
inference_guard = asyncio.Semaphore(config.MAX_CONCURRENT_INFERENCE)
jobs = JobManager(runtime, inference_guard)


@asynccontextmanager
async def lifespan(app):
    loading = asyncio.create_task(asyncio.to_thread(runtime.load))
    yield
    await jobs.shutdown()
    await loading


app = FastAPI(title='DECIBEL', version='1.1.0', lifespan=lifespan,
    responses={400: {'model': ErrorResponse}, 413: {'model': ErrorResponse},
               422: {'model': ErrorResponse}, 429: {'model': ErrorResponse}, 503: {'model': ErrorResponse}})
app.add_exception_handler(AnalysisError, analysis_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(HTTPException, http_error_handler)
app.add_exception_handler(Exception, unexpected_error_handler)
app.add_middleware(UploadLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=config.FRONTEND_ORIGINS,
                   allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])


@app.get('/api/health')
@app.get('/api/v1/health')
async def health():
    return {'status': 'ok', 'model_loaded': runtime.loaded, 'diagnostic': runtime.diagnostic}


@app.get('/api/v1/ready')
async def ready():
    return JSONResponse({'ready': runtime.loaded, 'model_loaded': runtime.loaded,
        'state': runtime.state, 'diagnostic': runtime.diagnostic}, status_code=200 if runtime.loaded else 503)


@app.get('/api/v1/model-info')
async def model_info():
    return {'model_id': config.MODEL_ID, 'sample_rate': config.SAMPLE_RATE,
        'classifier_architecture': 'mean(time) → Linear(hidden,256) → GELU → Dropout(0.3) → Linear(256,2)',
        'max_segment_seconds': 29, 'segment_duration_seconds': config.MAX_SEGMENT_SECONDS,
        'segment_overlap_seconds': config.SEGMENT_OVERLAP_SECONDS,
        'max_upload_mb': config.MAX_UPLOAD_MB, 'max_audio_seconds': config.MAX_AUDIO_SECONDS,
        'max_batch_files': config.MAX_BATCH_FILES, 'runtime_device': 'cuda' if runtime.loaded else 'unavailable',
        'runtime_precision': 'float32', 'model_fingerprint': config.MODEL_FINGERPRINT,
        'classifier_sha256': config.CLASSIFIER_SHA256, 'ready': runtime.loaded}


async def read_upload(audio):
    try:
        data = await audio.read(config.MAX_UPLOAD_BYTES + 1)
    finally:
        await audio.close()
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise AnalysisError('AUDIO_TOO_LARGE', f'Recording exceeds the {config.MAX_UPLOAD_MB} MB upload limit.', 413)
    if not data:
        raise AnalysisError('NO_AUDIO', 'Choose a nonempty audio file.', 400)
    return data


async def run_sync(data, phone=False, compare=False):
    if inference_guard.locked():
        raise AnalysisError('INSTRUMENT_BUSY', 'The instrument is busy. Submit a job or retry shortly.', 429)
    async with inference_guard:
        cancel = threading.Event()
        work = asyncio.create_task(asyncio.to_thread(analyze_recording, data, runtime, phone, compare, cancel))
        try:
            return await asyncio.shield(work)
        except asyncio.CancelledError:
            cancel.set()
            try:
                await work
            except AnalysisCancelled:
                pass
            raise


@app.post('/api/analyze', response_model=DetailedAnalysis)
@app.post('/api/v1/analyze', response_model=DetailedAnalysis)
async def analyze(audio: UploadFile = File(...), phone_mode: bool = Form(False)):
    return await run_sync(await read_upload(audio), phone_mode)


@app.post('/api/v1/compare', response_model=ComparisonResult)
async def compare(audio: UploadFile = File(...)):
    return await run_sync(await read_upload(audio), compare=True)


@app.post('/api/v1/jobs/analyze', response_model=JobResponse, status_code=202)
async def submit_job(audio: UploadFile = File(...), phone_mode: bool = Form(False), compare: bool = Form(False)):
    data = await read_upload(audio)
    if not runtime.loaded:
        raise AnalysisError('MODEL_NOT_READY', 'The model is not ready. Check the readiness diagnostic.', 503)
    return jobs.submit(data, phone_mode, compare)


@app.get('/api/v1/jobs/{job_id}', response_model=JobResponse)
async def get_job(job_id: str):
    return jobs.get(job_id).snapshot()


@app.post('/api/v1/jobs/{job_id}/cancel', response_model=JobResponse)
async def cancel_job(job_id: str):
    return jobs.cancel_job(job_id)


@app.post('/api/v1/jobs/batch', response_model=list[JobResponse], status_code=202)
async def batch(files: list[UploadFile] = File(...), phone_mode: bool = Form(False), compare: bool = Form(False)):
    try:
        if not 1 <= len(files) <= config.MAX_BATCH_FILES:
            raise AnalysisError('INVALID_BATCH', f'Choose between 1 and {config.MAX_BATCH_FILES} recordings.', 422)
        if not runtime.loaded:
            raise AnalysisError('MODEL_NOT_READY', 'The model is not ready. Check the readiness diagnostic.', 503)
        jobs.check_capacity(len(files))
        recordings = []
        for file in files:
            recordings.append(await read_upload(file))
            if sum(map(len, recordings)) > config.MAX_UPLOAD_BYTES * 2:
                raise AnalysisError('REQUEST_TOO_LARGE', 'Batch uploads exceed the combined memory limit.', 413)
        jobs.check_capacity(len(files), sum(map(len, recordings)))
        return [jobs.submit(data, phone_mode, compare) for data in recordings]
    finally:
        for file in files:
            await file.close()
