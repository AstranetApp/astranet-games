// Типы движка визуальной новеллы.
// Сцена — это просто массив шагов; каждый шаг описывает, что изменилось
// на сцене (фон, кто стоит слева/справа) и какую реплику показать.

export type CharId = 'maru' | 'bulochka' | 'ell' | 'chester';
export type SpeakerId = CharId | 'narrator' | 'player';
// Три места на сцене: втроём персонажи помещаются, и приход нового больше
// не выталкивает того, кто уже разговаривает.
export type Slot = 'left' | 'center' | 'right';
export const SLOTS: Slot[] = ['left', 'center', 'right'];

export interface Character {
  id: CharId;
  name: string;
  role: string;
  /** пустая строка — персонаж говорит, но на сцене не показывается */
  sprite: string;
  color: string;      // цвет имени в рамке реплики
  /** множитель роста: у крупно нарисованных спрайтов он меньше единицы */
  scale?: number;
}

export interface VNStep {
  /** фон: id картинки, null — чёрный экран */
  bg?: string | null;
  /** затемнение фона, 0 — как есть, 1 — почти чёрный (сумерки, ночь) */
  dim?: number;
  /** кто стоит в слоте; null — уходит со сцены */
  cast?: Partial<Record<Slot, CharId | null>>;
  /** кто говорит; 'narrator' — мысли героя, без рамки имени */
  speaker?: SpeakerId;
  text: string;
  /** визуальный акцент на шаге */
  fx?: 'shake' | 'flash';
  /** затемнить всех, кроме говорящего (по умолчанию — да) */
  dimOthers?: boolean;
}

export type Scene = VNStep[];

export const CHARS: Record<CharId, Character> = {
  maru: {
    id: 'maru',
    name: 'Мару',
    role: 'консьерж ЖК',
    sprite: '/assets/maru.webp',
    color: '#8fe3cd',
  },
  bulochka: {
    id: 'bulochka',
    name: 'Святая Булочка',
    role: 'консьерж ЖК',
    sprite: '/assets/bulochka.webp',
    color: '#ffd98a',
  },
  ell: {
    id: 'ell',
    name: 'Ell Mersenz',
    role: 'самоназначенный президент шлагбаума',
    sprite: '/assets/ell.webp',
    color: '#8fb8ff',
    // портрет нарисован крупным планом — рядом с остальными он подавлял кадр
    scale: 0.78,
  },
  // Спрайта нет: Чэстер появляется голосом над носилками, в кадр не лезет.
  chester: {
    id: 'chester',
    name: 'Чэстер',
    role: 'медик ЖК',
    sprite: '',
    color: '#9ff0b8',
  },
};

export const speakerName = (s: SpeakerId | undefined): string | null => {
  if (!s || s === 'narrator') return null;
  if (s === 'player') return 'Вы';
  return CHARS[s].name;
};

export const speakerColor = (s: SpeakerId | undefined): string => {
  if (!s || s === 'narrator') return '#cfc3e8';
  if (s === 'player') return '#ffb7d5';
  return CHARS[s].color;
};
