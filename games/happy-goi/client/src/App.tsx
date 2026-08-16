// Оркестрация экранов и связь с сервером.
//
// Роутера здесь нет: весь переход между экранами — это одно поле phase.
// Для игры такого размера этого достаточно, а взамен получаем то, чего от
// роутера пришлось бы добиваться руками: музыка, предзагрузка и «что рисуем»
// выводятся из одного значения, и рассинхронизироваться им негде.
//
// Пролог показывается один раз — флаг seenIntro живёт на сервере, поэтому
// у одного и того же жильца Astranet знакомство с Мару не повторится ни
// на телефоне, ни в вебе.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, setAuth } from './astranet/api';
import type { FinishResult, GameStart, Profile, ShiftStart } from './astranet/api';
import { resolveAuth } from './astranet/sdk';
import type { AuthKind } from './astranet/sdk';
import type { Difficulty } from './game/difficulty';
import VNPlayer from './vn/VNPlayer';
import {
  BRIEF, INTRO, KPP_BRIEF, SHIFT_LOSS, SHIFT_WIN, WIN_LINES, lossScene, pick,
} from './vn/script';
import type { Scene } from './vn/types';
import MainMenu from './screens/MainMenu';
import MinesweeperScreen from './screens/MinesweeperScreen';
import CheckpointScreen from './screens/CheckpointScreen';
import type { ShiftResult } from './screens/CheckpointScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import ResultOverlay from './screens/ResultOverlay';
import NowPlaying from './screens/NowPlaying';
import SettingsOverlay from './screens/SettingsOverlay';
import { music } from './audio/music';
import type { TrackId } from './audio/music';
import { setVoiceVolume } from './audio/voice';
import { loadSettings, saveSettings } from './settings';
import type { Settings } from './settings';

type Phase =
  | 'boot' | 'error' | 'intro' | 'menu' | 'board'
  | 'brief' | 'game' | 'reaction' | 'result'
  | 'kppBrief' | 'shift' | 'shiftReaction' | 'shiftResult';

const BRIEFED_KEY = 'happygoi.briefed';

// Музыка привязана к экрану, а не к событию: любой переход сам по себе
// выбирает трек, и ни один экран не может забыть его переключить.
//
// Обрати внимание на brief и kppBrief: они звучат ещё спокойной темой, хотя
// ведут в игру. Трек меняется, только когда персонажи договорили, — иначе
// кроссфейд перебивает реплику на полуслове.
const TRACK_BY_PHASE: Record<Phase, TrackId | null> = {
  boot: null,
  error: null,
  intro: 'seaside',
  menu: 'seaside',
  board: 'seaside',
  brief: 'seaside',
  game: 'mirrors',
  reaction: 'mirrors',
  result: 'mirrors',
  kppBrief: 'seaside',
  shift: 'overclock',
  shiftReaction: 'overclock',
  shiftResult: 'overclock',
};

