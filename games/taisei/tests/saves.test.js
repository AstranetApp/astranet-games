// End-to-end API/SQLite tests for identity hashing, payload limits, revisions,
// idempotent retries, and account isolation.

import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import { createTaiseiServer } from '../server/server.js';

const cleanup = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});

async function start() {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'taisei-api-'));
  const app = createTaiseiServer({ dataDir });
  await new Promise((resolvePromise) => app.server.listen(0, '127.0.0.1', resolvePromise));
  const address = app.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  cleanup.push(async () => {
    if (app.server.listening) await new Promise((resolvePromise) => app.server.close(resolvePromise));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { app, base, dataDir };
}

async function api(base, header, method, path, body) {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(header ? { 'X-Player': header } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('creates profiles and rejects invalid X-Player', async () => {
  const { base } = await start();
  assert.equal((await api(base, null, 'POST', '/api/hello', {})).status, 401);
  const guest = await api(base, 'guest 123e4567-e89b-42d3-a456-426614174000', 'POST', '/api/hello', {});
  assert.equal(guest.status, 200);
  assert.deepEqual(await guest.json(), { mode: 'guest', saveRevision: 0 });
  const astra = await api(base, 'astra devAstranetToken123456', 'POST', '/api/hello', {});
  assert.equal(astra.status, 200);
  assert.equal((await astra.json()).mode, 'astra');
});

test('writes, reads, retries, and rejects stale revisions', async () => {
  const { base } = await start();
  const header = 'astra devAstranetToken123456';
  const empty = await api(base, header, 'GET', '/api/save');
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).revision, 0);

  const firstBody = {
    schemaVersion: 1,
    baseRevision: 0,
    files: [{ path: 'config', data: Buffer.from('fullscreen = 0\n').toString('base64') }],
  };
  const first = await api(base, header, 'PUT', '/api/save', firstBody);
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.equal(saved.revision, 1);
  assert.equal(first.headers.get('etag'), '"taisei-save-1"');

  const retry = await api(base, header, 'PUT', '/api/save', firstBody);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).revision, 1);

  const stale = await api(base, header, 'PUT', '/api/save', {
    ...firstBody,
    files: [{ path: 'config', data: Buffer.from('fullscreen = 1\n').toString('base64') }],
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'revision conflict', currentRevision: 1 });

  const read = await api(base, header, 'GET', '/api/save');
  assert.equal((await read.json()).files[0].data, firstBody.files[0].data);
});

test('enforces file allowlist and size limits', async () => {
  const { base } = await start();
  const header = 'guest 123e4567-e89b-42d3-a456-426614174000';
  const traversal = await api(base, header, 'PUT', '/api/save', {
    schemaVersion: 1,
    baseRevision: 0,
    files: [{ path: '../config', data: '' }],
  });
  assert.equal(traversal.status, 400);
  const oversized = await api(base, header, 'PUT', '/api/save', {
    schemaVersion: 1,
    baseRevision: 0,
    files: [{ path: 'config', data: Buffer.alloc(64 * 1024 + 1).toString('base64') }],
  });
  assert.equal(oversized.status, 413);
});

test('does not persist the raw Astranet token in SQLite files', async () => {
  const { app, base, dataDir } = await start();
  const token = 'devAstranetToken123456';
  await api(base, `astra ${token}`, 'POST', '/api/hello', {});
  await api(base, `astra ${token}`, 'PUT', '/api/save', {
    schemaVersion: 1,
    baseRevision: 0,
    files: [{ path: 'config', data: Buffer.from('safe').toString('base64') }],
  });
  app.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (const name of await readdir(dataDir)) {
    const bytes = await readFile(resolve(dataDir, name));
    assert.equal(bytes.includes(Buffer.from(token)), false, `${name} contains the raw token`);
  }
});
