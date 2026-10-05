import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/lib/wav";

function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}
describe("mono PCM WAV encoding", () => {
  it.each([44100, 48000, 96000])(
    "writes an honest %i Hz RIFF header and clamps signed PCM",
    async (rate) => {
      const blob = encodeWav(
        [
          new Float32Array([-2, -1, -0.5]),
          new Float32Array([0, 0.5, 1, 2, NaN]),
        ],
        rate,
      );
      const buffer = await bytes(blob);
      const view = new DataView(buffer);
      const marker = (offset: number) =>
        String.fromCharCode(...new Uint8Array(buffer, offset, 4));
      expect(blob.type).toBe("audio/wav");
      expect(marker(0)).toBe("RIFF");
      expect(marker(8)).toBe("WAVE");
      expect(marker(12)).toBe("fmt ");
      expect(marker(36)).toBe("data");
      expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
      expect(view.getUint32(16, true)).toBe(16);
      expect(view.getUint16(20, true)).toBe(1);
      expect(view.getUint16(22, true)).toBe(1);
      expect(view.getUint32(24, true)).toBe(rate);
      expect(view.getUint32(28, true)).toBe(rate * 2);
      expect(view.getUint16(32, true)).toBe(2);
      expect(view.getUint16(34, true)).toBe(16);
      expect(view.getUint32(40, true)).toBe(16);
      expect(
        Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true)),
      ).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767, 0]);
    },
  );
});
