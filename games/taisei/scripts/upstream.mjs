// Pinned upstream artifact contract shared by local preparation, CI, and Docker.

export const UPSTREAM = Object.freeze({
  version: '1.4.6',
  tag: 'v1.4.6',
  archiveName: 'Taisei-1.4.6-emscripten-wasm32.tar.xz',
  archiveSha256: 'a6b742b6db2dd835f8cf199b4fa4e6a213eb09e68e50e89dd55a5254a39298af',
  archiveBytes: 200035100,
  archiveUrl: 'https://github.com/taisei-project/taisei/releases/download/v1.4.6/Taisei-1.4.6-emscripten-wasm32.tar.xz',
  topDirectory: 'Taisei-1.4.6-emscripten-wasm32',
  expectedFiles: [
    'COPYING.txt',
    'README.txt',
    'background.webp',
    'favicon.ico',
    'scythe.webp',
    'taisei.html',
    'taisei.js',
    'taisei.wasm',
  ],
  minimumDataFiles: 500,
});
