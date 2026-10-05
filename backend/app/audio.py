import io
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
import librosa
import numpy as np
import soundfile as sf
import torch
import torchaudio
from .config import MAX_SECONDS, MAX_AUDIO_SECONDS, MAX_DECODED_BYTES, SAMPLE_RATE
from .errors import AnalysisError


class AudioError(AnalysisError, ValueError):
    def __init__(self, message, code='INVALID_AUDIO'):
        super().__init__(code, message)


@dataclass
class DecodedAudio:
    samples: np.ndarray
    original_sample_rate: int
    channels: int
    decode_ms: float
    preprocessing_ms: float


def codec_simulate(audio: np.ndarray) -> np.ndarray:
    waveform = torch.from_numpy(audio).unsqueeze(0).float()
    down = torchaudio.functional.resample(waveform, orig_freq=16000, new_freq=8000)
    return torchaudio.functional.resample(down, orig_freq=8000, new_freq=16000).squeeze(0).numpy()


def prepare_audio(audio: np.ndarray, sr: int, phone_mode: bool = False, truncate: bool = True) -> np.ndarray:
    if sr <= 0 or audio.size == 0 or not np.isfinite(audio).all():
        raise AudioError('This recording contains invalid audio samples.')
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if audio.ndim != 1:
        raise AudioError('This audio channel layout is unsupported.')
    audio = audio.astype(np.float32)
    if sr != SAMPLE_RATE:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
    # Validate the analyzed window too: a loud tail must not authorize a silent window.
    if truncate:
        audio = audio[:int(MAX_SECONDS * SAMPLE_RATE)]
    # Conservative usability test: allow quiet speech if it has sustained energy.
    if np.abs(audio).max() < .0001 or (np.abs(audio).max() < .005 and float(np.sqrt(np.mean(audio ** 2))) < .0001):
        raise AudioError('No usable signal detected. Choose a recording with audible speech.', 'AUDIO_SILENT')
    if len(audio) < int(1.5 * SAMPLE_RATE):
        raise AudioError('Record at least 1.5 seconds of audio.', 'AUDIO_TOO_SHORT')
    if phone_mode:
        audio = codec_simulate(audio)
    return np.ascontiguousarray(audio)


def decode_audio(data: bytes, phone_mode: bool = False) -> np.ndarray:
    """Compatibility preprocessing helper for the original <=29s path."""
    decoded = decode_recording(data)
    return prepare_audio(decoded.samples, SAMPLE_RATE, phone_mode)


def decode_recording(data: bytes) -> DecodedAudio:
    from time import perf_counter
    begin = perf_counter()
    try:
        with sf.SoundFile(io.BytesIO(data)) as source:
            if source.channels > 8 or source.samplerate > 384000:
                raise AudioError('This audio channel layout or sample rate is unsupported.')
            if len(source) / source.samplerate > MAX_AUDIO_SECONDS:
                raise AudioError(f'Recording exceeds the {MAX_AUDIO_SECONDS:g}-second duration limit.', 'AUDIO_TOO_LONG')
            if len(source) * source.channels * 4 > MAX_DECODED_BYTES:
                raise AudioError('Decoded recording exceeds the memory limit. Export mono audio at a lower sample rate.', 'AUDIO_TOO_LARGE')
            audio = source.read(dtype='float32', always_2d=True)
            sr = source.samplerate
            channels = source.channels
    except AudioError:
        raise
    except Exception:
        # FFmpeg adds browser MediaRecorder WebM/AAC and other common codecs.
        # Fixed arguments, bounded decode, no shell, and automatically deleted input.
        try:
            with tempfile.TemporaryDirectory(prefix='decibel-') as folder:
                path = Path(folder) / 'input.audio'
                path.write_bytes(data)
                probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                    '-show_entries', 'stream=sample_rate,channels', '-of', 'json', str(path)],
                    capture_output=True, timeout=15, check=True)
                import json
                stream = json.loads(probe.stdout)['streams'][0]
                original_sr, channels = int(stream['sample_rate']), int(stream['channels'])
                if channels > 8 or original_sr > 384000:
                    raise AudioError('Unsupported channel layout or sample rate.', 'UNSUPPORTED_AUDIO')
                result = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path),
                    '-t', str(MAX_AUDIO_SECONDS + 1), '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'],
                    capture_output=True, timeout=60, check=True)
                audio = np.frombuffer(result.stdout, dtype='<f4').copy()
                sr = SAMPLE_RATE
                if len(audio) / sr > MAX_AUDIO_SECONDS:
                    raise AudioError(f'Recording exceeds the {MAX_AUDIO_SECONDS:g}-second duration limit.', 'AUDIO_TOO_LONG')
        except AudioError:
            raise
        except Exception:
            raise AudioError('Cannot decode this recording. Try WAV, MP3 or FLAC; compressed formats may require FFmpeg.', 'UNSUPPORTED_AUDIO') from None
    decode_ms = (perf_counter() - begin) * 1000
    original_sr = original_sr if 'original_sr' in locals() else sr
    begin = perf_counter()
    samples = prepare_audio(audio, sr, truncate=False)
    return DecodedAudio(samples, original_sr, channels, decode_ms, (perf_counter() - begin) * 1000)
