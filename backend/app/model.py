"""Extracted from TrueVoice's demo; float32 and unmasked mean pooling preserved."""
import hashlib
import torch
from torch import nn
from . import config


class AudioDeepfakeClassifier(nn.Module):
    def __init__(self, audio_tower, hidden_size):
        super().__init__()
        self.audio_tower = audio_tower
        self.classifier = nn.Sequential(nn.Linear(hidden_size, 256), nn.GELU(),
                                        nn.Dropout(0.3), nn.Linear(256, 2))

    def forward(self, input_features):
        output = self.audio_tower(input_features=input_features)
        hidden = output.last_hidden_state if hasattr(output, 'last_hidden_state') else output[0]
        return self.classifier(hidden.mean(dim=1))


class ModelRuntime:
    def __init__(self):
        self.processor = None
        self.model = None
        self.base_model = None
        self.diagnostic = 'Model initialization pending.'
        self.state = 'pending'

    @property
    def loaded(self):
        return self.model is not None

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
            from transformers import AutoProcessor, AutoModelForImageTextToText
            if hashlib.sha256(config.CLASSIFIER_PATH.read_bytes()).hexdigest() != config.CLASSIFIER_SHA256:
                self.diagnostic = 'Classifier integrity check failed. Restore the original trained checkpoint.'
                self.state = 'unavailable'
                return
            processor = AutoProcessor.from_pretrained(config.MODEL_ID, token=config.HF_TOKEN)
            base = AutoModelForImageTextToText.from_pretrained(config.MODEL_ID,
                token=config.HF_TOKEN, dtype=torch.float32, device_map='auto')
            tower = base.model.audio_tower
            for param in tower.parameters():
                param.requires_grad = False
            model = AudioDeepfakeClassifier(tower, tower.output_proj.out_features)
            model.classifier = model.classifier.to('cuda').to(torch.float32)
            model.classifier.load_state_dict(torch.load(config.CLASSIFIER_PATH, map_location='cpu', weights_only=True))
            base.eval()
            model.eval()
            self.base_model, self.processor, self.model = base, processor, model
            self.diagnostic = None
            self.state = 'ready'
        except Exception:
            self.state = 'unavailable'
            self.diagnostic = 'Model initialization failed. Check Gemma access, compatible Transformers and GPU memory; restart the API.'

    def predict(self, audio):
        inputs = self.processor(text='<audio>', audio=audio, sampling_rate=16000, return_tensors='pt')
        with torch.inference_mode():
            logits = self.model(inputs['input_features'].to('cuda', dtype=torch.float32))
            probs = torch.softmax(logits, dim=-1)[0].cpu().numpy()
        return float(probs[0]), float(probs[1])
