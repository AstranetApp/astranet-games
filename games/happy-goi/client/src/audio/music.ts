// Фоновая музыка: один трек на экран, смена — кроссфейдом.
//
// Автовоспроизведение браузеры и WebView запрещают до первого жеста
// пользователя, поэтому отклонённый play() не считается ошибкой: мы
// запоминаем желаемый трек и запускаем его на первом же клике или клавише.
//
// Громкость треков выровнена ещё при конвертации (оба −23.5 dB), так что
// gain здесь — только для тонкой подстройки, если трек всё равно выбивается.

import { loadSettings } from '../settings';

export type TrackId = 'seaside' | 'mirrors' | 'overclock';

export interface Track {
  id: TrackId;
  title: string;
  src: string;
  gain: number;
}

export const TRACKS: Record<TrackId, Track> = {
  seaside: {
    id: 'seaside',
    title: 'AZALI — seaside hometown',
    src: '/audio/seaside-hometown.mp3',
    gain: 1,
  },
  mirrors: {
    id: 'mirrors',
    title: 'AZALI — field of mirrors (small enemy encounter)',
    src: '/audio/field-of-mirrors.mp3',
    // на поле сапёра трек должен быть заметнее остальных
    gain: 1.5,
  },
  overclock: {
    id: 'overclock',
    title: 'XEOLT — Overclock Resurgence',
    src: '/audio/overclock-resurgence.mp3',
    gain: 1,
  },
};

const FADE_MS = 700;
const TICK_MS = 40;

export interface MusicState {
  track: Track | null;
  playing: boolean;
  volume: number;
  muted: boolean;
}

class MusicPlayer {
  private els: HTMLAudioElement[] = [];
  private active = 0;
  private wanted: TrackId | null = null;
  private fadeTimer: number | null = null;
  private unlock: (() => void) | null = null;
  private listeners = new Set<() => void>();

  state: MusicState = { track: null, playing: false, volume: 0.6, muted: false };

  private emit() {
    // новый объект состояния — иначе useSyncExternalStore не заметит смену
    this.state = { ...this.state };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  getState = () => this.state;

  init() {
    if (this.els.length) return;
    const s = loadSettings();
    this.state.volume = s.volume;
    this.state.muted = s.muted;
    // Элементы держим в DOM: часть WebView капризничает с «оторванными»
    // аудио, да и в devtools так видно, что именно играет.
    for (let i = 0; i < 2; i++) {
      const a = document.createElement('audio');
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      a.dataset.music = String(i);
      a.style.display = 'none';
      a.addEventListener('playing', () => {
        this.state.playing = true;
        this.emit();
      });
      document.body.appendChild(a);
      this.els.push(a);
    }
    // Слушаем жесты игрока с самого начала и до тех пор, пока звук реально
    // не пойдёт: одной попытки мало — жест может случиться раньше, чем мы
    // узнаем об отказе, а повторный play() иногда отклоняется снова.
    this.bindUnlock();
  }

  private target(track: Track) {
    // gain у трека может быть больше единицы — обязательно ограничиваем,
    // иначе присваивание el.volume бросит RangeError
    return this.state.muted ? 0 : Math.min(1, this.state.volume * track.gain);
  }

  /** Плавно переключиться на трек. Повторный вызов с тем же треком —но-оп. */
  play(id: TrackId | null) {
    this.init();
    if (this.wanted === id) return;
    this.wanted = id;

    const cur = this.els[this.active];
    if (!id) {
      this.fade(cur, 0, () => cur.pause());
      this.state.track = null;
      this.state.playing = false;
      this.emit();
      return;
    }

    const track = TRACKS[id];
    const next = this.els[1 - this.active];
    next.src = track.src;
    next.currentTime = 0;
    next.volume = 0;

    next.play().then(() => {
      this.state.playing = true;
      this.emit();
    }).catch(() => {
      // до первого жеста звук запрещён — подождём его
      this.state.playing = false;
      this.bindUnlock();
      this.emit();
    });

    this.fade(cur, 0, () => cur.pause());
    this.fade(next, this.target(track));
    this.active = 1 - this.active;
    this.state.track = track;
    this.emit();
  }

  private unbindUnlock() {
    if (!this.unlock) return;
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.removeEventListener(ev, this.unlock);
    }
    this.unlock = null;
  }

  private bindUnlock() {
    if (this.unlock) return;
    this.unlock = () => {
      const el = this.els[this.active];
      if (!this.wanted || this.state.muted || !el) return;
      if (!el.paused) { this.unbindUnlock(); return; }   // уже играет — слушать нечего
      el.play()
        .then(() => {
          this.state.playing = true;
          this.emit();
          this.unbindUnlock();                           // снимаем только после успеха
        })
        .catch(() => { /* этот жест не сработал — дождёмся следующего */ });
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, this.unlock);
    }
  }

  private fade(el: HTMLAudioElement, to: number, done?: () => void) {
    const from = el.volume;
    const steps = Math.max(1, Math.round(FADE_MS / TICK_MS));
    let i = 0;
    const timer = window.setInterval(() => {
      i++;
      const v = from + (to - from) * (i / steps);
      el.volume = Math.min(1, Math.max(0, v));
      if (i >= steps) {
        window.clearInterval(timer);
        done?.();
      }
    }, TICK_MS);
    // общий таймер нужен лишь для того, чтобы не копить их бесконечно
    if (this.fadeTimer) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => window.clearInterval(timer), FADE_MS + 200);
  }

  setVolume(v: number) {
    this.state.volume = Math.min(1, Math.max(0, v));
    const el = this.els[this.active];
    if (el && this.state.track) el.volume = this.target(this.state.track);
    this.emit();
  }

  setMuted(m: boolean) {
    this.state.muted = m;
    const el = this.els[this.active];
    if (el && this.state.track) {
      el.volume = this.target(this.state.track);
      if (m) {
        el.pause();
      } else {
        el.play()
          .then(() => { this.state.playing = true; this.emit(); })
          .catch(() => this.bindUnlock());
      }
    }
    this.emit();
  }

  /** Короткая проба текущей громкости — для ползунка в настройках. */
  preview() {
    const el = this.els[this.active];
    if (el && this.state.track && !this.state.muted) el.volume = this.target(this.state.track);
  }
}

export const music = new MusicPlayer();
