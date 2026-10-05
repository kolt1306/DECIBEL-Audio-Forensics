import { useState } from "react";
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
  return (
    <div
      className="segment-timeline"
      aria-label="Segment risk timeline. Overlapping model windows; not frame-level evidence."
    >
      <div className="segment-bands">
        {[...segments]
          .sort((a, b) => (a.fake_probability || 0) - (b.fake_probability || 0))
          .map((s) => (
            <button
              key={s.index}
              className={`segment-band ${s.risk || "skipped"}`}
              style={{
                left: `${(s.start_seconds / duration) * 100}%`,
                width: `${((s.end_seconds - s.start_seconds) / duration) * 100}%`,
              }}
              aria-label={`Segment ${s.index + 1}: ${time(s.start_seconds)} to ${time(s.end_seconds)}, ${s.status === "skipped" ? "not analyzed, silent" : `${s.risk} risk, ${((s.fake_probability || 0) * 100).toFixed(1)} percent deepfake probability`}. Seek to segment.`}
              onFocus={() => setHovered(s)}
              onBlur={() => setHovered(null)}
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSeek(s.start_seconds, s.end_seconds)}
            />
          ))}
      </div>
      <div className="timeline-caption">
        {hovered
          ? `${time(hovered.start_seconds)}—${time(hovered.end_seconds)} / ${hovered.status === "skipped" ? "SILENT · NOT ANALYZED" : `${((hovered.fake_probability || 0) * 100).toFixed(1)}% · ${hovered.risk?.toUpperCase()} RISK`}`
          : "SEGMENT RISK / OVERLAPPING WINDOWS · CLICK TO SEEK"}
      </div>
    </div>
  );
}
