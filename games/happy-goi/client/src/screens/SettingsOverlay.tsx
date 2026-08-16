// Настройки: громкость музыки и скорость текста в новелле.
// Всё сохраняется сразу — отдельной кнопки «применить» нет.

import { useSyncExternalStore } from 'react';
import { music } from '../audio/music';
import { blip, setVoiceVolume } from '../audio/voice';
import { TEXT_SPEEDS } from '../settings';
import type { Settings } from '../settings';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export default function SettingsOverlay({ settings, onChange, onClose }: Props) {
  const state = useSyncExternalStore(music.subscribe, music.getState, music.getState);

  return (
    <div className="result" onClick={onClose}>
      <div className="result-card settings-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="settings-title">Настройки</h2>

        <section className="set-row">
          <div className="set-head">
            <span>Музыка</span>
            <button
              className={`switch ${settings.muted ? '' : 'is-on'}`}
              onClick={() => { onChange({ muted: !settings.muted }); music.setMuted(!settings.muted); }}
              role="switch"
              aria-checked={!settings.muted}
            >
              <span className="switch-knob" />
            </button>
          </div>
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.volume * 100)}
            disabled={settings.muted}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              onChange({ volume: v });
              music.setVolume(v);
            }}
          />
          <div className="set-note">
            {settings.muted
              ? 'Звук выключен'
              : `Громкость ${Math.round(settings.volume * 100)}%`}
            {state.track && !settings.muted && <> · сейчас: {state.track.title}</>}
          </div>
        </section>

        <section className="set-row">
          <div className="set-head">
            <span>Голоса персонажей</span>
            <span className="set-value">{Math.round(settings.voice * 100)}%</span>
          </div>
          <input
            className="slider slider--voice"
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.voice * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              onChange({ voice: v });
              setVoiceVolume(v);
              blip('maru', 0);          // сразу слышно, что получилось
            }}
          />
          <div className="set-note">
            У каждого свой тембр: Мару выше и с подъёмом, Булочка ровнее, Ell — как из рупора.
          </div>
        </section>

        <section className="set-row">
          <div className="set-head"><span>Скорость текста</span></div>
          <div className="seg">
            {TEXT_SPEEDS.map((s) => (
              <button
                key={s.id}
                className={`seg-btn ${settings.textSpeed === s.ms ? 'is-on' : ''}`}
                onClick={() => onChange({ textSpeed: s.ms })}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="set-note">Клик или пробел всё равно дописывают реплику целиком.</div>
        </section>

        <div className="result-actions">
          <button className="btn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
