export type Risk = "low" | "medium" | "high";
export type Segment = {
  index: number;
  start_seconds: number;
  end_seconds: number;
  status: "analyzed" | "skipped";
  real_probability: number | null;
  fake_probability: number | null;
  risk: Risk | null;
  reason: string | null;
};
export type Region = {
  start_seconds: number;
  end_seconds: number;
  risk: "medium" | "high";
  peak_fake_probability: number;
};
export type Analysis = {
  verdict: "real" | "possible_deepfake" | "deepfake";
  risk: Risk;
  real_probability: number;
  fake_probability: number;
  fake_percentage: number;
  duration_seconds: number;
  phone_mode: boolean;
  analysis_id: string;
  segments: Segment[];
  suspicious_regions: Region[];
  peak_fake_probability: number;
  peak_segment_start: number;
  peak_segment_end: number;
  statistics: {
    mean: number;
    median: number;
    maximum: number;
    minimum: number;
    standard_deviation: number;
  };
  timeline_distribution: Record<Risk, number>;
  analyzed_seconds: number;
  unanalyzed_seconds: number;
  quality: {
    quality: "good" | "usable" | "poor";
    warnings: string[];
    duration_seconds: number;
    original_sample_rate: number;
    channels: number;
    rms: number;
    peak_amplitude: number;
    silence_ratio: number;
    clipping_ratio: number;
    dc_offset: number;
    dynamic_range_db: number;
    zero_crossing_rate: number;
    spectral_centroid_hz: number;
    spectral_bandwidth_hz: number;
    usable_signal_seconds: number;
  };
  metadata: {
    timestamp: string;
    model_id: string;
    model_fingerprint: string;
    classifier_sha256: string;
    sample_rate: number;
    segment_duration_seconds: number;
    segment_overlap_seconds: number;
    runtime_precision: string;
    aggregation: string;
  };
  timings: {
    decode_ms: number;
    preprocessing_ms: number;
    inference_ms: number;
    total_ms: number;
  };
  disclaimer: string;
};
export type Comparison = {
  standard: Analysis;
  phone: Analysis;
  difference_percentage_points: number;
};
export type Job = {
  job_id: string;
  state: "queued" | "processing" | "completed" | "failed" | "cancelled";
  segments_completed: number;
  segments_total: number;
  progress: number;
  created_at: string;
  result: Analysis | Comparison | null;
  error: { code: string; message: string } | null;
};
export type Health = {
  status: string;
  model_loaded: boolean;
  diagnostic?: string;
};
const BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"
).replace(/\/$/, "");
const errorMessages: Record<string, string> = {
  NO_AUDIO: "Choose a nonempty recording.",
  AUDIO_TOO_SHORT: "Record at least 1.5 seconds of usable signal.",
  AUDIO_SILENT:
    "No usable signal was detected. Choose audio with audible speech.",
  AUDIO_TOO_LARGE: "The recording exceeds the server upload limit.",
  REQUEST_TOO_LARGE: "The upload exceeds the server request limit.",
  AUDIO_TOO_LONG: "The recording exceeds the server duration limit.",
  INVALID_AUDIO: "This recording contains invalid audio.",
  UNSUPPORTED_AUDIO:
    "Cannot decode this format. Try WAV, MP3 or FLAC; browser recordings require FFmpeg on the server.",
  MODEL_NOT_READY:
    "The model is unavailable. Check the backend readiness diagnostic.",
  INFERENCE_FAILED:
    "Model inference failed. Retry or inspect the backend setup.",
  QUEUE_FULL: "The analysis queue is full. Try again shortly.",
  JOB_NOT_FOUND: "This analysis expired. Submit the recording again.",
  INSTRUMENT_BUSY: "The instrument is busy. Try again shortly.",
};
async function request(
  path: string,
  init: RequestInit = {},
  timeout = 20000,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The server returned an unreadable response. Check the API configuration.",
      );
    }
    if (!response.ok) {
      const code = (data as { error?: { code?: string } })?.error?.code;
      throw new Error(
        (code && errorMessages[code]) ||
          "The server could not process this request.",
      );
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "The request timed out or was interrupted. Please retry.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Cannot reach the backend. Start the API and check its configured address.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
const probability = (p: unknown): p is number =>
  typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;
const number = (p: unknown): p is number =>
  typeof p === "number" && Number.isFinite(p);
export function validateAnalysis(value: unknown): Analysis {
  const data = value as Analysis;
  if (
    !data ||
    !["real", "possible_deepfake", "deepfake"].includes(data.verdict) ||
    !["low", "medium", "high"].includes(data.risk) ||
    !probability(data.real_probability) ||
    !probability(data.fake_probability) ||
    Math.abs(data.real_probability + data.fake_probability - 1) > 0.0001 ||
    !number(data.fake_percentage) ||
    Math.abs(data.fake_percentage - data.fake_probability * 100) > 0.001 ||
    !number(data.duration_seconds) ||
    data.duration_seconds < 1.5 ||
    typeof data.phone_mode !== "boolean" ||
    typeof data.analysis_id !== "string" ||
    !Array.isArray(data.segments) ||
    !data.segments.length ||
    !Array.isArray(data.suspicious_regions) ||
    !data.metadata ||
    typeof data.metadata.model_fingerprint !== "string" ||
    !data.quality ||
    !Array.isArray(data.quality.warnings) ||
    !data.statistics ||
    !data.timings ||
    !data.timeline_distribution
  )
    throw new Error("The server returned an invalid analysis.");
  const expected =
    data.fake_probability >= 0.7
      ? ["deepfake", "high"]
      : data.fake_probability >= 0.4
        ? ["possible_deepfake", "medium"]
        : ["real", "low"];
  if (
    data.verdict !== expected[0] ||
    data.risk !== expected[1] ||
    !probability(data.peak_fake_probability) ||
    ![
      data.peak_segment_start,
      data.peak_segment_end,
      data.analyzed_seconds,
      data.unanalyzed_seconds,
    ].every(number) ||
    !Object.values(data.statistics).every(number) ||
    !Object.values(data.timings).every(number) ||
    !["good", "usable", "poor"].includes(data.quality.quality)
  )
    throw new Error("The server returned inconsistent analysis values.");
  for (const s of data.segments) {
    if (
      !number(s.start_seconds) ||
      !number(s.end_seconds) ||
      s.start_seconds < 0 ||
      s.end_seconds <= s.start_seconds ||
      s.end_seconds > data.duration_seconds + 0.01 ||
      !["analyzed", "skipped"].includes(s.status)
    )
      throw new Error("Invalid segment timeline.");
    if (
      s.status === "analyzed" &&
      (!probability(s.fake_probability) ||
        !probability(s.real_probability) ||
        Math.abs(s.fake_probability + s.real_probability - 1) > 0.0001 ||
        s.risk !==
          (s.fake_probability >= 0.7
            ? "high"
            : s.fake_probability >= 0.4
              ? "medium"
              : "low"))
    )
      throw new Error("Invalid segment classification.");
  }
  for (const r of data.suspicious_regions)
    if (
      !number(r.start_seconds) ||
      !number(r.end_seconds) ||
      r.start_seconds < 0 ||
      r.end_seconds <= r.start_seconds ||
      r.end_seconds > data.duration_seconds + 0.01 ||
      !probability(r.peak_fake_probability)
    )
      throw new Error("Invalid suspicious region.");
  return data;
}
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const data = (await request("/api/v1/health", { signal }, 10000)) as Health;
  if (!data || typeof data.model_loaded !== "boolean")
    throw new Error("Invalid health response.");
  return data;
}
export async function submitAnalysis(
  audio: File,
  phone: boolean,
  compare: boolean,
  signal?: AbortSignal,
): Promise<Job> {
  const form = new FormData();
  form.append("audio", audio);
  form.append("phone_mode", String(phone));
  form.append("compare", String(compare));
  return validateJob(
    await request(
      "/api/v1/jobs/analyze",
      { method: "POST", body: form, signal },
      60000,
    ),
  );
}
function validateJob(value: unknown): Job {
  const job = value as Job;
  if (
    !job ||
    typeof job.job_id !== "string" ||
    !["queued", "processing", "completed", "failed", "cancelled"].includes(
      job.state,
    ) ||
    !number(job.segments_completed) ||
    !number(job.segments_total) ||
    !probability(job.progress) ||
    job.segments_completed > job.segments_total
  )
    throw new Error("Invalid job status returned by the API.");
  if (job.state === "completed") {
    if (!job.result) throw new Error("Completed job has no result.");
    if ("standard" in job.result) {
      validateAnalysis(job.result.standard);
      validateAnalysis(job.result.phone);
      if (!number(job.result.difference_percentage_points))
        throw new Error("Invalid comparison response.");
    } else validateAnalysis(job.result);
  }
  return job;
}
export async function readJob(id: string, signal?: AbortSignal) {
  return validateJob(
    await request(`/api/v1/jobs/${encodeURIComponent(id)}`, { signal }),
  );
}
export async function cancelJob(id: string) {
  return validateJob(
    await request(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
  );
}
export async function submitBatch(
  files: File[],
  phone: boolean,
  compare: boolean,
  signal?: AbortSignal,
): Promise<Job[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  form.append("phone_mode", String(phone));
  form.append("compare", String(compare));
  const data = await request(
    "/api/v1/jobs/batch",
    { method: "POST", body: form, signal },
    90000,
  );
  if (!Array.isArray(data) || data.length !== files.length)
    throw new Error("Invalid batch response.");
  return data.map(validateJob);
}
export function jobFailure(job: Job) {
  return (
    (job.error && errorMessages[job.error.code]) ||
    "Analysis failed. Try a different recording or inspect the backend setup."
  );
}
export function waitForPoll(signal: AbortSignal, ms = 1000) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Interrupted"));
      return;
    }
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("Interrupted"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
