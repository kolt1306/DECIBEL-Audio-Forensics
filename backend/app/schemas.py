from typing import Literal
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal['ok', 'unavailable']
    model_loaded: bool
    diagnostic: str | None = None


class AnalysisResponse(BaseModel):
    verdict: Literal['real', 'possible_deepfake', 'deepfake']
    risk: Literal['low', 'medium', 'high']
    real_probability: float = Field(ge=0, le=1)
    fake_probability: float = Field(ge=0, le=1)
    fake_percentage: float = Field(ge=0, le=100)
    duration_seconds: float = Field(ge=1.5)
    phone_mode: bool


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class SegmentResult(BaseModel):
    index: int
    start_seconds: float
    end_seconds: float
    status: Literal['analyzed', 'skipped'] = 'analyzed'
    real_probability: float | None = Field(default=None, ge=0, le=1)
    fake_probability: float | None = Field(default=None, ge=0, le=1)
    risk: Literal['low', 'medium', 'high'] | None = None
    reason: str | None = None


class SuspiciousRegion(BaseModel):
    start_seconds: float
    end_seconds: float
    risk: Literal['medium', 'high']
    peak_fake_probability: float


class ProbabilityStatistics(BaseModel):
    mean: float
    median: float
    maximum: float
    minimum: float
    standard_deviation: float


class QualityDiagnostics(BaseModel):
    duration_seconds: float
    original_sample_rate: int
    channels: int
    rms: float
    peak_amplitude: float
    silence_ratio: float
    clipping_ratio: float
    dc_offset: float
    dynamic_range_db: float
    zero_crossing_rate: float
    spectral_centroid_hz: float
    spectral_bandwidth_hz: float
    usable_signal_seconds: float
    quality: Literal['good', 'usable', 'poor']
    warnings: list[str]


class AnalysisMetadata(BaseModel):
    timestamp: str
    model_id: str
    model_fingerprint: str
    classifier_sha256: str
    sample_rate: int
    segment_duration_seconds: float
    segment_overlap_seconds: float
    runtime_precision: str
    aggregation: str = 'maximum_segment_probability'


class ProcessingTimings(BaseModel):
    decode_ms: float
    preprocessing_ms: float
    inference_ms: float
    total_ms: float


class DetailedAnalysis(AnalysisResponse):
    analysis_id: str
    segments: list[SegmentResult]
    suspicious_regions: list[SuspiciousRegion]
    peak_fake_probability: float
    peak_segment_start: float
    peak_segment_end: float
    statistics: ProbabilityStatistics
    timeline_distribution: dict[str, float]
    analyzed_seconds: float
    unanalyzed_seconds: float
    quality: QualityDiagnostics
    metadata: AnalysisMetadata
    timings: ProcessingTimings
    disclaimer: str = 'DECIBEL results are probabilistic model outputs and should not be treated as definitive proof of audio authenticity.'


class ComparisonResult(BaseModel):
    standard: DetailedAnalysis
    phone: DetailedAnalysis
    difference_percentage_points: float


class JobResponse(BaseModel):
    job_id: str
    state: Literal['queued', 'processing', 'completed', 'failed', 'cancelled']
    segments_completed: int
    segments_total: int
    progress: float
    created_at: str
    result: DetailedAnalysis | ComparisonResult | None = None
    error: ErrorDetail | None = None
