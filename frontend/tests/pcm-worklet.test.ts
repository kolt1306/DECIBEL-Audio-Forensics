import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("averages channels, batches PCM, flushes the final frames and stays silent", () => {
  let Processor!: new () => {
    port: { onmessage: (event: { data: string }) => void };
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
  };
  const messages: (Float32Array | string)[] = [];
  runInNewContext(readFileSync("public/pcm-recorder.js", "utf8"), {
    AudioWorkletProcessor: class {
      port = {
        postMessage: (data: Float32Array | string) => messages.push(data),
      };
    },
    registerProcessor: (name: string, value: typeof Processor) => {
      expect(name).toBe("decibel-pcm-recorder");
      Processor = value;
    },
  });
  const processor = new Processor();
  const output = new Float32Array(128);
  for (let i = 0; i < 17; i++)
    expect(
      processor.process(
        [[new Float32Array(128).fill(0.8), new Float32Array(128).fill(-0.2)]],
        [[output]],
      ),
    ).toBe(true);
  expect(messages).toHaveLength(1);
  expect((messages[0] as Float32Array).length).toBe(2048);
  expect((messages[0] as Float32Array)[0]).toBeCloseTo(0.3);
  processor.port.onmessage({ data: "stop" });
  expect((messages[1] as Float32Array).length).toBe(128);
  expect(messages[2]).toBe("stopped");
  expect(processor.process([], [[output]])).toBe(false);
  expect(output.every((sample) => sample === 0)).toBe(true);
});
