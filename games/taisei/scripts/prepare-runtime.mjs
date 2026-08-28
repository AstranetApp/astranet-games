// Fetches, verifies, and extracts the official release into an ignored runtime
// directory. Extraction is staged so an interrupted run is never accepted.

import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_PATH, fetchUpstream } from './fetch-upstream.mjs';
import { UPSTREAM } from './upstream.mjs';
import { RUNTIME_DIR, verifyArchive, verifyManifest, verifyRuntime } from './verify-upstream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_PARENT = resolve(HERE, '..', 'runtime');

function commandWorks(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

function extractor() {
  if (process.platform === 'win32') {
    const candidates = [
      '7z',
      resolve(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe'),
      resolve(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
    ];
    for (const command of candidates) {
      if (commandWorks(command, [])) return { kind: '7z', command };
    }
  }
  if (commandWorks('tar')) return { kind: 'tar', command: 'tar' };
  throw new Error('Cannot extract .tar.xz: install tar with xz support (Windows: 7-Zip; Debian/Ubuntu: apt install xz-utils tar).');
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function extractWith7z(command, archive, stage) {
  const tarStage = resolve(stage, '.tar-stage');
  await mkdir(tarStage);
  await run(command, ['x', '-y', `-o${tarStage}`, archive], stage);
  const entries = (await readdir(tarStage)).filter((name) => name.endsWith('.tar'));
  if (entries.length !== 1) throw new Error(`Expected exactly one tar payload, received ${entries.length}`);
  await run(command, ['x', '-y', `-o${stage}`, resolve(tarStage, entries[0])], stage);
  await rm(tarStage, { recursive: true, force: true });
}

async function prepareRuntime() {
  verifyManifest();
  try {
    await verifyRuntime();
    console.log(`Taisei ${UPSTREAM.version}: verified prepared runtime ${RUNTIME_DIR}`);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.log(`Existing runtime will be replaced: ${error.message}`);
  }

  const archive = await fetchUpstream();
  await verifyArchive(archive);
  const tool = extractor();
  await mkdir(RUNTIME_PARENT, { recursive: true });
  const stage = resolve(RUNTIME_PARENT, `.stage-${randomUUID()}`);
  const old = resolve(RUNTIME_PARENT, `.old-${randomUUID()}`);
  await mkdir(stage, { recursive: false });
  try {
    if (tool.kind === '7z') {
      await extractWith7z(tool.command, archive, stage);
    } else {
      try {
        await run(tool.command, ['-xJf', archive, '-C', stage], stage);
      } catch (error) {
        throw new Error(`Cannot extract the .tar.xz archive with tar. Install xz support (Debian/Ubuntu: apt install xz-utils tar). ${error.message}`);
      }
    }

    const topEntries = (await readdir(stage)).filter((name) => !name.startsWith('.'));
    if (topEntries.length !== 1 || topEntries[0] !== UPSTREAM.topDirectory) {
      throw new Error(`Unexpected archive root: ${topEntries.join(', ') || '(empty)'}`);
    }
    const extracted = resolve(stage, UPSTREAM.topDirectory);
    await verifyRuntime(extracted);

    let hadRuntime = false;
    try {
      await access(RUNTIME_DIR);
      await rename(RUNTIME_DIR, old);
      hadRuntime = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await rename(extracted, RUNTIME_DIR);
      if (hadRuntime) await rm(old, { recursive: true, force: true });
    } catch (error) {
      if (hadRuntime) await rename(old, RUNTIME_DIR);
      throw error;
    }
    console.log(`Prepared Taisei ${UPSTREAM.version} runtime in ${RUNTIME_DIR}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

prepareRuntime().catch((error) => {
  console.error(error.message);
  console.error(`Archive cache: ${ARCHIVE_PATH}`);
  process.exitCode = 1;
});
