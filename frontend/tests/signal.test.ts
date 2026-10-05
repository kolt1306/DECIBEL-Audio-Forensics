import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SignalField from "../src/components/SignalField";
vi.mock("motion/react", () => ({ useReducedMotion: () => true }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("redraws a static reduced-motion waveform after resize and cleans its frame", () => {
  const context = {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({ width: 300, height: 180 } as DOMRect);
  let resize!: () => void;
  const disconnect = vi.fn();
  class Observer {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe = vi.fn();
    disconnect = disconnect;
  }
  vi.stubGlobal("ResizeObserver", Observer);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const view = render(
    createElement(SignalField, {
      peaks: [0.1, 0.2, 0.3],
      analyser: null,
      analyzing: false,
      dragging: false,
      phone: false,
      color: "#d5ee8c",
      progress: 0,
    }),
  );
  const run = () => {
    const [id, callback] = Array.from(frames.entries())[0];
    frames.delete(id);
    callback(0);
  };
  run();
  expect(context.clearRect).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  resize();
  run();
  expect(context.clearRect).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(0);
  resize();
  view.unmount();
  expect(frames.size).toBe(0);
  expect(disconnect).toHaveBeenCalledOnce();
});
