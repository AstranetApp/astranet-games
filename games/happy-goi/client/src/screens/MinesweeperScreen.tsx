// Экран мини-игры «сапёр»: HUD, поле, управление.
// Таймер запускается первым раскрытием, останавливается на исходе партии;
// его значение и уходит на сервер как длительность партии.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameStart } from '../astranet/api';
import { DIFFS } from '../game/difficulty';
import type { Board } from '../game/minesweeper';
import {
  FLAGGED, HIDDEN, REVEALED,
  chord, createBoard, minesLeft, reveal, toggleFlag,
} from '../game/minesweeper';

const LONG_PRESS_MS = 320;

function MineIcon() {
  // Мина Чаки: кошачья голова с фитильком
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M12 3.6c.7-1.2 2-2 2.6-1.4.5.6.1 1.7-.6 2.4" fill="none"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.2 8.4 4.6 5.9l3 .5M17.8 8.4l1.6-2.5-3 .5" fill="currentColor" />
      <circle cx="12" cy="14" r="7.2" fill="currentColor" />
      <path d="M6.6 9.2 5.4 5.4l3.4 1.7M17.4 9.2l1.2-3.8-3.4 1.7" fill="currentColor" />
      <circle cx="9.4" cy="13" r="1.05" fill="#1b1024" />
      <circle cx="14.6" cy="13" r="1.05" fill="#1b1024" />
      <path d="M11 16.2c.6.7 1.4.7 2 0" fill="none" stroke="#1b1024"
        strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M7 21V3.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7.8 4.2h9.4l-2.3 3.6 2.3 3.6H7.8z" fill="currentColor" />
      <path d="M4.6 21h6.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface Props {
  game: GameStart;
  streak: number;
  onFinish: (result: 'win' | 'loss', duration: number) => void;
  onQuit: () => void;
}

