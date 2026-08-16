// ============================================================
// ЖК «Щастливый Гой» — сервер. Node.js >= 22.5, ноль зависимостей:
// node:http + node:sqlite. Статика собранного клиента + игровой API.
//
// Идентификация: заголовок X-Player = "astra <token>" | "guest <uuid>".
// Токен Astranet — bearer: в БД хранится ТОЛЬКО sha256(salt+значение),
// исходный токен никуда не пишется и не логируется.
//
// Анти-чит: партия регистрируется до начала (/api/game/start), поле
// раскладывается по выданному сервером сиду, а ОЧКИ СЧИТАЕТ СЕРВЕР —
// клиент присылает лишь длительность и исход. Подделать можно только
// время, и оно проверяется по реальному времени жизни партии.
// ============================================================

import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8097);
const DATA_DIR = process.env.DATA_DIR || '/data';
const PUBLIC_DIR = resolve(process.env.PUBLIC_DIR ||
  fileURLToPath(new URL('../client/dist', import.meta.url)));

// ---------- БД ----------

const db = new DatabaseSync(join(DATA_DIR, 'happygoi.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,             -- sha256(salt + auth), не bearer
    kind TEXT NOT NULL,              -- astra | guest
    name TEXT NOT NULL,
    flat INTEGER NOT NULL,           -- номер квартиры, выданный Мару в прологе
    seen_intro INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,       -- серия побед подряд
    best_streak INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,        -- novice | amateur | pro
    day TEXT NOT NULL,               -- YYYY-MM-DD (UTC)
    week TEXT NOT NULL,              -- ISO-неделя YYYY-Www
    score INTEGER NOT NULL,
    duration REAL NOT NULL,
    streak INTEGER NOT NULL,         -- серия на момент победы
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_scores_day    ON scores(day, score DESC);
  CREATE INDEX IF NOT EXISTS ix_scores_week   ON scores(week, score DESC);
  CREATE INDEX IF NOT EXISTS ix_scores_all    ON scores(score DESC);
  CREATE INDEX IF NOT EXISTS ix_scores_player ON scores(player_id);

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    seed INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    finished INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS ix_games_player ON games(player_id, started_at);
`);

// соль для хэширования идентификаторов — генерируется однажды
function getSalt() {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('salt');
  if (row) return row.v;
  const salt = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('salt', salt);
  return salt;
}
const SALT = getSalt();

// ---------- время ----------

const utcDay = () => new Date().toISOString().slice(0, 10);

function isoWeek(d = new Date()) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y = dt.getUTCFullYear();
  const week = Math.ceil((((dt - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

// ---------- правила игры ----------
// Те же числа лежат в client/src/game/difficulty.ts — при правке менять оба места.

// minTime — порог правдоподобия, а не «нормальное» время. Он заведомо ниже
// мировых рекордов сапёра (≈1 / 7 / 30 с), чтобы очень быстрый, но честный
// игрок не получал отказ; всё, что быстрее, — гарантированно подлог.
const DIFFS = {
  novice:  { w: 9,  h: 9,  mines: 10, base: 1000, par: 45,  minTime: 0.8 },
  amateur: { w: 16, h: 16, mines: 40, base: 3000, par: 150, minTime: 4 },
  pro:     { w: 30, h: 16, mines: 99, base: 7000, par: 330, minTime: 12 },
};

// Пункт пропуска: смена фиксированной длины, очки — за верные решения.
// Клиент присылает только счётчики, формула живёт здесь.
// queue — размер очереди из client/src/game/checkpoint.ts: он же потолок
// числа решений за смену, поэтому очки не зависят от скорости кликов.
const SHIFT = {
  seconds: 60, queue: 55, perCorrect: 80,
  comboBonus: 0.03, comboCap: 30, minTime: 12, earlyBonus: 25,
};

// Множитель серии побед: +12% за каждую победу подряд, потолок на 11-й.
const streakMult = (streak) => 1 + 0.12 * Math.min(Math.max(streak - 1, 0), 10);

// Очки = (база сложности + бонус за скорость) × множитель серии.
function scoreFor(difficulty, duration, streak) {
  const d = DIFFS[difficulty];
  const speed = Math.max(0, d.par - duration) / d.par * d.base * 0.9;
  return Math.round((d.base + speed) * streakMult(streak));
}

// Очки смены = верные решения × ставка × (1 + комбо) × множитель серии,
// плюс бонус за очередь, разобранную раньше конца смены.
function shiftScore(correct, maxCombo, streak, duration, cleared) {
  const combo = 1 + Math.min(maxCombo, SHIFT.comboCap) * SHIFT.comboBonus;
  const base = correct * SHIFT.perCorrect * combo;
  const early = cleared ? Math.max(0, SHIFT.seconds - duration) * SHIFT.earlyBonus : 0;
  return Math.round((base + early) * streakMult(streak));
}

// ---------- игроки ----------

const hashAuth = (s) => createHash('sha256').update(SALT + '|' + s).digest('hex').slice(0, 32);

function parseAuth(req) {
  const h = req.headers['x-player'] || '';
  const m = /^(astra|guest) ([A-Za-z0-9_\-]{8,64})$/.exec(h);
  if (!m) return null;
  return { kind: m[1], id: hashAuth(m[1] + ':' + m[2]) };
}

const defaultName = (id) => 'ЖИЛЕЦ-' + id.slice(0, 4).toUpperCase();
// Номер квартиры детерминирован по игроку: Мару «подбирает» его в прологе,
// и он остаётся тем же на всех устройствах.
const flatNumber = (id) => 1 + (parseInt(id.slice(0, 6), 16) % 148);

function getPlayer(auth, touch = true) {
  let p = db.prepare('SELECT * FROM players WHERE id = ?').get(auth.id);
  const now = Date.now();
  if (!p) {
    db.prepare(`INSERT INTO players (id, kind, name, flat, created_at, last_seen)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(auth.id, auth.kind, defaultName(auth.id), flatNumber(auth.id), now, now);
    p = db.prepare('SELECT * FROM players WHERE id = ?').get(auth.id);
  } else if (touch) {
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, auth.id);
  }
  return p;
}

