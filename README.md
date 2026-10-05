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
