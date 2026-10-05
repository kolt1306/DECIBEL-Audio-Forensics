import numpy as np
from .schemas import QualityDiagnostics


def quality_warnings(rms, silence, clipping, usable, sample_rate):
    warnings = []
    if rms < .005:
        warnings.append('VERY_LOW_SIGNAL')
    if silence > .6:
        warnings.append('HIGH_SILENCE_RATIO')
    if clipping > .01:
        warnings.append('AUDIO_HEAVILY_CLIPPED')
    if usable < 1.5:
        warnings.append('VERY_SHORT_USABLE_SPEECH')
    if sample_rate < 8000 or sample_rate > 96000:
        warnings.append('UNUSUAL_SAMPLE_RATE')
    poor = silence > .9 or clipping > .1 or usable < 1.5
    return warnings, 'poor' if poor else 'usable' if warnings else 'good'


def diagnose(samples, original_sr, channels, sr=16000):
    audio = samples.astype(np.float64)
    abs_audio = np.abs(audio)
    rms = float(np.sqrt(np.mean(audio ** 2)))
    # 20ms RMS frames, conservative threshold; these are signal-energy heuristics, not VAD.
    frame_size = round(sr * .02)
    starts = np.arange(0, len(audio), frame_size)
    energy = np.sqrt(np.add.reduceat(audio ** 2, starts) / np.minimum(frame_size, len(audio) - starts))
    lengths = np.minimum(frame_size, len(audio) - starts)
    silent = energy < .001
    silence = float(lengths[silent].sum() / len(audio))
    usable = float(lengths[~silent].sum() / sr)
    clipping = float(np.mean(abs_audio >= .999))
    q10, q90 = np.percentile(energy, [10, 90])
    dynamic = float(20 * np.log10(max(q90, 1e-10) / max(q10, 1e-10)))
    # Evenly sampled 2048-point FFT frames bound diagnostics for long inputs.
    nfft = 2048
    fft_starts = np.linspace(0, max(0, len(audio) - nfft), min(256, max(1, len(audio) // nfft))).astype(int)
    windows = np.stack([np.pad(audio[i:i+nfft], (0, max(0, nfft - len(audio[i:i+nfft])))) for i in fft_starts])
    spectrum = np.abs(np.fft.rfft(windows * np.hanning(nfft), axis=1))
    frequencies = np.fft.rfftfreq(nfft, 1 / sr)
    denominator = np.maximum(spectrum.sum(axis=1), 1e-12)
    centroids = (spectrum * frequencies).sum(axis=1) / denominator
    bandwidth = np.sqrt((spectrum * (frequencies[None, :] - centroids[:, None]) ** 2).sum(axis=1) / denominator)
    warnings, quality = quality_warnings(rms, silence, clipping, usable, original_sr)
    return QualityDiagnostics(duration_seconds=len(audio)/sr, original_sample_rate=original_sr,
        channels=channels, rms=rms, peak_amplitude=float(abs_audio.max()), silence_ratio=silence,
        clipping_ratio=clipping, dc_offset=float(audio.mean()), dynamic_range_db=dynamic,
        zero_crossing_rate=float(np.mean(np.signbit(audio[1:]) != np.signbit(audio[:-1]))),
        spectral_centroid_hz=float(centroids.mean()), spectral_bandwidth_hz=float(bandwidth.mean()),
        usable_signal_seconds=usable, quality=quality, warnings=warnings)
