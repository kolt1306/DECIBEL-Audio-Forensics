import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { time } from "../lib/audio";
type Props = {
  peaks?: number[];
  analyser: AnalyserNode | null;
  analyzing: boolean;
  dragging: boolean;
  phone: boolean;
  color: string;
  progress: number;
  duration?: number;
  onSeek?: (seconds: number) => void;
};
export default function SignalField({
  peaks,
  analyser,
  analyzing,
  dragging,
  phone,
  color,
  progress,
  duration = 0,
  onSeek,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef(0.5);
  const bounds = useRef<DOMRect | null>(null);
  const probe = useRef<HTMLDivElement>(null);
  const hoverFrame = useRef(0);
  const reduced = useReducedMotion();
  useEffect(() => () => cancelAnimationFrame(hoverFrame.current), []);
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    const resize = () => {
      const box = el.getBoundingClientRect();
      bounds.current = box;
      width = box.width;
      height = box.height;
      const dpr = Math.min(devicePixelRatio, 2);
      el.width = width * dpr;
      el.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const live = new Uint8Array(analyser?.fftSize || 2048);
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden || width <= 0 || height <= 0) return;
      ctx.clearRect(0, 0, width, height);
      const mid = height * 0.5;
      ctx.strokeStyle = "#232e38";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += width / 12) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += height / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "#435664";
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
      ctx.setLineDash([]);
      if (analyser) analyser.getByteTimeDomainData(live);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const count = Math.floor(width / 3);
      for (let i = 0; i < count; i++) {
        const x = (i / count) * width;
        const p = i / count;
        let amplitude: number;
        if (analyser)
          amplitude = Math.abs(live[Math.floor(p * live.length)] - 128) / 128;
        else if (peaks)
          amplitude =
            peaks[Math.min(peaks.length - 1, Math.floor(p * peaks.length))];
        else {
          // Idle reference pattern; explicitly labeled, never presented as captured audio.
          const t = reduced ? 0 : now / 4000;
          const envelope =
            Math.exp(-Math.pow((p - 0.29) * 9, 2)) +
            0.7 * Math.exp(-Math.pow((p - 0.68) * 12, 2));
          amplitude =
            (0.035 + envelope * 0.33) *
            (0.25 +
              0.75 * Math.abs(Math.sin(i * 1.17 + t) * Math.cos(i * 0.23)));
          amplitude *=
            1 +
            (dragging ? 0.25 : 0.04) *
              Math.exp(-Math.pow((p - pointer.current) * 10, 2));
        }
        const a = Math.max(
          1,
          Math.min(1, amplitude) *
            height *
            0.42 *
            (phone && !peaks && !analyser ? 0.85 : 1),
        );
        ctx.globalAlpha = peaks || analyser ? 0.85 : 0.4;
        ctx.beginPath();
        ctx.moveTo(x, mid - a);
        ctx.lineTo(x, mid + a);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const marker = reduced ? 0.5 : (now / 3200) % 1;
      if (analyzing) {
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = color;
        ctx.fillRect(Math.max(0, marker * width - 45), 0, 45, height);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillRect(marker * width, 0, 1.5, height);
        ctx.fillRect(marker * width - 3, 0, 7, 5);
      }
      // Loaded audio stays static; its playback marker moves independently in CSS.
      if (analyser || (!reduced && (analyzing || !peaks)))
        frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", visibility);
    resize();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(frame);
    };
  }, [peaks, analyser, analyzing, dragging, phone, color, reduced]);
  return (
    <>
      <canvas
        ref={canvas}
        className={peaks ? "seekable-waveform" : ""}
        onClick={(e) => {
          if (!peaks || analyzing || !onSeek) return;
          const box = e.currentTarget.getBoundingClientRect();
          onSeek(
            Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) *
              duration,
          );
        }}
        onPointerMove={(e) => {
          const r = bounds.current;
          if (!r || !r.width) return;
          pointer.current = Math.max(
            0,
            Math.min(1, (e.clientX - r.left) / r.width),
          );
          if (peaks && !analyzing && !hoverFrame.current) {
            hoverFrame.current = requestAnimationFrame(() => {
              hoverFrame.current = 0;
              if (!probe.current) return;
              probe.current.style.transform = `translateX(${pointer.current * r.width}px)`;
              probe.current.style.opacity = "1";
              const label = probe.current.firstElementChild as HTMLElement;
              label.textContent = time(pointer.current * duration);
              label.style.left = pointer.current > 0.85 ? "auto" : "8px";
              label.style.right = pointer.current > 0.85 ? "8px" : "auto";
            });
          }
        }}
        onPointerLeave={() => {
          cancelAnimationFrame(hoverFrame.current);
          hoverFrame.current = 0;
          if (probe.current) probe.current.style.opacity = "0";
        }}
        aria-label={
          analyser
            ? "Live microphone amplitude"
            : peaks
              ? "Waveform of your complete recording"
              : "Illustrative idle signal pattern"
        }
        role="img"
      />
      {peaks && (
        <div ref={probe} className="waveform-probe" aria-hidden="true">
          <span />
        </div>
      )}
      {peaks && !analyzing && progress > 0 && (
        <div className="waveform-guides" aria-hidden="true">
          <div
            className="waveform-playhead"
            style={{ transform: `translateX(${progress * 100}%)` }}
          />
        </div>
      )}
    </>
  );
}
