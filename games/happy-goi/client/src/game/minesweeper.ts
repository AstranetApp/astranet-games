// Ядро сапёра: чистые функции над иммутабельным полем.
// Каждое действие возвращает НОВОЕ поле — React рендерит по ссылке.
//
// Мины раскладываются не при старте, а при первом клике: клетка первого
// клика и её соседи гарантированно пусты, поэтому первый ход никогда не
// убивает и почти всегда открывает область. Расклад детерминирован сидом
// сервера, так что «перезагрузить страницу ради лучшего поля» бесполезно.

export const HIDDEN = 0;
export const REVEALED = 1;
export const FLAGGED = 2;

export type Status = 'idle' | 'playing' | 'won' | 'lost';

export interface Board {
  w: number;
  h: number;
  mines: number;
  seed: number;
  mine: Uint8Array;
  adj: Uint8Array;
  state: Uint8Array;
  revealed: number;
  flags: number;
  status: Status;
  explodedAt: number;   // индекс взорвавшейся клетки, -1 если нет
  wrongFlags: number[]; // флаги не на минах — подсвечиваются после проигрыша
  generated: boolean;
}

// mulberry32: короткий детерминированный ГПСЧ. Тот же есть в game/checkpoint.ts.
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

export function createBoard(w: number, h: number, mines: number, seed: number): Board {
  const n = w * h;
  return {
    w, h, mines, seed,
    mine: new Uint8Array(n),
    adj: new Uint8Array(n),
    state: new Uint8Array(n),
    revealed: 0,
    flags: 0,
    status: 'idle',
    explodedAt: -1,
    wrongFlags: [],
    generated: false,
  };
}

const idx = (b: Board, x: number, y: number) => y * b.w + x;

export function neighbours(b: Board, i: number): number[] {
  const x = i % b.w, y = (i / b.w) | 0;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < b.w && ny >= 0 && ny < b.h) out.push(idx(b, nx, ny));
    }
  }
  return out;
}

// Раскладка мин с «безопасным пятном» вокруг первого клика.
function generate(b: Board, safe: number) {
  const n = b.w * b.h;
  const forbidden = new Set([safe, ...neighbours(b, safe)]);
  // если мин столько, что свободного места не хватает, защищаем только сам клик
  const pool: number[] = [];
  for (let i = 0; i < n; i++) if (!forbidden.has(i)) pool.push(i);
  if (pool.length < b.mines) {
    pool.length = 0;
    for (let i = 0; i < n; i++) if (i !== safe) pool.push(i);
  }

  // частичный Фишер—Йейтс: нужно лишь b.mines первых элементов
  const rand = rng(b.seed);
  for (let i = 0; i < b.mines; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    b.mine[pool[i]] = 1;
  }

  for (let i = 0; i < n; i++) {
    if (b.mine[i]) continue;
    let c = 0;
    for (const j of neighbours(b, i)) if (b.mine[j]) c++;
    b.adj[i] = c;
  }
  b.generated = true;
}

function clone(b: Board): Board {
  return {
    ...b,
    mine: b.generated ? b.mine : b.mine.slice(),
    adj: b.generated ? b.adj : b.adj.slice(),
    state: b.state.slice(),
    wrongFlags: b.wrongFlags,
  };
}

// Заливка: раскрытие пустой области итеративно (без рекурсии — поле «Весь ЖК» глубокое).
function flood(b: Board, start: number) {
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    if (b.state[i] !== HIDDEN) continue;
    b.state[i] = REVEALED;
    b.revealed++;
    if (b.adj[i] === 0 && !b.mine[i]) {
      for (const j of neighbours(b, i)) if (b.state[j] === HIDDEN) stack.push(j);
    }
  }
}

function checkWin(b: Board) {
  if (b.revealed === b.w * b.h - b.mines) {
    b.status = 'won';
    // на победе автоматически расставляем флаги на оставшиеся мины — косметика
    for (let i = 0; i < b.state.length; i++) {
      if (b.mine[i] && b.state[i] !== FLAGGED) { b.state[i] = FLAGGED; b.flags++; }
    }
  }
}

function explode(b: Board, at: number) {
  b.status = 'lost';
  b.explodedAt = at;
  b.state[at] = REVEALED;
  const wrong: number[] = [];
  for (let i = 0; i < b.state.length; i++) {
    if (b.mine[i] && b.state[i] === HIDDEN) b.state[i] = REVEALED;
    if (!b.mine[i] && b.state[i] === FLAGGED) wrong.push(i);
  }
  b.wrongFlags = wrong;
}

export function reveal(prev: Board, i: number): Board {
  if (prev.status === 'won' || prev.status === 'lost') return prev;
  if (prev.state[i] === REVEALED || prev.state[i] === FLAGGED) return prev;

  const b = clone(prev);
  if (!b.generated) {
    generate(b, i);
    b.status = 'playing';
  }
  if (b.mine[i]) { explode(b, i); return b; }
  flood(b, i);
  checkWin(b);
  return b;
}

export function toggleFlag(prev: Board, i: number): Board {
  if (prev.status === 'won' || prev.status === 'lost') return prev;
  if (prev.state[i] === REVEALED) return prev;
  const b = clone(prev);
  if (b.state[i] === FLAGGED) { b.state[i] = HIDDEN; b.flags--; }
  else { b.state[i] = FLAGGED; b.flags++; }
  return b;
}

// «Аккорд»: клик по раскрытой цифре, вокруг которой уже стоит ровно
// столько флагов — раскрывает всех остальных соседей разом.
export function chord(prev: Board, i: number): Board {
  if (prev.status !== 'playing') return prev;
  if (prev.state[i] !== REVEALED || prev.adj[i] === 0) return prev;

  const around = neighbours(prev, i);
  let flags = 0;
  for (const j of around) if (prev.state[j] === FLAGGED) flags++;
  if (flags !== prev.adj[i]) return prev;

  const b = clone(prev);
  for (const j of around) {
    if (b.state[j] !== HIDDEN) continue;
    if (b.mine[j]) { explode(b, j); return b; }
    flood(b, j);
  }
  checkWin(b);
  return b;
}

export const minesLeft = (b: Board) => b.mines - b.flags;
