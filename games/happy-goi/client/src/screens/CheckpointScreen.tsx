// Смена на пункте пропуска: карточка за карточкой, впустить или
// депортировать, правила накапливаются по ходу смены.
//
// Экран ничего не решает сам: что правильно — знает game/checkpoint.ts,
// сколько за это очков — сервер. Здесь только ввод, анимация и счётчики,
// которые уйдут в /api/shift/finish.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShiftStart } from '../astranet/api';
import type { Rule, Subject } from '../game/checkpoint';
import {
  MAX_MISTAKES, QUEUE_SIZE, RULE_EVERY, SHAPE_LABEL, SHIFT_SECONDS, TRAIT_LABEL,
  makeQueue, shiftRules, shouldDeport,
} from '../game/checkpoint';
import SubjectIcon from './SubjectIcon';

// Сколько длится обработка одной карточки: удар штампа, пауза на «прочитать
// вердикт», уход бланка. Те же числа разложены по фазам в styles.css.
const STEP_MS = 430;

export interface ShiftResult {
  correct: number;
  mistakes: number;
  maxCombo: number;
  duration: number;
  survived: boolean;
  /** очередь разобрана до конца — за оставшееся время начислят бонус */
  cleared: boolean;
}

interface Props {
  shift: ShiftStart;
  streak: number;
  onFinish: (r: ShiftResult) => void;
  onQuit: () => void;
}

type Flight = { dir: 'in' | 'out'; ok: boolean } | null;

// штрих-код из номера пропуска: тот же номер — тот же рисунок
function barcode(no: number): number[] {
  let a = no >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < 34; i++) {
    a = (Math.imul(a, 1103515245) + 12345) & 0x7fffffff;
    bars.push(((a >> 5) % 3 === 0 ? -1 : 1) * (1 + (a % 3)));
  }
  return bars;
}

