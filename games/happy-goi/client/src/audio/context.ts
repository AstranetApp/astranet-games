// Один AudioContext на всю игру: и музыка, и голоса берут его отсюда.
// Браузеры разрешают ограниченное число контекстов, а держать два ради
// двух источников звука незачем.

let ctx: AudioContext | null = null;

export function audioCtx(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}
