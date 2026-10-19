// Microphone recorder. The mic is opened per take and released in finish().

const CONSTRAINTS = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};
const MIME_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function stopTracks(stream) {
  for (const track of stream.getTracks()) track.stop();
}

async function openMic() {
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') {
    const err = new Error('getUserMedia недоступен (нужен https)');
    err.name = 'NotSupportedError';
    throw err;
  }
  try {
    return await md.getUserMedia(CONSTRAINTS);
  } catch (e) {
    if (e && (e.name === 'OverconstrainedError' || e.name === 'TypeError')) {
      return md.getUserMedia({ audio: true });
    }
    throw e;
  }
}

// Resolves once recording has started. finish() stops the recorder and all
// tracks and resolves with the recorded Blob (may be empty for very short takes).
export async function startRecording() {
  const stream = await openMic();
  const mimeType = pickMimeType();
  let rec;
  try {
    if (typeof MediaRecorder === 'undefined') {
      const err = new Error('MediaRecorder не поддерживается этим браузером');
      err.name = 'NotSupportedError';
      throw err;
    }
    rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (e) {
    stopTracks(stream);
    throw e;
  }

  const chunks = [];
  rec.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  let failure = null;
  rec.onerror = (ev) => {
    failure = (ev && ev.error) || ev;
  };

  try {
    rec.start();
  } catch (e) {
    stopTracks(stream);
    throw e;
  }

  let done = null;
  return {
    finish() {
      if (done) return done;
      done = new Promise((resolve, reject) => {
        const settle = () => {
          stopTracks(stream);
          if (failure) reject(failure);
          else resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/mp4' }));
        };
        if (rec.state === 'inactive') {
          settle();
          return;
        }
        rec.onstop = settle;
        try {
          rec.stop();
        } catch (e) {
          stopTracks(stream);
          reject(e);
        }
      });
      return done;
    },
  };
}
