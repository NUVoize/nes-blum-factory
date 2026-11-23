// UI sounds: the ui-kit blips (CC0, OGG) for menu actions, and a WebAudio square-wave typewriter blip
// whose pitch differs per director (PLAN §9.6). Silent when muted or when the window is not focused.
import back from './ui-kit/sounds/back.ogg';
import buildDone from './ui-kit/sounds/build-done.ogg';
import buildStart from './ui-kit/sounds/build-start.ogg';
import coin from './ui-kit/sounds/coin.ogg';
import cursor from './ui-kit/sounds/cursor.ogg';
import error from './ui-kit/sounds/error.ogg';
import select from './ui-kit/sounds/select.ogg';
import success from './ui-kit/sounds/success.ogg';

const FILES = { back, buildDone, buildStart, coin, cursor, error, select, success } as const;
export type SoundId = keyof typeof FILES;

export const DIRECTOR_PITCH: Record<string, number> = { story: 660, visual: 880, movement: 523, level: 587, build: 392 };

let volume = 0.4;
let muted = false;
let ctx: AudioContext | null = null;

export function configureSound(v: number, m: boolean): void {
  volume = Math.max(0, Math.min(1, v / 100));
  muted = m;
}

function audible(): boolean {
  return !muted && volume > 0 && document.hasFocus() && !document.documentElement.classList.contains('smoke');
}

export function play(id: SoundId): void {
  if (!audible()) return;
  const a = new Audio(FILES[id]);
  a.volume = volume;
  void a.play().catch(() => {});
}

export function blip(director: string): void {
  if (!audible()) return;
  ctx ??= new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = DIRECTOR_PITCH[director] ?? 600;
  gain.gain.value = volume * 0.08;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.025);
}
