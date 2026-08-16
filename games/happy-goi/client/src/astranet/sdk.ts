// ============================================================
// Astranet Web Tab SDK.
// Протокол целиком: docs/web-tab-sdk.md в корне репозитория.
//
// Игра запрашивает у клиента Astranet анонимный pairwise-токен
// (22 символа base64url). Токен стабилен для игрока на этом сайте
// и не раскрывает аккаунт. Мы используем его как идентификатор
// жильца: прогресс, серия побед и место в таблице ЖК.
//
// Вне Astranet (обычный браузер) — гостевой режим с UUID в
// localStorage: играть можно всё, но прогресс живёт в браузере.
// ============================================================

const REQ_TIMEOUT_MS = 3000;

declare global {
  interface Window {
    AstranetBridge?: { postMessage(payload: string): void };
  }
}

interface IdentityResponse {
  astranet?: string;
  id?: string;
  token?: string;
  error?: string;
}

// Запрос токена. Транспорт зависит от платформы клиента:
//  - Web (PWA): игра в iframe -> window.parent.postMessage
//  - Native (Android/iOS): игра в WebView -> window.AstranetBridge
// Формат сообщений одинаковый.
export function astranetGetIdentity(timeoutMs = REQ_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);

    const onMessage = (e: MessageEvent) => {
      const d = e.data as IdentityResponse | null;
      if (!d || d.astranet !== 'identity.response' || d.id !== id) return;
      cleanup();
      if (d.token) resolve(d.token);
      else reject(new Error(d.error || 'unavailable'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);

    const req = { astranet: 'identity.request', id };
    if (window.AstranetBridge) {
      window.AstranetBridge.postMessage(JSON.stringify(req)); // native WebView
    } else if (window.parent !== window) {
      window.parent.postMessage(req, '*');                    // iframe в PWA
    } else {
      cleanup();
      reject(new Error('not embedded in Astranet'));
    }
  });
}

// Гостевой идентификатор — фолбэк вне Astranet.
function guestId(): string {
  const KEY = 'happygoi.guest';
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { /* приватный режим */ }
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(KEY, id); } catch { /* ок, будет эфемерный */ }
  }
  return id;
}

export type AuthKind = 'astra' | 'guest';
export interface Auth { kind: AuthKind; header: string }

// Возвращает объект авторизации для нашего API.
// ВАЖНО: токен — bearer-идентификатор. Не показываем в UI, не кладём
// в URL; он уходит только в заголовок запросов к нашему же серверу.
export async function resolveAuth(): Promise<Auth> {
  try {
    const token = await astranetGetIdentity();
    return { kind: 'astra', header: 'astra ' + token };
  } catch {
    return { kind: 'guest', header: 'guest ' + guestId() };
  }
}
