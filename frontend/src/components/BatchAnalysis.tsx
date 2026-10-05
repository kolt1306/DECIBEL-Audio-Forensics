import { useEffect, useRef, useState } from "react";
import {
  cancelJob,
  jobFailure,
  readJob,
  submitBatch,
  waitForPoll,
  type Analysis,
  type Comparison,
  type Job,
} from "../lib/api";
export default function BatchAnalysis({
  files,
  phone,
  compare,
  disabled,
  onOpen,
  onClose,
}: {
  files: File[];
  phone: boolean;
  compare: boolean;
  disabled: boolean;
  onOpen: (file: File, result: Analysis | Comparison) => void;
  onClose: () => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const active = useRef<Job[]>([]);
  useEffect(
    () => () => {
      controller.current?.abort();
      active.current
        .filter((j) => ["queued", "processing"].includes(j.state))
        .forEach((j) => {
          void cancelJob(j.job_id).catch(() => {});
        });
    },
    [],
  );
  const start = async () => {
    if (running || disabled) return;
    setRunning(true);
    setError("");
    const c = new AbortController();
    controller.current = c;
    try {
      let next = await submitBatch(files, phone, compare, c.signal);
      active.current = next;
      setJobs(next);
      while (next.some((j) => ["queued", "processing"].includes(j.state))) {
        await waitForPoll(c.signal);
        next = await Promise.all(
          next.map((j) =>
            ["queued", "processing"].includes(j.state)
              ? readJob(j.job_id, c.signal)
              : j,
          ),
        );
        active.current = next;
        setJobs(next);
      }
    } catch (e) {
      active.current
        .filter((j) => ["queued", "processing"].includes(j.state))
        .forEach((j) => {
          void cancelJob(j.job_id).catch(() => {});
        });
      if (!c.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Batch analysis interrupted; cancellation requested.",
        );
    } finally {
      if (!c.signal.aborted) setRunning(false);
    }
  };
  return (
    <section className="batch-analysis" aria-label="Batch analysis">
      <div className="section-label">
        BATCH / {files.length} RECORDINGS{" "}
        <button disabled={running} onClick={onClose}>
          CLOSE
        </button>
      </div>
      <p className="quiet-copy">
        Each file receives an independent analysis. Shared GPU work is queued
        safely.
      </p>
      {files.map((file, i) => {
        const job = jobs[i];
        return (
          <div key={`${file.name}-${i}`} className="batch-row">
            <span title={file.name}>{file.name}</span>
            <span>
              {job
                ? `${job.state.toUpperCase()}${job.segments_total ? ` · ${job.segments_completed}/${job.segments_total}` : ""}`
                : "READY"}
            </span>
            {job?.state === "completed" && job.result && (
              <button
                disabled={disabled}
                onClick={() => onOpen(file, job.result!)}
              >
                OPEN RESULT ↗
              </button>
            )}
            {job && ["queued", "processing"].includes(job.state) && (
              <button
                onClick={() => {
                  void cancelJob(job.job_id).catch(() =>
                    setError(
                      "Cannot cancel this job. Check the backend connection.",
                    ),
                  );
                }}
              >
                CANCEL
              </button>
            )}
            {job?.state === "failed" && <small>{jobFailure(job)}</small>}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="batch-error">
          {error}
        </p>
      )}
      <button
        className="upload-button"
        disabled={running || disabled}
        onClick={() => {
          void start();
        }}
      >
        {running
          ? "BATCH IN PROGRESS"
          : jobs.length
            ? "RUN BATCH AGAIN"
            : "ANALYZE BATCH"}
      </button>
    </section>
  );
}
