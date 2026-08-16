// Пиктограммы объектов КПП. Рисуются кодом — ни одного растрового ассета,
// поэтому новый тип посетителя стоит десять строк, а не поход к художнику.

import type { ReactElement } from 'react';

const PATHS: Record<string, string> = {
  parcel: 'M6 16 24 8l18 8v18l-18 8-18-8z M6 16 24 24l18-8 M24 24v18',
  mine: 'M24 7c1.4-2.4 4-4 5.2-2.8 1 1.2.2 3.4-1.2 4.8 M13 18 10.6 11l6.8 3.4 M35 18l2.4-7-6.8 3.4',
  cat: 'M12 20 9 8l10 5 M36 20l3-12-10 5',
  pizza: 'M24 6 42 40H6z',
  cart: 'M10 34h28l-3-12H13z M17 22v-6a7 7 0 0 1 14 0v6',
  puddle: 'M8 32c4-6 10 2 14-2s4-8 10-6 8 8 6 12-12 6-20 4-12-4-10-8z',
  bill: 'M12 6h20l4 4v32l-4-3-4 3-4-3-4 3-4-3-4 3z M17 18h14 M17 25h14 M17 32h8',
  rent: 'M10 12h28v24H10z M10 12l14 12 14-12 M18 30l-8 6 M30 30l8 6',
  boom: 'M24 4l4 9 9-4-4 9 9 4-9 4 4 9-9-4-4 9-4-9-9 4 4-9-9-4 9-4-4-9 9 4z',
  snow: 'M24 5v38 M8 14l32 20 M40 14 8 34 M24 12l-5 5 M24 12l5 5 M24 36l-5-5 M24 36l5-5',
  noise: 'M14 20h6l8-7v22l-8-7h-6z M32 18a8 8 0 0 1 0 12 M36 14a14 14 0 0 1 0 20',
  derrick: 'M10 42 24 6l14 36 M15 30h18 M12 37h24 M24 6v36',
};

// Мелкие детали поверх контура: глаза кота, начинка пиццы и т.п.
const DETAILS: Record<string, ReactElement> = {
  mine: (
    <>
      <circle cx="24" cy="28" r="14" />
      <circle cx="19" cy="26" r="2" fill="currentColor" stroke="none" />
      <circle cx="29" cy="26" r="2" fill="currentColor" stroke="none" />
      <path d="M21.5 32c1.5 1.6 3.5 1.6 5 0" />
    </>
  ),
  cat: (
    <>
      <circle cx="24" cy="28" r="13" />
      <circle cx="19" cy="26" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="29" cy="26" r="1.6" fill="currentColor" stroke="none" />
      <path d="M21.5 32c1.5 1.6 3.5 1.6 5 0" />
    </>
  ),
  pizza: (
    <>
      <circle cx="24" cy="22" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="32" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="30" cy="32" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  cart: (
    <>
      <circle cx="16" cy="39" r="3" />
      <circle cx="32" cy="39" r="3" />
    </>
  ),
  boom: <circle cx="24" cy="24" r="5" />,
  rent: <path d="M24 20v8 M21 23h6" />,
};

// Что рисовать эмодзи, а не контуром: символ орла у Ell — фирменный,
// и линиями он получается похожим на что угодно, кроме орла.
const EMOJI: Record<string, string> = {
  eagle: '🦅',
};

interface Props { kind: string; className?: string }

export default function SubjectIcon({ kind, className }: Props) {
  if (EMOJI[kind]) {
    return <span className={`subject-emoji ${className ?? ''}`}>{EMOJI[kind]}</span>;
  }
  const d = PATHS[kind] ?? PATHS.parcel;
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
      {DETAILS[kind]}
    </svg>
  );
}
