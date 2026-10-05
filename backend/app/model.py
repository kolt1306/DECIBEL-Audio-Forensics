"""Standalone Gemma audio inference; original FP32 TrueVoice head and pooling."""
import hashlib
import logging
import traceback
import torch
from torch import nn
from . import config

logger = logging.getLogger('decibel.model')


def log_runtime_exception(message):
    # Preserve the traceback for operators, including failures from HF libraries,
    # but redact the configured credential even if an exception embeds it.
    detail = traceback.format_exc()
    if config.HF_TOKEN:
        detail = detail.replace(config.HF_TOKEN, '[REDACTED]')
    logger.error('%s\n%s', message, detail)


def select_audio_dtype():
    # BF16 matches the Gemma checkpoint and has FP32's exponent range.
    # FP32 is a safe fallback; the measured tower also fits at this precision.
    return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32


def load_audio_tower(model_id, token, device, dtype):
    from transformers import AutoConfig
    from transformers.models.gemma4.modeling_gemma4 import Gemma4AudioModel
    audio_config = AutoConfig.from_pretrained(model_id, token=token).audio_config
    if audio_config is None:
        raise ValueError('Checkpoint has no audio tower.')
    with torch.device('meta'):
        skeleton = Gemma4AudioModel(audio_config)
    count = sum(p.numel() for p in skeleton.parameters())
    del skeleton
    weight_bytes = count * torch.empty((), dtype=dtype).element_size()
    free_bytes, _ = torch.cuda.mem_get_info(device)
    logger.info('Audio tower: %s parameters; FP32=%s bytes; FP16/BF16=%s bytes', count, count * 4, count * 2)
    # Leave at least 1 GiB for activations/workspaces before attempting loading.
    if weight_bytes + 1024**3 > free_bytes:
        raise MemoryError('Audio tower requires more available CUDA memory.')
    # The pinned implementation declares base_model_prefix='model.audio_tower',
    # which loads just these checkpoint tensors; no language/vision model exists.
    tower, info = Gemma4AudioModel.from_pretrained(
        model_id, config=audio_config, token=token, dtype=dtype,
        device_map={'': str(device)}, output_loading_info=True,
    )
    if info.get('missing_keys') or info.get('mismatched_keys') or info.get('error_msgs'):
        raise ValueError('Audio tower checkpoint is incomplete or incompatible.')
    if any(p.device != device for p in tower.parameters()):
        raise ValueError('Audio tower must be entirely resident on CUDA.')
    tower.requires_grad_(False).eval()
    return tower, count


class AudioDeepfakeClassifier(nn.Module):
    def __init__(self, audio_tower, hidden_size):
        super().__init__()
        self.audio_tower = audio_tower
        self.classifier = nn.Sequential(nn.Linear(hidden_size, 256), nn.GELU(),
                                        nn.Dropout(0.3), nn.Linear(256, 2))

    def forward(self, input_features):
        output = self.audio_tower(input_features=input_features)
        hidden = output.last_hidden_state if hasattr(output, 'last_hidden_state') else output[0]
        head = next(self.classifier.parameters())
        # Preserve unmasked mean(time); explicitly bridge tower/head precision.
        pooled = hidden.mean(dim=1).to(device=head.device, dtype=head.dtype)
        return self.classifier(pooled)


class ModelRuntime:
    def __init__(self):
        self.processor = None
        self.model = None
        self.base_model = None  # Compatibility; full Gemma is never constructed.
        self.audio_parameter_count = None
        self.diagnostic = 'Model initialization pending.'
        self.state = 'pending'

    @property
    def loaded(self):
        return self.state == 'ready' and self.model is not None

    @property
    def precision(self):
        if self.model is None:
            return 'unavailable'
        return str(next(self.model.audio_tower.parameters()).dtype).removeprefix('torch.')

    def diagnostics(self):
        tower = next(self.model.audio_tower.parameters()) if self.loaded else None
        head = next(self.model.classifier.parameters()) if self.loaded else None
        return {
            'audio_tower_device': str(tower.device) if tower is not None else 'unavailable',
            'audio_tower_dtype': self.precision,
            'classifier_device': str(head.device) if head is not None else 'unavailable',
            'classifier_dtype': str(head.dtype).removeprefix('torch.') if head is not None else 'unavailable',
            'audio_tower_parameters': self.audio_parameter_count,
            'full_model_retained': False,
        }

    def load(self):
        if self.state != 'pending':
            return
        self.state = 'loading'
        if not torch.cuda.is_available():
            self.state = 'unavailable'
            self.diagnostic = 'CUDA GPU required. Install CUDA-enabled PyTorch on GPU infrastructure.'
            return
        if not config.HF_TOKEN:
            self.state = 'unavailable'
            self.diagnostic = 'Set HF_TOKEN with access to the Gemma model, then restart the API.'
            return
        try:
            from transformers import AutoProcessor
            if hashlib.sha256(config.CLASSIFIER_PATH.read_bytes()).hexdigest() != config.CLASSIFIER_SHA256:
                self.diagnostic = 'Classifier integrity check failed. Restore the original trained checkpoint.'
                self.state = 'unavailable'
                return
            device = torch.device('cuda:0')
            dtype = select_audio_dtype()
            processor = AutoProcessor.from_pretrained(config.MODEL_ID, token=config.HF_TOKEN)
            tower, count = load_audio_tower(config.MODEL_ID, config.HF_TOKEN, device, dtype)
            model = AudioDeepfakeClassifier(tower, tower.output_proj.out_features)
            model.classifier.load_state_dict(torch.load(config.CLASSIFIER_PATH, map_location='cpu', weights_only=True))
            model.classifier.to(device=device, dtype=torch.float32)
            model.eval()
            self.processor, self.model = processor, model
            self.audio_parameter_count = count
            self.diagnostic = None
            self.state = 'ready'
        except Exception as exc:
            log_runtime_exception('Model initialization failed')
            self.model = self.processor = None
            self.state = 'unavailable'
            self.diagnostic = ('Insufficient CUDA memory for the audio tower. Free GPU memory and restart the API.'
                if isinstance(exc, (MemoryError, torch.cuda.OutOfMemoryError)) else
                'Model initialization failed. Check server logs, Gemma access and compatible dependencies; restart the API.')

    def predict(self, audio):
        if not self.loaded:
            raise RuntimeError('Model is not ready.')
        inputs = self.processor(text='<audio>', audio=audio, sampling_rate=16000, return_tensors='pt')
        tower_param = next(self.model.audio_tower.parameters())
        with torch.inference_mode():
            # TrueVoice passed only features, without a mask or multimodal tensors.
            features = inputs['input_features'].to(device=tower_param.device, dtype=tower_param.dtype)
            logits = self.model(features)
            probs = torch.softmax(logits, dim=-1)[0].cpu().numpy()
        return float(probs[0]), float(probs[1])  # index 0 real; index 1 fake
