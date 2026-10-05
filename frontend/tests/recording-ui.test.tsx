import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MotionConfig } from "motion/react";
import App from "../src/App";

const recorder = vi.hoisted(() => ({
  recording: true,
  starting: false,
  elapsed: 12.5,
  analyser: null,
  stop: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../src/hooks/useRecorder", () => ({ useRecorder: () => recorder }));
vi.mock("../src/components/SignalField", () => ({
  default: () => <div role="img" aria-label="Test waveform" />,
}));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  getHealth: vi
    .fn()
    .mockResolvedValue({
      status: "loading",
      model_loaded: false,
      diagnostic: "Model warming up",
    }),
}));

beforeEach(() => {
  recorder.recording = true;
  recorder.starting = false;
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
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
