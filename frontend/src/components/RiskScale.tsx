import { motion } from "motion/react";
export default function RiskScale({ probability }: { probability: number }) {
  return (
    <div
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
          initial={{ left: "0%" }}
          animate={{ left: `${probability * 100}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
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
