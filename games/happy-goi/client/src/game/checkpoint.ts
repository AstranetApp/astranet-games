// Пункт пропуска: кто подходит к шлагбауму и по каким правилам его пускать.
//
// Вся игра — это данные (KINDS, RULES) плюс одна чистая функция решения
// (shouldDeport). Правила живут только здесь: сервер их не знает и не
// проверяет, он лишь считает очки по присланным счётчикам верных решений.
// Значит, добавить тип посетителя или указ можно, не трогая ни экран,
// ни сервер, — но и защита от накрутки держится не на них, а на проверках
// правдоподобия в /api/shift/finish.

export type Shape = 'round' | 'square' | 'star';

export type Trait =
  | 'ticking' | 'loud' | 'hot' | 'cold' | 'heavy'
  | 'purring' | 'unregistered' | 'rent' | 'oil';

export const TRAIT_LABEL: Record<Trait, string> = {
  ticking: 'тикает',
  loud: 'громкий',
  hot: 'горячий',
  cold: 'холодный',
  heavy: 'тяжёлый',
  purring: 'мурлычет',
  unregistered: 'без регистрации',
  rent: 'арендная плата',
  oil: 'пахнет нефтью',
};

export const SHAPE_LABEL: Record<Shape, string> = {
  round: 'круглая',
  square: 'прямоугольная',
  star: 'звезда',
};

export interface SubjectKind {
  kind: string;
  name: string;
  shape: Shape;
  /** признаки, которые есть всегда */
  always: Trait[];
  /** признаки, которые выпадают с вероятностью 0…1 */
  maybe?: [Trait, number][];
  /** объект ничей — к нему не идёт номер квартиры */
  ownerless?: boolean;
}

export const KINDS: SubjectKind[] = [
  { kind: 'parcel', name: 'Посылка', shape: 'round', always: [], maybe: [['ticking', .35], ['heavy', .4]] },
  { kind: 'mine', name: 'Мина Чаки', shape: 'round', always: ['ticking'], maybe: [['heavy', .3]] },
  { kind: 'cat', name: 'Кот', shape: 'round', always: ['purring'], maybe: [['unregistered', .55]] },
  { kind: 'pizza', name: 'Пицца', shape: 'round', always: ['hot'], maybe: [['heavy', .2]] },
  { kind: 'cart', name: 'Тележка', shape: 'square', always: ['heavy'], maybe: [['loud', .3]] },
  { kind: 'puddle', name: 'Лужа', shape: 'round', always: ['cold'], ownerless: true },
  { kind: 'bill', name: 'Счёт за ЖКХ', shape: 'square', always: [], maybe: [['loud', .2]] },
  { kind: 'rent', name: 'Арендная плата', shape: 'square', always: ['rent'], maybe: [['heavy', .5]] },
  { kind: 'boom', name: 'Взрыв', shape: 'star', always: ['loud', 'hot'], ownerless: true },
  { kind: 'snow', name: 'Декабрь', shape: 'star', always: ['cold'], ownerless: true },
  { kind: 'noise', name: 'Шум сверху', shape: 'star', always: ['loud'], ownerless: true },
  { kind: 'derrick', name: 'Нефтевышка', shape: 'square', always: ['heavy', 'oil'], maybe: [['loud', .5]] },
  { kind: 'eagle', name: 'Орёл', shape: 'star', always: ['loud'], maybe: [['unregistered', .4]] },
];

export interface Subject {
  no: number;
  kind: string;
  name: string;
  shape: Shape;
  traits: Trait[];
  flat: number | null;
  resident: string | null;
}

export interface Rule {
  id: string;
  label: string;
  /** что кричит Ell, вводя правило */
  ell: string;
  deport: (s: Subject) => boolean;
}

const has = (s: Subject, t: Trait) => s.traits.includes(t);

// Порядок в массиве — порядок появления в смене: первое правило самое простое.
export const RULES: Rule[] = [
  {
    id: 'ticking',
    label: 'тикающее — депортировать',
    ell: 'Если тикает — оно нам не друг. ДЕПОРТИРОВАН!',
    deport: (s) => has(s, 'ticking'),
  },
  {
    id: 'rent',
    label: 'арендную плату — депортировать',
    ell: 'Арендная плата? В этом ЖК её больше нет. ДЕПОРТИРОВАНА!',
    deport: (s) => has(s, 'rent'),
  },
  {
    id: 'ownerless',
    label: 'ничьё — не пускать',
    ell: 'Нет квартиры — нет входа. Bigger better STRONGER контроль!',
    deport: (s) => s.flat === null,
  },
  {
    id: 'loud',
    label: 'громкое — депортировать',
    ell: 'Тишина — наш главный экспорт. Громкое на выход!',
    deport: (s) => has(s, 'loud'),
  },
  {
    id: 'hot',
    label: 'горячее — депортировать',
    ell: 'Горячее пусть остывает за периметром. Я же mr.president.',
    deport: (s) => has(s, 'hot'),
  },
  {
    id: 'cold',
    label: 'холодное — депортировать',
    ell: 'Мне не нравится декабрь. Депортируем декабрь.',
    deport: (s) => has(s, 'cold'),
  },
  {
    id: 'heavy',
    label: 'тяжёлое — депортировать',
    ell: 'Тяжёлое портит плитку. Плитка — достояние ЖК!',
    deport: (s) => has(s, 'heavy'),
  },
  {
    id: 'round',
    label: 'круглое — депортировать',
    ell: 'Круглое катится. Катится — значит убегает. ДЕПОРТИРОВАН!',
    deport: (s) => s.shape === 'round',
  },
];

