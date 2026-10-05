import { useEffect, useRef, useState } from "react";
import { encodeWav } from "../lib/wav";
import { openMicrophone, rememberCapture } from "../lib/microphone";

type Capture = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  processor: AudioWorkletNode;
  chunks: Float32Array[];
  timer: ReturnType<typeof setInterval> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
};

export function useRecorder(
  onFile: (file: File) => void,
  onError: (message: string) => void,
) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const resources = useRef<Capture | null>(null);
  const opening = useRef<{
    stream: MediaStream;
    context: AudioContext | null;
  } | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const callbacks = useRef({ onFile, onError });
  callbacks.current = { onFile, onError };
  const cleanup = () => {
    const initializing = opening.current;
    opening.current = null;
    if (initializing) {
      initializing.stream.getTracks().forEach((t) => t.stop());
      if (initializing.context)
        void initializing.context.close().catch(() => {});
    }
    const r = resources.current;
    if (!r) return;
    resources.current = null;
    if (r.timer) clearInterval(r.timer);
    if (r.flushTimer) clearTimeout(r.flushTimer);
    if (!r.stopping) r.stream.getTracks().forEach((t) => t.stop());
    r.processor.port.onmessage = null;
    r.processor.onprocessorerror = null;
    r.processor.port.close();
    r.source.disconnect();
    r.analyser.disconnect();
    r.processor.disconnect();
    r.chunks.length = 0;
    void r.context.close().catch(() => {});
  };
  const reset = () => {
    if (mounted.current) {
      setRecording(false);
      setStarting(false);
      setAnalyser(null);
    }
  };
  const fail = () => {
    cleanup();
    reset();
    if (mounted.current)
      callbacks.current.onError(
        "Microphone capture failed. Try recording again.",
      );
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cleanup();
    };
  }, []);
  const stop = () => {
    const r = resources.current;
    if (!r || r.stopping) return;
    if (r.timer) clearInterval(r.timer);
    // Release the mic immediately; wait for the worklet's final PCM before encoding.
    r.stream.getTracks().forEach((t) => t.stop());
    r.stopping = true;
    r.flushTimer = setTimeout(fail, 3000);
    try {
      r.processor.port.postMessage("stop");
    } catch {
      fail();
    }
  };
  const start = async () => {
    if (pending.current || resources.current) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === "undefined" ||
      typeof AudioWorkletNode === "undefined"
    ) {
      callbacks.current.onError(
        "Recording needs a supported browser on HTTPS or localhost.",
      );
      return;
    }
    pending.current = true;
    setStarting(true);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      const opened = await openMicrophone();
      stream = opened.stream;
      if (!mounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      opening.current = { stream, context: null };
      context = new AudioContext();
      opening.current.context = context;
      await context.resume();
      await context.audioWorklet.addModule(
        import.meta.env.BASE_URL + "pcm-recorder.js",
      );
      if (!mounted.current) {
        cleanup();
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const node = context.createAnalyser();
      node.fftSize = 2048;
      const processor = new AudioWorkletNode(context, "decibel-pcm-recorder");
      const r: Capture = {
        stream,
        context,
        source,
        analyser: node,
        processor,
        chunks: [],
        timer: null,
        flushTimer: null,
        stopping: false,
      };
      resources.current = r;
      opening.current = null;
      processor.port.onmessage = ({
        data,
      }: MessageEvent<Float32Array | string>) => {
        if (resources.current !== r) return;
        if (data instanceof Float32Array) {
          r.chunks.push(data);
        } else if (data === "stopped" && r.stopping) {
          try {
            const wav = encodeWav(r.chunks, r.context.sampleRate);
            const file = new File([wav], "capture-" + Date.now() + ".wav", {
              type: "audio/wav",
            });
            const frames = r.chunks.reduce(
              (total, chunk) => total + chunk.length,
              0,
            );
            rememberCapture(file, {
              ...opened.capture,
              audioContextSampleRate: r.context.sampleRate,
              wavSampleRate: r.context.sampleRate,
              frames,
              durationSeconds: frames / r.context.sampleRate,
            });
            cleanup();
            reset();
            if (mounted.current) callbacks.current.onFile(file);
          } catch {
            fail();
          }
        }
      };
      processor.onprocessorerror = fail;
      source.connect(node);
      source.connect(processor);
      // Connected output keeps processing active; the worklet outputs silence.
      processor.connect(context.destination);
      const begin = performance.now();
      setElapsed(0);
      setAnalyser(node);
      setRecording(true);
      r.timer = setInterval(() => {
        const seconds = (performance.now() - begin) / 1000;
        setElapsed(Math.min(seconds, 600));
        if (seconds >= 600) stop();
      }, 100);
    } catch (error) {
      cleanup();
      reset();
      if (mounted.current)
        callbacks.current.onError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone access denied. Allow access in browser settings, or upload an audio file."
            : "Cannot open the microphone. Check that a microphone is connected and available.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setStarting(false);
    }
  };
  return { recording, starting, elapsed, analyser, start, stop };
}
