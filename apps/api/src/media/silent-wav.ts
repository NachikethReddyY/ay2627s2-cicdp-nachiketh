const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_FRAME = (CHANNELS * BITS_PER_SAMPLE) / 8;
const HEADER_BYTES = 44;

export function silentWav(durationMs: number): Uint8Array {
  const dataBytes = Math.round((SAMPLE_RATE * durationMs) / 1000) * BYTES_PER_FRAME;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  ascii(0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_FRAME, true);
  view.setUint16(32, BYTES_PER_FRAME, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}
