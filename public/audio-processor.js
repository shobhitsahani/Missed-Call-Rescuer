class PcmAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    // 50ms chunks at 16kHz = 800 samples (1600 bytes)
    this.chunkSamples = (options && options.processorOptions && options.processorOptions.chunkSamples) || 800;
    this.buffer = new Int16Array(this.chunkSamples);
    this.bufferIndex = 0;
    this.resamplePhase = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const channelData = input[0];
    const inputSampleRate = sampleRate; // Global AudioWorklet sample rate
    const ratio = inputSampleRate / this.targetSampleRate;

    while (this.resamplePhase < channelData.length) {
      const index = Math.floor(this.resamplePhase);
      const frac = this.resamplePhase - index;
      const s0 = channelData[index];
      const s1 = index + 1 < channelData.length ? channelData[index + 1] : s0;
      const sample = s0 + frac * (s1 - s0);

      const clamped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.bufferIndex++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      if (this.bufferIndex >= this.chunkSamples) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.chunkSamples);
        this.bufferIndex = 0;
      }

      this.resamplePhase += ratio;
    }

    this.resamplePhase -= channelData.length;
    return true;
  }
}

registerProcessor('pcm-audio-processor', PcmAudioProcessor);
