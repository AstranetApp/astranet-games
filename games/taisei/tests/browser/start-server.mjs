// Starts the real runtime for Playwright with disposable SQLite state.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startTaiseiServer } from '../../server/server.js';

const dataDir = await mkdtemp(resolve(tmpdir(), 'taisei-e2e-'));
const app = await startTaiseiServer({ dataDir, port: Number(process.env.TAISEI_E2E_PORT || 8198) });

async function shutdown() {
  if (app.server.listening) await new Promise((resolvePromise) => app.server.close(resolvePromise));
  await rm(dataDir, { recursive: true, force: true });
}

process.once('SIGTERM', () => shutdown().finally(() => process.exit(0)));
process.once('SIGINT', () => shutdown().finally(() => process.exit(0)));
