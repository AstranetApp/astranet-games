// Сложности и правила начисления очков.
// ВАЖНО: те же числа продублированы в server/server.js (DIFFS) — очки
// считает сервер, здесь они нужны только для предпросмотра в UI.

export type Difficulty = 'novice' | 'amateur' | 'pro';

export interface DiffSpec {
  id: Difficulty;
  title: string;
  subtitle: string;
  w: number;
  h: number;
  mines: number;
  base: number;
  par: number;
  minTime: number;
}

export const DIFFS: Record<Difficulty, DiffSpec> = {
  novice: {
    id: 'novice',
    title: 'Подъезд',
    subtitle: 'Первый этаж, всё спокойно',
    w: 9, h: 9, mines: 10, base: 1000, par: 45, minTime: 0.8,
  },
  amateur: {
    id: 'amateur',
    title: 'Секция',
    subtitle: 'Целое крыло на вас одного',
    w: 16, h: 16, mines: 40, base: 3000, par: 150, minTime: 4,
  },
  pro: {
    id: 'pro',
    title: 'Весь ЖК',
    subtitle: 'Чаки не мелочилась',
    w: 30, h: 16, mines: 99, base: 7000, par: 330, minTime: 12,
  },
};

export const DIFF_ORDER: Difficulty[] = ['novice', 'amateur', 'pro'];

// Множитель серии побед: +12% за победу подряд, потолок на 11-й.
export const streakMult = (streak: number) =>
  1 + 0.12 * Math.min(Math.max(streak - 1, 0), 10);

// Предпросмотр очков — ровно та же формула, что на сервере.
export function previewScore(d: Difficulty, duration: number, streak: number) {
  const spec = DIFFS[d];
  const speed = (Math.max(0, spec.par - duration) / spec.par) * spec.base * 0.9;
  return Math.round((spec.base + speed) * streakMult(streak));
}
