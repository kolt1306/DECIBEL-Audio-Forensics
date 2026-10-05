import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MotionConfig } from "motion/react";
import App from "../src/App";
import { decodeFile } from "../src/lib/audio";
import { submitAnalysis } from "../src/lib/api";
import analysis from "./fixtures/analysis.json";

const recorder = vi.hoisted(() => ({
  recording: true,
  starting: false,
  elapsed: 12.5,
  analyser: null,
  stop: vi.fn(),
  start: vi.fn(),
  onFile: null as ((file: File) => void) | null,
}));
vi.mock("../src/hooks/useRecorder", () => ({
  useRecorder: (onFile: (file: File) => void) => {
    recorder.onFile = onFile;
    return recorder;
  },
}));
vi.mock("../src/lib/audio", async (original) => ({
  ...(await original<object>()),
  decodeFile: vi.fn(async (file: File) => ({
    file,
    url: "blob:" + file.name,
    duration: 3.25,
    peaks: [0.3, 0.6, 0.2],
  })),
}));
vi.mock("../src/components/SignalField", () => ({
  default: () => <div role="img" aria-label="Test waveform" />,
}));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  submitAnalysis: vi.fn(),
  getHealth: vi.fn().mockResolvedValue({
    status: "loading",
    model_loaded: false,
    diagnostic: "Model warming up",
  }),
}));

beforeEach(() => {
  recorder.recording = true;
  recorder.starting = false;
  vi.stubGlobal("URL", { revokeObjectURL: vi.fn() });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

it("keeps WAV preview and analysis connected and revokes replaced URLs", async () => {
  recorder.recording = false;
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.mocked(submitAnalysis).mockResolvedValue({
    job_id: "recording-job",
    state: "completed",
    segments_completed: 1,
    segments_total: 1,
    progress: 1,
    created_at: "now",
    result: analysis as Awaited<ReturnType<typeof submitAnalysis>>["result"],
    error: null,
  });
  const view = render(
    <MotionConfig reducedMotion="always">
      <App />
    </MotionConfig>,
  );
  await view.findByText(/Model warming up/);
  const first = new File(["wav fixture"], "capture-1.wav", {
    type: "audio/wav",
  });
  await act(async () => {
    recorder.onFile?.(first);
  });
  expect(decodeFile).toHaveBeenCalledWith(first);
  expect(view.getByText("capture-1.wav")).toBeTruthy();
  expect(view.getByText(/00:03.25/)).toBeTruthy();
  expect(view.getByRole("img", { name: "Test waveform" })).toBeTruthy();
  const audio = view.container.querySelector("audio")!;
  expect(audio.getAttribute("src")).toBe("blob:capture-1.wav");
  expect(view.getByText("MONITOR RECORDING")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Play recording" }));
  await waitFor(() => expect(audio.play).toHaveBeenCalled());
  fireEvent.click(view.getByRole("button", { name: "ANALYZE SIGNAL" }));
  await waitFor(() =>
    expect(submitAnalysis).toHaveBeenCalledWith(
      first,
      false,
      false,
      expect.any(AbortSignal),
    ),
  );
  await view.findByText("CLASSIFICATION COMPLETE");
  expect(
    (
      view.getByRole("button", {
        name: /Replace recording/i,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  const second = new File(["wav fixture"], "capture-2.wav", {
    type: "audio/wav",
  });
  await act(async () => {
    recorder.onFile?.(second);
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:capture-1.wav");
  expect(view.getByText("capture-2.wav")).toBeTruthy();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:capture-2.wav");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps stop capture available, shows elapsed time, and disables analysis during recording", async () => {
  const view = render(
    <MotionConfig reducedMotion="always">
      <App />
    </MotionConfig>,
  );
  await view.findByText(/Model warming up/);
  expect(view.getByText("RECORDING")).toBeTruthy();
  expect(view.getByText("00:12.50")).toBeTruthy();
  const stop = view.getByRole("button", { name: "Stop capture" });
  expect((stop as HTMLButtonElement).disabled).toBe(false);
  expect(
    (
      view.getByRole("button", {
        name: "Upload recording",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "ANALYZE SIGNAL" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(stop);
  expect(recorder.stop).toHaveBeenCalledOnce();
});

it("communicates microphone initialization without exposing a second start action", async () => {
  recorder.recording = false;
  recorder.starting = true;
  const view = render(
    <MotionConfig reducedMotion="always">
      <App />
    </MotionConfig>,
  );
  await view.findByText(/Model warming up/);
  expect(view.getByText("OPENING MICROPHONE")).toBeTruthy();
  expect(
    (view.getByRole("button", { name: "Opening mic…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
