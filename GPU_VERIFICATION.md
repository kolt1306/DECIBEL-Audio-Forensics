# GPU inference verification

Verified on 5 October 2026 on Windows, NVIDIA RTX 4060 Laptop GPU (8188 MiB).

- Audio tower: 304,824,608 parameters; FP32 1,219,298,432 bytes (1.136 GiB); FP16/BF16 609,649,216 bytes (0.568 GiB).
- Tower: cuda:0, BF16; TrueVoice head: cuda:0, FP32. All 751 audio checkpoint tensors loaded. No full Gemma language/image model constructed or retained; no disk offloading.
- Runtime: torch 2.11.0+cu130, torchvision 0.26.0+cu130, torchaudio 2.11.0+cu130; Transformers Git revision 10502571152db764f244791b7054481a7f629801.
- Input: public LibriSpeech 5703-47212-0000 speech, 14.84 seconds, supplied via librosa's libri1 example (https://librosa.org/data/audio/5703-47212-0000.ogg).
- Measured total device VRAM before server: 583 MiB; after loading/before inference: 1292 MiB; sampled first-job peak: 1338 MiB; after extended requests: 1450 MiB. These include desktop/other GPU users, not just PyTorch allocations.
- First job sampled GPU utilization peak: 19%; utilization immediately after extended requests: 22%. Sampling uses nvidia-smi approximately every 100 ms plus command overhead, and can miss short kernel peaks. An earlier completed run measured 59% immediately after extended requests.
- First async job end-to-end: 2.631 seconds, including initial preprocessing and polling; API-reported inference time: 791.95 ms.
- Warm repeat request: 79.18 ms total HTTP wall time. Standard/phone comparison, two-file batch and four-window extended speech all completed successfully with real model probabilities.
- Uvicorn remained alive; /api/v1/health and /api/v1/ready both returned 200 after all requests. The verification script then deliberately stopped its own server.
- Classifier checkpoint SHA-256 remains e03b8a117892977cca69b8d0083720c4ac7b2255d8bf2ef18a1688dd36da6106. Original weights, class index 0=real / 1=fake, softmax and unmasked mean pooling are unchanged. BF16 tower computation can cause numerical differences from the original FP32 notebook.
- Backend regression suite: 55 passed. FRONTEND_ORIGIN was overridden to http://localhost:5173 for the existing CORS test; production .env and CORS behavior unchanged.

## Crash diagnosis limits

The previous code loaded and retained the full multimodal model in FP32 with device_map=auto, including CPU/disk offload and meta parameters, while invoking the extracted audio tower with CUDA input and a separate CUDA head. The offloaded execution/native tensor-transfer path is the leading suspect; 0xC0000005 alone does not identify the failing native library or establish CUDA OOM. No native crash dump was available, so an exact faulting instruction is not proven. The corrected fully resident tower completed real inference in the same CUDA environment.

Before-fix VRAM/utilization/latency were not measured in this session; the supplied baseline reported a native access violation and process termination. No baseline measurements are fabricated. Verification demonstrates successful execution of these workloads, not indefinite stability or model accuracy.
