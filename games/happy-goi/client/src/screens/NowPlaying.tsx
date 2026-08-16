// Плашка «сейчас играет» в правом нижнем углу.
// На поле сапёра висит постоянно, на остальных экранах показывается
// несколько секунд после смены трека, чтобы не спорить с рамкой реплики.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { music } from '../audio/music';

const SHOW_MS = 5000;

export default function NowPlaying({ pinned }: { pinned: boolean }) {
  const state = useSyncExternalStore(music.subscribe, music.getState, music.getState);
  const [visible, setVisible] = useState(false);
  const title = state.track?.title;

  useEffect(() => {
    if (!title) { setVisible(false); return; }
    setVisible(true);
    if (pinned) return;
    const t = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(t);
  }, [title, pinned]);

  if (!title) return null;

  return (
    <div className={`now-playing ${visible || pinned ? 'is-on' : ''}`}>
      <button
        className="np-mute"
        onClick={() => music.setMuted(!state.muted)}
        title={state.muted ? 'Включить музыку' : 'Выключить музыку'}
      >
        {state.muted ? '🔇' : '♪'}
      </button>
      <span className="np-title">{title}</span>
    </div>
  );
}
