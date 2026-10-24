import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, wavFileName } from '../src/wav.js';

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));

test('encodeWav writes a 16-bit PCM mono RIFF/WAVE header', () => {
  const bytes = encodeWav(new Float32Array(3), 48000);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 44 + 6);
  const v = view(bytes);
  assert.equal(ascii(bytes, 0), 'RIFF');
  assert.equal(v.getUint32(4, true), 36 + 6);
  assert.equal(ascii(bytes, 8), 'WAVE');
  assert.equal(ascii(bytes, 12), 'fmt ');
  assert.equal(v.getUint32(16, true), 16); // fmt chunk size
  assert.equal(v.getUint16(20, true), 1); // PCM
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 96000); // byte rate
  assert.equal(v.getUint16(32, true), 2); // block align
  assert.equal(v.getUint16(34, true), 16); // bits per sample
  assert.equal(ascii(bytes, 36), 'data');
  assert.equal(v.getUint32(40, true), 6);
});

test('encodeWav uses the given sample rate', () => {
  const v = view(encodeWav(new Float32Array(1), 44100));
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(28, true), 88200);
});

test('encodeWav stores samples as little-endian int16, clamped to [-1, 1]', () => {
  const samples = Float32Array.from([0, 1, -1, 0.5, -0.5, 1.5, -1.5]);
  const bytes = encodeWav(samples, 8000);
  const v = view(bytes);
  const out = [];
  for (let i = 0; i < samples.length; i++) out.push(v.getInt16(44 + i * 2, true));
  assert.deepEqual(out, [0, 32767, -32768, 16384, -16384, 32767, -32768]);
  // little-endian: 32767 = 0x7fff → ff 7f
  assert.deepEqual([bytes[46], bytes[47]], [0xff, 0x7f]);
});

test('encodeWav of no samples is a 44-byte header with an empty data chunk', () => {
  const bytes = encodeWav(new Float32Array(0), 48000);
  assert.equal(bytes.length, 44);
  const v = view(bytes);
  assert.equal(ascii(bytes, 0), 'RIFF');
  assert.equal(v.getUint32(4, true), 36);
  assert.equal(v.getUint32(40, true), 0);
});

test('wavFileName uses the local hours and minutes', () => {
  assert.equal(wavFileName(new Date(2000, 0, 1, 9, 5)), 'pesnya-naoborot-09-05.wav');
  assert.equal(wavFileName(new Date(2000, 0, 1, 23, 59, 59)), 'pesnya-naoborot-23-59.wav');
});
