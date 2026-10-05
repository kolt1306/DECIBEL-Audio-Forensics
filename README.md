# DECIBEL

**Voice authenticity system.** An audio investigation instrument built around the original TrueVoice classifier. Upload or record audio, view its real waveform, analyze the complete recording, locate suspicious segments, listen to regions, inspect input quality, compare channel modes and export the evidence report.

DECIBEL results are probabilistic model outputs and should not be treated as definitive proof of audio authenticity. No improved classifier accuracy is claimed.

## Architecture

```text
Browser / React + TypeScript + Vite
  → multipart upload → FastAPI → bounded decoding → mono / 16 kHz
  → quality diagnostics (independent of authenticity)
  → overlapping analysis windows
  → Gemma 4 E4B frozen audio tower → mean pooling over time
  → TrueVoice classifier: Linear(hidden,256) → GELU → Dropout(0.3) → Linear(256,2)
  → per-segment real / deepfake probabilities
  → DECIBEL aggregation / regions / timeline → browser investigation + JSON report
```

`backend/app` separates configuration, model lifecycle, audio decoding, diagnostics, segmentation, inference orchestration, aggregation, jobs, schemas and errors. `frontend/src` separates the canvas signal field, risk timeline, investigation, batch workflow, microphone lifecycle and API client. Training notebooks and Gradio are not shipped.

## DECIBEL ENHANCEMENTS OVER TRUEVOICE

**TrueVoice-derived:** `google/gemma-4-e4b-it`, the frozen audio tower, classifier architecture and unmodified trained weights, mono/16 kHz processing, torchaudio phone resampling, softmax class interpretation and 40%/70% thresholds. The original notebook uses **float32**. DECIBEL keeps the classifier in FP32 and preserves plain unmasked mean pooling and the processor's `<audio>` input. The standalone audio tower, input features and classifier all use FP32 on cuda:0, matching the original demo precision. An explicit dtype conversion remains before the head. For the verified public speech and user-supplied recording, standalone FP32 embeddings exactly matched the original full-model tower construction with the same checkpoint weights. Matching inference does not ensure every real recording is classified correctly.

**DECIBEL enhancements:** a modular FastAPI service; complete long-audio analysis; segment predictions; merged suspicious regions; peak-segment navigation; overlap-safe time distribution; audio quality diagnostics; one-time background model loading and readiness endpoints; GPU concurrency guard; structured errors; bounded request/decoder resources; UUIDs, fingerprints and timings; asynchronous jobs, real progress and cancellation; independent batch jobs; standard/phone comparison; waveform-aligned risk heatmap and region playback/looping; technical details, statistics, copy summary and JSON export; self-check and benchmark tools.

These additions improve the surrounding system. They do not retrain the classifier, change its mathematics or establish improved accuracy.

## Hardware and access

- Python 3.12 recommended; Node.js 22; Git.
- CUDA-capable NVIDIA infrastructure and matching CUDA-enabled torch, torchvision and torchaudio packages.
- Hugging Face access to `google/gemma-4-e4b-it` and a read token in `HF_TOKEN`.
- The audio tower has **304,824,608 parameters**: 1,219,298,432 bytes (1.136 GiB) in FP32 or 609,649,216 bytes (0.568 GiB) in FP16/BF16, excluding activations, buffers and CUDA workspaces. It fits on the verified 8 GB RTX 4060 Laptop GPU. DECIBEL loads `Gemma4AudioModel` directly from the checkpoint on `cuda:0`; it never constructs or retains the language/vision model and does not disk-offload inference. The shared Hugging Face checkpoint still requires about 16 GB of disk cache. No quantization is used.
- FFmpeg **and FFprobe** on `PATH` for WebM/Opus browser capture, AAC/M4A and other codecs unsupported by libsndfile. WAV, FLAC and supported MP3 use soundfile directly.

CPU-only installations can serve the application API and validate audio, but cannot classify. Gemma/model-loader dependencies remain necessary for actual inference. Transformers is pinned to Git commit `10502571152db764f244791b7054481a7f629801` because the notebook installs from Git for Gemma 4 support. This pin makes source reproducible; runtime validation is recorded below.

## Backend setup

From the repository root:

```sh
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
Copy-Item backend/.env.example backend/.env
```

macOS/Linux:

```sh
source .venv/bin/activate
cp backend/.env.example backend/.env
```

