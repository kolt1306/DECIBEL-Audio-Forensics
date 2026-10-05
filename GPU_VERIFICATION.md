# GPU inference verification (initial BF16 run)

Historical BF16 execution measurements; the production tower was subsequently restored to FP32. See the FP32 correctness addendum below.

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

## FP32 correctness addendum

Production inference now uses cuda:0 / float32 for the audio tower, input features and unchanged classifier. The reference demo was inspected locally: last_hidden_state after output_proj -> unmasked mean(dim=1) -> original Linear(1536,256), GELU, Dropout(0.3), Linear(256,2) -> softmax; index 0 real, index 1 fake. Dropout is inactive in eval. The documented classifier checksum is unchanged, and loading is strict.

Real sample fake probabilities, comparing freshly loaded precisions:

| Clip | BF16 before | FP32 after |
| --- | --- | --- |
| Public LibriSpeech speech | 0.00001149836862 | 0.00001161961427 |
| User-supplied known-real recording | 1.0 (real=0.00000004693518) | 1.0 (real=0.00000004272772) |

The standalone Gemma4AudioModel and the audio_tower obtained by constructing AutoModelForImageTextToText on empty parameters were compared in FP32. Only the tower's original checkpoint tensors were streamed and loaded; full language/vision weights were never allocated. Non-checkpoint positional/attention buffers were preserved from construction. All checkpoint parameters/buffers matched exactly. Both clips' embeddings had maximum absolute difference 0.0; the public clip's mean absolute difference was also 0.0. The original constructed tower and classifier reproduced fake=1.0 on the user recording.

Public diagnostic shapes: input_features [1,1483,128], last_hidden_state [1,371,1536], pooled [1,1536], logits [1,2]. FP32 public logits [3.7936899662,-7.5691146851]. Real HTTP POST /api/v1/analyze succeeded with public speech; probabilities were finite and summed to approximately one. Health and readiness remained 200 and Uvicorn stayed alive.

The reported universal saturation was not reproduced: the public recording is classified real in both precisions. The user recording remains a false positive in the reference-equivalent FP32 path. BF16 is therefore not a demonstrated cause of that result. Restoring FP32 corrects the precision deviation; it does not resolve this classifier false positive. Labels, thresholds, softmax, audio and weights were not changed to hide the result. A full from_pretrained load of all Gemma weights was intentionally avoided; the comparison validates the actual full-model tower class and original checkpoint tensors.

Regression suite after the FP32 correction: 55 passed, with FRONTEND_ORIGIN overridden only for the test process. The model fingerprint changed to record the FP32 tower/head policy.

The supplied user recording was also sent through POST /api/v1/analyze on a fresh FP32 Uvicorn process: real=4.2727716476e-08, fake=1.0, finite probabilities summing approximately to one. The process stayed alive; health/readiness returned 200. This confirms the score persists in the reference-equivalent API path; the user's existing port-8000 process was not stopped.
