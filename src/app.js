// UI wiring. One place owns `state` (pure game JSON) and `audio` (PCM takes);
// each screen has its own render function.
import { concatSamples, MIN_A_SEC, reverseSamples, splitEqual, trimSilence } from './audio-math.js';
import * as game from './game.js';
import { startRecording } from './recorder.js';
import {
  decodeToMono,
  getContext,
  onAudioError,
  play,
  playingId,
  setRecordingMode,
  stop,
} from './player.js';

const MAX_RECORD_SEC = 60;
const EMPTY_B_SEC = 0.1; // an empty/undecodable B take is stored as this much silence
const MIC_HELP = 'Разреши микрофон: Настройки → Safari → Микрофон';
const SOUND_HELP = 'Звука нет: нажми кнопку ещё раз, выключи бесшумный режим и прибавь громкость';

// ---- app state ----
let state = game.newGame();
// 'A', 'B0'..'B(n-1)', 'result' → Float32Array (mono, AudioContext sample rate);
// 'slices' → the reversed A cut into n parts (set once on entering B).
let audio = {};
// emptyTakes: chunk indices whose B take came out empty and is stored as silence.
const ui = { screen: 'start', error: '', aTooShort: false, emptyTakes: new Set() };
let round = 0; // bumped by «Новая игра»; takes from an older round are dropped
// The current take, set synchronously when «Записать» is tapped, so the
// mic-opening window counts as recording everywhere.
// { key, round, started: Promise, handle: null until the mic is open,
//   startedAt, tick, limit, finishing: Promise|null, cancelled }
let rec = null;

// ---- dom ----
const $ = (sel) => document.querySelector(sel);
const sections = [...document.querySelectorAll('section[data-screen]')];
const el = {
  error: $('#error'),
  chunkBox: $('#chunk-box'),
  chunkSlider: $('#chunk-slider'),
  chunkValue: $('#chunk-value'),
  btnNew: $('#btn-new'),
  timer: $('#timer'),
  btnARecord: $('#btn-a-record'),
  btnAFinish: $('#btn-a-finish'),
  aShort: $('#a-short'),
  aTake: $('#a-take'),
  btnAListen: $('#btn-a-listen'),
  planInfo: $('#plan-info'),
  btnToB: $('#btn-to-b'),
  chunkLabel: $('#chunk-label'),
  btnSlice: $('#btn-b-slice'),
  bTimer: $('#b-timer'),
  btnBRecord: $('#btn-b-record'),
  btnBFinish: $('#btn-b-finish'),
  bTake: $('#b-take'),
  btnBListen: $('#btn-b-listen'),
  bEmpty: $('#b-empty'),
  btnBBack: $('#btn-b-back'),
  btnBNext: $('#btn-b-next'),
  btnResult: $('#btn-result'),
  resultInfo: $('#result-info'),
  btnOriginal: $('#btn-original'),
  btnFinalNew: $('#btn-final-new'),
};

// ---- formatting ----
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const decimal = (x, digits) => x.toFixed(digits).replace('.', ',');
const formatChunkSec = (sec) => `${Number.isInteger(sec) ? sec : decimal(sec, 1)} с`;

