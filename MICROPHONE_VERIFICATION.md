# Microphone capture investigation — 5 October 2026

The supplied known-real user recording remains a classifier false positive. It returns fake=1.0 both in its original compressed form and after the production frontend encoder writes valid PCM16 WAV. The original-equivalent tower reproduces the WAV false positive with exactly matching embeddings. This pass does **not** establish whether browser DSP contributes to fresh live microphone false positives: no saved live microphone WAV or paired default/DSP-off human recordings were available.

## Integration and capture changes

Latest origin/main README commit 583605c was pulled before integrating WAV commit 61e634421684f4ed95e5e6579adfebafa700c219 as cherry-pick 1f9ca3b. The latest README was preserved during conflict resolution; unrelated feature history was not merged. Frontend polish and GPU/FP32 commits remain in main. The latest README's unclosed runtime code fence was closed before appending capture documentation.

Capture requests channelCount=1, echoCancellation=false, noiseSuppression=false and autoGainControl=false when supported. Browsers without capability discovery receive these ideal constraints. Unsupported properties are omitted; an OverconstrainedError relaxes only its named constraint while preserving the others. Permission/device failures are not retried as constraint failures. Actual channel count, sample rate, sample size and DSP settings come from track.getSettings(); device/group IDs are excluded. Enabled/unverifiable DSP and constraint fallback produce browser capture warnings, separately from decoded-signal quality and authenticity. Browser-reported DSP-off does not guarantee hardware/OS processing is absent. See [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [track settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings).

AudioWorklet captures PCM, averages channels to mono and flushes its partial final buffer on stop. The encoder produces audio/wav, capture-<timestamp>.wav, RIFF/WAVE, PCM format 1, one channel, signed 16-bit samples, block alignment 2, byte rate=AudioContext.sampleRate*2. It writes the actual AudioContext sample rate without pretending capture was 16 kHz. The audio graph may resample the microphone track to the context rate; both reported rates are retained. Soundfile decoding and existing librosa mono/16 kHz resampling remain unchanged. No MediaRecorder, WebM or FFmpeg is required for DECIBEL-generated WAVs.

Capture settings and sample-derived duration are available in a disclosure next to the recording. Save captured WAV downloads the exact submitted file. JSON exports add browser_capture metadata separately from untouched API results. Existing low-signal, silence, clipping, short usable-signal and unusual sample-rate warnings remain independent of authenticity. No unsupported duration recommendation was added.

High scores now read **High model suspicion**, with **model-estimated deepfake probability** shown separately. Low/moderate scores use matching suspicion wording. Returned numbers, percentage formatting, thresholds and the existing disclaimer are unchanged; fake=1.0 continues to display 100.0%.

## Measured WAV fixtures

The following fixtures execute frontend/src/lib/wav.ts on decoded existing real recordings. **They are encoder verification fixtures, not newly captured microphone recordings.** The original public reference is LibriSpeech 5703-47212-0000, previously verified from librosa's libri1 example.

| Metric | User recording through frontend encoder | Public reference through frontend encoder |
| --- | --- | --- |
| Original / WAV sample rate | 48000 Hz | 22050 Hz |
| Channels / bits / format | 1 / 16 / PCM 1 | 1 / 16 / PCM 1 |
| RIFF bytes / file bytes | 1368108 / 1368108 | 654488 / 654488 |
| Data bytes / available bytes | 1368064 / 1368064 | 654444 / 654444 |
| Byte rate / block alignment | 96000 / 2 | 44100 / 2 |
| Duration (WAV / decoded) | 14.250666667s / 14.250687500s | 14.840000000s / 14.840000000s |
| 16 kHz waveform length | 228011 | 237440 |
| RMS | 0.064997860 | 0.112091298 |
| Peak | 0.472188473 | 0.802327633 |
| 20 ms frame-energy silence | 2.526194% | 1.886792% |
| Clipping | 0.000000% | 0.000000% |
| DC offset | -2.48952311e-06 | 2.12643383e-05 |
| Quality / warnings | good / none | good / none |
| Complete frames / valid PCM WAV | yes / yes | yes / yes |

Sub-sample duration rounding after resampling is expected. Native/resampled values were finite; headers, lengths, byte rates and final frames were correct.

## Before-inference summaries

Population standard deviation is used. Near-zero means |sample| < 0.001, separately from frame-energy silence. Feature magnitudes do not represent waveform clipping. Hooks observe the unchanged production forward pass.

| Measurement | User WAV | Public WAV |
| --- | --- | --- |
| 16 kHz waveform: shape | [228011] | [237440] |
| 16 kHz waveform: minimum | -0.472188473 | -0.802327633 |
| 16 kHz waveform: maximum | 0.402179927 | 0.499562711 |
| 16 kHz waveform: mean | -2.48952188e-06 | 2.12643226e-05 |
| 16 kHz waveform: std | 0.0649978593 | 0.112091295 |
| 16 kHz waveform: rms | 0.0649978598 | 0.112091298 |
| Input features: shape | [1, 1425, 128] | [1, 1483, 128] |
| Input features: minimum | -6.90775537 | -6.90775537 |
| Input features: maximum | 2.92044997 | 3.11958861 |
| Input features: mean | -1.96510148 | -2.36746836 |
| Input features: std | 1.5742166 | 2.11010909 |
| Input features: rms | 2.51789227 | 3.17135087 |
| Tower last_hidden_state: shape | [1, 357, 1536] | [1, 371, 1536] |
| Tower last_hidden_state: minimum | -47.4746475 | -46.4481506 |
| Tower last_hidden_state: maximum | 47.6717529 | 49.9203873 |
| Tower last_hidden_state: mean | 0.0399577282 | 0.041109588 |
| Tower last_hidden_state: std | 5.78872871 | 5.77704191 |
| Tower last_hidden_state: rms | 5.78886635 | 5.77718796 |
| Unmasked pooled features: shape | [1, 1536] | [1, 1536] |
| Unmasked pooled features: minimum | -11.7133646 | -12.0557613 |
| Unmasked pooled features: maximum | 12.3387728 | 11.9771757 |
| Unmasked pooled features: mean | 0.0399577431 | 0.041109588 |
| Unmasked pooled features: std | 1.82343459 | 1.97095954 |
| Unmasked pooled features: rms | 1.82387235 | 1.97138836 |
| Waveform near-zero samples | 4.815996% | 6.597035% |
| Raw logits (real, fake) | [-8.329133033752441, 8.636884689331055] | [3.8420140743255615, -7.627562522888184] |
| Raw probabilities (real, fake) | [4.283036147967323e-08, 1.0] | [0.9999895095825195, 1.0442910024721641e-05] |

## Same-file transport comparison

Exact WAV bytes were analyzed through three routes. Production frontend submitAnalysis/readJob functions were transpiled and run in Node with native File/FormData/fetch against the real GPU server; this checks submission/validation/polling code, **not browser UI/CORS or live capture**. Curl posted the same files to /api/v1/analyze. Local analysis used analyze_recording with a freshly loaded FP32 runtime.

| Source | Frontend API client | Curl API | Local backend |
| --- | --- | --- | --- |
| User WAV | fake=1 | fake=1 | fake=1 |
| Public WAV | fake=1.04429100247e-05 | fake=1.04429100247e-05 | fake=1.04429100247e-05 |

All differences were exactly 0.0; fingerprints/checksums agreed. Original compressed user clip: fake=1.0. Original public reference: fake=1.1619614269875e-05, matching the earlier approximately 0.00001162 result. Public PCM16 fixture: approximately 0.00001044; the small quantization difference does not change its low-suspicion classification.

## Reference equivalence

Gemma4Processor with <audio> -> input_features on cuda:0/float32 -> Gemma4AudioModel.last_hidden_state -> unmasked mean(dim=1) -> original TrueVoice classifier on cuda:0/float32 -> unchanged softmax. Index 0 remains REAL, index 1 FAKE. Tower is cuda:0/float32; dropout is inactive in eval. Classifier SHA-256 remains e03b8a117892977cca69b8d0083720c4ac7b2255d8bf2ef18a1688dd36da6106.

For both encoder-generated WAVs, the standalone tower was compared again against original full-model class tower construction using streamed audio checkpoint tensors only. All state tensors matched exactly; public/user embedding maximum absolute differences were both **0.0**. Original-construction user WAV probabilities: real=4.2830361479673e-08, fake=1.0. No full language/vision weights were allocated. Labels, weights, pooling, thresholds, softmax, phone simulation and probabilities were not modified.

## Duration investigation

Prefix crops test existing speech; they are not separate live utterances.

| Crop | User WAV fake probability | Public WAV fake probability |
| --- | --- | --- |
| 3s | 0.994805753231 | 1.26917748275e-05 |
| 9s | 0.999997973442 | 4.03494777856e-06 |

Neither source contains 15 seconds; that test was marked unavailable instead of padding/repeating speech or inventing scores. The longer user recording remained false-positive; the short public recording remained low-suspicion. These observations do not establish disproportionate short-duration live false positives. No new 5–10 second UX recommendation is asserted.

## Findings and manual limits

| Candidate cause | Finding |
| --- | --- |
| Browser capture / DSP (A, I) | Fresh live capture remains unmeasured. Previous DSP was uncontrolled; the new request/settings warnings improve forensic capture fidelity, with no claimed score improvement. |
| WAV encoding (B) | Exact production encoder writes complete PCM16 WAV; user false positive persists while public speech remains low-suspicion. |
| Sample rate / mono (C, D) | Actual WAV rates and 16 kHz lengths verified. Both measured sources are mono; existing tests cover multi-channel averaging. |
| Waveform/file submission (E) | Preview retains the original File; same-byte frontend API client/curl/local scores agree. Browser UI remains untested this pass. |
| Backend decoding/resampling (F) | PCM decoding works without FFmpeg; existing preprocessing is unchanged. |
| Duration (G) | Crop results do not support a duration correction; a new 15-second live utterance was unavailable. |
| Silence/clipping/level (H) | User signal is good quality, with no clipping and low silence; diagnostics do not explain away the false positive. |
| Classifier (J) | Confirmed false positive for the supplied known-real recording, reproduced after WAV encoding by the original-equivalent tower. Attribution for fresh live capture remains unverified. |

Only the Codex in-app browser was exposed to automation; Firefox/Edge/native apps were unavailable. Navigation to both localhost:5175 and 127.0.0.1:5175 failed with net::ERR_BLOCKED_BY_CLIENT. No new human microphone recording, actual live track settings, manual playback/waveform check, DSP before/after score or Firefox/Chromium retest is claimed. The integrated WAV commit records prior user-verified Firefox recording/analysis; that is historical evidence.

The remaining empirical check is paired default/new capture of the same speech in Firefox and separate approximately 3s/9s/15s utterances. Inspect Microphone capture settings, save the exact WAV and export JSON metadata. Record browser/version, actual track settings, AudioContext/WAV rate, duration, RMS/peak/clipping and probability. If a valid minimally processed live recording still returns fake approximately 1, preserve and document the classifier false positive. No processing warning adjusts authenticity.

```sh
python backend/scripts/diagnose_capture.py capture.wav reference.wav --api http://127.0.0.1:8000 --duration-crops > capture-diagnostics.json
```

This opt-in tool reports scalar summaries, never raw audio or huge tensors, using the production path. Normal API logging is unchanged. Raw fixtures and JSON evidence stay outside this repository. Capture metadata lives in a WeakMap for the current File and is included only on the existing user-triggered JSON export action. Normal tests do not download Gemma.

## Checks

- npm run typecheck: passed.
- npm test: 42 passed across 10 files, including constraints/settings, selective fallback, permission failures, WAV rates/final chunks, unchanged-byte submission and unchanged saturated-score export.
- npm run build: passed.
- python -m pytest backend/tests -q: 59 passed. FRONTEND_ORIGIN=http://localhost:5173 was overridden only for the existing CORS test; one existing Starlette/httpx deprecation warning.
- Real GPU original/encoded-file inference, crop checks and exact-embedding comparison passed. Health/readiness remained HTTP 200 after inference; the user's backend process was preserved.

These checks validate encoding, transport and runtime behavior. They do not prove improved live classifier accuracy.