// Коты неприкосновенны: правило-исключение, которое ломает привычку
// депортировать всё подряд.
export const CAT_AMNESTY: Rule = {
  id: 'cats',
  label: 'коты — пускать всегда',
  ell: 'Коты — граждане с рождения. Это не обсуждается.',
  deport: () => false,
};

/** Итог по объекту: депортировать или впустить. Амнистия котов сильнее всего. */
export function shouldDeport(s: Subject, rules: Rule[]): boolean {
  const amnesty = rules.some((r) => r.id === 'cats');
  if (amnesty && s.kind === 'cat') return false;
  return rules.some((r) => r.id !== 'cats' && r.deport(s));
}

// ---------- генерация потока ----------

// mulberry32 — тот же ГПСЧ, что в game/minesweeper.ts. Копия намеренная:
// мини-игры не зависят друг от друга. Появится третья — стоит вынести
// в общий модуль, а не копировать в третий раз.
//
// Math.random() здесь не годится: очередь обязана раскладываться одинаково
// из одного сида, иначе перезагрузка страницы выдавала бы новую смену.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RESIDENTS = [
  'Чаки', 'Мару', 'С. Булочка', 'Р. Кузьминична', 'Ell M.', 'семья Гой',
  'В. Петрович', 'тётя Лида', 'кот Батон', 'аноним',
];

/** Поток посетителей смены — детерминирован сидом сервера. */
export function makeQueue(seed: number, count: number): Subject[] {
  const rand = rng(seed);
  const out: Subject[] = [];
  for (let i = 0; i < count; i++) {
    const k = KINDS[Math.floor(rand() * KINDS.length)];
    const traits: Trait[] = [...k.always];
    for (const [t, p] of k.maybe ?? []) if (rand() < p) traits.push(t);
    // даже у «своего» объекта иногда нет квартиры — это и создаёт решения
    const ownerless = k.ownerless || rand() < 0.18;
    out.push({
      no: 4400 + i + Math.floor(rand() * 9),
      kind: k.kind,
      name: k.name,
      shape: k.shape,
      traits,
      flat: ownerless ? null : 1 + Math.floor(rand() * 148),
      resident: ownerless ? null : RESIDENTS[Math.floor(rand() * RESIDENTS.length)],
    });
  }
  return out;
}

/**
 * Правила смены: набор и порядок появления.
 *
 * Случайный набор иногда вырождается — когда под запрет попадает почти вся
 * очередь, выгодно просто жать «депортировать» не глядя. Поэтому перебираем
 * несколько раскладов на пробной очереди и берём тот, где к концу смены
 * депортаций примерно половина. Сид тот же, так что смена остаётся
 * воспроизводимой.
 */
export function shiftRules(seed: number): Rule[] {
  const probe = makeQueue(seed, 80);
  const rand = rng(seed ^ 0x9e3779b9);
  let best: Rule[] = [];
  let bestErr = Infinity;

  for (let attempt = 0; attempt < 24; attempt++) {
    const pool = [...RULES];
    // первое правило всегда простое и заметное
    const first = pool.splice(Math.floor(rand() * 3), 1)[0];
    const rest: Rule[] = [];
    while (rest.length < 3 && pool.length) {
      rest.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    const set = [first, ...rest, CAT_AMNESTY];

    const share = probe.filter((s) => shouldDeport(s, set)).length / probe.length;
    const err = Math.abs(share - 0.5);
    if (err < bestErr) { bestErr = err; best = set; }
    if (err < 0.1) break;
  }
  return best;
}

export const SHIFT_SECONDS = 60;
export const RULE_EVERY = 12;      // каждые 12 секунд Ell добавляет правило
export const MAX_MISTAKES = 3;

// Очередь конечна: смена заканчивается либо по времени, либо когда принят
// последний посетитель. Без потолка очки зависели бы только от скорости
// кликов, и таблицу занял бы тот, кто быстрее всех жмёт не глядя.
export const QUEUE_SIZE = 55;
