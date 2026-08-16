// Проигрыватель сцены: фон, спрайты в двух слотах, рамка реплики
// с посимвольным выводом. Клик/пробел — дописать или дальше, Esc — пропустить.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CharId, Scene, Slot } from './types';
import { CHARS, SLOTS, speakerColor, speakerName } from './types';
import { fill } from './script';
import { blip } from '../audio/voice';

const DEFAULT_CHAR_MS = 22;

interface StageState {
  bg: string | null;
  dim: number;
  cast: Record<Slot, CharId | null>;
}

// Разворачиваем «дельты» шагов в полное состояние сцены на каждом шаге,
// чтобы прыжок вперёд по сцене не терял ушедших/пришедших персонажей.
function buildStages(scene: Scene): StageState[] {
  const out: StageState[] = [];
  let cur: StageState = { bg: null, dim: 0, cast: { left: null, center: null, right: null } };
  for (const step of scene) {
    const next: StageState = { bg: cur.bg, dim: cur.dim, cast: { ...cur.cast } };
    if (step.bg !== undefined) next.bg = step.bg;
    if (step.dim !== undefined) next.dim = step.dim;
    if (step.cast) {
      for (const [slot, who] of Object.entries(step.cast) as [Slot, CharId | null][]) {
        next.cast[slot] = who;
      }
    }
    out.push(next);
    cur = next;
  }
  return out;
}

interface Props {
  scene: Scene;
  vars?: Record<string, string | number>;
  onDone: () => void;
  /** показывать кнопку «Пропустить» */
  skippable?: boolean;
  /** миллисекунд на символ — задаётся в настройках */
  charMs?: number;
}

export default function VNPlayer({
  scene, vars = {}, onDone, skippable = true, charMs = DEFAULT_CHAR_MS,
}: Props) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(0);
  const stages = useMemo(() => buildStages(scene), [scene]);

  const step = scene[i];
  const text = useMemo(() => fill(step?.text ?? '', vars), [step, vars]);
  const stage = stages[i]
    ?? { bg: null, dim: 0, cast: { left: null, center: null, right: null } };
  const done = shown >= text.length;

  // Реф на onDone: сцена может завершиться из обработчика клавиш,
  // который вешается один раз.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => { setShown(0); }, [i]);

  useEffect(() => {
    if (shown >= text.length) return;
    const t = setTimeout(() => {
      const ch = text[shown];
      // на пробелах и знаках препинания голос молчит — так «речь» звучит
      // словами, а не ровным треском
      if (ch && !/[\s.,!?…—:;«»"()]/.test(ch)) blip(step?.speaker, shown);
      setShown((n) => n + 1);
    }, charMs);
    return () => clearTimeout(t);
  }, [shown, text, charMs, step]);

  const advance = useCallback(() => {
    if (!done) { setShown(text.length); return; }
    if (i + 1 >= scene.length) doneRef.current();
    else setI(i + 1);
  }, [done, i, scene.length, text.length]);

  const skip = useCallback(() => doneRef.current(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      } else if (e.key === 'Escape' && skippable) {
        skip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, skip, skippable]);

  if (!step) return null;

  const name = speakerName(step.speaker);
  const color = speakerColor(step.speaker);
  const isNarration = !step.speaker || step.speaker === 'narrator';

  return (
    <div className={`vn ${step.fx ? 'fx-' + step.fx : ''}`} onClick={advance}>
      <div
        className={`vn-bg ${stage.bg ? '' : 'is-dark'}`}
        style={stage.bg ? { backgroundImage: `url(${stage.bg})` } : undefined}
        key={stage.bg ?? 'dark'}
      />
      {/* отдельный слой сумерек: плавно гасит фон, не трогая спрайты */}
      <div className="vn-dim" style={{ opacity: stage.dim }} />
      <div className="vn-vignette" />

      {SLOTS.map((slot) => {
        const who = stage.cast[slot];
        if (!who || !CHARS[who].sprite) return null;
        const active = step.speaker === who;
        return (
          <img
            key={slot + who}
            className={`vn-sprite vn-sprite--${slot} ${active ? 'is-active' : 'is-dim'}`}
            style={{ '--sprite-scale': CHARS[who].scale ?? 1 } as CSSProperties}
            src={CHARS[who].sprite}
            alt={CHARS[who].name}
            draggable={false}
          />
        );
      })}

      <div className="vn-box">
        {name && (
          <div className="vn-name" style={{ color, borderColor: color }}>
            {name}
          </div>
        )}
        <p className={`vn-text ${isNarration ? 'is-narration' : ''}`}>
          {text.slice(0, shown)}
          <span className="vn-caret" hidden={done} />
        </p>
        <span className={`vn-next ${done ? 'is-ready' : ''}`}>▼</span>
      </div>

      {skippable && (
        <button
          className="vn-skip"
          onClick={(e) => { e.stopPropagation(); skip(); }}
        >
          Пропустить
        </button>
      )}
    </div>
  );
}
