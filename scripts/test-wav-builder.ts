import { pcmToWav } from '../server/wav';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- 1. Testing WAV Header Builder ---');

// Create a test 16-bit mono PCM buffer (100 samples = 200 bytes)
const sampleCount = 100;
const pcmBuffer = Buffer.alloc(sampleCount * 2);
for (let i = 0; i < sampleCount; i++) {
  // 1 kHz sine wave at 24 kHz sample rate
  const sample = Math.round(Math.sin((2 * Math.PI * 1000 * i) / 24000) * 16000);
  pcmBuffer.writeInt16LE(sample, i * 2);
}

const sampleRate = 24000;
const numChannels = 1;
const bitDepth = 16;
const wavBuffer = pcmToWav(pcmBuffer, sampleRate, numChannels, bitDepth);

// Total length check: 44 bytes header + pcmBuffer.length
assert(wavBuffer.length === 44 + pcmBuffer.length, `Expected length ${44 + pcmBuffer.length}, got ${wavBuffer.length}`);

// RIFF chunk descriptor
assert(wavBuffer.subarray(0, 4).toString('ascii') === 'RIFF', 'RIFF identifier at offset 0');
const chunkSize = wavBuffer.readUInt32LE(4);
assert(chunkSize === 36 + pcmBuffer.length, `RIFF chunk size: expected ${36 + pcmBuffer.length}, got ${chunkSize}`);
assert(wavBuffer.subarray(8, 12).toString('ascii') === 'WAVE', 'WAVE format at offset 8');

// fmt subchunk
assert(wavBuffer.subarray(12, 16).toString('ascii') === 'fmt ', 'fmt subchunk identifier at offset 12');
const subchunk1Size = wavBuffer.readUInt32LE(16);
assert(subchunk1Size === 16, `fmt subchunk size must be 16 for PCM, got ${subchunk1Size}`);
const audioFormat = wavBuffer.readUInt16LE(20);
assert(audioFormat === 1, `AudioFormat must be 1 (PCM), got ${audioFormat}`);
const channels = wavBuffer.readUInt16LE(22);
assert(channels === 1, `Channels must be 1, got ${channels}`);
const rate = wavBuffer.readUInt32LE(24);
assert(rate === 24000, `Sample rate must be 24000, got ${rate}`);
const byteRate = wavBuffer.readUInt32LE(28);
assert(byteRate === 48000, `Byte rate must be 48000 (24000 * 1 * 16 / 8), got ${byteRate}`);
const blockAlign = wavBuffer.readUInt16LE(32);
assert(blockAlign === 2, `Block align must be 2 (1 * 16 / 8), got ${blockAlign}`);
const bits = wavBuffer.readUInt16LE(34);
assert(bits === 16, `Bits per sample must be 16, got ${bits}`);

// data subchunk
assert(wavBuffer.subarray(36, 40).toString('ascii') === 'data', 'data subchunk identifier at offset 36');
const dataSize = wavBuffer.readUInt32LE(40);
assert(dataSize === pcmBuffer.length, `Data size must equal PCM length ${pcmBuffer.length}, got ${dataSize}`);

// Payload match
const payload = wavBuffer.subarray(44);
assert(payload.equals(pcmBuffer), 'PCM payload in WAV matches input PCM exactly');

console.log('✓ All WAV Header Builder tests passed.');
