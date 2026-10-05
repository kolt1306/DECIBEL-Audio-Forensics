"""Opt-in measured capture investigation. No audio/tensors are logged or stored.

Run from the repository root with its Python environment:
python backend/scripts/diagnose_capture.py speech.wav reference.wav --api http://127.0.0.1:8000
Reports scalar summaries only. No model output or preprocessing is changed.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import numpy as np
import soundfile as sf
import torch

# Script is also usable when invoked directly, without PYTHONPATH configuration.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app import config
from backend.app.audio import decode_recording
from backend.app.diagnostics import diagnose
from backend.app.model import ModelRuntime
from backend.app.service import analyze_recording


def summary(values, waveform=False):
    if isinstance(values, torch.Tensor):
        values = values.detach().float().cpu().numpy()
    x = np.asarray(values)
    result = dict(shape=list(x.shape), minimum=float(x.min()), maximum=float(x.max()),
                  mean=float(x.mean()), std=float(x.std()), rms=float(np.sqrt(np.mean(x.astype(np.float64)**2))))
    if waveform:
        result.update(near_zero_ratio=float(np.mean(np.abs(x) < .001)),
                      clipping_ratio=float(np.mean(np.abs(x) >= .999)), dc_offset=float(x.mean()))
    return result


def wav_header(data):
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        return None
    result = dict(riff_bytes=struct.unpack_from('<I', data, 4)[0]+8, file_bytes=len(data))
    offset = 12
    while offset + 8 <= len(data):
        marker, size = struct.unpack_from('<4sI', data, offset)
        body = offset + 8
        if marker == b'fmt ' and size >= 16:
            values = struct.unpack_from('<HHIIHH', data, body)
            result.update(zip(('format', 'channels', 'sample_rate', 'byte_rate', 'block_align', 'bits'), values))
        elif marker == b'data':
            result.update(data_bytes=size, available_data_bytes=min(size, len(data)-body))
        offset = body + size + size % 2
    if all(k in result for k in ('data_bytes', 'block_align', 'sample_rate')):
        result['complete_frames'] = result['data_bytes'] % result['block_align'] == 0
        result['duration_seconds'] = result['data_bytes'] / result['block_align'] / result['sample_rate']
        result['valid_pcm16_mono'] = (result.get('format') == 1 and result.get('channels') == 1
            and result.get('bits') == 16 and result['block_align'] == 2
            and result.get('byte_rate') == result['sample_rate'] * 2
            and result['available_data_bytes'] == result['data_bytes']
            and result['riff_bytes'] == len(data) and result['complete_frames'])
    return result


def investigate(path, runtime, api=None, durations=False):
    data = path.read_bytes()
    native, rate = sf.read(io.BytesIO(data), dtype='float32', always_2d=True)
    decoded = decode_recording(data)
    report = dict(filename=path.name, sha256=hashlib.sha256(data).hexdigest(), wav=wav_header(data),
        original_sample_rate=rate, channels=native.shape[1], duration_seconds=len(native)/rate,
        native_waveform=summary(native, True), resampled_waveform=summary(decoded.samples, True),
        quality=diagnose(decoded.samples, decoded.original_sample_rate, decoded.channels).model_dump())
    windows = []
    pending = {}
    def tower_pre(_, args, kwargs):
        features = kwargs['input_features']
        pending['input_features'] = dict(**summary(features), device=str(features.device), dtype=str(features.dtype))
    def tower_post(_, args, output):
        hidden = output.last_hidden_state if hasattr(output, 'last_hidden_state') else output[0]
        pending['tower_output'] = summary(hidden)
    def head_pre(_, args):
        pending['pooled'] = summary(args[0])
    def head_post(_, args, output):
        pending['logits'] = output.detach().cpu().tolist()
        pending['probabilities'] = torch.softmax(output, dim=-1).detach().cpu().tolist()
        windows.append(dict(pending))
        pending.clear()
    hooks = [runtime.model.audio_tower.register_forward_pre_hook(tower_pre, with_kwargs=True),
        runtime.model.audio_tower.register_forward_hook(tower_post),
        runtime.model.classifier.register_forward_pre_hook(head_pre),
        runtime.model.classifier.register_forward_hook(head_post)]
    try:
        result = analyze_recording(data, runtime)
    finally:
        for hook in hooks:
            hook.remove()
    report['inference_windows'] = windows
    report['local'] = dict(real_probability=result.real_probability, fake_probability=result.fake_probability)
    if api:
        # curl sends the exact input file; no re-encoding or filename special case.
        response = subprocess.run(['curl.exe' if sys.platform == 'win32' else 'curl', '-sS', '--fail-with-body',
            '--max-time', '180', '-F', f'audio=@{path};type=audio/wav' if report['wav'] else f'audio=@{path}',
            '-F', 'phone_mode=false', api.rstrip('/')+'/api/v1/analyze'], capture_output=True, text=True, check=True)
        body = json.loads(response.stdout)
        report['curl_api'] = {k: body[k] for k in ('real_probability', 'fake_probability', 'metadata', 'quality')}
        report['api_local_fake_difference'] = abs(body['fake_probability'] - result.fake_probability)
    if durations:
        report['duration_crops'] = []
        for seconds in (3, 9, 15):
            if len(decoded.samples) < seconds * config.SAMPLE_RATE:
                report['duration_crops'].append(dict(seconds=seconds, status='unavailable: source shorter than requested duration'))
                continue
            real, fake = runtime.predict(decoded.samples[:seconds * config.SAMPLE_RATE])
            report['duration_crops'].append(dict(seconds=seconds, real_probability=real, fake_probability=fake,
                source='prefix crop of existing recording, not a new live microphone recording'))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recordings', type=Path, nargs='+')
    parser.add_argument('--api')
    parser.add_argument('--duration-crops', action='store_true')
    args = parser.parse_args()
    runtime = ModelRuntime()
    runtime.load()
    if not runtime.loaded:
        raise RuntimeError(runtime.diagnostic)
    tower = next(runtime.model.audio_tower.parameters())
    head = next(runtime.model.classifier.parameters())
    report = dict(runtime=dict(tower_device=str(tower.device), tower_dtype=str(tower.dtype),
        classifier_device=str(head.device), classifier_dtype=str(head.dtype),
        classifier_sha256=hashlib.sha256(config.CLASSIFIER_PATH.read_bytes()).hexdigest(),
        pooling='unmasked mean(dim=1)', class_order=['real', 'fake'], dropout_training=runtime.model.classifier[2].training),
        recordings=[investigate(path.resolve(), runtime, args.api, args.duration_crops) for path in args.recordings])
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
