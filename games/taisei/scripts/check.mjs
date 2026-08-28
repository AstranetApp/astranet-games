// Fast source and pinned-manifest checks; real runtime verification is added
// automatically when `npm run prepare` has already completed.

import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyManifest, verifyRuntime } from './verify-upstream.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['scripts', 'server', 'web', 'tests'];

async function javascriptFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await javascriptFiles(path));
    else if (['.js', '.mjs'].includes(extname(entry.name))) result.push(path);
  }
  return result;
}

verifyManifest();
for (const relative of SOURCE_DIRS) {
  for (const file of await javascriptFiles(resolve(ROOT, relative))) {
    const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (check.status !== 0) process.exit(check.status || 1);
  }
}

try {
  await verifyRuntime();
  console.log('Source syntax, pinned manifest, and prepared runtime are valid');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  console.log('Source syntax and pinned manifest are valid; runtime is not prepared');
}
