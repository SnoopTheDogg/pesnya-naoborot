import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reverseSamples,
  chunkCount,
  splitEqual,
  concatSamples,
  mixToMono,
  trimSilence,
  MIN_A_SEC,
} from '../src/audio-math.js';

test('MIN_A_SEC is 0.3', () => {
  assert.equal(MIN_A_SEC, 0.3);
});

test('chunkCount rounds duration / target to nearest, min 1', () => {
  assert.equal(chunkCount(10, 2), 5);
  assert.equal(chunkCount(11, 2), 5);
  assert.equal(chunkCount(13, 2), 6);
  assert.equal(chunkCount(9.9, 5), 2);
  assert.equal(chunkCount(3, 5), 1);
  assert.equal(chunkCount(0.4, 5), 1);
});

test('reverseSamples returns a reversed copy and leaves input untouched', () => {
  const input = Float32Array.from([1, 2, 3]);
  const out = reverseSamples(input);
  assert.deepEqual(Array.from(out), [3, 2, 1]);
  assert.deepEqual(Array.from(input), [1, 2, 3]);
  assert.notEqual(out, input);
  assert.ok(out instanceof Float32Array);
});

test('splitEqual gives equal slices, remainder on the last', () => {
  const input = Float32Array.from({ length: 11 }, (_, i) => i);
  const parts = splitEqual(input, 5);
  assert.deepEqual(parts.map((p) => p.length), [2, 2, 2, 2, 3]);
  assert.deepEqual(Array.from(concatSamples(parts)), Array.from(input));
});

test('concatSamples round-trips splitEqual', () => {
  const input = Float32Array.from({ length: 23 }, (_, i) => i * 0.1);
  assert.deepEqual(Array.from(concatSamples(splitEqual(input, 4))), Array.from(input));
});

test('mixToMono averages channels', () => {
  const out = mixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
  assert.deepEqual(Array.from(out), [0.5, 0.5]);
});

test('trimSilence trims leading/trailing silence with padding', () => {
  const x = new Float32Array(250);
  x.fill(0.5, 100, 150);
  const out = trimSilence(x, 1000, { padSec: 0.01 });
  assert.equal(out.length, 70);
});

test('trimSilence returns input unchanged when all silent', () => {
  const x = new Float32Array(300);
  const out = trimSilence(x, 1000);
  assert.equal(out.length, 300);
});

test('full pipeline invariant: reverse -> split -> concat -> reverse = original', () => {
  const x = Float32Array.from({ length: 103 }, (_, i) => Math.sin(i));
  const out = reverseSamples(concatSamples(splitEqual(reverseSamples(x), 4)));
  assert.deepEqual(out, x);
});
