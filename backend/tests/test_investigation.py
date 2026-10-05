import asyncio
import importlib
import threading
from time import monotonic
import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend.app import config
from backend.app.aggregation import probability_statistics, suspicious_regions, timeline_distribution
from backend.app.audio import prepare_audio, AudioError
from backend.app.diagnostics import diagnose, quality_warnings
from backend.app.errors import AnalysisError
from backend.app.jobs import Job, JobManager
from backend.app.main import app, runtime
from backend.app.schemas import SegmentResult
from backend.app.segmentation import segment_windows
from backend.app.service import analyze_recording, AnalysisCancelled
from backend.tests.test_audio_api import voice_signal, wav


def segment(index, start, end, fake=None):
    # Explicit synthetic values to unit-test aggregation only; not inference validation.
    return SegmentResult(index=index, start_seconds=start, end_seconds=end,
        status='skipped' if fake is None else 'analyzed', real_probability=None if fake is None else 1-fake,
        fake_probability=fake, risk=None if fake is None else 'high' if fake >= .7 else 'medium' if fake >= .4 else 'low')


@pytest.mark.parametrize('duration,overlap', [(1.5, 0), (25, 2), (25.5, 0), (25.5, 2), (48.1, 2), (48.2, 2), (71, 2), (600, 2), (100, 24)])
def test_windows_cover_every_sample_without_short_tail(duration, overlap):
    sr, length = 16000, round(duration * 16000)
    windows = segment_windows(length, sr, 25, overlap)
    assert windows[0].start == 0 and windows[-1].end == length
    for i, w in enumerate(windows):
        assert w.index == i and 1.5 * sr <= w.end-w.start <= 25 * sr
        if i:
            assert windows[i-1].start < w.start <= windows[i-1].end


def test_windows_match_requested_overlap():
    assert [(w.start/16000, w.end/16000) for w in segment_windows(94*16000,16000,25,2)] == [(0,25),(23,48),(46,71),(69,94)]


@pytest.mark.parametrize('seconds,overlap,length', [(30,2,100), (25,25,100), (25,-1,100), (25,2,1)])
def test_invalid_windows(seconds, overlap, length):
    with pytest.raises(ValueError):
        segment_windows(length*16000, 16000, seconds, overlap)


def test_merge_adjacent_suspicion_and_break_on_low():
    windows = [segment(0,0,25,.09), segment(1,23,48,.72), segment(2,46,71,.81), segment(3,69,94,.76), segment(4,92,117,.1), segment(5,115,140,.5)]
    regions = suspicious_regions(windows)
    assert len(regions) == 2
    assert (regions[0].start_seconds, regions[0].end_seconds, regions[0].peak_fake_probability, regions[0].risk) == (23,94,.81,'high')
    assert regions[1].risk == 'medium'


def test_distribution_never_double_counts_overlap():
    windows = [segment(0,0,25,.1), segment(1,23,48,.5), segment(2,46,71,.8)]
    distribution, analyzed, unanalyzed = timeline_distribution(windows,71)
    assert analyzed == 71 and unanalyzed == 0
    assert distribution == {'low': 23/71, 'medium':23/71, 'high':25/71}
    assert sum(distribution.values()) == pytest.approx(1)


def test_skipped_time_has_no_fabricated_probability():
    windows = [segment(0,0,25,.1),segment(1,23,48),segment(2,46,71,.8)]
    distribution, analyzed, unanalyzed = timeline_distribution(windows,71)
    assert analyzed == 50 and unanalyzed == 21
    assert distribution == {'low':.5,'medium':0,'high':.5}
    stats = probability_statistics(windows)
    assert stats.mean == pytest.approx(.45) and stats.maximum == .8 and stats.minimum == .1
    assert stats.median == pytest.approx(.45) and stats.standard_deviation == pytest.approx(.35)


def test_diagnostics_are_nondestructive_and_finite():
    signal = voice_signal(2)
    original = signal.copy()
    quality = diagnose(signal,48000,2)
    np.testing.assert_array_equal(signal,original)
    assert quality.quality == 'good' and quality.warnings == []
    assert quality.rms == pytest.approx(.2/np.sqrt(2),abs=1e-5)
    assert quality.spectral_centroid_hz == pytest.approx(300,abs=5)
    assert quality.original_sample_rate == 48000 and quality.channels == 2
    assert np.isfinite(list(quality.model_dump().values())[3:13]).all()


@pytest.mark.parametrize('args,warning,quality', [((.002,.1,0,2,16000),'VERY_LOW_SIGNAL','usable'), ((.1,.95,0,.1,16000),'HIGH_SILENCE_RATIO','poor'), ((.1,0,.15,2,16000),'AUDIO_HEAVILY_CLIPPED','poor'), ((.1,0,0,1,16000),'VERY_SHORT_USABLE_SPEECH','poor'), ((.1,0,0,2,4000),'UNUSUAL_SAMPLE_RATE','usable')])
def test_quality_warning_logic(args, warning, quality):
    warnings, actual = quality_warnings(*args)
    assert warning in warnings and actual == quality


def test_quiet_legitimate_signal_is_not_rejected():
    signal = voice_signal() * .005
    np.testing.assert_array_equal(prepare_audio(signal,16000),signal)
    with pytest.raises(AudioError) as exc:
        prepare_audio(np.full(32000,1e-6,dtype=np.float32),16000)
    assert exc.value.code == 'AUDIO_SILENT'


