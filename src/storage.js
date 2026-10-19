// Keeps the last round in IndexedDB so it survives a page reload: one 'state'
// record plus one record per take ('audio:A', 'audio:B0', …, Float32Array).
// Every operation runs in its own transaction, strictly in call order.
const DB_NAME = 'pesnya-naoborot';
const STORE = 'kv';
const STATE_KEY = 'state';
const AUDIO_PREFIX = 'audio:';

let dbPromise = null;
let connection = null; // the open IDBDatabase, if any

// Forgets the connection, so the next operation opens a fresh one.
function dropDb() {
  if (connection) {
    try {
      connection.close();
    } catch {
      // already closed
    }
  }
  connection = null;
  dbPromise = null;
}

function openDb() {
  if (!dbPromise) {
    const p = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        reject(new DOMException('IndexedDB недоступен в этом браузере', 'NotSupportedError'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        const forget = () => {
          if (connection === db) dropDb();
          else db.close();
        };
        db.onversionchange = forget;
        db.onclose = forget; // e.g. WebKit lost its IndexedDB server while in the background
        connection = db;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    dbPromise = p;
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
  }
  return dbPromise;
}

// Runs fn(store) in one transaction; resolves with fn's return value once the
// transaction has committed (so request results returned by fn are filled in).
async function attempt(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    // A failed request's error reaches tx.onerror before the transaction aborts,
    // while tx.error is still null: take the request's own error.
    tx.onerror = (ev) => reject(
        (ev && ev.target && ev.target.error) ||
          tx.error ||
          new DOMException('запрос к IndexedDB не удался', 'UnknownError'),
      );
    tx.onabort = () => reject(tx.error || new DOMException('транзакция IndexedDB прервана', 'AbortError'));
    try {
      result = fn(tx.objectStore(STORE));
    } catch (e) {
      reject(e);
      try {
        tx.abort();
      } catch {
        // already finished
      }
    }
  });
}

// A connection can go bad (closed, lost after backgrounding): a failed
// operation is retried once on a fresh connection before the error is passed on.
async function run(mode, fn) {
  try {
    return await attempt(mode, fn);
  } catch {
    dropDb();
    return attempt(mode, fn);
  }
}

let queue = Promise.resolve();

function enqueue(op) {
  const p = queue.then(op);
  queue = p.catch(() => {});
  return p;
}

// `state` is any structured-clonable snapshot of the round.
export function saveState(state) {
  return enqueue(() => run('readwrite', (store) => store.put(state, STATE_KEY)));
}

export function saveAudio(key, samples) {
  return enqueue(() => run('readwrite', (store) => store.put(samples, AUDIO_PREFIX + key)));
}

// The saved round, or null when there is none.
export function loadAll() {
  return enqueue(async () => {
    const { keys, values } = await run('readonly', (store) => ({
      keys: store.getAllKeys(),
      values: store.getAll(),
    }));
    let state = null;
    const audio = {};
    keys.result.forEach((key, i) => {
      const value = values.result[i];
      if (key === STATE_KEY) state = value;
      else if (typeof key === 'string' && key.startsWith(AUDIO_PREFIX) && value instanceof Float32Array) {
        audio[key.slice(AUDIO_PREFIX.length)] = value;
      }
    });
    return state == null ? null : { state, audio };
  });
}

export function clearAll() {
  return enqueue(() => run('readwrite', (store) => store.clear()));
}
