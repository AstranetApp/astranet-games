// Validates the pinned manifest and the extracted release layout without
// trusting file names supplied by the archive.

import { open, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from './fetch-upstream.mjs';
import { UPSTREAM } from './upstream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RUNTIME_DIR = resolve(HERE, '..', 'runtime', 'upstream');

export function verifyManifest() {
  const expectedUrl = `https://github.com/taisei-project/taisei/releases/download/${UPSTREAM.tag}/${UPSTREAM.archiveName}`;
  if (UPSTREAM.archiveUrl !== expectedUrl) throw new Error('Pinned URL is not the expected official GitHub release URL');
  if (!/^[a-f0-9]{64}$/.test(UPSTREAM.archiveSha256)) throw new Error('Pinned SHA-256 has an invalid format');
  if (!/^\d+\.\d+\.\d+$/.test(UPSTREAM.version)) throw new Error('Pinned version has an invalid format');
  return true;
}

export async function verifyArchive(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== UPSTREAM.archiveBytes) {
    throw new Error(`Archive size mismatch: expected ${UPSTREAM.archiveBytes}, received ${info.size}`);
  }
  const digest = await sha256File(path);
  if (digest !== UPSTREAM.archiveSha256) {
    throw new Error(`Archive checksum mismatch: expected ${UPSTREAM.archiveSha256}, received ${digest}`);
  }
}

export async function verifyRuntime(runtimeDir = RUNTIME_DIR) {
  for (const relative of UPSTREAM.expectedFiles) {
    const info = await stat(resolve(runtimeDir, relative));
    if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty upstream file: ${relative}`);
  }

  const dataEntries = await readdir(resolve(runtimeDir, 'data'), { withFileTypes: true });
  if (dataEntries.length < UPSTREAM.minimumDataFiles) {
    throw new Error(`Unexpected data directory: expected at least ${UPSTREAM.minimumDataFiles} files, received ${dataEntries.length}`);
  }
  for (const entry of dataEntries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) {
      throw new Error(`Unexpected entry in upstream data directory: ${entry.name}`);
    }
  }

  const wasm = await open(resolve(runtimeDir, 'taisei.wasm'), 'r');
  try {
    const magic = Buffer.alloc(4);
    await wasm.read(magic, 0, magic.length, 0);
    if (!magic.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) throw new Error('taisei.wasm has an invalid WebAssembly header');
  } finally {
    await wasm.close();
  }

  const glue = await readFile(resolve(runtimeDir, 'taisei.js'), 'utf8');
  if (!glue.includes('createTaisei') || !glue.includes('initFilesystem') || !glue.includes('FS.syncfs operations in flight')) {
    throw new Error('taisei.js does not expose the expected modularized Taisei API');
  }
  const copying = await readFile(resolve(runtimeDir, 'COPYING.txt'), 'utf8');
  if (!copying.includes('CC-BY 4.0') || !copying.includes('unofficial fan-made game')) {
    throw new Error('COPYING.txt does not contain the expected upstream attribution');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(verifyManifest)
    .then(() => process.argv.includes('--manifest-only') ? null : verifyRuntime())
    .then(() => console.log(process.argv.includes('--manifest-only') ? 'Pinned upstream manifest is valid' : 'Extracted upstream runtime is valid'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
