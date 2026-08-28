// Owns browser capability checks, official Emscripten startup ordering,
// lifecycle/focus integration, identity, and local/account save coordination.

import { resolveAuth } from './astranet-sdk.js';
import { createFilesystemAdapter, createSaveSynchronizer } from './save-sync.js';

const elements = {
  boot: document.querySelector('#boot'),
  canvas: document.querySelector('#canvas'),
  status: document.querySelector('#status'),
  progress: document.querySelector('#progress'),
  warning: document.querySelector('#warning'),
  mode: document.querySelector('#mode'),
  save: document.querySelector('#save-state'),
  focus: document.querySelector('#focus'),
  fullscreen: document.querySelector('#fullscreen'),
};

const diagnostics = window.__taiseiDiagnostics = {
  runtimeVersion: '1.4.6',
  runtimeState: 'checking',
  authMode: null,
  webAssembly: typeof WebAssembly === 'object',
  webgl2: false,
  indexedDB: typeof indexedDB === 'object',
  wasmInstantiated: false,
  firstFrame: false,
  saveState: 'waiting',
};
const localDiagnostics = ['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('diagnostics');

function publishState() {
  window.dispatchEvent(new CustomEvent('astranet:taisei-state', { detail: { ...diagnostics } }));
}

function setStatus(text) {
  elements.status.textContent = text;
  publishState();
}

function setWarning(text) {
  elements.warning.textContent = text;
  elements.warning.hidden = !text;
}

function setSaveState(text, warning = false) {
  elements.save.textContent = `Save: ${text}`;
  diagnostics.saveState = text;
  if (warning) setWarning(text);
  publishState();
}

function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`Unable to start Taisei: ${message}`);
  diagnostics.runtimeState = 'error';
  publishState();
  setWarning('Reload after resolving the diagnostic above. Local data has not been deleted.');
}

async function loadConfig() {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`configuration HTTP ${response.status}`);
  return response.json();
}

function loadRuntimeScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/taisei.js';
    script.async = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('taisei.js failed to load')), { once: true });
    document.head.append(script);
  });
}

function webglContext(canvas) {
  return canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });
}

function resizeCanvas() {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(elements.canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(elements.canvas.clientHeight * ratio));
  if (elements.canvas.width !== width) elements.canvas.width = width;
  if (elements.canvas.height !== height) elements.canvas.height = height;
}

async function boot() {
  if (!diagnostics.webAssembly) throw new Error('WebAssembly is not supported');
  if (!diagnostics.indexedDB) throw new Error('IndexedDB is not available');
  const gl = webglContext(elements.canvas);
  diagnostics.webgl2 = Boolean(gl);
  if (!gl) throw new Error('WebGL 2 is not available');
  publishState();

  const config = await loadConfig();
  const authPromise = resolveAuth(config);
  diagnostics.runtimeState = 'loading';
  setStatus('Loading the official Taisei runtime…');
  await loadRuntimeScript();
  if (typeof window.createTaisei !== 'function') throw new Error('Taisei module factory is missing');

  let firstFrameResolve;
  const firstFrame = new Promise((resolve) => { firstFrameResolve = resolve; });
  const module = await window.createTaisei({
    canvas: elements.canvas,
    preinitializedWebGLContext: gl,
    onFirstFrame() {
      diagnostics.firstFrame = true;
      diagnostics.runtimeState = 'running';
      elements.canvas.style.visibility = 'visible';
      elements.boot.classList.add('complete');
      elements.canvas.focus({ preventScroll: true });
      firstFrameResolve();
      publishState();
    },
    print(text) { console.log(String(text)); },
    printErr(text) { console.error(String(text)); },
    setStatus(text) {
      const match = String(text || '').match(/([^(]+)\((\d+(?:\.\d+)?)\/(\d+)\)/);
      if (match) {
        elements.progress.hidden = false;
        elements.progress.value = Number(match[2]);
        elements.progress.max = Number(match[3]);
        setStatus(match[1].trim());
      } else if (text) {
        elements.progress.hidden = true;
        setStatus(String(text));
      }
    },
    onAbort(reason) { fatal(new Error(`runtime aborted: ${reason}`)); },
  });
  if (localDiagnostics) window.__taiseiModule = module;
  diagnostics.wasmInstantiated = true;
  module.initFilesystem();
  const fs = createFilesystemAdapter(module);
  await fs.sync(true);

  const auth = await authPromise;
  diagnostics.authMode = auth.kind;
  elements.mode.textContent = `Identity: ${auth.kind === 'astra' ? 'Astranet' : 'guest'}`;
  publishState();

  const saveSync = createSaveSynchronizer({ fs, auth, intervalMs: config.saveIntervalMs, onState: setSaveState });
  await saveSync.restoreBeforeBoot();
  setStatus('Starting Taisei…');
  resizeCanvas();
  module.callMain();
  saveSync.start();

  let pausedByVisibility = false;
  const onVisibility = () => {
    if (document.hidden) {
      saveSync.syncNow();
      if (typeof module.pauseMainLoop === 'function') {
        module.pauseMainLoop();
        pausedByVisibility = true;
      }
      const audioContext = module.SDL2?.audioContext;
      if (audioContext?.state === 'running') audioContext.suspend().catch(() => {
        // Browser audio policy may reject a programmatic suspend; gameplay remains paused.
      });
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      module.resumeMainLoop?.();
      elements.canvas.focus({ preventScroll: true });
    }
  };
  const onPageHide = () => { saveSync.syncNow(); };
  const onContextLost = (event) => {
    event.preventDefault();
    setWarning('WebGL context was lost. Reload the page after the local save finishes.');
    saveSync.syncNow();
  };
  const focusCanvas = () => elements.canvas.focus({ preventScroll: true });
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(elements.canvas);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  elements.canvas.addEventListener('webglcontextlost', onContextLost);
  elements.canvas.addEventListener('pointerdown', focusCanvas);
  elements.focus.addEventListener('click', focusCanvas);
  elements.fullscreen.addEventListener('click', () => {
    elements.canvas.requestFullscreen().catch((error) => setWarning(`Fullscreen is unavailable: ${error.message}`));
  });

  const dispose = () => {
    saveSync.dispose();
    fs.dispose();
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    elements.canvas.removeEventListener('webglcontextlost', onContextLost);
    elements.canvas.removeEventListener('pointerdown', focusCanvas);
  };
  window.addEventListener('pagehide', dispose, { once: true });

  if (localDiagnostics) {
    window.__taiseiTest = {
      async writeAllowedFile(path, text) {
        if (!['config', 'progress.zst'].includes(path)) throw new Error('path is not allowed');
        fs.ensureStorage();
        fs.writeFile(`/persistent/storage/${path}`, text);
      },
      readAllowedFile(path) {
        return fs.readFile(`/persistent/storage/${path}`, 'utf8');
      },
      flushLocal: () => fs.sync(false),
      syncNow: saveSync.syncNow,
    };
  }

  await firstFrame;
}

window.addEventListener('error', (event) => {
  if (!diagnostics.firstFrame) fatal(event.error || new Error(event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  if (!diagnostics.firstFrame) fatal(event.reason || new Error('Unhandled boot rejection'));
});

boot().catch(fatal);