// ---------- статистика ----------

function bestScore(playerId, day, week) {
  let sql = 'SELECT MAX(score) s FROM scores WHERE player_id = ?';
  const args = [playerId];
  if (day) { sql += ' AND day = ?'; args.push(day); }
  if (week) { sql += ' AND week = ?'; args.push(week); }
  return db.prepare(sql).get(...args)?.s || 0;
}

// лучшее время по сложности — личный рекорд, не идёт в общий зачёт
function bestTimes(playerId) {
  const rows = db.prepare(
    'SELECT difficulty, MIN(duration) t FROM scores WHERE player_id = ? GROUP BY difficulty')
    .all(playerId);
  const out = {};
  for (const r of rows) out[r.difficulty] = r.t;
  return out;
}

// топ по «лучшему результату каждого игрока»
function board(day, week, limit = 50) {
  let where = '1=1';
  const args = [];
  if (day) { where += ' AND s.day = ?'; args.push(day); }
  if (week) { where += ' AND s.week = ?'; args.push(week); }
  return db.prepare(`
    SELECT s.player_id, p.name, p.flat, MAX(s.score) score
    FROM scores s JOIN players p ON p.id = s.player_id
    WHERE ${where}
    GROUP BY s.player_id
    ORDER BY score DESC, MIN(s.created_at) ASC
    LIMIT ?`).all(...args, limit);
}

