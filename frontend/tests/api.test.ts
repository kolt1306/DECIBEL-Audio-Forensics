import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelJob,
  getHealth,
  readJob,
  submitAnalysis,
  validateAnalysis,
  waitForPoll,
} from "../src/lib/api";
afterEach(() => vi.unstubAllGlobals());
describe("API integrity and failure handling", () => {
  it("reports model-not-ready through safe known error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "MODEL_NOT_READY",
                message: "private server details must not be displayed",
              },
            }),
            { status: 503 },
          ),
        ),
    );
    await expect(
      submitAnalysis(new File(["x"], "test.wav"), false, false),
    ).rejects.toThrow("The model is unavailable");
  });
  it("rejects invalid JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );
    await expect(getHealth()).rejects.toThrow("unreadable response");
  });
  it("handles interrupted network requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(getHealth()).rejects.toThrow("Cannot reach the backend");
  });
  it("rejects invalid job progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              job_id: "test",
              state: "processing",
              segments_completed: 9,
              segments_total: 8,
              progress: 1.125,
            }),
          ),
        ),
    );
    await expect(readJob("test")).rejects.toThrow("Invalid job status");
  });
  it("rejects a completed job without classifier evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              job_id: "test",
              state: "completed",
              segments_completed: 1,
              segments_total: 1,
              progress: 1,
              result: null,
            }),
          ),
        ),
    );
    await expect(readJob("test")).rejects.toThrow("no result");
  });
  it("issues cancellation to the matching job", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            job_id: "test",
            state: "cancelled",
            segments_completed: 0,
            segments_total: 0,
            progress: 0,
            result: null,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await cancelJob("test")).state).toBe("cancelled");
    expect(fetch.mock.calls[0][0]).toContain("/jobs/test/cancel");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
  });
  it("rejects missing or fabricated analysis values", () => {
    expect(() => validateAnalysis({ fake_probability: NaN })).toThrow(
      "invalid analysis",
    );
    expect(() => validateAnalysis(null)).toThrow("invalid analysis");
  });
  it("cleans up polling promptly on cancellation", async () => {
    const controller = new AbortController();
    const pending = waitForPoll(controller.signal, 60000);
    controller.abort();
    await expect(pending).rejects.toThrow("Interrupted");
  });
});
