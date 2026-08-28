// Development-only Astranet parent emulator. The fixed bearer is never shown,
// logged, or reused outside this local test contract.

const DEVELOPMENT_TOKEN = 'devAstranetToken123456';
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;
const iframe = document.querySelector('#game');
const events = document.querySelector('#events');
let loadedOnce = false;

function status(text) {
  const item = document.createElement('li');
  item.textContent = text;
  events.append(item);
}

iframe.addEventListener('load', () => {
  status(loadedOnce ? 'iframe reloaded' : 'iframe loaded');
  loadedOnce = true;
});

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.astranet !== 'identity.request' || !REQUEST_ID.test(String(data.id || ''))) return;
  status('identity requested');
  iframe.contentWindow.postMessage({ astranet: 'identity.response', id: data.id, token: DEVELOPMENT_TOKEN }, event.origin);
  status('identity issued');
});

document.querySelector('#reload').addEventListener('click', () => {
  status('iframe reload requested');
  iframe.src = iframe.src;
});
document.querySelector('#standalone').addEventListener('click', () => {
  window.open('/?diagnostics=1', '_blank', 'noopener');
});
