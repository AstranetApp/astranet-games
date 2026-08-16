// Голоса персонажей — короткие «блипы» на печатающийся текст, как в
// Undertale. Никаких сэмплов: осциллятор + фильтр, поэтому каждый голос
// это семь чисел, а не мегабайт записи.
//
// Характер задаётся тембром: Мару — высокий и с подъёмом в конце (он вечно
// заигрывает), Булочка — низкий и ровный (она всегда серьёзна), Ell —
// гнусавый рупор с падением тона (он вещает, а не разговаривает).

import { audioCtx } from './context';
import type { SpeakerId } from '../vn/types';

interface VoiceSpec {
  wave: OscillatorType;
  freq: number;      // базовая высота, Гц
  slide: number;     // во сколько раз тон уезжает за время блипа
  dur: number;       // длительность блипа, с
  cutoff: number;    // срез фильтра, Гц
  jitter: number;    // случайный разброс высоты, доля
  gain: number;      // громкость блипа
  every: number;     // печатать звук на каждый N-й символ
}

// gain подобран так, чтобы голоса были слышны поверх музыки на её обычной
// громкости: приглушать музыку ради реплик — не выход.
const VOICES: Record<string, VoiceSpec> = {
  maru:     { wave: 'triangle', freq: 540, slide: 1.10, dur: .075, cutoff: 2800, jitter: .07, gain: .30, every: 3 },
  bulochka: { wave: 'square',   freq: 300, slide: 0.96, dur: .055, cutoff: 1300, jitter: .03, gain: .24, every: 3 },
  // Ell вещает в рупор: пила ярче и громче прочих, иначе его низкий тембр
  // тонет даже в тихой музыке
  ell:      { wave: 'sawtooth', freq: 185, slide: 0.90, dur: .085, cutoff: 1600, jitter: .05, gain: .30, every: 3 },
  // Чэстер тараторит: блипы короче и чаще, тон слегка прыгает вверх
  chester:  { wave: 'triangle', freq: 430, slide: 1.06, dur: .05,  cutoff: 2200, jitter: .09, gain: .26, every: 2 },
  player:   { wave: 'triangle', freq: 330, slide: 1.00, dur: .06,  cutoff: 1800, jitter: .04, gain: .24, every: 3 },
  narrator: { wave: 'sine',     freq: 210, slide: 0.98, dur: .05,  cutoff: 900,  jitter: .02, gain: .16, every: 4 },
};

let volume = 0.6;
let enabled = true;

export function setVoiceVolume(v: number) { volume = Math.min(1, Math.max(0, v)); }
export function setVoiceEnabled(on: boolean) { enabled = on; }

/** Проиграть один блип голосом персонажа. */
export function blip(speaker: SpeakerId | undefined, charIndex: number) {
  if (!enabled || volume <= 0) return;
  const spec = VOICES[speaker ?? 'narrator'] ?? VOICES.narrator;
  if (charIndex % spec.every !== 0) return;

  const ctx = audioCtx();
  if (!ctx) return;

  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  const f = spec.freq * (1 + (Math.random() - 0.5) * spec.jitter);
  osc.type = spec.wave;
  osc.frequency.setValueAtTime(f, t);
  if (spec.slide !== 1) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f * spec.slide), t + spec.dur);
  }

  filter.type = 'lowpass';
  filter.frequency.value = spec.cutoff;
  filter.Q.value = 0.8;

  // мягкая атака и быстрый спад: щелчков нет, «речь» не сливается в гудение
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(spec.gain * volume, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + spec.dur + 0.02);
}
