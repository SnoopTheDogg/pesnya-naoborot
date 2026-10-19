// Pure game state machine. State is plain JSON; every function returns a new state.
import { chunkCount, MIN_A_SEC } from './audio-math.js';

const MIN_CHUNK_SEC = 1;
const MAX_CHUNK_SEC = 8;

export function newGame(chunkSec = 5) {
  return { phase: 'A', chunkSec, aDurationSec: null, n: 0, current: 0, takes: [] };
}

export function setChunkSec(s, sec) {
  if (s.phase !== 'A') return s;
  const snapped = Math.round(sec * 2) / 2;
  return { ...s, chunkSec: Math.min(MAX_CHUNK_SEC, Math.max(MIN_CHUNK_SEC, snapped)) };
}

export function setRecordingA(s, durationSec) {
  if (s.phase !== 'A') return s;
  return { ...s, aDurationSec: durationSec };
}

export function plan(s) {
  if (s.aDurationSec == null) return { n: 0, sliceSec: 0 };
  const n = chunkCount(s.aDurationSec, s.chunkSec);
  return { n, sliceSec: s.aDurationSec / n };
}

export function canStartB(s) {
  return s.phase === 'A' && s.aDurationSec != null && s.aDurationSec >= MIN_A_SEC;
}

export function startB(s) {
  if (!canStartB(s)) return s;
  const { n } = plan(s);
  return { ...s, phase: 'B', n, current: 0, takes: Array(n).fill(false) };
}

export function setTake(s, i) {
  if (s.phase !== 'B' || !Number.isInteger(i) || i < 0 || i >= s.n) return s;
  const takes = s.takes.slice();
  takes[i] = true;
  return { ...s, takes };
}

export function canNext(s) {
  return s.phase === 'B' && s.takes[s.current] === true;
}

export function isLast(s) {
  return s.n > 0 && s.current === s.n - 1;
}

export function next(s) {
  if (!canNext(s)) return s;
  if (isLast(s)) return { ...s, phase: 'final' };
  return { ...s, current: s.current + 1 };
}

export function back(s) {
  if (s.phase !== 'B') return s;
  return { ...s, current: Math.max(0, s.current - 1) };
}
