import { useEffect, useRef } from "react";

/** Sparse frequency contours, decorative and deliberately outside the data plot. */
export default function SignalAtmosphere() {
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const visibility = () =>
      field.current?.classList.toggle("paused", document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  return (
    <div ref={field} className="signal-atmosphere" aria-hidden="true">
      <svg viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 9 }, (_, i) => (
          <path
            key={i}
            style={{ animationDelay: `${i * -1.8}s` }}
            d={`M -100 ${280 + i * 24} C 240 ${280 + i * 24}, 330 ${70 + i * 38}, 570 ${170 + i * 30} S 870 ${510 - i * 18}, 1100 ${340 + i * 17} S 1400 ${160 + i * 24}, 1540 ${260 + i * 20}`}
          />
        ))}
        <path
          className="field-pulse"
          d="M -100 440 C 380 440, 380 160, 640 260 S 1080 530, 1540 350"
        />
      </svg>
    </div>
  );
}
