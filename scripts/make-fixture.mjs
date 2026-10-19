// Writes e2e/fixtures/voice.wav: 16-bit mono 48 kHz, 12 s of a tone that
// alternates between 440 Hz and 660 Hz every 0.5 s, amplitude 0.5.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 48000;
const SECONDS = 12;
const AMP = 0.5;
const SWITCH_SEC = 0.5;

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'e2e', 'fixtures', 'voice.wav');

const frames = RATE * SECONDS;
const dataBytes = frames * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write('RIFF', 0, 'ascii');
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write('WAVE', 8, 'ascii');
buf.write('fmt ', 12, 'ascii');
buf.writeUInt32LE(16, 16); // fmt chunk size
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 2, 28); // byte rate
buf.writeUInt16LE(2, 32); // block align
buf.writeUInt16LE(16, 34); // bits per sample
buf.write('data', 36, 'ascii');
buf.writeUInt32LE(dataBytes, 40);

let phase = 0;
for (let i = 0; i < frames; i++) {
  const t = i / RATE;
  const freq = Math.floor(t / SWITCH_SEC) % 2 === 0 ? 440 : 660;
  phase += (2 * Math.PI * freq) / RATE;
  const v = Math.round(AMP * Math.sin(phase) * 32767);
  buf.writeInt16LE(v, 44 + i * 2);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`wrote ${out} (${buf.length} bytes)`);
