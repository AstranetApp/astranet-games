// Web-only Astranet identity bridge. It validates source, origin, correlation
// ID, and token shape, then falls back to a non-sensitive local guest UUID.

const GUEST_KEY = 'astranet.taisei.guest';
const ASTRA_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const RESPONSE_ID = /^[A-Za-z0-9_-]{8,80}$/;

function guestId() {
  let value = null;
  try {
    value = localStorage.getItem(GUEST_KEY);
  } catch {
    // Private browsing may deny localStorage; an ephemeral guest remains playable.
  }
  if (!value) {
    value = crypto.randomUUID();
    try {
      localStorage.setItem(GUEST_KEY, value);
    } catch {
      // Persistence is optional for the fallback; the current session can continue.
    }
  }
  return value;
}

export function requestAstranetIdentity({ parentOrigin, timeoutMs = 3000 }) {
  if (window.parent === window) return Promise.reject(new Error('not embedded'));
  const expectedOrigin = parentOrigin || location.origin;
  const id = crypto.randomUUID().replaceAll('-', '');
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onMessage = (event) => {
      if (event.source !== window.parent || event.origin !== expectedOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.astranet !== 'identity.response') return;
      if (!RESPONSE_ID.test(String(data.id || '')) || data.id !== id) return;
      if (typeof data.token === 'string' && ASTRA_TOKEN.test(data.token)) finish(resolve, data.token);
      else finish(reject, new Error('identity unavailable'));
    };
    const timer = setTimeout(() => finish(reject, new Error('identity timeout')), timeoutMs);
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ astranet: 'identity.request', id }, expectedOrigin);
  });
}

export async function resolveAuth(config) {
  try {
    const token = await requestAstranetIdentity(config);
    return { kind: 'astra', header: `astra ${token}` };
  } catch {
    // Identity absence is an expected standalone/offline state, not a boot error.
    return { kind: 'guest', header: `guest ${guestId()}` };
  }
}
