// Bridges Taisei's IDBFS account files to the revisioned server API. The local
// IDBFS copy remains authoritative when a conflict or backend failure occurs.

const SCHEMA_VERSION = 1;
const STORAGE_ROOT = '/persistent/storage';
const MANIFEST_PATH = '/persistent/.astranet-save-sync.json';
const ALLOWED = Object.freeze({
  'config': 64 * 1024,
  'progress.zst': 1024 * 1024,
});

function errorMessage(error) {
  if (typeof error === 'string' && error) return error;
  if (error?.message) return error.message;
  if (error?.target?.error?.message) return error.target.error.message;
  if (error?.errno !== undefined) return `filesystem errno ${error.errno}${error?.code ? ` (${error.code})` : ''}`;
  if (error?.name) return error.name;
  return 'unknown error';
}

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function hashFiles(files) {
  const bytes = new TextEncoder().encode(JSON.stringify(files));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

function readManifest(fs) {
  try {
    const parsed = JSON.parse(fs.readFile(MANIFEST_PATH, 'utf8'));
    if (Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 && /^[a-f0-9]{64}$/.test(parsed.payloadHash)) return parsed;
  } catch {
    // Missing or corrupt sync metadata never invalidates Taisei's actual local save.
  }
  return null;
}

function writeManifest(fs, revision, payloadHash) {
  fs.writeFile(MANIFEST_PATH, JSON.stringify({ schemaVersion: SCHEMA_VERSION, revision, payloadHash }));
}

async function snapshot(fs) {
  fs.ensureStorage();
  const files = [];
  for (const [path, limit] of Object.entries(ALLOWED)) {
    const fullPath = `${STORAGE_ROOT}/${path}`;
    if (!fs.exists(fullPath)) continue;
    const bytes = fs.readFile(fullPath);
    if (bytes.length > limit) throw new Error(`${path} exceeds the local sync limit`);
    files.push({ path, data: toBase64(bytes) });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, payloadHash: await hashFiles(files) };
}

function validateRemote(remote) {
  if (!remote || remote.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(remote.revision) || remote.revision < 0 || !/^[a-f0-9]{64}$/.test(String(remote.payloadHash || '')) || !Array.isArray(remote.files)) {
    throw new Error('Server returned an invalid save envelope');
  }
  const seen = new Set();
  for (const file of remote.files) {
    if (!file || !Object.hasOwn(ALLOWED, file.path) || seen.has(file.path) || typeof file.data !== 'string') {
      throw new Error('Server returned an invalid save path');
    }
    const bytes = fromBase64(file.data);
    if (bytes.length > ALLOWED[file.path]) throw new Error('Server returned an oversized save file');
    seen.add(file.path);
  }
  return remote;
}

function applyRemote(fs, remote) {
  fs.ensureStorage();
  for (const path of Object.keys(ALLOWED)) {
    const file = remote.files.find((candidate) => candidate.path === path);
    const fullPath = `${STORAGE_ROOT}/${path}`;
    if (file) fs.writeFile(fullPath, fromBase64(file.data));
    else {
      try {
        fs.unlink(fullPath);
      } catch {
        // A missing optional save file already matches the remote snapshot.
      }
    }
  }
}

function findSyncMethod(FS) {
  const candidates = Object.entries(FS).filter(([, value]) =>
    typeof value === 'function' && value.toString().includes('FS.syncfs operations in flight'));
  if (candidates.length !== 1) throw new Error(`Expected one Emscripten syncfs implementation, received ${candidates.length}`);
  return candidates[0][0];
}

export function createFilesystemAdapter(module) {
  const FS = module.FS;
  const syncMethod = findSyncMethod(FS);
  const original = FS[syncMethod].bind(FS);
  let queue = Promise.resolve();
  const queuedSync = (populate, callback) => {
    if (typeof populate === 'function') {
      callback = populate;
      populate = false;
    }
    queue = queue.catch(() => undefined).then(() => new Promise((resolve) => {
      try {
        original(Boolean(populate), (error) => {
          try {
            callback?.(error);
          } finally {
            resolve();
          }
        });
      } catch (error) {
        try {
          callback?.(error);
        } finally {
          resolve();
        }
      }
    }));
  };
  FS[syncMethod] = queuedSync;

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (typeof value === 'string') return new TextEncoder().encode(value);
    throw new TypeError('Filesystem writes require a string or Uint8Array');
  }

  return {
    ensureStorage() {
      module.FS_createPath('/persistent', 'storage', true, true);
    },
    exists(path) {
      try {
        FS.stat(path);
        return true;
      } catch (error) {
        if (error?.name === 'ErrnoError') return false;
        throw error;
      }
    },
    readFile(path, encoding = 'binary') {
      const info = FS.stat(path);
      const stream = FS.open(path, 'r');
      try {
        const bytes = new Uint8Array(info.size);
        if (bytes.length) FS.read(stream, bytes, 0, bytes.length, 0);
        return encoding === 'utf8' ? new TextDecoder().decode(bytes) : bytes;
      } finally {
        FS.close(stream);
      }
    },
    writeFile(path, value) {
      const bytes = asBytes(value);
      const stream = FS.open(path, 'w');
      try {
        if (bytes.length) FS.write(stream, bytes, 0, bytes.length, 0);
      } finally {
        FS.close(stream);
      }
    },
    unlink(path) {
      module.FS_unlink(path);
    },
    sync(populate) {
      return new Promise((resolve, reject) => {
        queuedSync(populate, (error) => error ? reject(error) : resolve());
      });
    },
    dispose() {
      FS[syncMethod] = original;
    },
  };
}

