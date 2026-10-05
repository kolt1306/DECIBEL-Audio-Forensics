"""Run real inference on operator-provided audio; no bundled samples or fake model."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app import config
from backend.app.errors import AnalysisError
from backend.app.model import ModelRuntime
from backend.app.service import analyze_recording


def main():
    parser = argparse.ArgumentParser(description='Benchmark DECIBEL on your recording')
    parser.add_argument('audio')
    parser.add_argument('--phone', action='store_true')
    args = parser.parse_args()
    runtime = ModelRuntime(); runtime.load()
    if not runtime.loaded:
        print(json.dumps({'model_ready':False,'diagnostic':runtime.diagnostic}))
        return 1
    try:
        with Path(args.audio).open('rb') as stream:
            data = stream.read(config.MAX_UPLOAD_BYTES+1)
        if len(data)>config.MAX_UPLOAD_BYTES:
            raise AnalysisError('AUDIO_TOO_LARGE','Recording exceeds upload limit.',413)
        result = analyze_recording(data,runtime,args.phone)
        print(json.dumps({'analysis_id':result.analysis_id,'segments':len(result.segments),
            'model_fingerprint':config.MODEL_FINGERPRINT,'timings':result.timings.model_dump()},indent=2))
    except (AnalysisError, OSError) as exc:
        print(json.dumps({'error': exc.code if isinstance(exc,AnalysisError) else 'FILE_UNREADABLE'}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
