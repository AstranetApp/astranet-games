// Настройки игрока живут в localStorage: они про устройство (громкость,
// скорость чтения), а не про аккаунт, и на сервер им незачем.

export interface Settings {
  volume: number;      // громкость музыки, 0…1
  muted: boolean;
  voice: number;       // громкость голосов персонажей, 0…1
  textSpeed: number;   // миллисекунд на символ в новелле
}

const KEY = 'happygoi.settings';

export const DEFAULTS: Settings = { volume: 0.55, muted: false, voice: 0.9, textSpeed: 22 };

export const TEXT_SPEEDS = [
  { id: 'slow', label: 'Неспешно', ms: 34 },
  { id: 'normal', label: 'Обычно', ms: 22 },
  { id: 'fast', label: 'Быстро', ms: 10 },
];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    const clamp = (v: unknown, def: number) =>
      typeof v === 'number' ? Math.min(1, Math.max(0, v)) : def;
    return {
      volume: clamp(s.volume, DEFAULTS.volume),
      muted: !!s.muted,
      voice: clamp(s.voice, DEFAULTS.voice),
      textSpeed: typeof s.textSpeed === 'number' ? s.textSpeed : DEFAULTS.textSpeed,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ }
}
