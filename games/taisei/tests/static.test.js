// Production-like static server tests for traversal, streaming Range/HEAD,
// MIME, caching, and iframe security headers.

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { createTaiseiServer } from '../server/server.js';

const cleanup = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'taisei-static-'));
  const shellDir = resolve(root, 'shell');
  const testHostDir = resolve(root, 'test-host');
  const runtimeDir = resolve(root, 'runtime');
  const dataDir = resolve(root, 'database');
  await Promise.all([mkdir(shellDir), mkdir(testHostDir), mkdir(resolve(runtimeDir, 'data'), { recursive: true })]);
  await Promise.all([
    writeFile(resolve(shellDir, 'index.html'), '<!doctype html><title>game</title>'),
    writeFile(resolve(shellDir, 'attribution.html'), '<!doctype html><title>credits</title>'),
    writeFile(resolve(testHostDir, 'index.html'), '<!doctype html><title>host</title>'),
    writeFile(resolve(runtimeDir, 'taisei.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])),
    writeFile(resolve(runtimeDir, 'taisei.js'), 'globalThis.fixture = true;'),
  ]);
  const app = createTaiseiServer({ dataDir, shellDir, testHostDir, runtimeDir });
  await new Promise((resolvePromise) => app.server.listen(0, '127.0.0.1', resolvePromise));
  const port = app.server.address().port;
  cleanup.push(async () => {
    if (app.server.listening) await new Promise((resolvePromise) => app.server.close(resolvePromise));
    await rm(root, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${port}`, port };
}

function rawRequest(port, path, method = 'GET', headers = {}) {
  return new Promise((resolvePromise, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('serves health, HEAD, WASM MIME, and secure iframe headers', async () => {
  const { base } = await fixture();
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const html = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('cache-control'), 'no-cache');
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(html.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
  assert.equal(html.headers.get('x-frame-options'), null);
  const wasm = await fetch(`${base}/taisei.wasm`, { method: 'HEAD' });
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('content-length'), '8');
});

test('streams valid byte ranges and rejects invalid ranges', async () => {
  const { port } = await fixture();
  const partial = await rawRequest(port, '/taisei.wasm', 'GET', { Range: 'bytes=1-3' });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers['content-range'], 'bytes 1-3/8');
  assert.deepEqual([...partial.body], [97, 115, 109]);
  const invalid = await rawRequest(port, '/taisei.wasm', 'GET', { Range: 'bytes=99-100' });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers['content-range'], 'bytes */8');
});

test('blocks traversal, missing files, and non-GET static methods', async () => {
  const { port } = await fixture();
  assert.equal((await rawRequest(port, '/%2e%2e/secret')).status, 403);
  assert.equal((await rawRequest(port, '/missing.file')).status, 404);
  const method = await rawRequest(port, '/', 'POST');
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, 'GET, HEAD');
});