export default function CheckpointScreen({ shift, streak, onFinish, onQuit }: Props) {
  const queue = useMemo(() => makeQueue(shift.seed, QUEUE_SIZE), [shift.seed]);
  const allRules = useMemo(() => shiftRules(shift.seed), [shift.seed]);

  const [i, setI] = useState(0);
  const [left, setLeft] = useState(SHIFT_SECONDS);
  const [ruleCount, setRuleCount] = useState(1);
  const [correct, setCorrect] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [flight, setFlight] = useState<Flight>(null);
  const [ell, setEll] = useState(allRules[0].ell);
  const [shake, setShake] = useState(false);

  const startedAt = useRef(performance.now());
  const finished = useRef(false);
  const busy = useRef(false);

  const rules = useMemo(() => allRules.slice(0, ruleCount), [allRules, ruleCount]);
  const subject: Subject | undefined = queue[i];

  const end = useCallback((
    survived: boolean, corr: number, miss: number, best: number, cleared = false,
  ) => {
    if (finished.current) return;
    finished.current = true;
    onFinish({
      correct: corr,
      mistakes: miss,
      maxCombo: best,
      duration: (performance.now() - startedAt.current) / 1000,
      survived,
      cleared,
    });
  }, [onFinish]);

  // Очередь кончилась раньше времени — смена закрыта досрочно.
  useEffect(() => {
    if (i >= queue.length) end(true, correct, mistakes, maxCombo, true);
  }, [i, queue.length, end, correct, mistakes, maxCombo]);

  // Часы смены: они же вводят новые правила Ell.
  useEffect(() => {
    const t = setInterval(() => {
      setLeft((prev) => {
        const next = prev - 0.1;
        if (next <= 0) {
          clearInterval(t);
          return 0;
        }
        const passed = SHIFT_SECONDS - next;
        const want = Math.min(allRules.length, 1 + Math.floor(passed / RULE_EVERY));
        setRuleCount((rc) => {
          if (want > rc) setEll(allRules[want - 1].ell);
          return Math.max(rc, want);
        });
        return next;
      });
    }, 100);
    return () => clearInterval(t);
  }, [allRules]);

  useEffect(() => {
    if (left <= 0) end(true, correct, mistakes, maxCombo);
  }, [left, end, correct, mistakes, maxCombo]);

  const decide = useCallback((deport: boolean) => {
    if (busy.current || finished.current || left <= 0 || !subject) return;
    busy.current = true;

    const right = shouldDeport(subject, rules) === deport;
    setFlight({ dir: deport ? 'out' : 'in', ok: right });

    if (right) {
      setCorrect((c) => c + 1);
      setCombo((c) => {
        const n = c + 1;
        setMaxCombo((m) => Math.max(m, n));
        return n;
      });
    } else {
      setCombo(0);
      setShake(true);
      setTimeout(() => setShake(false), 320);
      setMistakes((m) => {
        const n = m + 1;
        if (n >= MAX_MISTAKES) {
          setTimeout(() => end(false, correct, n, maxCombo), 450);
        }
        return n;
      });
      // разбор ошибки: игрок должен видеть, какой именно указ он проглядел
      const broken = rules.filter((r) => r.id !== 'cats' && r.deport(subject));
      setEll(deport
        ? `«${subject.name}» не нарушал ни одного указа — его следовало ВПУСТИТЬ.`
        : `«${subject.name}» нарушает указ: ${broken[0]?.label ?? '—'}. Депортировать!`);
    }

    // busy держит ввод закрытым, пока карточка не уехала. Иначе игрок
    // проскакивал бы очередь вслепую, не успевая прочитать пропуск,
    // — а сервер отбраковал бы такую смену как невозможно быструю.
    setTimeout(() => {
      setFlight(null);
      setI((n) => n + 1);
      busy.current = false;
    }, STEP_MS);
  }, [subject, rules, left, correct, maxCombo, end]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); decide(false); }
      if (e.key === 'ArrowRight') { e.preventDefault(); decide(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide]);

  const bars = useMemo(() => barcode(subject?.no ?? 0), [subject?.no]);
  const timePct = Math.max(0, Math.min(100, (left / SHIFT_SECONDS) * 100));
  const queueLeft = queue.length - i;

  return (
    <div className={`kpp ${shake ? 'is-wrong' : ''}`}>
      <div className="kpp-bg" />
      <div className="kpp-scrim" />

      <header className="kpp-hud">
        <button className="btn btn--icon" onClick={onQuit} title="Уйти со смены">←</button>
        <div className="kpp-timer">
          <div className="kpp-timer-bar" style={{ width: `${timePct}%` }} />
          <span>{left.toFixed(1)}</span>
        </div>
        <div className="hud-stat" title="Очки за смену">✔ <b>{correct}</b></div>
        <div className="hud-stat" title="Комбо">⚡ <b>×{combo}</b></div>
        <div className="hud-stat kpp-lives" title="Осталось ошибок">
          {Array.from({ length: MAX_MISTAKES }, (_, n) => (
            <span key={n} className={n < MAX_MISTAKES - mistakes ? 'life' : 'life is-lost'}>
              {n < MAX_MISTAKES - mistakes ? '🛡' : '✖'}
            </span>
          ))}
        </div>
        <div className="hud-stat" title="Осталось в очереди">👥 <b>{queueLeft}</b></div>
        <div className="hud-stat" title="Серия смен">🔥 <b>{streak}</b></div>
      </header>

      <div className="kpp-rules">
        <span className="kpp-rules-title">
          Указы Ell · нарушил хоть один — депортировать
        </span>
        <div className="kpp-rules-list">
          {rules.map((r: Rule, n) => (
            <span
              key={r.id}
              className={`kpp-rule ${n === rules.length - 1 && rules.length > 1 ? 'is-fresh' : ''}`}
            >
              {r.label}
            </span>
          ))}
        </div>
      </div>

      <div className="kpp-stage">
        {subject && (
        <article
          key={subject.no + '-' + i}
          className={`pass ${flight ? `is-${flight.dir} ${flight.ok ? 'ok' : 'bad'}` : ''}`}
        >
          <div className="pass-head">
            <span>Пропуск №{subject.no}</span>
            <span>ЖК «Щастливый Гой»</span>
          </div>

          <div className="pass-body">
            <div className="pass-photo">
              <SubjectIcon kind={subject.kind} className="pass-icon" />
            </div>
            <div className="pass-rows">
              <div className="pass-row"><span className="k">Объект</span><span className="v">{subject.name}</span></div>
              <div className="pass-row">
                <span className="k">Кому</span>
                <span className="v">
                  {subject.flat ? <>кв. {subject.flat} <small>{subject.resident}</small></> : <>— <small>ничей</small></>}
                </span>
              </div>
              <div className="pass-row"><span className="k">Форма</span><span className="v">{SHAPE_LABEL[subject.shape]}</span></div>
              <div className="pass-row">
                <span className="k">Приметы</span>
                <span className="pass-marks">
                  {subject.traits.length
                    ? subject.traits.map((t) => (
                        <span key={t} className="pass-mark">{TRAIT_LABEL[t]}</span>
                      ))
                    : <span className="pass-mark is-quiet">ничего особенного</span>}
                </span>
              </div>
            </div>
          </div>

          <div className="pass-barcode">
            {bars.map((w, n) => (
              <i key={n} style={{ width: Math.abs(w), opacity: w > 0 ? 1 : 0 }} />
            ))}
          </div>

          {flight && (
            <div className={`pass-stamp ${flight.dir === 'out' ? 'deport' : 'let-in'}`}>
              {flight.dir === 'out' ? 'ДЕПОРТИРОВАН' : 'ВПУЩЕН'}
            </div>
          )}
        </article>
        )}

        <div className="kpp-verdict">
          <button className="vbtn vbtn--in" onClick={() => decide(false)}>
            ВПУСТИТЬ<small>←</small>
          </button>
          <button className="vbtn vbtn--out" onClick={() => decide(true)}>
            ДЕПОРТИРОВАТЬ<small>→</small>
          </button>
        </div>
      </div>

      <footer className="kpp-ell">
        <b>Ell Mersenz:</b> {ell}
      </footer>
    </div>
  );
}
