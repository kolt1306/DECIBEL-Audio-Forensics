import { afterEach, expect, it, vi } from "vitest";
import { openMicrophone } from "../src/lib/microphone";
afterEach(() => vi.unstubAllGlobals());
function setup(
  settings: MediaTrackSettings = {},
  supported?: MediaTrackSupportedConstraints,
) {
  const stop = vi.fn();
  const stream = {
    getAudioTracks: () => [{ getSettings: () => settings }],
    getTracks: () => [{ stop }],
  };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      ...(supported ? { getSupportedConstraints: () => supported } : {}),
    },
  });
  return { getUserMedia, stream, stop };
}
it("requests mono with all browser DSP disabled and records actual settings only", async () => {
  const media = setup({
    channelCount: 1,
    sampleRate: 44100,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    deviceId: "private",
  });
  const { capture } = await openMicrophone();
  expect(media.getUserMedia).toHaveBeenCalledWith({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  expect(capture.settings.sampleRate).toBe(44100);
  expect(capture.settings).not.toHaveProperty("deviceId");
  expect(capture.warnings).toEqual([]);
});
it("omits unsupported constraints and reports unverified DSP", async () => {
  const media = setup(
    { echoCancellation: false },
    { channelCount: true, echoCancellation: true },
  );
  const { capture } = await openMicrophone();
  expect(media.getUserMedia).toHaveBeenCalledWith({
    audio: { channelCount: 1, echoCancellation: false },
  });
  expect(capture.warnings.join(" ")).toContain(
    "could not be verified: noiseSuppression, autoGainControl",
  );
});
it("relaxes only a rejected constraint, preserving the remaining DSP requests", async () => {
  const media = setup({ autoGainControl: true });
  media.getUserMedia.mockRejectedValueOnce({
    name: "OverconstrainedError",
    constraint: "autoGainControl",
  });
  const { capture } = await openMicrophone();
  expect(media.getUserMedia).toHaveBeenNthCalledWith(2, {
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
    },
  });
  expect(capture.relaxedConstraints).toEqual(["autoGainControl"]);
  expect(capture.warnings.join(" ")).toContain(
    "processing enabled: autoGainControl",
  );
});
it.each(["NotAllowedError", "NotFoundError", "NotReadableError", "TypeError"])(
  "never retries %s as a constraint failure",
  async (name) => {
    const media = setup();
    const error = { name };
    media.getUserMedia.mockRejectedValue(error);
    await expect(openMicrophone()).rejects.toBe(error);
    expect(media.getUserMedia).toHaveBeenCalledOnce();
  },
);
it("stops retrying an unknown constraint and cleans up on settings failure", async () => {
  const media = setup();
  media.getUserMedia.mockRejectedValueOnce({
    name: "OverconstrainedError",
    constraint: "deviceId",
  });
  await expect(openMicrophone()).rejects.toMatchObject({
    constraint: "deviceId",
  });
  media.stream.getAudioTracks = () => {
    throw new Error("track failure");
  };
  await expect(openMicrophone()).rejects.toThrow("track failure");
  expect(media.stop).toHaveBeenCalledOnce();
});
