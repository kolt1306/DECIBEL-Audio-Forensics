import { useEffect, useRef, useState } from "react";
export function useRecorder(
  onFile: (file: File) => void,
  onError: (message: string) => void,
) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const resources = useRef<{
    stream: MediaStream;
    context: AudioContext;
    recorder: MediaRecorder;
    timer: ReturnType<typeof setInterval> | null;
  } | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const callbacks = useRef({ onFile, onError });
  callbacks.current = { onFile, onError };
  const cleanup = () => {
    const r = resources.current;
    if (!r) return;
    if (r.timer) clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.context.close();
    resources.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const r = resources.current;
      if (r?.recorder.state === "recording") r.recorder.stop();
      cleanup();
    };
  }, []);
  const stop = () => {
    const r = resources.current;
    if (r?.recorder.state === "recording") r.recorder.stop();
    cleanup();
    if (mounted.current) {
      setRecording(false);
      setAnalyser(null);
    }
  };
  const start = async () => {
    if (pending.current || resources.current) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      context = new AudioContext();
      await context.resume();
      if (!mounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        await context.close();
        return;
      }
      const node = context.createAnalyser();
      node.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(node);
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (mounted.current) {
          const mime = recorder.mimeType || "audio/webm";
          const extension = mime.includes("mp4")
            ? "m4a"
            : mime.includes("ogg")
              ? "ogg"
              : "webm";
          callbacks.current.onFile(
            new File(chunks, `capture-${Date.now()}.${extension}`, {
              type: mime,
            }),
          );
        }
      };
      recorder.onerror = () => {
        stop();
        callbacks.current.onError(
          "Microphone capture failed. Try recording again.",
        );
      };
      const begin = performance.now();
      resources.current = { stream, context, recorder, timer: null };
      recorder.start(250);
      setElapsed(0);
      setAnalyser(node);
      setRecording(true);
      resources.current.timer = setInterval(() => {
        const seconds = (performance.now() - begin) / 1000;
        setElapsed(Math.min(seconds, 600));
        if (seconds >= 600) stop();
      }, 100);
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      if (context) void context.close();
      cleanup();
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
