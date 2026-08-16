// Клиент нашего API. Авторизация — заголовок X-Player,
// значение задаётся один раз после resolveAuth() из sdk.ts.

import type { Difficulty } from '../game/difficulty';

let authHeader: string | null = null;

export function setAuth(header: string) { authHeader = header; }

/** Ошибка API с HTTP-кодом: по нему экран итога отличает «сервер не принял
 *  результат» от «связь пропала» и не выдаёт победу за поражение. */
export class ApiError extends Error {
  status: number;
  code: string | undefined;

  constructor(status: number, code?: string) {
    super(`api ${status}${code ? ': ' + code : ''}`);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { 'X-Player': authHeader } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const code = await res.json().then((d) => d?.error).catch(() => undefined);
    throw new ApiError(res.status, code);
  }
  return res.json() as Promise<T>;
}

export interface Profile {
  name: string;
  flat: number;
  seenIntro: boolean;
  streak: number;
  bestStreak: number;
  wins: number;
  losses: number;
  bests: {
    alltime: number;
    daily: number;
    weekly: number;
    times: Partial<Record<Difficulty, number>>;
  };
  ranks: { daily: number | null; weekly: number | null; alltime: number | null };
}

export interface GameStart {
  gameId: string;
  seed: number;
  difficulty: Difficulty;
  w: number;
  h: number;
  mines: number;
}

export interface FinishResult {
  ok: true;
  won: boolean;
  score: number;
  streak: number;
  mult?: number;
  newBest?: boolean;
  lostStreak?: number;
  ranks?: { daily: number | null; weekly: number | null; alltime: number | null };
  callout?: { board: string; need: number } | null;
  bestTimes?: Partial<Record<Difficulty, number>>;
  /** результат не попал в таблицу: сервер отклонил его или не ответил */
  notCounted?: 'rejected' | 'offline';
}

export interface ShiftStart {
  shiftId: string;
  seed: number;
  seconds: number;
}

export interface ShiftFinish extends FinishResult {
  correct?: number;
  mistakes?: number;
  maxCombo?: number;
}

export type BoardKind = 'daily' | 'weekly' | 'alltime';

export interface BoardRow { name: string; flat: number; score: number; me?: boolean }
export interface Leaderboard {
  board: BoardKind;
  rows: BoardRow[];
  me: { rank: number; score: number } | null;
}

export const api = {
  hello:       ()                    => call<Profile>('POST', '/api/hello'),
  seenIntro:   ()                    => call<{ ok: true }>('POST', '/api/intro/seen'),
  setName:     (name: string)        => call<{ name: string }>('POST', '/api/name', { name }),
  gameStart:   (difficulty: Difficulty) =>
    call<GameStart>('POST', '/api/game/start', { difficulty }),
  gameFinish:  (gameId: string, result: 'win' | 'loss', duration: number) =>
    call<FinishResult>('POST', '/api/game/finish', { gameId, result, duration }),
  shiftStart:  ()                    => call<ShiftStart>('POST', '/api/shift/start'),
  shiftFinish: (shiftId: string, payload: {
    correct: number; mistakes: number; maxCombo: number; duration: number; survived: boolean;
  }) => call<ShiftFinish>('POST', '/api/shift/finish', { shiftId, ...payload }),
  leaderboard: (board: BoardKind)    => call<Leaderboard>('GET', `/api/leaderboard?board=${board}`),
};
