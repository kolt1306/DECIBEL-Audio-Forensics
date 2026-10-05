export type SignalAudio = {
  file: File;
  url: string;
  duration: number;
  peaks: number[];
};
export async function decodeFile(file: File): Promise<SignalAudio> {
  if (!file.size) throw new Error("This file is empty.");
  if (file.size > 50 * 1024 * 1024)
    throw new Error("Choose a recording smaller than 50 MB.");
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 1.5)
      throw new Error("The signal is too short. Record at least 1.5 seconds.");
    if (buffer.duration > 600)
      throw new Error("Choose a recording up to 10 minutes long.");
    const length = buffer.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < length; i++)
        mono[i] += channel[i] / buffer.numberOfChannels;
    }
    const peaks: number[] = [];
    const step = Math.max(1, Math.floor(length / 1400));
    let largest = 0;
    let energy = 0;
    for (let i = 0; i < length; i += step) {
      let peak = 0;
      for (let j = i; j < Math.min(length, i + step); j++) {
        peak = Math.max(peak, Math.abs(mono[j]));
        energy += mono[j] * mono[j];
      }
      peaks.push(peak);
      largest = Math.max(largest, peak);
    }
    if (
      largest < 0.0001 ||
      (largest < 0.005 && Math.sqrt(energy / length) < 0.0001)
    )
      throw new Error("No usable signal. Choose audio with audible speech.");
    return {
      file,
      url: URL.createObjectURL(file),
      duration: buffer.duration,
      peaks,
    };
  } catch (error) {
    if (error instanceof DOMException)
      throw new Error(
        "Your browser cannot decode this audio. Try WAV, MP3, FLAC or a different browser.",
      );
    throw error;
  } finally {
    await context.close();
  }
}
export function time(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}
