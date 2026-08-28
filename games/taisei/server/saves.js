// Validates and stores the narrow account-save payload. Replays, screenshots,
// caches, and arbitrary Emscripten paths are intentionally outside this API.

import { createHash } from 'node:crypto';

export const SAVE_SCHEMA_VERSION = 1;
export const MAX_REQUEST_BYTES = 1_600_000;
export const SAVE_LIMITS = Object.freeze({
  'config': 64 * 1024,
  'progress.zst': 1024 * 1024,
});

export class SaveValidationError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > 1_500_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new SaveValidationError(400, 'invalid base64');
  }
  return Buffer.from(value, 'base64');
}

export function normalizeSave(body) {
  if (!body || body.schemaVersion !== SAVE_SCHEMA_VERSION || !Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0) {
    throw new SaveValidationError(400, 'invalid save envelope');
  }
  if (!Array.isArray(body.files) || body.files.length > Object.keys(SAVE_LIMITS).length) {
    throw new SaveValidationError(400, 'invalid files');
  }

  const seen = new Set();
  const files = [];
  let total = 0;
  for (const input of body.files) {
    if (!input || typeof input.path !== 'string' || !Object.hasOwn(SAVE_LIMITS, input.path) || seen.has(input.path)) {
      throw new SaveValidationError(400, 'invalid path');
    }
    if (input.path.includes('..') || input.path.startsWith('/') || input.path.includes('\\')) {
      throw new SaveValidationError(400, 'invalid path');
    }
    const bytes = decodeBase64(input.data);
    if (bytes.length > SAVE_LIMITS[input.path]) throw new SaveValidationError(413, 'save file too large');
    total += bytes.length;
    if (total > 1_100_000) throw new SaveValidationError(413, 'save too large');
    seen.add(input.path);
    files.push({ path: input.path, data: bytes.toString('base64') });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const payload = Buffer.from(JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, files }));
  const payloadHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { baseRevision: body.baseRevision, files, payload, payloadHash };
}

export function emptySave() {
  const files = [];
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    revision: 0,
    payloadHash: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files,
    updatedAt: null,
  };
}

export function getSave(db, playerId) {
  const row = db.prepare('SELECT schema_version, revision, payload, payload_hash, updated_at FROM saves WHERE player_id = ?').get(playerId);
  if (!row) return emptySave();
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(row.payload).toString('utf8'));
  } catch {
    throw new SaveValidationError(500, 'stored save is corrupt');
  }
  if (decoded.schemaVersion !== row.schema_version || !Array.isArray(decoded.files)) {
    throw new SaveValidationError(500, 'stored save is corrupt');
  }
  return {
    schemaVersion: row.schema_version,
    revision: row.revision,
    payloadHash: row.payload_hash,
    files: decoded.files,
    updatedAt: row.updated_at,
  };
}

export function putSave(db, playerId, body) {
  const save = normalizeSave(body);
  const current = db.prepare('SELECT revision, payload_hash FROM saves WHERE player_id = ?').get(playerId);
  const currentRevision = current?.revision || 0;

  // Retrying a request after losing its response is idempotent even though its
  // base revision is now stale.
  if (current && current.payload_hash === save.payloadHash) return getSave(db, playerId);
  if (save.baseRevision !== currentRevision) {
    const error = new SaveValidationError(409, 'revision conflict');
    error.currentRevision = currentRevision;
    throw error;
  }

  const revision = currentRevision + 1;
  const updatedAt = Date.now();
  db.prepare(`
    INSERT INTO saves (player_id, schema_version, revision, payload, payload_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      revision = excluded.revision,
      payload = excluded.payload,
      payload_hash = excluded.payload_hash,
      updated_at = excluded.updated_at
  `).run(playerId, SAVE_SCHEMA_VERSION, revision, save.payload, save.payloadHash, updatedAt);
  return getSave(db, playerId);
}
