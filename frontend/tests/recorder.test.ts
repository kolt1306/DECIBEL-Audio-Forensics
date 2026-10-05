import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "../src/hooks/useRecorder";

afterEach(() => vi.unstubAllGlobals());
function mediaSetup() {
  const stop = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  class Context {
    resume = vi.fn().mockResolvedValue(undefined);
    close = close;
    createAnalyser = () => ({ fftSize: 2048 });
    createMediaStreamSource = () => ({ connect: vi.fn() });
  }
  class Recorder {
    static isTypeSupported = () => true;
    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["capture test bytes"]) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  return { stop, close, stream };
}

describe("microphone lifecycle", () => {
  it("reports denied access without retaining microphone resources", async () => {
    const media = mediaSetup();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const error = vi.fn();
    const file = vi.fn();
    const hook = renderHook(() => useRecorder(file, error));
    await act(async () => {
      await hook.result.current.start();
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Microphone access denied"),
    );
    expect(hook.result.current.recording).toBe(false);
    expect(hook.result.current.starting).toBe(false);
    expect(media.close).not.toHaveBeenCalled();
    expect(file).not.toHaveBeenCalled();
    hook.unmount();
  });
  it("stops tracks, closes AudioContext and returns capture on stop", async () => {
    const media = mediaSetup();
    const file = vi.fn();
    const error = vi.fn();
    const hook = renderHook(() => useRecorder(file, error));
    await act(async () => {
      await hook.result.current.start();
    });
    expect(hook.result.current.recording).toBe(true);
    act(() => hook.result.current.stop());
    expect(media.stop).toHaveBeenCalledOnce();
    expect(media.close).toHaveBeenCalledOnce();
    expect(file).toHaveBeenCalledOnce();
    expect(file.mock.calls[0][0]).toBeInstanceOf(File);
    expect(hook.result.current.analyser).toBeNull();
    expect(hook.result.current.recording).toBe(false);
    hook.unmount();
  });
  it("cleans recording on unmount without emitting a file", async () => {
    const media = mediaSetup();
    const file = vi.fn();
    const hook = renderHook(() => useRecorder(file, vi.fn()));
    await act(async () => {
      await hook.result.current.start();
    });
    hook.unmount();
    expect(media.stop).toHaveBeenCalledOnce();
    expect(media.close).toHaveBeenCalledOnce();
    expect(file).not.toHaveBeenCalled();
  });
  it("closes a stream if permission resolves after unmount", async () => {
    const media = mediaSetup();
    let resolve!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const hook = renderHook(() => useRecorder(vi.fn(), vi.fn()));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.start();
    });
    hook.unmount();
    resolve(media.stream);
    await pending;
    await waitFor(() => expect(media.stop).toHaveBeenCalledOnce());
  });
});
