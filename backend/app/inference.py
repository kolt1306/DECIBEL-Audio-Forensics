import math
from .schemas import AnalysisResponse


def build_result(real: float, fake: float, duration: float, phone_mode: bool):
    if not all(math.isfinite(p) and 0 <= p <= 1 for p in (real, fake)) or abs(real + fake - 1) > 1e-4:
        raise ValueError('Invalid model probabilities')
    verdict, risk = ('deepfake', 'high') if fake >= .70 else ('possible_deepfake', 'medium') if fake >= .40 else ('real', 'low')
    return AnalysisResponse(verdict=verdict, risk=risk, real_probability=real,
        fake_probability=fake, fake_percentage=fake * 100, duration_seconds=duration, phone_mode=phone_mode)
