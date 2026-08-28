// Streams shell and upstream runtime files with safe path resolution, MIME,
// Range support, and iframe-compatible security headers.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.zip': 'application/zip',
  '.data': 'application/octet-stream',
  '.tsr': 'application/octet-stream',
});

export function contentSecurityPolicy(frameAncestors) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

function baseHeaders(frameAncestors) {
  return {
    'Content-Security-Policy': contentSecurityPolicy(frameAncestors),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function decodePath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').some((segment) => segment === '..')) return null;
  return decoded;
}

function within(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

export function resolveStaticPath(rawPath, roots) {
  const decoded = decodePath(rawPath);
  if (!decoded) return { forbidden: true };
  let root;
  let localPath;
  let runtime = false;
  if (decoded === '/' || decoded === '/index.html') {
    root = roots.shellDir;
    localPath = 'index.html';
  } else if (decoded === '/attribution/' || decoded === '/attribution/index.html') {
    root = roots.shellDir;
    localPath = 'attribution.html';
  } else if (decoded.startsWith('/shell/')) {
    root = roots.shellDir;
    localPath = decoded.slice('/shell/'.length);
  } else if (decoded === '/test-host' || decoded === '/test-host/' || decoded === '/test-host/index.html') {
    root = roots.testHostDir;
    localPath = 'index.html';
  } else if (decoded.startsWith('/test-host/')) {
    root = roots.testHostDir;
    localPath = decoded.slice('/test-host/'.length);
  } else {
    root = roots.runtimeDir;
    localPath = decoded.slice(1);
    runtime = true;
  }
  const path = resolve(root, localPath);
  if (!within(root, path)) return { forbidden: true };
  return { path, runtime, decoded };
}

function cacheControl(target) {
  const extension = extname(target.path).toLowerCase();
  if (extension === '.html') return 'no-cache';
  if (target.runtime && target.decoded.startsWith('/data/') && /^[a-f0-9]{64}$/.test(target.decoded.slice('/data/'.length))) {
    return 'public, max-age=31536000, immutable';
  }
  return target.runtime ? 'public, max-age=86400' : 'no-cache';
}

export function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { invalid: true };
    end = Math.min(end, size - 1);
  }
  if (start < 0 || start > end || start >= size) return { invalid: true };
  return { start, end };
}

export function createStaticHandler(roots, frameAncestors) {
  return async function serveStatic(req, res, rawPath) {
    const target = resolveStaticPath(rawPath, roots);
    if (target.forbidden) {
      res.writeHead(403, { ...baseHeaders(frameAncestors), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    let info;
    try {
      info = await stat(target.path);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        res.writeHead(404, { ...baseHeaders(frameAncestors), 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      throw error;
    }
    if (!info.isFile()) {
      res.writeHead(404, { ...baseHeaders(frameAncestors), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const type = MIME[extname(target.path).toLowerCase()] || 'application/octet-stream';
    const headers = {
      ...baseHeaders(frameAncestors),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl(target),
      'Content-Type': type,
    };
    const range = parseRange(req.headers.range, info.size);
    if (range?.invalid) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}`, 'Content-Length': '0' });
      res.end();
      return;
    }
    const status = range ? 206 : 200;
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    headers['Content-Length'] = String(info.size === 0 ? 0 : end - start + 1);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || info.size === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(target.path, { start, end });
    stream.on('error', (error) => res.destroy(error));
    stream.pipe(res);
  };
}
