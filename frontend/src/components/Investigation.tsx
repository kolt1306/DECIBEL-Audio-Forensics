import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { disclose, reveal } from "../lib/motion";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  Play,
} from "lucide-react";
import { time } from "../lib/audio";
import type { Analysis, Comparison } from "../lib/api";
type Props = {
  result: Analysis;
  comparison: Comparison | null;
  onMode: (result: Analysis) => void;
  onRegion: (start: number, end: number, play?: boolean) => void;
  onError: (message: string) => void;
};
const warnings: Record<string, string> = {
  VERY_LOW_SIGNAL: "Low signal level",
  HIGH_SILENCE_RATIO: "High silence ratio",
  AUDIO_HEAVILY_CLIPPED: "Possible heavy clipping",
  VERY_SHORT_USABLE_SPEECH: "Very little usable signal",
  UNUSUAL_SAMPLE_RATE: "Unusual sample rate",
};
export default function Investigation({
  result,
  comparison,
  onMode,
  onRegion,
  onError,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [technical, setTechnical] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);
  const exportJSON = () => {
    const report = comparison
      ? { product: "DECIBEL", ...comparison, disclaimer: result.disclaimer }
      : { product: "DECIBEL", ...result };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `DECIBEL-${result.analysis_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(
        `DECIBEL Analysis\nVerdict: ${result.verdict.replaceAll("_", " ")}\nOverall (peak segment) deepfake probability: ${result.fake_percentage.toFixed(1)}%\nPeak segment: ${time(result.peak_segment_start)}–${time(result.peak_segment_end)}\nInput quality: ${result.quality.quality}\nAnalysis ID: ${result.analysis_id}\n${result.disclaimer}`,
      );
      setCopied(true);
    } catch {
      onError("Cannot access the clipboard. Export the JSON report instead.");
    }
  };
  return (
    <motion.section
      className="investigation"
      aria-label="Audio investigation details"
      initial={reduced ? false : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={reduced ? { duration: 0 } : reveal}
    >
      <div className="investigation-top">
        <span className="eyebrow">03 / SIGNAL INVESTIGATION</span>
        <div>
          <button
            className={copied ? "copied" : ""}
            aria-live="polite"
            onClick={() => {
              void copySummary();
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy summary"}
          </button>
          <button onClick={exportJSON}>
            <Download size={13} />
            Export JSON
          </button>
        </div>
      </div>
      <div className="investigation-grid">
        <div className="region-section">
          <div className="section-label">
            SUSPICIOUS REGIONS <span>SEGMENT-DERIVED</span>
          </div>
          {result.suspicious_regions.length ? (
            result.suspicious_regions.map((r, i) => (
              <div key={i} className={`region-row ${r.risk}`}>
                <button
                  className="region-time"
                  onClick={() => onRegion(r.start_seconds, r.end_seconds)}
                >
                  {time(r.start_seconds)}
                  <span>—</span>
                  {time(r.end_seconds)}
                  <ArrowUpRight size={13} />
                </button>
                <span className="region-prob">
                  {(r.peak_fake_probability * 100).toFixed(1)}%
                  <small>PEAK</small>
                </span>
                <button
                  className="region-play"
                  onClick={() => onRegion(r.start_seconds, r.end_seconds, true)}
                >
                  <Play size={12} />
                  Play region
                </button>
              </div>
            ))
          ) : (
            <p className="quiet-copy">
              No medium or high-risk segments detected.
            </p>
          )}
          <button
            className="jump-peak"
            onClick={() =>
              onRegion(result.peak_segment_start, result.peak_segment_end, true)
            }
          >
            Listen to peak segment <ArrowUpRight size={13} />
          </button>
          <p className="quiet-copy region-caveat">
            Regions combine adjacent overlapping predictions. Boundaries are
            approximate; no frame-level detection is claimed.
          </p>
        </div>
        <div className="quality-section">
          <div className="section-label">
            INPUT QUALITY <span>{result.quality.quality.toUpperCase()}</span>
          </div>
          <p className="quality-purpose">
            Recording suitability, separate from authenticity.
          </p>
          {result.quality.warnings.length ? (
            <ul className="quality-warnings">
              {result.quality.warnings.map((w) => (
                <li key={w}>{warnings[w] || w.replaceAll("_", " ")}</li>
              ))}
            </ul>
          ) : (
            <p className="quiet-copy">No input-quality warnings.</p>
          )}
          <div className="quality-metrics">
            <span>
              RMS <b>{result.quality.rms.toFixed(4)}</b>
            </span>
            <span>
              SILENCE <b>{(result.quality.silence_ratio * 100).toFixed(1)}%</b>
            </span>
            <span>
              CLIPPING{" "}
              <b>{(result.quality.clipping_ratio * 100).toFixed(2)}%</b>
            </span>
          </div>
        </div>
      </div>
      <div className="statistics-row">
        <span>
          SEGMENT MEAN <b>{(result.statistics.mean * 100).toFixed(1)}%</b>
        </span>
        <span>
          MEDIAN <b>{(result.statistics.median * 100).toFixed(1)}%</b>
        </span>
        <span>
          MIN / MAX{" "}
          <b>
            {(result.statistics.minimum * 100).toFixed(1)} /{" "}
            {(result.statistics.maximum * 100).toFixed(1)}%
          </b>
        </span>
        <span>
          STD. DEVIATION{" "}
          <b>{(result.statistics.standard_deviation * 100).toFixed(1)} pp</b>
        </span>
      </div>
      <div className="distribution">
        <span>ANALYZED TIME</span>
        <div>
          {(["low", "medium", "high"] as const).map((r) => (
            <span
              key={r}
              className={r}
              style={{ width: `${result.timeline_distribution[r] * 100}%` }}
            />
          ))}
        </div>
        <p>
          {(["low", "medium", "high"] as const).map((r) => (
            <span key={r}>
              {r.toUpperCase()}{" "}
              {(result.timeline_distribution[r] * 100).toFixed(1)}%
            </span>
          ))}
        </p>
      </div>
      {result.unanalyzed_seconds > 0.01 && (
        <p className="quiet-copy">
          {result.unanalyzed_seconds.toFixed(2)} seconds have no usable segment
          prediction and are excluded from the risk distribution.
        </p>
      )}
      {comparison && (
        <div className="comparison">
          <div className="section-label">
            CHANNEL COMPARISON <span>OUTPUT DIFFERENCE, NOT ACCURACY</span>
          </div>
          <div className="comparison-options">
            <button
              aria-pressed={!result.phone_mode}
              onClick={() => onMode(comparison.standard)}
            >
              STANDARD{" "}
              <strong>{comparison.standard.fake_percentage.toFixed(1)}%</strong>
            </button>
            <button
              aria-pressed={result.phone_mode}
              onClick={() => onMode(comparison.phone)}
            >
              PHONE SIMULATION{" "}
              <strong>{comparison.phone.fake_percentage.toFixed(1)}%</strong>
            </button>
            <span>
              {comparison.difference_percentage_points >= 0 ? "+" : ""}
              {comparison.difference_percentage_points.toFixed(1)}
              <small> PERCENTAGE POINTS</small>
            </span>
          </div>
        </div>
      )}
      <section className="technical-details">
        <button
          className="technical-toggle"
          aria-expanded={technical}
          aria-controls="technical-report"
          onClick={() => setTechnical((v) => !v)}
        >
          <ChevronDown size={14} />
          Technical analysis{" "}
          <span>
            {result.segments.filter((s) => s.status === "analyzed").length} /{" "}
            {result.segments.length} SEGMENTS
          </span>
        </button>
        <AnimatePresence initial={false}>
          {technical && (
            <motion.div
              id="technical-report"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={reduced ? { duration: 0 } : disclose}
              style={{ overflow: "hidden" }}
            >
              <dl>
                <dt>Analysis ID</dt>
                <dd>{result.analysis_id}</dd>
                <dt>Timestamp</dt>
                <dd>{result.metadata.timestamp}</dd>
                <dt>Model</dt>
                <dd>{result.metadata.model_id}</dd>
                <dt>Model fingerprint</dt>
                <dd>{result.metadata.model_fingerprint}</dd>
                <dt>Classifier SHA-256</dt>
                <dd>{result.metadata.classifier_sha256}</dd>
                <dt>Input</dt>
                <dd>
                  {result.quality.original_sample_rate} Hz /{" "}
                  {result.quality.channels} channels →{" "}
                  {result.metadata.sample_rate} Hz mono
                </dd>
                <dt>Windows / overlap</dt>
                <dd>
                  {result.metadata.segment_duration_seconds}s /{" "}
                  {result.metadata.segment_overlap_seconds}s
                </dd>
                <dt>Precision / channel</dt>
                <dd>
                  {result.metadata.runtime_precision} /{" "}
                  {result.phone_mode ? "16 → 8 → 16 kHz" : "standard"}
                </dd>
                <dt>Aggregation</dt>
                <dd>
                  Maximum segment probability; an application-level summary, not
                  a new trained confidence.
                </dd>
                <dt>Decode / preprocessing</dt>
                <dd>
                  {result.timings.decode_ms.toFixed(1)} /{" "}
                  {result.timings.preprocessing_ms.toFixed(1)} ms
                </dd>
                <dt>Inference / total</dt>
                <dd>
                  {result.timings.inference_ms.toFixed(1)} /{" "}
                  {result.timings.total_ms.toFixed(1)} ms
                </dd>
                <dt>DC offset / dynamic range</dt>
                <dd>
                  {result.quality.dc_offset.toFixed(5)} /{" "}
                  {result.quality.dynamic_range_db.toFixed(1)} dB
                </dd>
                <dt>Zero crossing / spectral centroid</dt>
                <dd>
                  {result.quality.zero_crossing_rate.toFixed(4)} /{" "}
                  {result.quality.spectral_centroid_hz.toFixed(1)} Hz
                </dd>
                <dt>Spectral bandwidth</dt>
                <dd>{result.quality.spectral_bandwidth_hz.toFixed(1)} Hz</dd>
                <dt>Signal-energy estimate</dt>
                <dd>
                  {result.quality.usable_signal_seconds.toFixed(2)}s (energy
                  heuristic, not speech recognition)
                </dd>
              </dl>
              <div
                className="segment-table"
                role="region"
                aria-label="Segment predictions"
              >
                <table>
                  <thead>
                    <tr>
                      <th>SEGMENT</th>
                      <th>TIME RANGE</th>
                      <th>FAKE PROB.</th>
                      <th>RISK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.segments.map((s) => (
                      <tr key={s.index}>
                        <td>{String(s.index + 1).padStart(2, "0")}</td>
                        <td>
                          <button
                            onClick={() =>
                              onRegion(s.start_seconds, s.end_seconds)
                            }
                          >
                            {time(s.start_seconds)}—{time(s.end_seconds)}
                          </button>
                        </td>
                        <td>
                          {s.fake_probability === null
                            ? "—"
                            : `${(s.fake_probability * 100).toFixed(1)}%`}
                        </td>
                        <td>
                          {s.status === "skipped"
                            ? "SKIPPED / SILENT"
                            : s.risk?.toUpperCase()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
      <p className="report-disclaimer">{result.disclaimer}</p>
    </motion.section>
  );
}
