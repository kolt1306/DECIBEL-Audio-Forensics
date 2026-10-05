"""Safe operator diagnostics. No token value or host/filesystem details are printed."""
import argparse
import hashlib
import importlib.util
import json
import torch
from . import config
from .model import ModelRuntime


def main():
    parser = argparse.ArgumentParser(description='DECIBEL backend self-check')
    parser.add_argument('--full', action='store_true', help='Attempt real gated Gemma initialization')
    args = parser.parse_args()
    present = config.CLASSIFIER_PATH.is_file()
    valid = present and hashlib.sha256(config.CLASSIFIER_PATH.read_bytes()).hexdigest() == config.CLASSIFIER_SHA256
    report = {'classifier_present': present, 'classifier_checksum_valid': valid,
        'hf_token_present': bool(config.HF_TOKEN), 'cuda_available': torch.cuda.is_available(),
        'required_imports': {module: importlib.util.find_spec(module) is not None for module in
            ['fastapi','torch','torchaudio','transformers','accelerate','torchvision','PIL','librosa','soundfile']},
        'model_fingerprint': config.MODEL_FINGERPRINT,
        'segment_seconds': config.MAX_SEGMENT_SECONDS, 'overlap_seconds': config.SEGMENT_OVERLAP_SECONDS}
    if args.full:
        runtime = ModelRuntime(); runtime.load()
        report.update(model_ready=runtime.loaded, diagnostic=runtime.diagnostic, **runtime.diagnostics())
    print(json.dumps(report,indent=2))
    return 0 if valid and all(report['required_imports'].values()) and (not args.full or report['model_ready']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
