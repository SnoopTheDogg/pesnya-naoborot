// WAV file of a recording, for saving it to the phone. No DOM, no Web Audio.

const HEADER_BYTES = 44;

// 16-bit PCM mono WAV: samples are clamped to [-1, 1].
export function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const v = new DataView(bytes.buffer);
  const text = (at, s) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(HEADER_BYTES + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return bytes;
}

// File name with the local time it was saved at: pesnya-naoborot-HH-MM.wav
export function wavFileName(date) {
  const two = (x) => String(x).padStart(2, '0');
  return `pesnya-naoborot-${two(date.getHours())}-${two(date.getMinutes())}.wav`;
}
