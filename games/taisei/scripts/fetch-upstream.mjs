// Downloads only the pinned official GitHub release and promotes it atomically
// after a streaming SHA-256 verification.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { UPSTREAM } from './upstream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const CACHE_DIR = resolve(ROOT, '.cache');
export const ARCHIVE_PATH = resolve(CACHE_DIR, UPSTREAM.archiveName);

export async function sha256File(path) {
  const hash = createHash('sha256');
  const file = await open(path, 'r');
  try {
    for await (const chunk of file.createReadStream()) hash.update(chunk);
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

async function validCachedArchive() {
  try {
    const info = await stat(ARCHIVE_PATH);
    if (!info.isFile() || info.size !== UPSTREAM.archiveBytes) return false;
    return await sha256File(ARCHIVE_PATH) === UPSTREAM.archiveSha256;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function fetchUpstream() {
  await mkdir(CACHE_DIR, { recursive: true });
  if (await validCachedArchive()) {
    console.log(`Taisei ${UPSTREAM.version}: verified cached archive ${ARCHIVE_PATH}`);
    return ARCHIVE_PATH;
  }

  const partial = `${ARCHIVE_PATH}.part`;
  await rm(partial, { force: true });
  console.log(`Downloading Taisei ${UPSTREAM.version} (${Math.round(UPSTREAM.archiveBytes / 1024 / 1024)} MiB)...`);

  const response = await fetch(UPSTREAM.archiveUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Upstream download failed: HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.url.startsWith('https://github.com/') &&
      !response.url.startsWith('https://release-assets.githubusercontent.com/')) {
    throw new Error(`Unexpected upstream redirect target: ${new URL(response.url).origin}`);
  }

  const hash = createHash('sha256');
  let received = 0;
  let lastPercent = -1;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      const percent = Math.floor(received * 100 / UPSTREAM.archiveBytes);
      if (percent >= lastPercent + 5 || received === UPSTREAM.archiveBytes) {
        lastPercent = percent;
        console.log(`  ${Math.min(percent, 100)}% (${Math.round(received / 1024 / 1024)} MiB)`);
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: 'wx' }));
    const digest = hash.digest('hex');
    if (received !== UPSTREAM.archiveBytes) {
      throw new Error(`Upstream size mismatch: expected ${UPSTREAM.archiveBytes}, received ${received}`);
    }
    if (digest !== UPSTREAM.archiveSha256) {
      throw new Error(`Upstream checksum mismatch: expected ${UPSTREAM.archiveSha256}, received ${digest}`);
    }
    await rename(partial, ARCHIVE_PATH);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }

  console.log(`Verified SHA-256 ${UPSTREAM.archiveSha256}`);
  return ARCHIVE_PATH;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchUpstream().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