Install a matching CUDA-enabled **torch, torchvision and torchaudio** set using the [official PyTorch selector](https://pytorch.org/get-started/locally/) before the backend requirements. Use all three versions from the same supported release and CUDA wheel index; general requirements intentionally do not hardcode a CUDA wheel URL. Pillow and torchvision are required by Gemma4Processor even for this audio workflow. Then:

```sh
pip install -r backend/requirements.txt
```

Edit `backend/.env` (never commit it):

```dotenv
HF_TOKEN=your_huggingface_read_token
FRONTEND_ORIGIN=http://localhost:5173
MAX_UPLOAD_MB=50
MAX_AUDIO_SECONDS=600
MAX_DECODED_MB=256
MAX_SEGMENT_SECONDS=25
SEGMENT_OVERLAP_SECONDS=2
MAX_CONCURRENT_INFERENCE=1
MAX_BATCH_FILES=10
MAX_PENDING_JOBS=12
JOB_TTL_SECONDS=1800
```

```sh
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Use **one worker** for this in-memory queue/model deployment. The model loads once in a background startup task; health/readiness remain responsive during initialization and GPU work. A missing token, CPU-only runtime or model load failure gives an explicit safe readiness diagnostic. Restart after fixing configuration. Avoid `--reload` on GPU deployments because each reload reinitializes the model. Multiple allowed frontend origins may be comma-separated; wildcard CORS is not the default.

## Frontend setup

In another terminal:

```sh
cd frontend
npm ci
```

Copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_BASE_URL` (default `http://localhost:8000`). Frontend environment values are public bundle configuration; tokens belong only in the backend.

```sh
npm run dev
```

Open [localhost:5173](http://localhost:5173). `npm run build` produces `frontend/dist`. Serve that directory over HTTPS for production. Microphone capture requires localhost or HTTPS, a supported MediaRecorder browser and microphone permission.

The browser's default client limits are 50 MB, 10 minutes and 10 batch files. These match the server defaults; if deploying with different limits, adjust client validation accordingly. The microphone automatically stops after 10 minutes. Actual server decodability is always validated, independent of MIME labels.

The waveform covers the **complete recording** and is derived from decoded mono samples. Idle graphics are explicitly illustrative. Risk bands use real returned segment probabilities; overlapping bands show the highest risk. Hover/focus describes each model window. Clicking seeks to a window; suspicious-region controls play/loop a region or return to full audio. The classification and waveform stay in one composition. Motion respects reduced-motion preferences; live amplitude remains available as capture feedback.

## Analysis semantics

### Segments and silent windows

Default windows are 25 seconds with 2 seconds overlap: `0–25`, `23–48`, `46–71`, etc. Every sample is covered; there is no silent truncation after 29 seconds. Windows never exceed the model's 29-second input limit. A last tail below 1.5 seconds is covered by an end-aligned window rather than creating invalid short input. Very short recordings use one valid window. Config values are range-validated at import/startup. Overlap is capped at 5 seconds and half the configured window length.

Audio becomes mono at 16 kHz. An obviously silent signal is rejected conservatively: peak below 0.0001, or peak below 0.005 with RMS below 0.0001. This intentionally allows sustained quiet audio instead of rejecting it solely for the upstream 0.005 peak threshold. Each silent analysis window is marked `skipped` with null probabilities and `AUDIO_SILENT`, never assigned an invented classifier score. If no usable windows remain, analysis fails.

Phone mode preserves `16 kHz → 8 kHz → 16 kHz` via torchaudio, independently for each model window. Comparison analyzes the same windows in both modes and returns both results separately. Its signed difference is **phone minus standard, in percentage points**, not an accuracy comparison or combined confidence.

### Verdict and aggregation

Per-segment softmax index 0 = real; index 1 = fake. Fake probability ≥0.70 means `deepfake/high`; ≥0.40 and <0.70 means `possible_deepfake/medium`; below 0.40 means `real/low`.

The overall verdict conservatively uses the **maximum valid segment fake probability**. Its real probability is the actual paired output from that same peak segment. This application-level aggregation is labeled in the API, UI and report; it is not a trained whole-recording confidence score. Arithmetic mean, median, min, max and population standard deviation over valid windows are also returned. Overlapping windows remain separate observations for these statistics; they are not independent evidence.

Adjacent medium/high-risk windows with intersecting or touching bounds merge into suspicious regions. A low-risk or skipped segment breaks the adjacency chain. Region probability is the maximum contributing segment score; region risk follows the unchanged thresholds. Boundaries are approximate **segment-derived regions**, not frame-level detection.

For time distribution, DECIBEL partitions the timeline at all segment boundaries and assigns each interval the highest active valid risk. Each instant is counted once. Fractions use valid analyzed time as denominator; uncovered time is separately returned as `unanalyzed_seconds`. The UI heatmap follows the same highest-risk overlap rule.

### Quality diagnostics

Diagnostics are computed before phone simulation and do not modify the signal or influence classifier probabilities: original sample rate/channels, duration, RMS, peak amplitude, 20ms energy-frame silence ratio, clipping ratio (`|sample| ≥0.999`), DC offset, 10th-to-90th percentile frame-RMS dynamic range, zero crossing ratio, mean FFT spectral centroid/bandwidth and estimated usable signal seconds. FFT analysis samples up to 256 evenly spaced 2048-point frames to bound processing time. Spectral measurements are diagnostic summaries, never evidence that a voice is fake.

Warnings: `VERY_LOW_SIGNAL` for RMS <0.005; `HIGH_SILENCE_RATIO` above 60%; `AUDIO_HEAVILY_CLIPPED` above 1%; `VERY_SHORT_USABLE_SPEECH` below 1.5 seconds above the 0.001 frame-RMS threshold; `UNUSUAL_SAMPLE_RATE` below 8 kHz or above 96 kHz. The usable-signal estimate is an energy heuristic, **not voice activity detection**. Quality is `poor` for >90% silence, >10% clipping or <1.5 usable signal seconds; otherwise `usable` when any warning exists, `good` without warnings. Quality describes input suitability independently of authenticity.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/health` | Service liveness; HTTP 200, model status included |
| `GET /api/v1/ready` | Inference readiness; HTTP 503 until ready |
| `GET /api/v1/model-info` | Safe architecture, configuration limits, precision, fingerprint and readiness |
| `POST /api/v1/analyze` | Synchronous multipart `audio`, `phone_mode` |
| `POST /api/v1/compare` | Synchronous independent standard/phone analysis |
| `POST /api/v1/jobs/analyze` | Async multipart `audio`, `phone_mode`, `compare`; HTTP 202 |
| `GET /api/v1/jobs/{job_id}` | Job state, true segment progress, result/error |
| `POST /api/v1/jobs/{job_id}/cancel` | Request cancellation |
| `POST /api/v1/jobs/batch` | Up to 10 multipart `files`, `phone_mode`, `compare`; independent jobs |

`/api/health` and `/api/analyze` are compatibility aliases. API documentation: [localhost:8000/docs](http://localhost:8000/docs).

```sh
curl http://localhost:8000/api/v1/ready
curl -F "audio=@speech.wav" -F "phone_mode=false" http://localhost:8000/api/v1/analyze
curl -F "audio=@long-speech.wav" -F "compare=true" http://localhost:8000/api/v1/jobs/analyze
curl -F "files=@first.wav" -F "files=@second.wav" http://localhost:8000/api/v1/jobs/batch
```

Detailed responses include UUID analysis ID, timestamp, raw peak/segment probabilities, regions, statistics, risk distribution, quality/warnings, model/classifier fingerprints, settings, and measured decode/preprocessing/inference/total timings. Comparison timings share decoding/diagnostics and total wall time; each mode's inference timing covers its own windows. A queued job has `segments_total: 0` until decoding establishes its actual windows. Progress is processed windows divided by total windows, including skipped silent windows and both modes when comparing. No fabricated phase progress is shown.

Predictable error form:

```json
{"error":{"code":"AUDIO_TOO_SHORT","message":"Record at least 1.5 seconds of audio."}}
```

Codes include `NO_AUDIO`, `INVALID_AUDIO`, `UNSUPPORTED_AUDIO`, `AUDIO_TOO_SHORT`, `AUDIO_TOO_LONG`, `AUDIO_SILENT`, `AUDIO_TOO_LARGE`, `REQUEST_TOO_LARGE`, `MODEL_NOT_READY`, `INFERENCE_FAILED`, `INVALID_BATCH`, `QUEUE_FULL` and `JOB_NOT_FOUND`. Client timeout/network failures are handled separately in the UI. The client bounds a single job wait to 30 minutes and requests cancellation after timeout/interruption. No stack traces, token values, host details or filesystem paths are returned.

## Jobs, concurrency and privacy

All synchronous, async, batch and comparison inference shares the configurable semaphore (default 1). Queued cancellation prevents work; running cancellation finishes the current GPU call and stops future windows. It never releases the guard while an inference thread is still running. Cancellation cannot interrupt a single CUDA call; there is no promise of immediate GPU preemption. Health remains independent of the guard.

Requests are capped before multipart parsing/spooling, including chunked requests. Files have a separate size limit. Direct libsndfile decoding also caps the original float32 allocation at `MAX_DECODED_MB` (256 MB default); unusually large decoded layouts must be exported as mono/lower-rate audio. Batch admission is atomic: the count and combined pending-byte budget are checked before jobs are submitted. Queued/processing upload memory is bounded to twice the configured file limit, and the queue count to `MAX_PENDING_JOBS`. FFmpeg output is bounded to the duration limit plus one second so excessive-duration recordings are **rejected**, not silently truncated; fallback decoding has a 60-second timeout.

Audio is not permanently stored or logged. Upload handles close even on errors. FFmpeg inputs use a safely created temporary directory and are deleted after decoding. Job payloads/decoded samples are retained only during queued/active work; completed records contain results only. Results expire from memory after `JOB_TTL_SECONDS` and are count-bounded. Polling IDs are unguessable UUIDs, not authentication. This is a single-instance queue: restart loses jobs. Use HTTPS, authentication/rate limits and proxy body limits before making the API public; CORS alone is not access control. No database, raw-audio cache or browser audio history is introduced.

## Tests and operator tools

```sh
pip install -r backend/requirements-dev.txt
python -m compileall -q backend/app
python -m pytest backend/tests -q
python -m backend.app.selfcheck
python -m backend.app.selfcheck --full
python backend/scripts/benchmark.py your-recording.wav
```

```sh
cd frontend
npm run typecheck
npm test
npm run build
```

Backend tests cover the original checksum/weight shapes, preprocessing and phone equivalence, validation, segmentation/overlap/short tails, aggregation, region merging, risk duration, diagnostics, config parsing, structured errors, readiness, queue bounds/cancellation, real unloaded-model failures and chunked upload limits. Tone fixtures test processing only; synthetic probabilities appear only in pure aggregation unit tests. They are never presented as classifier predictions. Frontend tests cover API failures/invalid responses and microphone cleanup/permission denial/unmount races.

**REAL GPU RUNTIME VERIFIED** on Windows with RTX 4060 Laptop 8 GB, CUDA-enabled PyTorch 2.11.0+cu130, torchvision 0.26.0+cu130, torchaudio 2.11.0+cu130, and the pinned Transformers revision. Public LibriSpeech speech completed through real Uvicorn async jobs, repeated sync analysis, standard/phone comparison, batch, and long-audio segmentation. Health/readiness remained HTTP 200 after inference. See [GPU verification report](GPU_VERIFICATION.md) for measured memory, utilization and latency. This verifies execution stability, not classifier accuracy.

To repeat verification with your own real speech:

```sh
python backend/scripts/verify_gpu.py your-real-speech.wav --port 8000
```

The script owns and stops its test server, requires an unused port, and writes measured samples/results to `gpu-verification.json`. It never fabricates model scores. For an already running server, wait for readiness HTTP 200, then:

```sh
curl -F "audio=@your-real-speech.wav" -F "phone_mode=false" http://localhost:8000/api/v1/analyze
curl -F "audio=@your-real-speech.wav" http://localhost:8000/api/v1/compare
curl -F "audio=@your-long-recording.wav" http://localhost:8000/api/v1/jobs/analyze
```

For core equivalence, compare a single ≤25-second segment against the upstream notebook on the identical waveform/mode and compatible dependencies. Report GPU/runtime results separately from utility tests. Successful live job results, heatmap classification, reports and comparison outputs still need real-model end-to-end verification.

## Provenance and licenses

**TrueVoice** is the original model adaptation, trained classifier and research by Shiwon Oh (`shiwoni`) and Hyemin Jeong (`hyeminss11`): [hyeminss11/true-voice-gemma4](https://github.com/hyeminss11/true-voice-gemma4). **DECIBEL** contributes the backend, application architecture and investigation/visual system described above. DECIBEL did not train the original classifier, and no endorsement is implied.

Reference revision: `c4020a4e7a3480c0711a5754ba505a4d28bc5d26`. The reference repository is read-only and was not modified.

`backend/saved_model/classifier_head.pt` is the unmodified **1,578,541-byte** artifact. SHA-256:

```text
e03b8a117892977cca69b8d0083720c4ac7b2255d8bf2ef18a1688dd36da6106
```

It is checksum-verified before loading with `torch.load(..., weights_only=True)`. Hidden size comes from `audio_tower.output_proj.out_features`. The upstream `metadata.json` contained binary checkpoint bytes rather than JSON at inspection; it is not copied as misleading metadata. [provenance.json](backend/saved_model/provenance.json) records verified artifact facts.

Both upstream notices are retained: [MIT](licenses/TrueVoice-MIT.txt) and [CC BY 4.0](licenses/LICENSE-CC-BY-4.0.md). [NOTICE](NOTICE) credits the authors and identifies changes. Gemma remains subject to its own model access/license terms; its base weights are downloaded separately into the Hugging Face cache.