function rankOf(playerId, day, week) {
  const mine = bestScore(playerId, day, week);
  if (!mine) return null;
  let where = '1=1';
  const args = [];
  if (day) { where += ' AND day = ?'; args.push(day); }
  if (week) { where += ' AND week = ?'; args.push(week); }
  const better = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT player_id, MAX(score) b FROM scores
      WHERE ${where} GROUP BY player_id HAVING b > ?
    )`).get(...args, mine)?.c || 0;
  return { rank: better + 1, score: mine };
}

// ---------- rate limit ----------

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.reset) { b = { n: 0, reset: now + 60000 }; buckets.set(ip, b); }
  return ++b.n > 150;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 120000).unref();

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

function send(res, code, body, type = 'application/json') {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(buf),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10240) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function sanitizeName(raw) {
  const s = String(raw || '')
    .replace(/[^0-9A-Za-zА-Яа-яЁё _\-\.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return s.length >= 2 ? s : null;
}

// ---------- API ----------

function profile(p) {
  const day = utcDay(), week = isoWeek();
  return {
    name: p.name,
    flat: p.flat,
    seenIntro: !!p.seen_intro,
    streak: p.streak,
    bestStreak: p.best_streak,
    wins: p.wins,
    losses: p.losses,
    bests: {
      alltime: bestScore(p.id),
      daily: bestScore(p.id, day),
      weekly: bestScore(p.id, null, week),
      times: bestTimes(p.id),
    },
    ranks: {
      daily: rankOf(p.id, day)?.rank || null,
      weekly: rankOf(p.id, null, week)?.rank || null,
      alltime: rankOf(p.id)?.rank || null,
    },
  };
}

const routes = {

  'POST /api/hello': (req, res, auth) => {
    send(res, 200, profile(getPlayer(auth)));
  },

  // Пролог показывается один раз и на всех устройствах игрока: флаг живёт
  // на сервере, а не в localStorage.
  'POST /api/intro/seen': (req, res, auth) => {
    getPlayer(auth);
    db.prepare('UPDATE players SET seen_intro = 1 WHERE id = ?').run(auth.id);
    send(res, 200, { ok: true });
  },

  'POST /api/name': async (req, res, auth) => {
    const body = await readBody(req);
    const name = sanitizeName(body.name);
    if (!name) return send(res, 400, { error: 'bad name' });
    getPlayer(auth);
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, auth.id);
    send(res, 200, { name });
  },

  'POST /api/game/start': async (req, res, auth) => {
    const body = await readBody(req);
    const difficulty = DIFFS[body.difficulty] ? body.difficulty : 'novice';
    getPlayer(auth);
    // страховка от спама партий
    const open = db.prepare(
      'SELECT COUNT(*) c FROM games WHERE player_id = ? AND finished = 0 AND started_at > ?')
      .get(auth.id, Date.now() - 3600000)?.c || 0;
    if (open > 40) return send(res, 429, { error: 'too many games' });

    const id = randomUUID();
    const seed = randomBytes(4).readUInt32BE(0);
    db.prepare('INSERT INTO games (id, player_id, difficulty, seed, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, auth.id, difficulty, seed, Date.now());
    send(res, 200, { gameId: id, seed, difficulty, ...DIFFS[difficulty] });
  },

  'POST /api/game/finish': async (req, res, auth) => {
    const b = await readBody(req);
    const p = getPlayer(auth);

    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(String(b.gameId || ''));
    if (!game || game.player_id !== auth.id) return send(res, 400, { error: 'unknown game' });
    if (game.finished) return send(res, 409, { error: 'already finished' });
    db.prepare('UPDATE games SET finished = 1 WHERE id = ?').run(game.id);

    const won = b.result === 'win';
    const duration = Math.max(0, Number(b.duration) || 0);
    const elapsed = (Date.now() - game.started_at) / 1000;
    const d = DIFFS[game.difficulty];

    // Поражение: серия сгорает, очки не начисляются.
    if (!won) {
      db.prepare('UPDATE players SET streak = 0, losses = losses + 1 WHERE id = ?').run(p.id);
      return send(res, 200, { ok: true, won: false, score: 0, streak: 0, lostStreak: p.streak });
    }

    // Победа быстрее физически возможного или «в прошлом» — не засчитываем.
    const plausible = duration >= d.minTime && duration <= elapsed + 3;
    if (!plausible) {
      db.prepare('UPDATE players SET streak = 0 WHERE id = ?').run(p.id);
      return send(res, 422, { error: 'implausible' });
    }

    const streak = p.streak + 1;
    const score = scoreFor(game.difficulty, duration, streak);
    const day = utcDay(), week = isoWeek();

    db.prepare(`UPDATE players SET streak = ?, best_streak = MAX(best_streak, ?), wins = wins + 1
                WHERE id = ?`).run(streak, streak, p.id);
    db.prepare(`INSERT INTO scores (player_id, difficulty, day, week, score, duration, streak, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.id, game.difficulty, day, week, score, duration, streak, Date.now());

    const ranks = {
      daily: rankOf(p.id, day)?.rank || null,
      weekly: rankOf(p.id, null, week)?.rank || null,
      alltime: rankOf(p.id)?.rank || null,
    };

    // «Почти получилось»: сколько очков не хватило до топ-10 дня.
    let callout = null;
    const top = board(day, null, 10);
    if (ranks.daily && ranks.daily > 10 && top.length >= 10) {
      const need = top[9].score - bestScore(p.id, day) + 1;
      if (need > 0) callout = { board: 'daily', need };
    }

    send(res, 200, {
      ok: true,
      won: true,
      score,
      streak,
      mult: Number(streakMult(streak).toFixed(2)),
      newBest: score >= bestScore(p.id),
      ranks,
      callout,
      bestTimes: bestTimes(p.id),
    });
  },

  // ---- пункт пропуска ----

  'POST /api/shift/start': async (req, res, auth) => {
    getPlayer(auth);
    const open = db.prepare(
      'SELECT COUNT(*) c FROM games WHERE player_id = ? AND finished = 0 AND started_at > ?')
      .get(auth.id, Date.now() - 3600000)?.c || 0;
    if (open > 40) return send(res, 429, { error: 'too many games' });

    const id = randomUUID();
    const seed = randomBytes(4).readUInt32BE(0);
    db.prepare('INSERT INTO games (id, player_id, difficulty, seed, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, auth.id, 'kpp', seed, Date.now());
    send(res, 200, { shiftId: id, seed, seconds: SHIFT.seconds });
  },

  'POST /api/shift/finish': async (req, res, auth) => {
    const b = await readBody(req);
    const p = getPlayer(auth);

    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(String(b.shiftId || ''));
    if (!game || game.player_id !== auth.id) return send(res, 400, { error: 'unknown shift' });
    if (game.finished) return send(res, 409, { error: 'already finished' });
    db.prepare('UPDATE games SET finished = 1 WHERE id = ?').run(game.id);

    const correct = Math.max(0, Math.floor(Number(b.correct) || 0));
    const mistakes = Math.max(0, Math.floor(Number(b.mistakes) || 0));
    const maxCombo = Math.max(0, Math.floor(Number(b.maxCombo) || 0));
    const duration = Math.max(0, Number(b.duration) || 0);
    const survived = !!b.survived;
    const cleared = !!b.cleared;
    const elapsed = (Date.now() - game.started_at) / 1000;

    // Смену провалили (три ошибки) — серия сгорает, очков нет.
    if (!survived) {
      db.prepare('UPDATE players SET streak = 0, losses = losses + 1 WHERE id = ?').run(p.id);
      return send(res, 200, { ok: true, won: false, score: 0, streak: 0, lostStreak: p.streak, correct });
    }

    // Решений не может быть больше, чем успеет нажать человек, а смена
    // не может закончиться раньше, чем началась.
    const plausible =
      duration >= SHIFT.minTime &&
      duration <= elapsed + 3 &&
      duration <= SHIFT.seconds + 5 &&
      // больше, чем стояло в очереди, обработать невозможно
      correct + mistakes <= SHIFT.queue &&
      // между решениями UI держит ~0.43 с анимации — быстрее не нажать
      correct + mistakes <= duration / 0.35 &&
      maxCombo <= correct;
    if (!plausible) {
      db.prepare('UPDATE players SET streak = 0 WHERE id = ?').run(p.id);
      return send(res, 422, { error: 'implausible' });
    }

    const streak = p.streak + 1;
    const score = shiftScore(correct, maxCombo, streak, duration, cleared);
    const day = utcDay(), week = isoWeek();

    db.prepare(`UPDATE players SET streak = ?, best_streak = MAX(best_streak, ?), wins = wins + 1
                WHERE id = ?`).run(streak, streak, p.id);
    db.prepare(`INSERT INTO scores (player_id, difficulty, day, week, score, duration, streak, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.id, 'kpp', day, week, score, duration, streak, Date.now());

    const ranks = {
      daily: rankOf(p.id, day)?.rank || null,
      weekly: rankOf(p.id, null, week)?.rank || null,
      alltime: rankOf(p.id)?.rank || null,
    };

    let callout = null;
    const top = board(day, null, 10);
    if (ranks.daily && ranks.daily > 10 && top.length >= 10) {
      const need = top[9].score - bestScore(p.id, day) + 1;
      if (need > 0) callout = { board: 'daily', need };
    }

    send(res, 200, {
      ok: true,
      won: true,
      score,
      streak,
      correct,
      mistakes,
      maxCombo,
      mult: Number(streakMult(streak).toFixed(2)),
      newBest: score >= bestScore(p.id),
      ranks,
      callout,
    });
  },

  'GET /api/leaderboard': (req, res, auth, url) => {
    const kind = url.searchParams.get('board');
    const day = utcDay(), week = isoWeek();
    let rows, me;
    if (kind === 'daily') {
      rows = board(day, null); me = rankOf(auth.id, day);
    } else if (kind === 'weekly') {
      rows = board(null, week); me = rankOf(auth.id, null, week);
    } else {
      rows = board(null, null); me = rankOf(auth.id);
    }
    send(res, 200, {
      board: kind || 'alltime',
      rows: rows.map((r) => ({
        name: r.name, flat: r.flat, score: r.score,
        me: r.player_id === auth.id || undefined,
      })),
      me,
    });
  },
};

// ---------- статика ----------

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  let file = resolve(join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  // SPA: неизвестный путь без расширения отдаём как index.html
  if (!existsSync(file) && !extname(file)) file = join(PUBLIC_DIR, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'not found' });

  const ext = extname(file);
  const type = MIME[ext] || 'application/octet-stream';
  // Vite кладёт хэш в имя файла — такие ассеты кэшируются намертво.
  const hashed = /-[A-Za-z0-9_]{8,}\.(js|css)$/.test(file);
  const cache = ext === '.html' ? 'no-cache'
    : hashed || ext === '.woff2' ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';
  const buf = readFileSync(file);

  // Плеер запрашивает музыку кусками — отвечаем 206, иначе буферизация
  // и перемотка в некоторых WebView работают через раз.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && buf.length) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (start > end || start >= buf.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` });
      return res.end();
    }
    const chunk = buf.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': chunk.length,
      'Content-Range': `bytes ${start}-${end}/${buf.length}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(req.method === 'HEAD' ? undefined : chunk);
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/healthz') return send(res, 200, { ok: true });

    if (pathname.startsWith('/api/')) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
      if (rateLimited(ip)) return send(res, 429, { error: 'slow down' });
      const auth = parseAuth(req);
      if (!auth) return send(res, 401, { error: 'no auth' });
      const handler = routes[`${req.method} ${pathname}`];
      if (!handler) return send(res, 404, { error: 'not found' });
      await handler(req, res, auth, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method' });
    serveStatic(req, res, pathname);
  } catch {
    if (!res.headersSent) send(res, 500, { error: 'internal' });
  }
});

server.listen(PORT, () => {
  console.log(`ЖК «Щастливый Гой» слушает :${PORT}, данные в ${DATA_DIR}, статика ${PUBLIC_DIR}`);
});
