/** Encode mono PCM at the actual AudioContext sample rate, without resampling. */
export function encodeWav(
  chunks: readonly Float32Array[],
  sampleRate: number,
): Blob {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0)
    throw new Error("Invalid recording sample rate.");
  const dataSize = chunks.reduce((n, chunk) => n + chunk.length, 0) * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Number.isFinite(value)
        ? Math.max(-1, Math.min(1, value))
        : 0;
      view.setInt16(
        offset,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}