def test_config_parser_validates(monkeypatch):
    monkeypatch.setenv('DECIBEL_TEST_NUMBER','4')
    assert config.env_number('DECIBEL_TEST_NUMBER',1,1,10,True) == 4
    for bad in ['NaN','wrong','-1','100']:
        monkeypatch.setenv('DECIBEL_TEST_NUMBER',bad)
        with pytest.raises(ValueError):
            config.env_number('DECIBEL_TEST_NUMBER',1,1,10)


def test_v1_endpoints_and_structured_errors():
    client = TestClient(app)
    assert client.get('/api/v1/health').json()['status'] == 'ok'
    assert client.get('/api/v1/ready').status_code == 503
    info = client.get('/api/v1/model-info').json()
    assert info['model_fingerprint'] == config.MODEL_FINGERPRINT
    assert not any(k in info for k in ['HF_TOKEN','path','hostname'])
    assert client.post('/api/v1/analyze').json()['error']['code'] == 'NO_AUDIO'
    assert client.post('/api/v1/analyze', files={'audio':('short.wav',wav(voice_signal(.5)))}).json()['error']['code'] == 'AUDIO_TOO_SHORT'
    assert client.post('/api/v1/analyze', files={'audio':('silent.wav',wav(np.zeros(32000)))}).json()['error']['code'] == 'AUDIO_SILENT'
    assert client.post('/api/v1/jobs/analyze',files={'audio':('signal.wav',wav(voice_signal()))}).status_code == 503
    assert client.get('/api/v1/jobs/not-found').json()['error']['code'] == 'JOB_NOT_FOUND'
    assert client.post('/api/v1/jobs/batch',files=[('files',('signal.wav',wav(voice_signal())))]).status_code == 503


def test_job_failure_transition_without_a_fake_model():
    async def scenario():
        manager = JobManager(runtime,asyncio.Semaphore(1))
        response = manager.submit(wav(voice_signal()))
        assert response.state == 'queued'
        job = manager.get(response.job_id)
        await job.task
        assert job.state == 'failed' and job.error.code == 'MODEL_NOT_READY'
        assert job.upload_bytes == 0 and job.result is None
    asyncio.run(scenario())


def test_queued_cancellation_releases_resources():
    async def scenario():
        guard = asyncio.Semaphore(1)
        await guard.acquire()
        manager = JobManager(runtime,guard)
        response = manager.submit(b'test bytes, never inferred')
        job = manager.get(response.job_id)
        await asyncio.sleep(0)
        cancelled = manager.cancel_job(job.job_id)
        await asyncio.gather(job.task,return_exceptions=True)
        assert cancelled.state == 'cancelled' and job.cancel.is_set() and job.upload_bytes == 0
        guard.release()
    asyncio.run(scenario())


def test_cancel_before_decode():
    event = threading.Event(); event.set()
    with pytest.raises(AnalysisCancelled):
        analyze_recording(b'not decoded',runtime,cancel=event)


def test_job_progress_capacity_and_expiry():
    manager = JobManager(runtime,None)
    job = Job(); job.update_progress(3,8)
    assert job.snapshot().progress == .375
    manager.jobs[job.job_id] = job
    job.upload_bytes = config.MAX_UPLOAD_BYTES*2
    with pytest.raises(AnalysisError):
        manager.check_capacity(upload_bytes=1)
    job.state='failed'; job.finished_at = monotonic()-config.JOB_TTL_SECONDS-1
    manager.prune()
    assert not manager.jobs


def test_chunked_upload_limit_has_structured_error(monkeypatch):
    import httpx
    limits = importlib.import_module('backend.app.limits')
    monkeypatch.setattr(limits,'MAX_UPLOAD_BYTES',32)
    async def scenario():
        async def body():
            yield b'--boundary\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\n\r\n'
            yield b'x'*70000
            yield b'\r\n--boundary--\r\n'
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            response=await client.post('/api/v1/analyze',content=body(),headers={'Content-Type':'multipart/form-data; boundary=boundary'})
            assert response.status_code == 413
            assert response.json()['error']['code'] == 'REQUEST_TOO_LARGE'
    asyncio.run(scenario())


def test_processing_cancellation_holds_guard_until_thread_finishes(monkeypatch):
    job_module = importlib.import_module('backend.app.jobs')
    entered, finish = threading.Event(), threading.Event()
    # Control-flow fixture only: no model, prediction or successful inference output.
    def pending_work(*args):
        entered.set()
        finish.wait(timeout=3)
        raise AnalysisCancelled
    monkeypatch.setattr(job_module, 'analyze_recording', pending_work)
    async def scenario():
        guard = asyncio.Semaphore(1)
        manager = JobManager(runtime, guard)
        response = manager.submit(b'control flow only')
        for _ in range(100):
            if entered.is_set():
                break
            await asyncio.sleep(.01)
        assert entered.is_set() and guard.locked()
        manager.cancel_job(response.job_id)
        assert guard.locked() and manager.get(response.job_id).state == 'processing'
        finish.set()
        await manager.get(response.job_id).task
        assert manager.get(response.job_id).state == 'cancelled'
        assert not guard.locked()
    asyncio.run(scenario())


def test_decoded_memory_limit(monkeypatch):
    module = importlib.import_module('backend.app.audio')
    monkeypatch.setattr(module, 'MAX_DECODED_BYTES', 100)
    with pytest.raises(AudioError) as exc:
        module.decode_recording(wav(voice_signal()))
    assert exc.value.code == 'AUDIO_TOO_LARGE'
