import os
import hashlib
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
MODEL_ID = 'google/gemma-4-e4b-it'
CLASSIFIER_PATH = ROOT / 'saved_model' / 'classifier_head.pt'
CLASSIFIER_SHA256 = 'e03b8a117892977cca69b8d0083720c4ac7b2255d8bf2ef18a1688dd36da6106'
HF_TOKEN = os.getenv('HF_TOKEN')
FRONTEND_ORIGINS = [s.strip() for s in os.getenv('FRONTEND_ORIGIN', 'http://localhost:5173').split(',') if s.strip()]
def env_number(name, default, minimum, maximum, integer=False):
    try:
        value = int(os.getenv(name, str(default))) if integer else float(os.getenv(name, str(default)))
        if not minimum <= value <= maximum:
            raise ValueError
        return value
    except ValueError:
        raise ValueError(f'{name} must be between {minimum} and {maximum}.') from None


MAX_UPLOAD_MB = env_number('MAX_UPLOAD_MB', 50, 1, 200, True)
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
SAMPLE_RATE = 16000
MAX_SECONDS = 29.0
MAX_AUDIO_SECONDS = env_number('MAX_AUDIO_SECONDS', 600, 1.5, 3600)
MAX_DECODED_BYTES = env_number('MAX_DECODED_MB', 256, 32, 1024, True) * 1024 * 1024
MAX_SEGMENT_SECONDS = env_number('MAX_SEGMENT_SECONDS', 25, 1.5, 29)
SEGMENT_OVERLAP_SECONDS = env_number('SEGMENT_OVERLAP_SECONDS', min(2, MAX_SEGMENT_SECONDS / 2), 0, min(5, MAX_SEGMENT_SECONDS / 2))
MAX_CONCURRENT_INFERENCE = env_number('MAX_CONCURRENT_INFERENCE', 1, 1, 4, True)
MAX_BATCH_FILES = env_number('MAX_BATCH_FILES', 10, 1, 20, True)
MAX_PENDING_JOBS = env_number('MAX_PENDING_JOBS', 12, 1, 50, True)
JOB_TTL_SECONDS = env_number('JOB_TTL_SECONDS', 1800, 60, 86400, True)
MODEL_FINGERPRINT = hashlib.sha256(f'{MODEL_ID}|{CLASSIFIER_SHA256}|audio-bf16-if-supported-else-fp32-head-fp32|mean-time|16000|linear256-gelu-dropout03-linear2|thresholds04-07'.encode()).hexdigest()
