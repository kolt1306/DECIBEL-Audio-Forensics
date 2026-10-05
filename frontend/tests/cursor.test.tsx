import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SignalCursor from "../src/components/SignalCursor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("signal-pointer");
});

function setup(enabled: boolean) {
  const listeners = new Set<() => void>();
  const policy = {
    matches: enabled,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => policy);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const pointer = (target: Element, x: number) => {
    const event = new Event("pointermove", { bubbles: true });
    Object.assign(event, { pointerType: "mouse", clientX: x, clientY: 60 });
    target.dispatchEvent(event);
  };
  const drain = () => {
    for (let i = 0; frames.size && i < 180; i++) {
      const [key, fn] = [...frames][0];
      frames.delete(key);
      fn(i * 16 + 16);
    }
  };
  return { policy, frames, listeners, pointer, drain };
}

it("leaves the native cursor and schedules no animation for reduced motion/coarse pointers", () => {
  const env = setup(false);
  render(<SignalCursor />);
  env.pointer(document.body, 50);
  expect(env.frames.size).toBe(0);
  expect(document.documentElement.classList.contains("signal-pointer")).toBe(
    false,
  );
});

it("settles after movement and immediately restores native behavior when policy changes", () => {
  const env = setup(true);
  const view = render(
    <>
      <SignalCursor />
      <button data-magnetic>Analyze</button>
      <input aria-label="seek" />
    </>,
  );
  const button = view.getByRole("button");
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  env.pointer(button, 80);
  env.drain();
  expect(env.frames.size).toBe(0);
  expect(button.style.translate).not.toBe("");
  env.pointer(view.getByLabelText("seek"), 90);
  expect(document.documentElement.classList.contains("signal-pointer")).toBe(
    false,
  );
  env.drain();
  expect(button.style.translate).toBe("");
  env.pointer(button, 100);
  env.policy.matches = false;
  env.listeners.forEach((fn) => fn());
  expect(env.frames.size).toBe(0);
  expect(button.style.translate).toBe("");
  expect(document.documentElement.classList.contains("signal-pointer")).toBe(
    false,
  );
  view.unmount();
  expect(env.listeners.size).toBe(0);
});

it("cancels pending frames when the window loses focus or the component unmounts", () => {
  const env = setup(true);
  const view = render(<SignalCursor />);
  env.pointer(document.body, 100);
  expect(env.frames.size).toBe(1);
  fireEvent.blur(window);
  expect(env.frames.size).toBe(0);
  env.pointer(document.body, 200);
  view.unmount();
  expect(env.frames.size).toBe(0);
});
