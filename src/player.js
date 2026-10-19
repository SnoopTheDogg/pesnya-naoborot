// Web Audio playback. Only one sound plays at a time.
import { mixToMono } from './audio-math.js';

let ctx = null;
let current = null; // { id, source, onEnd }
let errorHandler = (e) => console.error(e);
let resumeError = null; // last failure of ctx.resume(), already reported

// The player has no UI: problems that would otherwise be silent (the context
// cannot resume, playback started but the context is not running) go here.
export function onAudioError(handler) {
  errorHandler = handler;
}

function report(e) {
  try {
    errorHandler(e);
  } catch {
    // never let reporting break playback
  }
}

function setSessionType(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    // audioSession is iOS-only and best-effort.
  }
}

setSessionType('playback');

// 'play-and-record' while the mic is open, 'playback' otherwise (iOS: ignores the
// silent switch and keeps sound off the earpiece).
export function setRecordingMode(on) {
  setSessionType(on ? 'play-and-record' : 'playback');
}

// Lazily created; call from a user gesture so iOS unlocks audio.
export function getContext() {
  if (!ctx || ctx.state === 'closed') {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state !== 'running' && ctx.state !== 'closed') {
    resumeError = null;
    const failed = (e) => {
      resumeError = e;
      report(e);
    };
    try {
      ctx.resume().catch(failed);
    } catch (e) {
      failed(e);
    }
  }
  return ctx;
}

export async function decodeToMono(blob) {
  const data = await blob.arrayBuffer();
  const ac = getContext();
  // Callback form for older Safari, promise form elsewhere.
  const buffer = await new Promise((resolve, reject) => {
    const p = ac.decodeAudioData(data, resolve, (e) =>
      reject(e || new DOMException('Не удалось декодировать запись', 'EncodingError')),
    );
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return mixToMono(channels);
}

function finishCurrent() {
  const ended = current;
  current = null;
  if (ended && ended.onEnd) ended.onEnd();
}

// onEnd fires once when this sound ends, whether naturally or because it was
// stopped/replaced; playingId() is already updated when it fires.
export function play(id, samples, onEnd) {
  stop();
  const ac = getContext();
  const buffer = ac.createBuffer(1, Math.max(1, samples.length), ac.sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(ac.destination);
  const entry = { id, source, onEnd };
  source.onended = () => {
    if (current === entry) finishCurrent();
  };
  current = entry;
  source.start();
  if (ac.state !== 'running') checkRunning(ac, entry);
}

const START_GRACE_MS = 1000;

// A sound was started on a context that is not running yet; if it is still not
// running shortly after, the user hears nothing — say so.
function checkRunning(ac, entry) {
  setTimeout(() => {
    if (current === entry && ac.state !== 'running' && !resumeError) {
      report(new DOMException(`звук не запустился, AudioContext в состоянии «${ac.state}»`, 'InvalidStateError'));
    }
  }, START_GRACE_MS);
}

export function stop() {
  if (!current) return;
  const { source } = current;
  source.onended = null;
  try {
    source.stop();
  } catch {
    // already stopped
  }
  finishCurrent();
}

export function playingId() {
  return current ? current.id : null;
}
