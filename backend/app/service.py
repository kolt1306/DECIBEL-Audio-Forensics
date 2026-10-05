import logging
import threading
from datetime import datetime, timezone
from time import perf_counter
from uuid import uuid4
from . import config
from .model import log_runtime_exception
from .audio import AudioError, decode_recording, prepare_audio
from .aggregation import probability_statistics, suspicious_regions, timeline_distribution
from .diagnostics import diagnose
from .errors import AnalysisError
from .inference import build_result
from .schemas import DetailedAnalysis, SegmentResult, AnalysisMetadata, ProcessingTimings, ComparisonResult
from .segmentation import segment_windows

logger = logging.getLogger('decibel.analysis')
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(levelname)s %(name)s %(message)s'))
    logger.addHandler(handler)
logger.propagate = False


class AnalysisCancelled(Exception):
    pass


def analyze_recording(data, runtime, phone_mode=False, compare=False, cancel=None, progress=None):
    begin = perf_counter()
    analysis_id = str(uuid4())
    logger.info('analysis_id=%s started', analysis_id)
    cancel = cancel or threading.Event()
    if cancel.is_set():
        raise AnalysisCancelled
    decoded = decode_recording(data)
    samples = decoded.samples
    processing = perf_counter()
    quality = diagnose(samples, decoded.original_sample_rate, decoded.channels)
    windows = segment_windows(len(samples), config.SAMPLE_RATE, config.MAX_SEGMENT_SECONDS, config.SEGMENT_OVERLAP_SECONDS)
    preprocess_ms = decoded.preprocessing_ms + (perf_counter() - processing) * 1000
    if cancel.is_set():
        raise AnalysisCancelled
    if not runtime.loaded:
        raise AnalysisError('MODEL_NOT_READY', 'The model is unavailable. Check the readiness diagnostic.', 503)
    total = len(windows) * (2 if compare else 1)
    completed = 0
    if progress:
        progress(completed, total)
    metadata = AnalysisMetadata(timestamp=datetime.now(timezone.utc).isoformat(), model_id=config.MODEL_ID,
        model_fingerprint=config.MODEL_FINGERPRINT, classifier_sha256=config.CLASSIFIER_SHA256,
        sample_rate=config.SAMPLE_RATE, segment_duration_seconds=config.MAX_SEGMENT_SECONDS,
        segment_overlap_seconds=config.SEGMENT_OVERLAP_SECONDS, runtime_precision=getattr(runtime, 'precision', 'float32'))

    def run_mode(phone):
        nonlocal completed
        segments, inference_ms, mode_preprocessing_ms = [], 0., 0.
        for window in windows:
            if cancel.is_set():
                raise AnalysisCancelled
            segment = SegmentResult(index=window.index, start_seconds=window.start / config.SAMPLE_RATE,
                end_seconds=window.end / config.SAMPLE_RATE)
            preparing = perf_counter()
            try:
                chunk = prepare_audio(samples[window.start:window.end], config.SAMPLE_RATE, phone)
            except AudioError as exc:
                if exc.code != 'AUDIO_SILENT':
                    raise
                segment.status, segment.reason = 'skipped', 'AUDIO_SILENT'
                mode_preprocessing_ms += (perf_counter() - preparing) * 1000
            else:
                mode_preprocessing_ms += (perf_counter() - preparing) * 1000
                extracting = perf_counter()
                try:
                    real, fake = runtime.predict(chunk)
                    verdict = build_result(real, fake, len(chunk) / config.SAMPLE_RATE, phone)
                except Exception:
                    log_runtime_exception('Model inference failed')
                    raise AnalysisError('INFERENCE_FAILED', 'Model inference failed. Retry or inspect the server configuration.', 500) from None
                inference_ms += (perf_counter() - extracting) * 1000
                segment.real_probability, segment.fake_probability, segment.risk = real, fake, verdict.risk
            segments.append(segment)
            completed += 1
            if progress:
                progress(completed, total)
        if cancel.is_set():
            raise AnalysisCancelled
        valid = [s for s in segments if s.status == 'analyzed']
        if not valid:
            raise AnalysisError('AUDIO_SILENT', 'No usable analysis segments were found.')
        peak = max(valid, key=lambda s: s.fake_probability)
        duration = len(samples) / config.SAMPLE_RATE
        summary = build_result(peak.real_probability, peak.fake_probability, duration, phone)
        distribution, analyzed, unanalyzed = timeline_distribution(segments, duration)
        return DetailedAnalysis(**summary.model_dump(), analysis_id=analysis_id if not compare else str(uuid4()),
            segments=segments, suspicious_regions=suspicious_regions(segments),
            peak_fake_probability=peak.fake_probability, peak_segment_start=peak.start_seconds,
            peak_segment_end=peak.end_seconds, statistics=probability_statistics(segments),
            timeline_distribution=distribution, analyzed_seconds=analyzed, unanalyzed_seconds=unanalyzed,
            quality=quality, metadata=metadata,
            timings=ProcessingTimings(decode_ms=decoded.decode_ms, preprocessing_ms=preprocess_ms + mode_preprocessing_ms,
                inference_ms=inference_ms, total_ms=0))

    standard = run_mode(False if compare else phone_mode)
    if compare:
        phone = run_mode(True)
        standard.timings.total_ms = phone.timings.total_ms = (perf_counter() - begin) * 1000
        logger.info('analysis_id=%s completed segments=%s comparison=true', analysis_id, total)
        return ComparisonResult(standard=standard, phone=phone, difference_percentage_points=(phone.fake_probability - standard.fake_probability) * 100)
    standard.timings.total_ms = (perf_counter() - begin) * 1000
    logger.info('analysis_id=%s completed segments=%s', analysis_id, total)
    return standard
