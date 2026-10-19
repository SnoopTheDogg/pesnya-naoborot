// Pure sample math for the reverse-song game. No DOM, no Web Audio.

export const MIN_A_SEC = 0.3;

const EPS = 1e-9;

export function reverseSamples(samples) {
  const out = new Float32Array(samples.length);
  for (let i = 0, j = samples.length - 1; j >= 0; i++, j--) out[i] = samples[j];
  return out;
}

// Number of chunks: duration / target rounded to nearest (exact halves round down), at least 1.
export function chunkCount(durationSec, targetSec) {
  return Math.max(1, Math.ceil(durationSec / targetSec - 0.5 - EPS));
}

// n slices of floor(len / n) samples; the remainder goes to the last slice.
export function splitEqual(samples, n) {
  const size = Math.floor(samples.length / n);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const start = i * size;
    const end = i === n - 1 ? samples.length : start + size;
    parts.push(samples.slice(start, end));
  }
  return parts;
}

export function concatSamples(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function mixToMono(channels) {
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (const ch of channels) {
    for (let i = 0; i < len; i++) out[i] += ch[i];
  }
  for (let i = 0; i < len; i++) out[i] /= channels.length;
  return out;
}

export function trimSilence(samples, sampleRate, { threshold = 0.02, padSec = 0.05 } = {}) {
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return samples;
  const pad = Math.round(padSec * sampleRate);
  const start = Math.max(0, first - pad);
  const end = Math.min(samples.length, last + 1 + pad);
  return samples.slice(start, end);
}