export function createSaveSynchronizer({ fs, auth, onState, intervalMs = 30000 }) {
  let revision = 0;
  let remoteHash = null;
  let conflict = false;
  let timer = null;
  let inFlight = Promise.resolve();

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'X-Player': auth.header, ...options.headers },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({ error: 'invalid response' }));
      if (!response.ok) {
        const error = new Error(body.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.currentRevision = body.currentRevision;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function upload(local, baseRevision) {
    const saved = validateRemote(await api('/api/save', {
      method: 'PUT',
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, baseRevision, files: local.files }),
    }));
    revision = saved.revision;
    remoteHash = saved.payloadHash;
    writeManifest(fs, revision, remoteHash);
    await fs.sync(false);
    onState(`synced r${revision}`);
  }

  async function restoreBeforeBoot() {
    try {
      await api('/api/hello', { method: 'POST', body: '{}' });
      const remote = validateRemote(await api('/api/save'));
      const local = await snapshot(fs);
      const manifest = readManifest(fs);
      revision = remote.revision;
      remoteHash = remote.payloadHash;

      if (remote.revision === 0) {
        if (local.files.length) await upload(local, 0);
        else {
          writeManifest(fs, 0, remote.payloadHash);
          await fs.sync(false);
          onState('local only');
        }
      } else if (local.payloadHash === remote.payloadHash) {
        writeManifest(fs, remote.revision, remote.payloadHash);
        await fs.sync(false);
        onState(`synced r${remote.revision}`);
      } else if (!local.files.length || (manifest && manifest.payloadHash === local.payloadHash && manifest.revision < remote.revision)) {
        applyRemote(fs, remote);
        writeManifest(fs, remote.revision, remote.payloadHash);
        await fs.sync(false);
        onState(`restored r${remote.revision}`);
      } else if (manifest && manifest.revision === remote.revision) {
        await upload(local, remote.revision);
      } else {
        conflict = true;
        onState('conflict — local kept', true);
      }
    } catch (error) {
      onState(`server unavailable — local kept (${errorMessage(error)})`, true);
    }
  }

  function syncNow() {
    inFlight = inFlight.then(async () => {
      await fs.sync(false);
      if (conflict) return;
      const local = await snapshot(fs);
      if (local.payloadHash === remoteHash) return;
      try {
        await upload(local, revision);
      } catch (error) {
        if (error.status === 409) {
          conflict = true;
          onState('conflict — local kept', true);
        } else {
          onState(`server pending — local saved (${errorMessage(error)})`, true);
        }
      }
    }).catch((error) => onState(`local save failed (${errorMessage(error)})`, true));
    return inFlight;
  }

  function start() {
    if (!timer) timer = setInterval(syncNow, intervalMs);
  }

  function dispose() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { restoreBeforeBoot, syncNow, start, dispose, snapshot: () => snapshot(fs) };
}
