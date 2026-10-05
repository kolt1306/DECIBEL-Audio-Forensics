"""Real GPU/API verification. Run with a real speech path; never uses fake scores."""
import argparse
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import httpx
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]


def gpu_sample():
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    output = subprocess.check_output([
        'nvidia-smi', '--query-gpu=memory.used,utilization.gpu',
        '--format=csv,noheader,nounits', '--id=0'], text=True, creationflags=flags)
    memory, utilization = map(int, output.strip().split(','))
    return {'vram_mib': memory, 'gpu_util_percent': utilization}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('speech', type=Path)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--report', type=Path, default=ROOT / 'gpu-verification.json')
    args = parser.parse_args()
    # Validate before spawning anything.
    samples, rate = sf.read(args.speech, dtype='float32', always_2d=True)
    if len(samples) / rate < 1.5:
        parser.error('Speech recording must be at least 1.5 seconds.')
    report = {'speech_seconds': len(samples) / rate, 'gpu_before_server': gpu_sample(), 'checks': []}
    base = f'http://127.0.0.1:{args.port}'
    with httpx.Client(base_url=base, timeout=180, trust_env=False) as client:
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', args.port))
            except OSError:
                parser.error('Port is unavailable; choose an unused port.')
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        with (ROOT / 'gpu-verification-server.log').open('w', encoding='utf8') as log:
            server = subprocess.Popen([sys.executable, '-X', 'faulthandler', '-m', 'uvicorn',
                'backend.app.main:app', '--host', '127.0.0.1', '--port', str(args.port)],
                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
            try:
                deadline = time.monotonic() + 180
                while time.monotonic() < deadline:
                    if server.poll() is not None:
                        raise RuntimeError(f'Server exited during loading: {server.returncode}')
                    try:
                        ready = client.get('/api/v1/ready', timeout=2)
                        if ready.status_code == 200:
                            break
                        if ready.json().get('state') == 'unavailable':
                            raise RuntimeError(ready.json()['diagnostic'])
                    except (httpx.ConnectError, httpx.ConnectTimeout):
                        pass
                    time.sleep(.5)
                else:
                    raise RuntimeError('Readiness deadline exceeded.')
                report['model'] = client.get('/api/v1/model-info').json()
                report['gpu_before_inference'] = gpu_sample()
                speech = args.speech.read_bytes()
                stop = threading.Event()
                measurements = []
                def monitor():
                    while not stop.is_set():
                        measurements.append({'elapsed_seconds': time.perf_counter() - started, **gpu_sample()})
                        stop.wait(.1)
                started = time.perf_counter()
                thread = threading.Thread(target=monitor, daemon=True)
                thread.start()
                try:
                    response = client.post('/api/v1/jobs/analyze', files={'audio': (args.speech.name, speech)})
                    response.raise_for_status()
                    job_id = response.json()['job_id']
                    job_deadline = time.monotonic() + 180
                    while True:
                        if time.monotonic() > job_deadline:
                            raise RuntimeError('Inference deadline exceeded.')
                        if server.poll() is not None:
                            raise RuntimeError(f'Server crashed: {server.returncode}')
                        job = client.get(f'/api/v1/jobs/{job_id}').json()
                        if job['state'] in ('completed', 'failed', 'cancelled'):
                            break
                        time.sleep(.1)
                    if job['state'] != 'completed':
                        raise RuntimeError(f"Job ended with {job['state']}: {job.get('error')}")
                    report['latency_seconds'] = time.perf_counter() - started
                    report['result'] = job['result']
                finally:
                    stop.set()
                    thread.join(timeout=5)
                report['gpu_during_inference_samples'] = measurements
                report['gpu_peak_vram_mib'] = max(s['vram_mib'] for s in measurements)
                report['gpu_peak_util_percent'] = max(s['gpu_util_percent'] for s in measurements)
                # Exercise repeated real inference, phone comparison, batch, and long segmentation.
                for name, endpoint, payload in [
                    ('repeat', '/api/v1/analyze', [('audio', (args.speech.name, speech))]),
                    ('comparison', '/api/v1/compare', [('audio', (args.speech.name, speech))]),
                    ('batch', '/api/v1/jobs/batch', [('files', (args.speech.name, speech)), ('files', (args.speech.name, speech))]),
                ]:
                    began = time.perf_counter()
                    response = client.post(endpoint, files=payload)
                    response.raise_for_status()
                    body = response.json()
                    if name == 'batch':
                        for item in body:
                            while True:
                                state = client.get(f"/api/v1/jobs/{item['job_id']}").json()
                                if state['state'] in ('completed', 'failed', 'cancelled'):
                                    assert state['state'] == 'completed', state.get('error')
                                    break
                                time.sleep(.1)
                    report['checks'].append({'name': name, 'status': response.status_code,
                        'latency_seconds': time.perf_counter() - began})
                extended = np.tile(samples, (max(2, int(60 * rate / len(samples)) + 1), 1))
                stream = io.BytesIO()
                sf.write(stream, extended, rate, format='WAV')
                response = client.post('/api/v1/analyze', files={'audio': ('long-speech.wav', stream.getvalue())})
                response.raise_for_status()
                long_result = response.json()
                assert len(long_result['segments']) > 1
                report['checks'].append({'name': 'long_audio', 'status': response.status_code,
                    'segments': len(long_result['segments']), 'timings': long_result['timings']})
                report['health_after'] = client.get('/api/v1/health').status_code
                report['ready_after'] = client.get('/api/v1/ready').status_code
                report['server_alive_after'] = server.poll() is None
                report['gpu_after'] = gpu_sample()
                assert report['server_alive_after'] and report['health_after'] == report['ready_after'] == 200
                assert report['gpu_peak_util_percent'] > 0
                args.report.write_text(json.dumps(report, indent=2), encoding='utf8')
                print(json.dumps({k:v for k,v in report.items() if k not in ('result','gpu_during_inference_samples')}, indent=2))
            finally:
                if 'stop' in locals():
                    stop.set()
                if 'thread' in locals():
                    thread.join(timeout=5)
                # Only stop the subprocess owned by this verification script.
                server.terminate()
                try:
                    server.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


if __name__ == '__main__':
    main()
