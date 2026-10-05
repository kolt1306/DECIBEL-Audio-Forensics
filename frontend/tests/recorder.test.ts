import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "../src/hooks/useRecorder";
import { submitAnalysis } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());
function mediaSetup(addModule = vi.fn().mockResolvedValue(undefined)) {
  const stop = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const nodes: { disconnect: ReturnType<typeof vi.fn> }[] = [];
  const processors: Processor[] = [];
  const makeNode = () => {
    const node = { connect: vi.fn(), disconnect: vi.fn(), fftSize: 2048 };
    nodes.push(node);
    return node;
  };
  class Context {
    sampleRate = 48000;
    destination = {};
    audioWorklet = { addModule };
    resume = vi.fn().mockResolvedValue(undefined);
    close = close;
    createAnalyser = makeNode;
    createMediaStreamSource = makeNode;
  }
  class Processor {
    connect = vi.fn();
    disconnect = vi.fn();
    onprocessorerror: (() => void) | null = null;
    port = {
      onmessage: null as ((e: { data: Float32Array | string }) => void) | null,
      postMessage: vi.fn(() => {
        this.port.onmessage?.({ data: new Float32Array([0.25, -0.5]) });
        this.port.onmessage?.({ data: "stopped" });
      }),
      close: vi.fn(),
    };
    constructor() {
      processors.push(this);
      nodes.push(this);
    }
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Processor);
  // Recording must not depend on MediaRecorder or any compressed MIME support.
  vi.stubGlobal("MediaRecorder", undefined);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  return { stop, close, stream, processors, nodes };
}
function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

describe("microphone lifecycle", () => {
  it("releases the microphone immediately if unmounted during worklet loading", async () => {
    let resolve!: () => void;
    const loading = new Promise<void>((r) => {
      resolve = r;
    });
    const addModule = vi.fn().mockReturnValue(loading);
    const media = mediaSetup(addModule);
    const file = vi.fn();
    const hook = renderHook(() => useRecorder(file, vi.fn()));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.start();
    });
    await waitFor(() => expect(addModule).toHaveBeenCalled());
    hook.unmount();
    expect(media.stop).toHaveBeenCalledOnce();
    expect(media.close).toHaveBeenCalledOnce();
    resolve();
    await pending;
    expect(file).not.toHaveBeenCalled();
    expect(media.stop).toHaveBeenCalledOnce();
    expect(media.close).toHaveBeenCalledOnce();
  });
  it("cleans initialization resources when the worklet fails to load", async () => {
    const media = mediaSetup(
      vi.fn().mockRejectedValue(new Error("worklet load failed")),
    );
    const error = vi.fn();
    const hook = renderHook(() => useRecorder(vi.fn(), error));
    await act(async () => {
      await hook.result.current.start();
    });
    expect(media.stop).toHaveBeenCalledOnce();
    expect(media.close).toHaveBeenCalledOnce();
    expect(hook.result.current.starting).toBe(false);
    expect(error).toHaveBeenCalled();
    hook.unmount();
  });
  it("discards incomplete PCM if the worklet never acknowledges stop", async () => {
    const media = mediaSetup();
    const file = vi.fn();
    const error = vi.fn();
    const hook = renderHook(() => useRecorder(file, error));
    await act(async () => {
      await hook.result.current.start();
    });
    media.processors[0].port.postMessage.mockImplementation(() => {});
    vi.useFakeTimers();
    act(() => hook.result.current.stop());
    expect(media.stop).toHaveBeenCalledOnce();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(file).not.toHaveBeenCalled();
    expect(media.close).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
    vi.useRealTimers();
    hook.unmount();
  });
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
  it("returns real WAV bytes including the last PCM chunk and releases all resources", async () => {
    const media = mediaSetup();
    const file = vi.fn();
    const hook = renderHook(() => useRecorder(file, vi.fn()));
    await act(async () => {
      await hook.result.current.start();
    });
    media.processors[0].port.onmessage?.({ data: new Float32Array([1, -1]) });
    expect(hook.result.current.recording).toBe(true);
    act(() => hook.result.current.stop());
    expect(media.stop).toHaveBeenCalledOnce();
    expect(media.close).toHaveBeenCalledOnce();
    expect(file).toHaveBeenCalledOnce();
    const capture = file.mock.calls[0][0] as File;
    expect(capture.type).toBe("audio/wav");
    expect(capture.name).toMatch(/^capture-\d+\.wav$/);
    const buffer = await bytes(capture);
    const view = new DataView(buffer);
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...new Uint8Array(buffer, 8, 4))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(48, true)).toBe(8192);
    media.nodes.forEach((node) =>
      expect(node.disconnect).toHaveBeenCalledOnce(),
    );
    expect(media.processors[0].port.close).toHaveBeenCalledOnce();
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
  it("starts a fresh PCM buffer on repeated recordings", async () => {
    const media = mediaSetup();
    const file = vi.fn();
    const hook = renderHook(() => useRecorder(file, vi.fn()));
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await hook.result.current.start();
      });
      act(() => hook.result.current.stop());
    }
    expect(file).toHaveBeenCalledTimes(2);
    expect(file.mock.calls[0][0].size).toBe(48);
    expect(file.mock.calls[1][0].size).toBe(48);
    expect(media.stop).toHaveBeenCalledTimes(2);
    expect(media.close).toHaveBeenCalledTimes(2);
    media.nodes.forEach((node) =>
      expect(node.disconnect).toHaveBeenCalledOnce(),
    );
    hook.unmount();
  });
  it("does not emit a partial file on processor failure", async () => {
    const media = mediaSetup();
    const file = vi.fn();
    const error = vi.fn();
    const hook = renderHook(() => useRecorder(file, error));
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => media.processors[0].onprocessorerror?.());
    expect(file).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("capture failed"),
    );
    expect(media.stop).toHaveBeenCalledOnce();
    expect(media.close).toHaveBeenCalledOnce();
    hook.unmount();
  });
  it("passes generated WAV unchanged to the existing analysis POST", async () => {
    mediaSetup();
    const file = vi.fn();
    const hook = renderHook(() => useRecorder(file, vi.fn()));
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => hook.result.current.stop());
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        job_id: "capture-job",
        state: "queued",
        segments_completed: 0,
        segments_total: 1,
        progress: 0,
      }),
    });
    vi.stubGlobal("fetch", fetch);
    await submitAnalysis(file.mock.calls[0][0], false, false);
    expect(fetch.mock.calls[0][0]).toContain("/api/v1/jobs/analyze");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    const audio = (fetch.mock.calls[0][1].body as FormData).get(
      "audio",
    ) as File;
    expect(audio.type).toBe("audio/wav");
    expect(audio.name).toMatch(/\.wav$/);
    expect(new Uint8Array(await bytes(audio))).toEqual(
      new Uint8Array(await bytes(file.mock.calls[0][0])),
    );
    hook.unmount();
  });
});