// Картинки сцены грузим заранее: спрайт не должен «въезжать» в кадр
// уже после того, как персонаж заговорил.
function preload(urls: string[]) {
  return Promise.all(urls.map((src) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = img.onerror = () => done();
    img.src = src;
  })));
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [authKind, setAuthKind] = useState<AuthKind>('guest');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [game, setGame] = useState<GameStart | null>(null);
  const [shift, setShift] = useState<ShiftStart | null>(null);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [duration, setDuration] = useState(0);
  const [reaction, setReaction] = useState<Scene>([]);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const backFromBoard = useRef<Phase>('menu');

  // музыка следует за экраном; сам плеер разбирается с кроссфейдом
  useEffect(() => { music.play(TRACK_BY_PHASE[phase]); }, [phase]);

  // громкость голосов живёт в модуле озвучки, а не в React-состоянии
  useEffect(() => { setVoiceVolume(settings.voice); }, [settings.voice]);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const vars = useMemo(
    () => ({ name: profile?.name ?? 'жилец', flat: profile?.flat ?? 1 }),
    [profile],
  );

  // ---------- загрузка ----------

  const boot = useCallback(async () => {
    setPhase('boot');
    try {
      const auth = await resolveAuth();
      setAuthKind(auth.kind);
      setAuth(auth.header);
      const [p] = await Promise.all([
        api.hello(),
        preload([
          '/assets/street.webp',
          '/assets/menu_background.webp',
          '/assets/maru.webp',
          '/assets/bulochka.webp',
        ]),
      ]);
      setProfile(p);
      setPhase(p.seenIntro ? 'menu' : 'intro');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  const refresh = useCallback(async () => {
    // Профиль — это счётчики в углу экрана: не обновились сейчас, обновятся
    // на следующем hello. Ронять из-за них экран нельзя.
    try { setProfile(await api.hello()); } catch { /* подождёт следующего раза */ }
  }, []);

  // ---------- сюжет ----------

  const finishIntro = useCallback(() => {
    setPhase('menu');
    api.seenIntro().catch(() => { /* повторим при следующем hello */ });
    setProfile((p) => (p ? { ...p, seenIntro: true } : p));
  }, []);

  // ---------- партия ----------

  const startGame = useCallback(async (d: Difficulty, withBrief: boolean) => {
    try {
      const g = await api.gameStart(d);
      setGame(g);
      setResult(null);
      setPhase(withBrief ? 'brief' : 'game');
    } catch {
      setPhase('error');
    }
  }, []);

  const onPlay = useCallback((d: Difficulty) => {
    void startGame(d, true);
  }, [startGame]);

  // Из меню брифинг идёт всегда, но со второго раза — обрезанный до первой
  // реплики: правила сапёра игрок уже знает, а «Чаки снова заминировала ЖК»
  // нужно, чтобы партия начиналась с реплики, а не с голого поля.
  // Флаг держим в localStorage: он про «этот игрок уже читал», а не про
  // прогресс, и терять его при смене устройства не жалко.
  const briefScene = useMemo<Scene>(() => {
    let seen = false;
    try { seen = localStorage.getItem(BRIEFED_KEY) === '1'; } catch { /* приватный режим */ }
    return seen ? BRIEF.slice(0, 1) : BRIEF;
  }, [game]);

  const finishBrief = useCallback(() => {
    try { localStorage.setItem(BRIEFED_KEY, '1'); } catch { /* приватный режим: прочитает брифинг ещё раз */ }
    setPhase('game');
  }, []);

  const onFinish = useCallback(async (res: 'win' | 'loss', dur: number) => {
    if (!game) return;
    setDuration(dur);
    setReaction(res === 'win' ? pick(WIN_LINES) : lossScene());
    setPhase('reaction');
    try {
      const r = await api.gameFinish(game.gameId, res, dur);
      setResult(r);
      setProfile((p) => (p ? { ...p, streak: r.streak } : p));
    } catch (e) {
      // Исход партии переписывать нельзя: игрок видел, что двор разминирован.
      // Честно говорим, что очки не начислены, и почему.
      setResult({
        ok: true,
        won: res === 'win',
        score: 0,
        streak: 0,
        notCounted: e instanceof ApiError && e.status === 422 ? 'rejected' : 'offline',
      });
    }
    void refresh();
  }, [game, refresh]);

  // ---------- смена на КПП ----------

  // withBrief=false — повторный заход прямо из экрана итогов: инструктаж там
  // только мешает. В отличие от сапёрного, брифинг КПП не обрезается: правил
  // больше, они накапливаются по ходу смены, и урезанная до одной реплики
  // версия читалась как поломка. Кто их помнит — жмёт «Пропустить».
  const startShift = useCallback(async (withBrief: boolean) => {
    try {
      const s = await api.shiftStart();
      setShift(s);
      setResult(null);
      setPhase(withBrief ? 'kppBrief' : 'shift');
    } catch {
      setPhase('error');
    }
  }, []);

  const finishKppBrief = useCallback(() => setPhase('shift'), []);

  const onShiftFinish = useCallback(async (r: ShiftResult) => {
    if (!shift) return;
    setDuration(r.duration);
    setReaction(pick(r.survived ? SHIFT_WIN : SHIFT_LOSS));
    setPhase('shiftReaction');
    try {
      const res = await api.shiftFinish(shift.shiftId, r);
      setResult(res);
      setProfile((p) => (p ? { ...p, streak: res.streak } : p));
    } catch (e) {
      setResult({
        ok: true,
        won: r.survived,
        score: 0,
        streak: 0,
        notCounted: e instanceof ApiError && e.status === 422 ? 'rejected' : 'offline',
      });
    }
    void refresh();
  }, [shift, refresh]);

  const openBoard = useCallback((from: Phase) => {
    backFromBoard.current = from;
    setPhase('board');
  }, []);

  const rename = useCallback((name: string) => {
    setProfile((p) => (p ? { ...p, name } : p));
    api.setName(name).then((r) => setProfile((p) => (p ? { ...p, name: r.name } : p)))
      .catch(() => void refresh());
  }, [refresh]);

  // ---------- экраны ----------

  const screen = (() => {
    if (phase === 'boot') {
      return (
        <div className="boot">
          <div className="boot-glow" />
          <p>Открываем калитку…</p>
        </div>
      );
    }

    if (phase === 'error') {
      return (
        <div className="boot">
          <p>Консьерж не отвечает. Связь с домоуправлением потеряна.</p>
          <button className="btn" onClick={() => void boot()}>Постучать ещё раз</button>
        </div>
      );
    }

    if (phase === 'intro') {
      return <VNPlayer scene={INTRO} vars={vars} onDone={finishIntro} charMs={settings.textSpeed} />;
    }

    if (phase === 'board') {
      return <LeaderboardScreen onBack={() => setPhase(backFromBoard.current)} />;
    }

    if (phase === 'menu' && profile) {
      return (
        <MainMenu
          profile={profile}
          authKind={authKind}
          onPlay={onPlay}
          onBoard={() => openBoard('menu')}
          onRename={rename}
          onReplayIntro={() => setPhase('intro')}
          onSettings={() => setShowSettings(true)}
          onShift={() => void startShift(true)}
        />
      );
    }

    if (phase === 'kppBrief') {
      return (
        <VNPlayer
          scene={KPP_BRIEF}
          vars={vars}
          onDone={finishKppBrief}
          charMs={settings.textSpeed}
        />
      );
    }

    if ((phase === 'shift' || phase === 'shiftReaction' || phase === 'shiftResult') && shift) {
      return (
        <>
          {phase === 'shift' && (
            <CheckpointScreen
              shift={shift}
              streak={profile?.streak ?? 0}
              onFinish={(r) => void onShiftFinish(r)}
              onQuit={() => setPhase('menu')}
            />
          )}

          {phase === 'shiftReaction' && (
            <VNPlayer
              scene={reaction}
              vars={vars}
              onDone={() => setPhase('shiftResult')}
              skippable={false}
              charMs={settings.textSpeed}
            />
          )}

          {phase === 'shiftResult' && (
            <>
              <div className="menu-bg" />
              <div className="menu-scrim" />
              {result ? (
                <ResultOverlay
                  result={result}
                  mode="kpp"
                  duration={duration}
                  onAgain={() => void startShift(false)}
                  onMenu={() => setPhase('menu')}
                  onBoard={() => openBoard('shiftResult')}
                />
              ) : (
                <div className="result"><div className="result-card">
                  <p>Домоуправление считает премию…</p>
                </div></div>
              )}
            </>
          )}
        </>
      );
    }

    if (phase === 'brief') {
      return (
        <VNPlayer scene={briefScene} vars={vars} onDone={finishBrief} charMs={settings.textSpeed} />
      );
    }

    if ((phase === 'game' || phase === 'reaction' || phase === 'result') && game) {
      return (
        <>
          {phase === 'game' && (
            <MinesweeperScreen
              game={game}
              streak={profile?.streak ?? 0}
              onFinish={(r, d) => void onFinish(r, d)}
              onQuit={() => setPhase('menu')}
            />
          )}

          {phase === 'reaction' && (
            <VNPlayer
              scene={reaction}
              vars={vars}
              onDone={() => setPhase('result')}
              skippable={false}
              charMs={settings.textSpeed}
            />
          )}

          {phase === 'result' && (
            <>
              <div className="menu-bg" />
              <div className="menu-scrim" />
              {result ? (
                <ResultOverlay
                  result={result}
                  difficulty={game.difficulty}
                  duration={duration}
                  onAgain={() => void startGame(game.difficulty, false)}
                  onMenu={() => setPhase('menu')}
                  onBoard={() => openBoard('result')}
                />
              ) : (
                <div className="result"><div className="result-card">
                  <p>Домоуправление считает премию…</p>
                </div></div>
              )}
            </>
          )}
        </>
      );
    }

    return null;
  })();

  return (
    <>
      {screen}
      {phase !== 'boot' && phase !== 'error' && <NowPlaying pinned={phase === 'game'} />}
      {showSettings && (
        <SettingsOverlay
          settings={settings}
          onChange={patchSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
