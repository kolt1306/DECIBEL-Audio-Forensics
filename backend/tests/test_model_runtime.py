"""Offline regression tests: no Gemma downloads or CUDA hardware required."""
import logging
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock
import numpy as np
import pytest
import torch
from torch import nn
from backend.app import config
from backend.app import model as module


class TinyTower(nn.Module):
    def __init__(self):
        super().__init__()
        self.output_proj = nn.Linear(2, 2)
        self.seen = None

    def forward(self, input_features):
        self.seen = input_features
        return SimpleNamespace(last_hidden_state=input_features)


def test_dtype_policy(monkeypatch):
    monkeypatch.setattr(torch.cuda, 'is_bf16_supported', lambda: True)
    assert module.select_audio_dtype() == torch.bfloat16
    monkeypatch.setattr(torch.cuda, 'is_bf16_supported', lambda: False)
    assert module.select_audio_dtype() == torch.float32


def test_pooling_bridge_and_class_order():
    tower = TinyTower().to(dtype=torch.bfloat16)
    model = module.AudioDeepfakeClassifier(tower, 2).eval()
    seen = []
    hook = model.classifier.register_forward_pre_hook(lambda _, args: seen.append(args[0]))
    features = torch.tensor([[[1., 2.], [3., 4.]]], dtype=torch.bfloat16)
    logits = model(features)
    torch.testing.assert_close(seen[0], torch.tensor([[2., 3.]], dtype=torch.float32))
    assert logits.dtype == torch.float32
    hook.remove()
    runtime = module.ModelRuntime()
    runtime.model = model
    runtime.state = 'ready'
    runtime.processor = Mock(return_value={'input_features': features.float(), 'input_ids': torch.tensor([[1]])})
    expected = torch.softmax(logits, dim=-1)[0].detach().numpy()
    real, fake = runtime.predict(np.ones(32000, dtype=np.float32))
    assert real == float(expected[0]) and fake == float(expected[1])
    assert tower.seen.dtype == torch.bfloat16 and tower.seen.device.type == 'cpu'
    runtime.processor.assert_called_once()


def test_no_cuda_is_explicit(monkeypatch):
    monkeypatch.setattr(torch.cuda, 'is_available', lambda: False)
    runtime = module.ModelRuntime()
    runtime.load()
    assert not runtime.loaded and runtime.state == 'unavailable'
    assert 'CUDA' in runtime.diagnostic


def test_direct_audio_loader(monkeypatch):
    import transformers
    fake_module = ModuleType('transformers.models.gemma4.modeling_gemma4')
    loaded = Mock()
    loaded.parameters.return_value = [SimpleNamespace(device=torch.device('cuda:0'))]
    fake_class = Mock(side_effect=lambda _: nn.Linear(2, 2))
    fake_class.from_pretrained.return_value = (loaded, {'missing_keys': [], 'mismatched_keys': []})
    fake_module.Gemma4AudioModel = fake_class
    monkeypatch.setitem(sys.modules, fake_module.__name__, fake_module)
    audio_config = object()
    monkeypatch.setattr(transformers.AutoConfig, 'from_pretrained', Mock(return_value=SimpleNamespace(audio_config=audio_config)))
    monkeypatch.setattr(torch.cuda, 'mem_get_info', lambda _: (8 * 1024**3, 8 * 1024**3))
    tower, count = module.load_audio_tower('test', 'secret', torch.device('cuda:0'), torch.bfloat16)
    assert tower is loaded and count == 6
    kwargs = fake_class.from_pretrained.call_args.kwargs
    assert kwargs['config'] is audio_config
    assert kwargs['dtype'] == torch.bfloat16 and kwargs['device_map'] == {'': 'cuda:0'}
    assert 'offload_folder' not in kwargs
    fake_class.from_pretrained.return_value = (loaded, {'missing_keys': ['output_proj.weight']})
    with pytest.raises(ValueError, match='incomplete'):
        module.load_audio_tower('test', 'secret', torch.device('cuda:0'), torch.bfloat16)
    monkeypatch.setattr(torch.cuda, 'mem_get_info', lambda _: (1, 8 * 1024**3))
    fake_class.from_pretrained.reset_mock()
    with pytest.raises(MemoryError):
        module.load_audio_tower('test', 'secret', torch.device('cuda:0'), torch.bfloat16)
    fake_class.from_pretrained.assert_not_called()


def test_safe_initialization_failure(monkeypatch, caplog):
    import transformers
    monkeypatch.setattr(torch.cuda, 'is_available', lambda: True)
    monkeypatch.setattr(module, 'select_audio_dtype', lambda: torch.bfloat16)
    monkeypatch.setattr(config, 'HF_TOKEN', 'private-test-token')
    monkeypatch.setattr(transformers.AutoProcessor, 'from_pretrained', Mock(side_effect=RuntimeError('private-test-token failure')))
    runtime = module.ModelRuntime()
    with caplog.at_level(logging.ERROR, logger='decibel.model'):
        runtime.load()
    assert not runtime.loaded and runtime.state == 'unavailable'
    assert 'private-test-token' not in runtime.diagnostic
    assert 'private-test-token' not in caplog.text
    assert 'Traceback' in caplog.text and '[REDACTED]' in caplog.text
    assert runtime.base_model is None


def test_runtime_load_head_unchanged(monkeypatch):
    import transformers
    monkeypatch.setattr(torch.cuda, 'is_available', lambda: True)
    monkeypatch.setattr(config, 'HF_TOKEN', 'private-test-token')
    monkeypatch.setattr(module, 'select_audio_dtype', lambda: torch.bfloat16)
    tower = TinyTower()
    # Real checkpoint expects 1536 output features. No GPU required in this test.
    tower.output_proj = nn.Linear(2, 1536)
    loader = Mock(return_value=(tower, sum(p.numel() for p in tower.parameters())))
    monkeypatch.setattr(module, 'load_audio_tower', loader)
    processor = object()
    monkeypatch.setattr(transformers.AutoProcessor, 'from_pretrained', Mock(return_value=processor))
    original_to = nn.Module.to
    monkeypatch.setattr(nn.Module, 'to', lambda self, *args, **kwargs: original_to(self, dtype=kwargs.get('dtype', torch.float32)))
    runtime = module.ModelRuntime()
    runtime.load()
    assert runtime.loaded and runtime.base_model is None
    assert loader.call_args.args[2:] == (torch.device('cuda:0'), torch.bfloat16)
    original = torch.load(config.CLASSIFIER_PATH, weights_only=True, map_location='cpu')
    for key, tensor in runtime.model.classifier.state_dict().items():
        torch.testing.assert_close(tensor, original[key], rtol=0, atol=0)
    assert not runtime.model.training and not runtime.model.classifier.training
    runtime.load()
    loader.assert_called_once()
