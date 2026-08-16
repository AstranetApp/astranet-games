// Главное меню. Фон — та самая вывеска ЖК: название игры уже нарисовано
// на картинке, поэтому свой заголовок мы не рисуем, чтобы не дублировать.

import { useState } from 'react';
import type { Profile } from '../astranet/api';
import type { AuthKind } from '../astranet/sdk';
import { DIFFS, DIFF_ORDER } from '../game/difficulty';
import type { Difficulty } from '../game/difficulty';

interface Props {
  profile: Profile;
  authKind: AuthKind;
  onPlay: (d: Difficulty) => void;
  onBoard: () => void;
  onRename: (name: string) => void;
  onReplayIntro: () => void;
  onSettings: () => void;
  onShift: () => void;
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}с`;
};

export default function MainMenu({
  profile, authKind, onPlay, onBoard, onRename, onReplayIntro, onSettings, onShift,
}: Props) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);

  const submitName = () => {
    const v = draft.trim();
    if (v && v !== profile.name) onRename(v);
    setEditing(false);
  };

  return (
    <div className="menu">
      <div className="menu-bg" />
      <div className="menu-scrim" />

      <header className="plate plate--player">
        <div className="plate-row">
          {editing ? (
            <input
              className="name-input"
              value={draft}
              autoFocus
              maxLength={16}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitName();
                if (e.key === 'Escape') { setDraft(profile.name); setEditing(false); }
              }}
            />
          ) : (
            <button className="name-btn" onClick={() => setEditing(true)} title="Сменить имя">
              {profile.name} <span className="pen">✎</span>
            </button>
          )}
          <span className="flat">кв. {profile.flat}</span>
        </div>
        <div className="plate-row plate-row--stats">
          <span title="Побед подряд">🔥 серия {profile.streak}</span>
          {profile.bests.alltime > 0 && (
            <span title="Лучший счёт за всё время">★ {profile.bests.alltime.toLocaleString('ru')}</span>
          )}
          {profile.ranks.alltime && <span title="Место в таблице">#{profile.ranks.alltime}</span>}
        </div>
        {authKind === 'guest' && (
          <div className="guest-note">гостевой режим — прогресс в этом браузере</div>
        )}
      </header>

      <div className="menu-center">
        {!picking ? (
          <nav className="menu-actions">
            <button className="btn btn--hero" onClick={() => setPicking(true)}>
              Разминировать ЖК
              <small>мини-игра «сапёр»</small>
            </button>
            <button className="btn btn--hero btn--hero-alt" onClick={onShift}>
              Пункт пропуска
              <small>смена у Ell Mersenz</small>
            </button>
            {/* следующий большой режим — пока заглушка, кнопка не нажимается */}
            <button className="btn btn--locked" disabled title="Скоро">
              Открытый мир
              <small>в разработке</small>
            </button>
            <button className="btn" onClick={onBoard}>Таблица жильцов</button>
            <div className="menu-minor">
              <button className="btn btn--ghost" onClick={onReplayIntro}>Пересмотреть знакомство</button>
              <button className="btn btn--ghost" onClick={onSettings}>Настройки</button>
            </div>
          </nav>
        ) : (
          <div className="picker">
            <h2 className="picker-title">Что разминируем?</h2>
            <div className="picker-grid">
              {DIFF_ORDER.map((id) => {
                const d = DIFFS[id];
                const best = profile.bests.times[id];
                return (
                  <button key={id} className="card" onClick={() => onPlay(id)}>
                    <span className="card-title">{d.title}</span>
                    <span className="card-sub">{d.subtitle}</span>
                    <span className="card-meta">
                      {d.w}×{d.h} · {d.mines} мин
                    </span>
                    <span className="card-base">база {d.base.toLocaleString('ru')} очк.</span>
                    {best !== undefined && (
                      <span className="card-best">рекорд {fmtTime(best)}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="picker-hint">
              Серия побед даёт до <b>+120%</b> к очкам. Один подрыв — и она сгорает.
            </p>
            <button className="btn btn--ghost" onClick={() => setPicking(false)}>Назад</button>
          </div>
        )}
      </div>
    </div>
  );
}
