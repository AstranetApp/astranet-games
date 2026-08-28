// Taisei web host: zero-runtime-dependency Node HTTP/SQLite server for the
// official WASM runtime, Astranet identity hashing, and revisioned saves.

import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { getOrCreateSalt, parsePlayerHeader, touchPlayer } from './auth.js';
import { getSave, MAX_REQUEST_BYTES, putSave, SaveValidationError } from './saves.js';
import { contentSecurityPolicy, createStaticHandler } from './static.js';
import { UPSTREAM } from '../scripts/upstream.mjs';

const GAME_ROOT = fileURLToPath(new URL('..', import.meta.url));

function validateFrameAncestors(value) {
  if (typeof value !== 'string' || /[\r\n;]/.test(value)) throw new Error('FRAME_ANCESTORS contains invalid characters');
  const tokens = value.trim().split(/\s+/);
  if (!tokens.length) throw new Error('FRAME_ANCESTORS cannot be empty');
  for (const token of tokens) {
    if (token === "'self'" || token === "'none'") continue;
    const origin = new URL(token);
    if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== token) {
      throw new Error(`Invalid FRAME_ANCESTORS origin: ${token}`);
    }
  }
  return tokens.join(' ');
}

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, 'taisei.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('astra', 'guest')),
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saves (
      player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      payload BLOB NOT NULL,
      payload_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new SaveValidationError(413, 'request too large'));
      try {
        resolvePromise(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new SaveValidationError(400, 'invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function createRateLimiter(limit = 180) {
  const buckets = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
  }, 120_000);
  timer.unref();
  return {
    blocked(key) {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.reset <= now) {
        bucket = { count: 0, reset: now + 60_000 };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      return bucket.count > limit;
    },
    close() { clearInterval(timer); },
  };
}

export function createTaiseiServer(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || resolve(GAME_ROOT, '.data'));
  const runtimeDir = resolve(options.runtimeDir || process.env.RUNTIME_DIR || resolve(GAME_ROOT, 'runtime', 'upstream'));
  const shellDir = resolve(options.shellDir || resolve(GAME_ROOT, 'web', 'shell'));
  const testHostDir = resolve(options.testHostDir || resolve(GAME_ROOT, 'web', 'test-host'));
  const frameAncestors = validateFrameAncestors(options.frameAncestors || process.env.FRAME_ANCESTORS || "'self'");
  const parentOrigin = options.parentOrigin ?? process.env.ASTRANET_PARENT_ORIGIN ?? '';
  if (parentOrigin && new URL(parentOrigin).origin !== parentOrigin) throw new Error('ASTRANET_PARENT_ORIGIN must be an exact origin');

  const db = openDatabase(dataDir);
  const salt = getOrCreateSalt(db);
  const rateLimiter = createRateLimiter(options.rateLimit || 180);
  const serveStatic = createStaticHandler({ runtimeDir, shellDir, testHostDir }, frameAncestors);
  const csp = contentSecurityPolicy(frameAncestors);

  const server = http.createServer(async (req, res) => {
    try {
      const rawPath = String(req.url || '/').split(/[?#]/, 1)[0];
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, runtimeVersion: UPSTREAM.version });
      if (url.pathname === '/config.json') {
        return sendJson(res, 200, { parentOrigin, identityTimeoutMs: 3000, saveIntervalMs: 30000 }, {
          'Content-Security-Policy': csp,
        });
      }

      if (url.pathname.startsWith('/api/')) {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (rateLimiter.blocked(ip)) return sendJson(res, 429, { error: 'rate limited' });
        const player = parsePlayerHeader(req.headers['x-player'], salt);
        if (!player) return sendJson(res, 401, { error: 'invalid player' });
        touchPlayer(db, player);

        if (req.method === 'POST' && url.pathname === '/api/hello') {
          const save = getSave(db, player.id);
          return sendJson(res, 200, { mode: player.kind, saveRevision: save.revision });
        }
        if (req.method === 'GET' && url.pathname === '/api/save') {
          const save = getSave(db, player.id);
          return sendJson(res, 200, save, { ETag: `"taisei-save-${save.revision}"` });
        }
        if (req.method === 'PUT' && url.pathname === '/api/save') {
          const save = putSave(db, player.id, await readJson(req));
          return sendJson(res, 200, save, { ETag: `"taisei-save-${save.revision}"` });
        }
        return sendJson(res, 404, { error: 'not found' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD' });
      await serveStatic(req, res, rawPath);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      if (error instanceof SaveValidationError) {
        const body = { error: error.code };
        if (error.currentRevision !== undefined) body.currentRevision = error.currentRevision;
        sendJson(res, error.status, body);
        return;
      }
      console.error(`Request failed: ${error?.message || 'unknown error'}`);
      sendJson(res, 500, { error: 'internal' });
    }
  });

  server.once('close', () => {
    rateLimiter.close();
    db.close();
  });
  return { server, dataDir, runtimeDir, frameAncestors, db };
}

export async function startTaiseiServer(options = {}) {
  const app = createTaiseiServer(options);
  const port = Number(options.port ?? process.env.PORT ?? 8098);
  await new Promise((resolvePromise, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, options.host || '127.0.0.1', resolvePromise);
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startTaiseiServer().then((app) => {
    const address = app.server.address();
    const host = address.address.includes(':') ? `[${address.address}]` : address.address;
    const base = `http://${host}:${address.port}`;
    console.log(`Taisei ${UPSTREAM.version} standalone: ${base}/`);
    console.log(`Astranet test host: ${base}/test-host/`);
    console.log(`SQLite data directory: ${app.dataDir}`);
    console.log(`Runtime directory: ${app.runtimeDir}`);
    console.log(`CSP frame-ancestors: ${app.frameAncestors}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
