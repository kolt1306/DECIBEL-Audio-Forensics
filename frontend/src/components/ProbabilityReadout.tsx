import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { reveal } from "../lib/motion";

export default function ProbabilityReadout({ value }: { value: number }) {
  const output = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const visible = useInView(output, { once: true });
  useEffect(() => {
    if (reduced) {
      output.current!.textContent = value.toFixed(1);
      return;
    }
    if (!visible) return;
    const animation = animate(0, value, {
      ...reveal,
      duration: 0.85,
      onUpdate: (v) => {
        if (output.current) output.current.textContent = v.toFixed(1);
      },
    });
    return () => animation.stop();
  }, [value, reduced, visible]);
  return (
    <strong aria-label={`${value.toFixed(1)} percent`}>
      <span ref={output} aria-hidden="true">
        {value.toFixed(1)}
      </span>
      <small aria-hidden="true">%</small>
    </strong>
  );
}
