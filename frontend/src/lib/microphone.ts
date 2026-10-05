const dspKeys = [
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
] as const;
export type MicrophoneCapture = {
  requested: MediaTrackConstraints;
  settings: Pick<
    MediaTrackSettings,
    | "channelCount"
    | "sampleRate"
    | "sampleSize"
    | "echoCancellation"
    | "noiseSuppression"
    | "autoGainControl"
  >;
  relaxedConstraints: string[];
  warnings: string[];
  audioContextSampleRate?: number;
  wavSampleRate?: number;
  frames?: number;
  durationSeconds?: number;
};
const recordings = new WeakMap<File, MicrophoneCapture>();
export const captureFor = (file?: File) =>
  file ? recordings.get(file) : undefined;
export const rememberCapture = (file: File, capture: MicrophoneCapture) =>
  recordings.set(file, capture);

/** Prefer unprocessed speech; unsupported/ignored constraints are never claimed as applied. */
export async function openMicrophone(): Promise<{
  stream: MediaStream;
  capture: MicrophoneCapture;
}> {
  const devices = navigator.mediaDevices;
  const supported = devices.getSupportedConstraints?.();
  const audio: MediaTrackConstraints = {};
  for (const key of ["channelCount", ...dspKeys] as const) {
    // Older browsers without capability discovery can still accept ideal constraints.
    if (!supported || supported[key])
      Object.assign(audio, { [key]: key === "channelCount" ? 1 : false });
  }
  const requested = { ...audio };
  const relaxedConstraints: string[] = [];
  let stream: MediaStream;
  while (true) {
    try {
      stream = await devices.getUserMedia({
        audio: Object.keys(audio).length ? { ...audio } : true,
      });
      break;
    } catch (error) {
      const failure = error as { name?: string; constraint?: string };
      // Retry only constraint incompatibility, never permission/device failures.
      if (failure.name !== "OverconstrainedError") throw error;
      const key = failure.constraint;
      if (!key || !Object.prototype.hasOwnProperty.call(audio, key))
        throw error;
      delete audio[key as keyof MediaTrackConstraints];
      relaxedConstraints.push(key);
    }
  }
  try {
    const actual = stream.getAudioTracks()[0]?.getSettings?.() || {};
    const settings: MicrophoneCapture["settings"] = {};
    for (const key of [
      "channelCount",
      "sampleRate",
      "sampleSize",
      ...dspKeys,
    ] as const) {
      if (actual[key] !== undefined)
        Object.assign(settings, { [key]: actual[key] });
    }
    const warnings: string[] = [];
    const enabled = dspKeys.filter((key) => actual[key] === true);
    const unknown = dspKeys.filter((key) => typeof actual[key] !== "boolean");
    if (enabled.length)
      warnings.push(
        `Browser microphone processing enabled: ${enabled.join(", ")}. This can alter speech; it does not establish authenticity.`,
      );
    if (unknown.length)
      warnings.push(
        `Browser microphone processing could not be verified: ${unknown.join(", ")}.`,
      );
    if (relaxedConstraints.length)
      warnings.push(
        `Browser required capture constraint fallback: ${relaxedConstraints.join(", ")}.`,
      );
    return {
      stream,
      capture: { requested, settings, relaxedConstraints, warnings },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
