import hashlib
import io
import numpy as np
import pytest
import soundfile as sf
import torch
import torchaudio
from fastapi.testclient import TestClient
from backend.app import config
from backend.app.audio import AudioError, codec_simulate, decode_audio, prepare_audio
from backend.app.inference import build_result
from backend.app.main import app, runtime


def voice_signal(seconds=2, sr=16000):
    # Deterministic test signal for preprocessing only; never classifier evidence.
    return (.2 * np.sin(2 * np.pi * 300 * np.arange(int(seconds * sr)) / sr)).astype(np.float32)


def wav(samples, sr=16000):
    stream = io.BytesIO()
    sf.write(stream, samples, sr, format='WAV')
    return stream.getvalue()


def test_original_checkpoint():
    assert config.CLASSIFIER_PATH.stat().st_size == 1578541
    assert hashlib.sha256(config.CLASSIFIER_PATH.read_bytes()).hexdigest() == config.CLASSIFIER_SHA256
    state = torch.load(config.CLASSIFIER_PATH, map_location='cpu', weights_only=True)
    assert tuple(state['0.weight'].shape) == (256, 1536)
    assert tuple(state['3.weight'].shape) == (2, 256)


def test_mono_resampling_and_truncation():
    stereo = np.stack([voice_signal(31, 48000)] * 2, axis=1)
    actual = decode_audio(wav(stereo, 48000))
    assert actual.dtype == np.float32
    assert actual.shape == (29 * 16000,)


def test_phone_mode_matches_source():
    signal = voice_signal()
    waveform = torch.from_numpy(signal).unsqueeze(0).float()
    expected = torchaudio.functional.resample(torchaudio.functional.resample(waveform, 16000, 8000), 8000, 16000).squeeze(0).numpy()
    np.testing.assert_array_equal(codec_simulate(signal), expected)
    np.testing.assert_array_equal(decode_audio(wav(signal), True), codec_simulate(decode_audio(wav(signal))))


@pytest.mark.parametrize('samples', [np.zeros(32000), np.array([]), np.full(32000, np.nan), voice_signal(1)])
def test_invalid_signal(samples):
    with pytest.raises(AudioError):
        prepare_audio(samples, 16000)


@pytest.mark.parametrize('fake,verdict,risk', [(0, 'real', 'low'), (.3999, 'real', 'low'), (.4, 'possible_deepfake', 'medium'), (.6999, 'possible_deepfake', 'medium'), (.7, 'deepfake', 'high'), (1, 'deepfake', 'high')])
def test_threshold_boundaries(fake, verdict, risk):
    result = build_result(1 - fake, fake, 2, True)
    assert (result.verdict, result.risk) == (verdict, risk)
    assert result.fake_probability == fake
    assert result.fake_percentage == fake * 100


def test_reject_invalid_probabilities():
    with pytest.raises(ValueError):
        build_result(float('nan'), .2, 2, False)


def test_api_unloaded_model_and_validation():
    # No mock classifier and no synthetic classification result.
    assert runtime.model is None
    client = TestClient(app)
    assert client.get('/api/health').json()['model_loaded'] is False
    assert client.post('/api/analyze').status_code == 422
    assert client.post('/api/analyze', files={'audio': ('empty.wav', b'')}).status_code == 400
    assert client.post('/api/analyze', files={'audio': ('silent.wav', wav(np.zeros(32000)))}).status_code == 422
    assert client.post('/api/analyze', files={'audio': ('short.wav', wav(voice_signal(.5)))}).status_code == 422
    assert client.post('/api/analyze', files={'audio': ('speech.wav', wav(voice_signal()))}).status_code == 503
    assert client.post('/api/analyze', files={'audio': ('large.wav', b'0' * (config.MAX_UPLOAD_BYTES + 1))}).status_code == 413
    assert client.post('/api/analyze', content=b'', headers={'content-length': str(config.MAX_UPLOAD_BYTES + 65537)}).status_code == 413
    assert client.post('/api/analyze', files={'audio': ('invalid.wav', b'not audio')}).status_code == 422


def test_cors_is_restricted():
    client = TestClient(app)
    accepted = client.options('/api/analyze', headers={'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'POST'})
    rejected = client.options('/api/analyze', headers={'Origin': 'https://untrusted.example', 'Access-Control-Request-Method': 'POST'})
    assert accepted.headers['access-control-allow-origin'] == 'http://localhost:5173'
    assert 'access-control-allow-origin' not in rejected.headers
