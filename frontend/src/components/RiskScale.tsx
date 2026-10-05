import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { reveal } from "../lib/motion";
export default function RiskScale({ probability }: { probability: number }) {
  const reduced = useReducedMotion();
  const scale = useRef<HTMLDivElement>(null);
  const visible = useInView(scale, { once: true });
  return (
    <div
      ref={scale}
      className="risk-scale"
      aria-label={`Deepfake probability ${(probability * 100).toFixed(1)} percent. Low below 40, medium from 40, high from 70.`}
    >
      <div className="ruler">
        <div className="zone low" />
        <div className="zone medium" />
        <div className="zone high" />
        {Array.from({ length: 21 }, (_, i) => (
          <i
            key={i}
            style={{ left: `${i * 5}%` }}
            className={i % 2 === 0 ? "major" : ""}
          />
        ))}
        <motion.div
          className="risk-marker"
          initial={{ left: reduced ? `${probability * 100}%` : "0%" }}
          animate={{
            left: visible || reduced ? `${probability * 100}%` : "0%",
          }}
          transition={{ ...reveal, duration: reduced ? 0 : 0.8 }}
        >
          <span>▼</span>
        </motion.div>
      </div>
      <div className="scale-numbers">
        <span>0</span>
        <span style={{ left: "40%" }}>40</span>
        <span style={{ left: "70%" }}>70</span>
        <span>100</span>
      </div>
      <div className="scale-zones">
        <span>LOW RISK</span>
        <span>CAUTION</span>
        <span>HIGH RISK</span>
      </div>
    </div>
  );
}
