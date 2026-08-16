// Таблица жильцов. Три зачёта: день, неделя (ISO) и всё время.
// Считается лучший результат каждого игрока, а не сумма.

import { useEffect, useState } from 'react';
import { api } from '../astranet/api';
import type { BoardKind, Leaderboard } from '../astranet/api';

const TABS: { id: BoardKind; label: string }[] = [
  { id: 'daily', label: 'Сегодня' },
  { id: 'weekly', label: 'Неделя' },
  { id: 'alltime', label: 'Всё время' },
];

interface Props { onBack: () => void }

export default function LeaderboardScreen({ onBack }: Props) {
  const [tab, setTab] = useState<BoardKind>('daily');
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(false);
    api.leaderboard(tab)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [tab]);

  return (
    <div className="board">
      <div className="menu-bg" />
      <div className="menu-scrim" />

      <div className="board-panel">
        <header className="board-head">
          <button className="btn btn--icon" onClick={onBack}>←</button>
          <h2>Доска почёта</h2>
        </header>

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'is-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="board-list">
          {error && <p className="board-empty">Не удалось загрузить таблицу.</p>}
          {!error && !data && <p className="board-empty">Загружаем…</p>}
          {data && data.rows.length === 0 && (
            <p className="board-empty">
              Пока пусто. Разминируйте двор первым — и займёте всю доску.
            </p>
          )}
          {data?.rows.map((r, i) => (
            <div key={i} className={`row ${r.me ? 'is-me' : ''}`}>
              <span className={`rank r${i + 1 <= 3 ? i + 1 : ''}`}>{i + 1}</span>
              <span className="who">
                {r.name}
                <small>кв. {r.flat}</small>
              </span>
              <span className="score">{r.score.toLocaleString('ru')}</span>
            </div>
          ))}
        </div>

        {data?.me && (
          <footer className="board-me">
            Ваше место: <b>#{data.me.rank}</b> · {data.me.score.toLocaleString('ru')} очк.
          </footer>
        )}
      </div>
    </div>
  );
}