export default function MinesweeperScreen({ game, streak, onFinish, onQuit }: Props) {
  const spec = DIFFS[game.difficulty];
  const [board, setBoard] = useState<Board>(() =>
    createBoard(game.w, game.h, game.mines, game.seed));
  const [flagMode, setFlagMode] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cell, setCell] = useState(32);
  const [scrolls, setScrolls] = useState(false);

  const startedAt = useRef<number | null>(null);
  const finished = useRef(false);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const wrongFlags = useMemo(() => new Set(board.wrongFlags), [board.wrongFlags]);

  // Размер плитки подбираем под доступное место, а не задаём константой:
  // «Весь ЖК» — это 30×16, и на телефоне он влезает только ужатым.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const gap = 2;
      // Ограничиваем ещё и окном: контейнер может на кадр остаться раздутым
      // прошлым размером поля, и тогда замер даст лишнее место.
      const availW = Math.min(el.clientWidth, window.innerWidth) - 12;
      const availH = Math.min(el.clientHeight, window.innerHeight) - 12;
      const w = (availW - gap * (game.w - 1)) / game.w;
      const h = (availH - gap * (game.h - 1)) / game.h;
      // Ниже этого плитку не ужимаем: пальцем в 10 пикселей не попасть.
      // Если поле не влезло — оно прокручивается (см. .field-wrap).
      const min = matchMedia('(pointer: coarse)').matches ? 26 : 14;
      const size = Math.max(min, Math.min(46, Math.floor(Math.min(w, h))));
      setCell(size);
      setScrolls(size * game.w + gap * (game.w - 1) > availW);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [game.w, game.h]);

  // Отсчёт идёт от первого раскрытия, а не от появления экрана: время на
  // «посмотреть на поле» игроку не засчитывается.
  useEffect(() => {
    if (board.status !== 'playing') return;
    startedAt.current ??= performance.now();
    const t = setInterval(() => {
      if (startedAt.current) setElapsed((performance.now() - startedAt.current) / 1000);
    }, 100);
    return () => clearInterval(t);
  }, [board.status]);

  // Исход партии — сообщаем наверх ровно один раз
  useEffect(() => {
    if (board.status !== 'won' && board.status !== 'lost') return;
    if (finished.current) return;
    finished.current = true;
    const dur = startedAt.current ? (performance.now() - startedAt.current) / 1000 : 0;
    setElapsed(dur);
    const timer = setTimeout(() => onFinish(board.status === 'won' ? 'win' : 'loss', dur), 900);
    return () => clearTimeout(timer);
  }, [board.status, onFinish]);

  const act = useCallback((i: number, kind: 'reveal' | 'flag' | 'chord') => {
    setBoard((b) => {
      if (kind === 'flag') return toggleFlag(b, i);
      if (kind === 'chord') return chord(b, i);
      if (b.state[i] === REVEALED) return chord(b, i);
      return reveal(b, i);
    });
  }, []);

  const onPointerDown = (i: number) => (e: React.PointerEvent) => {
    if (e.button === 2) return;
    longFired.current = false;
    if (e.pointerType === 'touch') {
      pressStart.current = { x: e.clientX, y: e.clientY };
      pressTimer.current = window.setTimeout(() => {
        longFired.current = true;
        act(i, 'flag');
        navigator.vibrate?.(12);
      }, LONG_PRESS_MS);
    }
  };

  // Палец поехал — это прокрутка большого поля, а не долгий тап.
  const onPointerMove = (e: React.PointerEvent) => {
    const s = pressStart.current;
    if (!s || !pressTimer.current) return;
    if (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8) clearPress();
  };

  const clearPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    pressStart.current = null;
  };

  const onClickCell = (i: number) => () => {
    clearPress();
    // после долгого тапа флаг уже поставлен — «отпускание» не должно вскрывать клетку
    if (longFired.current) { longFired.current = false; return; }
    act(i, flagMode ? 'flag' : 'reveal');
  };

  // С клавиатуры: Enter/Space приходят обычным click'ом, F ставит флажок.
  const onKeyDownCell = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
      e.preventDefault();
      act(i, 'flag');
    }
  };

  const onContext = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    clearPress();
    act(i, 'flag');
  };

  const left = minesLeft(board);
  const over = board.status === 'won' || board.status === 'lost';

  return (
    <div className="game">
      <div className="game-bg" />
      <div className="game-scrim" />

      <header className="hud">
        <button className="btn btn--icon" onClick={onQuit} title="Выйти в меню">←</button>

        <div className="hud-stat" title="Мин осталось по вашим флажкам">
          <MineIcon />
          <b className={left < 0 ? 'is-bad' : ''}>{left}</b>
        </div>

        <div className="hud-title">
          <span>{spec.title}</span>
          <small>{game.w}×{game.h}</small>
        </div>

        <div className="hud-stat" title="Время партии">
          ⏱ <b>{elapsed.toFixed(1)}</b>
        </div>

        <div className="hud-stat" title="Серия побед">
          🔥 <b>{streak}</b>
        </div>

        <button
          className={`btn btn--icon flag-toggle ${flagMode ? 'is-on' : ''}`}
          onClick={() => setFlagMode((v) => !v)}
          title="Режим флажков (или правая кнопка / долгий тап)"
        >
          <FlagIcon />
        </button>
      </header>

      <div className="field-wrap" ref={wrapRef}>
        <div
          className={`field ${over ? 'is-over' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${game.w}, ${cell}px)`,
            gridAutoRows: `${cell}px`,
            fontSize: `${Math.round(cell * 0.56)}px`,
          }}
          onPointerLeave={clearPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          {Array.from({ length: game.w * game.h }, (_, i) => {
            const st = board.state[i];
            const isMine = board.generated && board.mine[i] === 1;
            const adj = board.adj[i];
            const wrong = wrongFlags.has(i);
            const cls = [
              'cell',
              st === REVEALED ? 'is-open' : 'is-closed',
              st === FLAGGED ? 'is-flag' : '',
              st === REVEALED && isMine ? 'is-mine' : '',
              i === board.explodedAt ? 'is-boom' : '',
              wrong ? 'is-wrong' : '',
              st === REVEALED && !isMine && adj ? `n${adj}` : '',
            ].join(' ');
            return (
              <button
                key={i}
                className={cls}
                disabled={over}
                onPointerDown={onPointerDown(i)}
                onPointerMove={onPointerMove}
                onPointerUp={clearPress}
                onPointerCancel={clearPress}
                onClick={onClickCell(i)}
                onKeyDown={onKeyDownCell(i)}
                onContextMenu={onContext(i)}
                aria-label={st === HIDDEN ? 'закрытая клетка' : undefined}
              >
                {st === FLAGGED && !wrong && <FlagIcon />}
                {wrong && <span className="wrong-mark">✕</span>}
                {st === REVEALED && isMine && <MineIcon />}
                {st === REVEALED && !isMine && adj > 0 && adj}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="game-hint">
        {board.status === 'idle'
          ? 'Первый клик всегда безопасен — Мару проверил.'
          : 'ПКМ или долгий тап — флажок. Клик по цифре с нужным числом флажков раскрывает соседей.'}
        {scrolls && <span className="hint-scroll">Двор не влез в экран — его можно прокручивать.</span>}
      </footer>
    </div>
  );
}
