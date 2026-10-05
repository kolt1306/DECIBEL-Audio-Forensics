import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { reveal } from "../lib/motion";
import type { Segment } from "../lib/api";
import { time } from "../lib/audio";
export default function SegmentTimeline({
  segments,
  duration,
  onSeek,
}: {
  segments: Segment[];
  duration: number;
  onSeek: (start: number, end: number) => void;
}) {
  const [hovered, setHovered] = useState<Segment | null>(null);
  const reduced = useReducedMotion();
  const analyzed = segments.filter((s) => s.fake_probability !== null);
  const peak = analyzed.reduce<Segment | null>(
    (best, s) =>
      !best || s.fake_probability! > best.fake_probability! ? s : best,
    null,
  );
  const x = (s: Segment) =>
    ((s.start_seconds + s.end_seconds) / 2 / duration) * 1000;
  const y = (s: Segment) => 64 - (s.fake_probability || 0) * 48;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : reveal}
      className="segment-timeline"
      aria-label="Segment risk timeline. Overlapping model windows; not frame-level evidence."
    >
      <div className="risk-trace-heading">
        <span>02 / SEGMENT RISK</span>
        <span>
          {peak
            ? `PEAK ${(peak.fake_probability! * 100).toFixed(1)}%`
            : "NO ANALYZED WINDOWS"}
        </span>
      </div>
      <div className="risk-plot">
        <svg
          viewBox="0 0 1000 80"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[0.4, 0.7].map((p) => (
            <line
              key={p}
              x1="0"
              x2="1000"
              y1={64 - p * 48}
              y2={64 - p * 48}
              className="risk-guide"
            />
          ))}
          {analyzed.map((s) => (
            <g key={s.index} className={`trace-window ${s.risk}`}>
              <motion.path
                d={`M ${(s.start_seconds / duration) * 1000} ${y(s)} H ${(s.end_seconds / duration) * 1000}`}
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={reveal}
              />
              <circle cx={x(s)} cy={y(s)} r={s === peak ? 3 : 1.5} />
              {s === peak && (
                <line
                  x1={x(s)}
                  x2={x(s)}
                  y1={y(s) + 6}
                  y2="77"
                  className="peak-guide"
                />
              )}
            </g>
          ))}
        </svg>
        <div className="segment-bands">
          {[...segments]
            .sort(
              (a, b) => (a.fake_probability || 0) - (b.fake_probability || 0),
            )
            .map((s) => (
              <button
                key={s.index}
                className={`segment-band ${s.risk || "skipped"} ${hovered?.index === s.index ? "selected" : ""}`}
                style={
                  {
                    left: `${(s.start_seconds / duration) * 100}%`,
                    width: `${((s.end_seconds - s.start_seconds) / duration) * 100}%`,
                    "--intensity": s.fake_probability ?? 0,
                  } as React.CSSProperties
                }
                aria-label={`Segment ${s.index + 1}: ${time(s.start_seconds)} to ${time(s.end_seconds)}, ${s.status === "skipped" ? "not analyzed, silent" : `${s.risk} risk, ${((s.fake_probability || 0) * 100).toFixed(1)} percent deepfake probability`}. Seek to segment.`}
                onFocus={() => setHovered(s)}
                onBlur={() => setHovered(null)}
                onMouseEnter={() => setHovered(s)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSeek(s.start_seconds, s.end_seconds)}
              />
            ))}
        </div>
      </div>
      <div className="timeline-caption" role="status">
        {hovered
          ? `${time(hovered.start_seconds)}—${time(hovered.end_seconds)} / ${hovered.status === "skipped" ? "SILENT · NOT ANALYZED" : `${((hovered.fake_probability || 0) * 100).toFixed(1)}% · ${hovered.risk?.toUpperCase()} RISK`}`
          : "OVERLAPPING MODEL WINDOWS · SELECT TO SEEK"}
      </div>
    </motion.div>
  );
}
