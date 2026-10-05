import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
type Props = {
  peaks?: number[];
  analyser: AnalyserNode | null;
  analyzing: boolean;
  dragging: boolean;
  phone: boolean;
  color: string;
  progress: number;
};
export default function SignalField({
  peaks,
  analyser,
  analyzing,
  dragging,
  phone,
  color,
  progress,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef(0.5);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    let frame = 0;
    let width = 0;
    let height = 0;
    const resize = () => {
      const box = el.getBoundingClientRect();
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
      ctx.clearRect(0, 0, width, height);
      const mid = height * 0.5;
      ctx.strokeStyle = "#282d26";
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
      ctx.strokeStyle = "#535b48";
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
      ctx.setLineDash([]);
      if (analyser) analyser.getByteTimeDomainData(live);
      ctx.strokeStyle = color;
      ctx.lineWidth = peaks || analyser ? 1.7 : 1;
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
        ctx.globalAlpha = peaks || analyser ? 0.88 : 0.55;
        ctx.beginPath();
        ctx.moveTo(x, mid - a);
        ctx.lineTo(x, mid + a);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const marker = analyzing ? (reduced ? 0.5 : (now / 3200) % 1) : progress;
      if (analyzing || progress > 0) {
        ctx.fillStyle = color;
        ctx.fillRect(marker * width, 0, 1.5, height);
        ctx.fillRect(marker * width - 3, 0, 7, 5);
      }
      if (!reduced || analyser) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [peaks, analyser, analyzing, dragging, phone, color, progress, reduced]);
  return (
    <canvas
      ref={canvas}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current = (e.clientX - r.left) / r.width;
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
  );
}