function formatTimer(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function describeError(e, help) {
  const name = (e && e.name) || 'Error';
  const message = (e && e.message) || String(e);
  const text = `${name}: ${message}`;
  return help ? `${text}\n${help}` : text;
}

function showError(e, help) {
  console.error(e);
  ui.error = describeError(e, help);
  render();
}

// ---- recording (shared by every screen that records) ----
async function toSamples(blob) {
  if (!blob || blob.size === 0) return { samples: null, error: null };
  try {
    const mono = await decodeToMono(blob);
    return { samples: trimSilence(mono, getContext().sampleRate), error: null };
  } catch (e) {
    return { samples: null, error: e };
  }
}

// Starts a take for `key` ('A', 'B0'..). Resolves once the mic is open (or failed).
function beginRecording(key) {
  if (rec) return rec.started;
  getContext();
  stop();
  ui.error = '';
  const r = { key, round, handle: null, startedAt: 0, finishing: null, cancelled: false };
  rec = r;
  setRecordingMode(true);
  r.started = (async () => {
    try {
      r.handle = await startRecording();
    } catch (e) {
      if (rec === r) rec = null;
      setRecordingMode(false);
      if (!r.cancelled) showError(e, MIC_HELP);
      return;
    }
    if (r.cancelled || r.finishing) return; // finishRecording() takes it from here
    stop(); // nothing may play while recording
    r.startedAt = performance.now();
    r.tick = setInterval(renderTimer, 200);
    r.limit = setTimeout(() => finishRecording(), MAX_RECORD_SEC * 1000);
    render();
  })();
  render();
  return r.started;
}

// Ends the current take; it is decoded and stored. With cancelPending, a take
// whose mic is still opening is cancelled instead (mic released, previous take
// kept). Without it, the take is ended as soon as the mic opens (a too-short
// take). Safe to call repeatedly; resolves when the take is fully handled.
function finishRecording({ cancelPending = false } = {}) {
  if (!rec) return Promise.resolve();
  if (rec.finishing) return rec.finishing;
  const r = rec;
  r.cancelled = cancelPending && r.handle === null;
  r.finishing = (async () => {
    await r.started;
    clearInterval(r.tick);
    clearTimeout(r.limit);
    let blob = null;
    if (r.handle) {
      try {
        blob = await r.handle.finish();
      } catch (e) {
        ui.error = describeError(e);
        console.error(e);
      }
    }
    setRecordingMode(false);
    if (r.cancelled) {
      if (rec === r) rec = null;
      render();
      return;
    }
    const { samples, error } = await toSamples(blob);
    if (rec === r) rec = null;
    onRecorded(r, samples, error);
    render();
  })();
  render();
  return r.finishing;
}

const bKey = (i) => `B${i}`; // audio key of chunk i's take

// A take may only land in the round and phase it was recorded for; a B take
// only on the chunk it was recorded for.
function takeBelongs(r) {
  if (r.round !== round) return false;
  return r.key === 'A' ? state.phase === 'A' : state.phase === 'B' && r.key === bKey(state.current);
}

function onRecorded(r, samples, decodeError) {
  if (!takeBelongs(r)) {
    console.warn(`take ${r.key} dropped: game moved on`);
    return;
  }
  if (r.key === 'A') {
    const sec = samples ? samples.length / getContext().sampleRate : 0;
    if (!samples || sec < MIN_A_SEC) {
      if (decodeError) console.warn('A take not decodable', decodeError);
      delete audio.A;
      state = game.setRecordingA(state, null);
      ui.aTooShort = true;
    } else {
      audio.A = samples;
      state = game.setRecordingA(state, sec);
      ui.aTooShort = false;
    }
  }
  if (r.key.startsWith('B')) {
    // Any B take counts, even silence: otherwise a quiet chunk would block the game.
    const i = Number(r.key.slice(1)); // === state.current (takeBelongs)
    if (samples) {
      audio[r.key] = samples;
      ui.emptyTakes.delete(i);
    } else {
      if (decodeError) console.warn(`B take ${i + 1} not decodable`, decodeError);
      audio[r.key] = new Float32Array(Math.round(EMPTY_B_SEC * getContext().sampleRate));
      ui.emptyTakes.add(i);
    }
    state = game.setTake(state, i);
  }
}

// Play button behaviour: ends a running take first (keeping it; a take whose
// mic is still opening is cancelled), toggles off if this id is already
// playing, otherwise plays.
async function togglePlay(id, getSamples) {
  getContext();
  if (rec) {
    await finishRecording({ cancelPending: true });
  } else if (playingId() === id) {
    stop();
    render();
    return;
  }
  if (rec) return; // another take started meanwhile
  const samples = getSamples();
  if (samples) play(id, samples, render);
  render();
}

// ---- screens ----
function currentScreen() {
  return ui.screen === 'start' ? 'start' : state.phase;
}

function renderTimer() {
  if (!rec) return;
  const sec = rec.handle ? (performance.now() - rec.startedAt) / 1000 : 0;
  (rec.key === 'A' ? el.timer : el.bTimer).textContent = formatTimer(sec);
}

// A play button shows (class `playing`, aria-pressed) whether its sound is playing.
function renderPlayButton(node, id) {
  const on = playingId() === id;
  node.classList.toggle('playing', on);
  node.setAttribute('aria-pressed', String(on));
}

function renderChunkBox(screen) {
  const slot = document.querySelector(`section[data-screen="${screen}"] .chunk-slot`);
  if (slot && el.chunkBox.parentElement !== slot) slot.appendChild(el.chunkBox);
  el.chunkBox.hidden = !slot;
  const locked = state.phase !== 'A';
  el.chunkSlider.disabled = locked;
  el.chunkBox.classList.toggle('disabled', locked);
  if (Number(el.chunkSlider.value) !== state.chunkSec) el.chunkSlider.value = String(state.chunkSec);
  el.chunkValue.textContent = formatChunkSec(state.chunkSec);
}

function renderStart() {
  el.btnNew.disabled = false;
}

function renderA() {
  const recording = rec !== null && rec.key === 'A';
  const hasTake = Boolean(audio.A);
  el.timer.hidden = !recording;
  if (recording) renderTimer();
  el.btnARecord.hidden = recording;
  el.btnARecord.textContent = hasTake ? 'Перезаписать' : 'Записать';
  el.btnARecord.classList.toggle('primary', !hasTake);
  el.btnAFinish.hidden = !recording;
  el.btnAFinish.disabled = Boolean(rec && rec.finishing);
  el.aShort.hidden = !ui.aTooShort || recording;
  el.aTake.hidden = !hasTake;
  renderPlayButton(el.btnAListen, 'A');
  const { n, sliceSec } = game.plan(state);
  el.planInfo.dataset.n = String(n);
  el.planInfo.textContent = n
    ? `Выйдет ${n} ${plural(n, 'кусок', 'куска', 'кусков')} по ~${decimal(sliceSec, 1)} с`
    : '';
  el.btnToB.hidden = rec !== null || !game.canStartB(state);
}

function renderB() {
  const i = state.current;
  const key = bKey(i);
  const busy = rec !== null; // recording, or the mic is still opening
  const recording = busy && rec.key === key;
  const hasTake = Boolean(audio[key]);
  el.chunkLabel.textContent = `Кусок ${i + 1} из ${state.n}`;
  renderPlayButton(el.btnSlice, `slice${i}`);
  el.bTimer.hidden = !recording;
  if (recording) renderTimer();
  el.btnBRecord.hidden = recording;
  el.btnBRecord.textContent = hasTake ? 'Перезаписать' : 'Записать';
  el.btnBRecord.classList.toggle('primary', !hasTake);
  el.btnBFinish.hidden = !recording;
  el.btnBFinish.disabled = Boolean(rec && rec.finishing);
  el.bTake.hidden = !hasTake;
  renderPlayButton(el.btnBListen, key);
  el.bEmpty.hidden = !ui.emptyTakes.has(i);
  el.btnBBack.hidden = i === 0;
  el.btnBBack.disabled = busy;
  el.btnBNext.textContent = game.isLast(state) ? 'К результату' : 'Дальше';
  el.btnBNext.classList.toggle('primary', hasTake);
  el.btnBNext.disabled = busy || !game.canNext(state);
}

function renderFinal() {
  const sec = audio.result ? audio.result.length / getContext().sampleRate : 0;
  el.resultInfo.dataset.seconds = sec.toFixed(2);
  el.resultInfo.textContent = `Результат: ${decimal(sec, 1)} с`;
  renderPlayButton(el.btnResult, 'result');
  renderPlayButton(el.btnOriginal, 'A');
}

const renderers = { start: renderStart, A: renderA, B: renderB, final: renderFinal };

function render() {
  const screen = currentScreen();
  for (const s of sections) s.hidden = s.dataset.screen !== screen;
  el.error.hidden = !ui.error;
  el.error.textContent = ui.error;
  renderChunkBox(screen);
  renderers[screen]();
}

// ---- events ----
function onTap(node, handler) {
  node.addEventListener('click', () => {
    try {
      const r = handler();
      if (r && typeof r.catch === 'function') r.catch(showError);
    } catch (e) {
      showError(e);
    }
  });
}

el.chunkSlider.addEventListener('input', () => {
  state = game.setChunkSec(state, Number(el.chunkSlider.value));
  render();
});

// Drops the round (takes, a running take) and shows `screen`. The chunk length is kept.
function resetRound(screen) {
  getContext();
  stop();
  if (rec) finishRecording({ cancelPending: true });
  round += 1;
  state = game.newGame(state.chunkSec);
  audio = {};
  ui.screen = screen;
  ui.aTooShort = false;
  ui.emptyTakes = new Set();
  ui.error = '';
  render();
}

onTap(el.btnNew, () => resetRound('game'));

onTap(el.btnARecord, () => {
  ui.aTooShort = false;
  return beginRecording('A');
});
onTap(el.btnAFinish, () => finishRecording());
onAudioError((e) => showError(e, SOUND_HELP));
onTap(el.btnAListen, () => togglePlay('A', () => audio.A));

onTap(el.btnToB, () => {
  if (rec || !game.canStartB(state)) return;
  stop();
  state = game.startB(state);
  audio.slices = splitEqual(reverseSamples(audio.A), state.n);
  ui.error = '';
  render();
});

// ---- player B ----
onTap(el.btnSlice, () => {
  const i = state.current;
  return togglePlay(`slice${i}`, () => audio.slices && audio.slices[i]);
});
onTap(el.btnBRecord, () => {
  if (state.phase !== 'B') return undefined;
  return beginRecording(bKey(state.current));
});
onTap(el.btnBFinish, () => finishRecording());
onTap(el.btnBListen, () => {
  const key = bKey(state.current);
  return togglePlay(key, () => audio[key]);
});

function computeResult() {
  const takes = [];
  for (let i = 0; i < state.n; i++) takes.push(audio[bKey(i)]);
  audio.result = reverseSamples(concatSamples(takes));
}

onTap(el.btnBNext, () => {
  if (rec || !game.canNext(state)) return;
  stop();
  state = game.next(state);
  if (state.phase === 'final') computeResult();
  ui.error = '';
  render();
});
onTap(el.btnBBack, () => {
  if (rec || state.phase !== 'B' || state.current === 0) return;
  stop();
  state = game.back(state);
  ui.error = '';
  render();
});

// ---- final ----
onTap(el.btnResult, () => togglePlay('result', () => audio.result));
onTap(el.btnOriginal, () => togglePlay('A', () => audio.A));
onTap(el.btnFinalNew, () => {
  if (!window.confirm('Начать новую игру? Записи этого раунда удалятся.')) return;
  resetRound('start');
});

render();
