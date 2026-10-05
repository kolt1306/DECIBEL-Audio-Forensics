// Audio rendering thread: collect PCM and output silence to avoid mic feedback.
class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.length = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") {
        this.active = false;
        this.flush();
        this.port.postMessage("stopped");
      }
    };
  }
  flush() {
    if (!this.length) return;
    const chunk = this.samples.slice(0, this.length);
    this.port.postMessage(chunk, [chunk.buffer]);
    this.length = 0;
  }
  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.samples[this.length++] = sample;
      if (this.length === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor("decibel-pcm-recorder", PCMRecorder);
