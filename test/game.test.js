import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setChunkSec, setRecordingA, plan, canStartB, startB,
  setTake, canNext, next, back, isLast,
} from '../src/game.js';

test('newGame defaults', () => {
  assert.deepEqual(newGame(), {
    phase: 'A', chunkSec: 5, aDurationSec: null, n: 0, current: 0, takes: [],
  });
  assert.equal(newGame(3).chunkSec, 3);
});

test('setChunkSec clamps to [1, 8] and snaps to 0.5', () => {
  const s = newGame();
  assert.equal(setChunkSec(s, 0.3).chunkSec, 1);
  assert.equal(setChunkSec(s, 9).chunkSec, 8);
  assert.equal(setChunkSec(s, 4.3).chunkSec, 4.5);
  assert.equal(setChunkSec(s, 4.2).chunkSec, 4);
});

test('functions return new objects and do not mutate input', () => {
  const s = newGame();
  const t = setChunkSec(s, 3);
  assert.notEqual(t, s);
  assert.equal(s.chunkSec, 5);
});

test('setChunkSec is ignored after startB', () => {
  const s = startB(setRecordingA(newGame(), 10));
  assert.equal(s.phase, 'B');
  assert.equal(setChunkSec(s, 2), s);
});

test('setRecordingA only in phase A', () => {
  const s = setRecordingA(newGame(), 10);
  assert.equal(s.aDurationSec, 10);
  const b = startB(s);
  assert.equal(setRecordingA(b, 3), b);
});

test('plan: no recording gives zeros', () => {
  assert.deepEqual(plan(newGame()), { n: 0, sliceSec: 0 });
});

test('plan: 11 s at chunkSec 2 gives n 5, sliceSec 2.2', () => {
  const s = setChunkSec(setRecordingA(newGame(), 11), 2);
  assert.deepEqual(plan(s), { n: 5, sliceSec: 2.2 });
});

test('canStartB / startB refused for a too-short recording', () => {
  const s = setRecordingA(newGame(), 0.2);
  assert.equal(canStartB(s), false);
  assert.equal(startB(s), s);
  assert.equal(canStartB(newGame()), false);
  assert.equal(canStartB(setRecordingA(newGame(), 0.3)), true);
});

test('startB sets up phase B', () => {
  const s = startB(setChunkSec(setRecordingA(newGame(), 11), 2));
  assert.equal(s.phase, 'B');
  assert.equal(s.n, 5);
  assert.equal(s.current, 0);
  assert.deepEqual(s.takes, [false, false, false, false, false]);
  assert.equal(canStartB(s), false);
});

test('walk: next needs a take, back keeps takes', () => {
  let s = startB(setChunkSec(setRecordingA(newGame(), 6), 2)); // n 3
  assert.equal(s.n, 3);
  assert.equal(canNext(s), false);
  assert.equal(next(s), s);
  s = setTake(s, 0);
  assert.equal(canNext(s), true);
  s = next(s);
  assert.equal(s.current, 1);
  assert.equal(canNext(s), false);
  s = back(s);
  assert.equal(s.current, 0);
  assert.deepEqual(s.takes, [true, false, false]);
  assert.equal(back(s).current, 0);
});

test('isLast and final transition', () => {
  let s = startB(setChunkSec(setRecordingA(newGame(), 6), 2)); // n 3
  assert.equal(isLast(s), false);
  for (let i = 0; i < 2; i++) s = next(setTake(s, s.current));
  assert.equal(s.current, 2);
  assert.equal(isLast(s), true);
  s = next(setTake(s, 2));
  assert.equal(s.phase, 'final');
  assert.deepEqual(s.takes, [true, true, true]);
});

test('single-chunk game goes straight to final', () => {
  let s = startB(setRecordingA(newGame(), 2));
  assert.equal(s.n, 1);
  assert.equal(isLast(s), true);
  s = next(setTake(s, 0));
  assert.equal(s.phase, 'final');
});

test('phase guards: next/back/canNext outside B', () => {
  const a = setRecordingA(newGame(), 5);
  assert.equal(canNext(a), false);
  assert.equal(back(a), a);
  assert.equal(next(a), a);
});
