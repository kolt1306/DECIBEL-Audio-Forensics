# DECIBEL — AI Voice Authenticity Forensics

> **A GPU-accelerated audio forensics system for investigating AI-generated and deepfake speech.**

DECIBEL turns a raw recording into an interactive forensic view: upload or record audio, inspect the real waveform, run Gemma 4–based inference, locate suspicious regions, compare standard vs phone-channel audio, and export the evidence as structured JSON.

Built for **Best Use of Gemma 4** and **Best Open-Source AI Project**.

---

## Why DECIBEL

Deepfake voice detection is usually presented as a single score. DECIBEL treats it as an **investigation workflow** instead.

- **Record or upload audio** directly in the browser
- **Analyze long recordings** using overlapping windows
- **Visualize segment-level risk** on the same timeline as the waveform
- **Jump to suspicious regions** and replay them
- **Compare standard and phone-call channels**
- **Inspect audio quality diagnostics** independently of authenticity
- **Run batch jobs** with async progress and cancellation
- **Export structured JSON reports** with timings, fingerprints, segment scores, regions and warnings

The interface is intentionally designed like a compact forensic instrument rather than a generic AI dashboard.

> **Important:** DECIBEL returns probabilistic model outputs. It does not provide definitive proof that a recording is real or fake, and false positives are possible.

---

## What makes this implementation different

The upstream TrueVoice workflow uses the Gemma 4 E4B audio tower together with a trained classifier head.

DECIBEL preserves that classifier pipeline while rebuilding the surrounding system for stable local GPU inference and a complete web experience.

### GPU-focused Gemma 4 runtime

Instead of loading and retaining the full multimodal Gemma 4 model, DECIBEL loads the audio model directly:

```text
audio
  ↓
Gemma4Processor
  ↓
Gemma4AudioModel
  ↓
last_hidden_state
  ↓
unmasked mean over time
  ↓
TrueVoice classifier head
  ↓
real / fake probabilities

```

### Live microphone capture

DECIBEL captures mono PCM with AudioWorklet and writes signed 16-bit WAV at the actual browser AudioContext sample rate. Generated WAVs decode without FFmpeg. Capture requires HTTPS or localhost and microphone permission. It requests echo cancellation, noise suppression and automatic gain control off where supported, checks actual track settings, and reports enabled/unverifiable processing separately from input quality and authenticity.

Open **Microphone capture settings** to inspect settings or save the exact WAV. JSON exports preserve probabilities and add browser capture metadata. Result headings describe **model suspicion**; even 100.0% is a model estimate, not proof.

The supplied known-real user recording remains a classifier false positive in reference-equivalent FP32 inference. No live DSP before/after improvement is claimed. See [microphone measurements and limitations](MICROPHONE_VERIFICATION.md) and [GPU runtime verification](GPU_VERIFICATION.md).

An opt-in scalar-only diagnostic tool is available:

```sh
python backend/scripts/diagnose_capture.py capture.wav reference.wav --api http://127.0.0.1:8000 --duration-crops > capture-diagnostics.json
```
