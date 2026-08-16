// Итог партии или смены поверх сцены: очки, множитель серии, места
// в таблицах и подсказка «сколько не хватило до топ-10» — главный повод
// сыграть ещё раз.

import type { FinishResult, ShiftFinish } from '../astranet/api';
import type { Difficulty } from '../game/difficulty';
import { DIFFS } from '../game/difficulty';

interface Props {
  result: FinishResult | ShiftFinish;
  /** сапёр: какая была сложность */
  difficulty?: Difficulty;
  /** режим смены на КПП */
  mode?: 'kpp';
  duration: number;
  onAgain: () => void;
  onMenu: () => void;
  onBoard: () => void;
}

const fmt = (n: number) => n.toLocaleString('ru');

export default function ResultOverlay({
  result, difficulty, mode, duration, onAgain, onMenu, onBoard,
}: Props) {
  const kpp = mode === 'kpp';
  const shift = result as ShiftFinish;
  const title = result.won
    ? (kpp ? 'Смена закрыта' : 'Двор разминирован')
    : (kpp ? 'Смена сорвана' : 'Бабах');
  const where = kpp ? 'Пункт пропуска' : difficulty ? DIFFS[difficulty].title : '';

  return (
    <div className="result">
      <div className="result-card">
        <h2 className={result.won ? 'win' : 'loss'}>{title}</h2>
        <p className="result-sub">{where} · {duration.toFixed(1)} с</p>

        {result.notCounted && (
          <p className="not-counted">
            {result.notCounted === 'rejected'
              ? 'Домоуправление не приняло отчёт: цифры выглядят невозможными. Очки не начислены.'
              : 'Связь с домоуправлением пропала — результат не попал в таблицу.'}
          </p>
        )}

        {result.won && !result.notCounted ? (
          <>
            <div className="score-big">
              {fmt(result.score)}
              <small>очков</small>
            </div>

            <div className="result-rows">
              {kpp && (
                <div>
                  <span>Верных решений</span>
                  <b>{shift.correct ?? 0}{shift.mistakes ? ` · ошибок ${shift.mistakes}` : ''}</b>
                </div>
              )}
              {kpp && shift.maxCombo ? (
                <div><span>Лучшее комбо</span><b>×{shift.maxCombo}</b></div>
              ) : null}
              <div>
                <span>{kpp ? 'Серия смен' : 'Серия побед'}</span>
                <b>🔥 {result.streak}{result.mult ? ` · ×${result.mult}` : ''}</b>
              </div>
              {result.ranks?.daily && (
                <div><span>Место за сегодня</span><b>#{result.ranks.daily}</b></div>
              )}
              {result.ranks?.alltime && (
                <div><span>Место за всё время</span><b>#{result.ranks.alltime}</b></div>
              )}
            </div>

            {result.newBest && <p className="badge">Личный рекорд!</p>}
            {result.callout && (
              <p className="callout">
                До топ-10 дня не хватило <b>{fmt(result.callout.need)}</b> очков.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="score-big is-zero">0<small>очков</small></div>
            {!result.notCounted && (
              <p className="result-lost">
                {result.lostStreak
                  ? <>Сгорела серия из <b>{result.lostStreak}</b> побед.</>
                  : kpp
                    ? <>Три ошибки за смену — Ell закрывает будку до завтра.</>
                    : <>Очки начисляются только за полностью разминированный двор.</>}
              </p>
            )}
          </>
        )}

        <div className="result-actions">
          <button className="btn btn--hero" onClick={onAgain}>Ещё раз</button>
          <button className="btn" onClick={onBoard}>Таблица</button>
          <button className="btn btn--ghost" onClick={onMenu}>В меню</button>
        </div>
      </div>
    </div>
  );
}
