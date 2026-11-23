// THE LEGEND OF BLUM (BLUMZ-M1): the random soak (scripts/legend-soak.mjs, and replayed in Mesen by
// scripts/legend-mesen.mjs). A seeded "player-like" pad: walks around, presses A at everything, opens the
// menu, answers choices at random, fights or flees at random, from a dirty boot. It looks for what the
// scripted bot never meets: a frozen frame counter (hang), an invalid state, lag frames, a lost probe, a
// state that never ends (load, slide, battle exit).
import { RomHarness, type Prefill } from '../../emu/harness.js';
import type { ButtonName, JsnesModule } from '../../emu/nes-session.js';
import { buttonMask, LS, readLegendProbe, traceKey, type LegendBot, type LegendProbe } from './run.js';

export interface SoakOptions {
  seed: number;
  frames: number;
  prefill?: Prefill;
  /** Mixed soak: the bot plays, interrupted by bursts of random input (detours, menus, fleeing, losing). */
  bot?: LegendBot;
}
export interface SoakResult {
  frames: number;
  finished: boolean;
  bursts: number;
  inputs: Record<number, number>;
  events: string[];
  problems: string[];
  states: Record<string, number>;
  battles: number;
  dialogs: number;
  menus: number;
  screens: number[];
  maxStill: number;
  lag: number;
  end: LegendProbe;
}

const STATE_NAMES = ['boot', 'map', 'scroll', 'dialog', 'battle', 'menu', 'title', 'card', 'load', 'classes', 'end'];
/** Longest a passing state may last (frames) before it counts as stuck. */
const PASSING_MAX: Record<number, number> = { [LS.load]: 240, [LS.scroll]: 200 };

export function soakRun(jsnes: JsnesModule, rom: Uint8Array, o: SoakOptions): SoakResult {
  const h = new RomHarness(jsnes, rom, { prefill: o.prefill ?? 'clean' });
  let seed = (o.seed * 2654435761) >>> 0 || 1;
  const rnd = (n: number) => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed % n;
  };
  const inputs: Record<number, number> = {};
  const events: string[] = [];
  const problems: string[] = [];
  const states: Record<string, number> = {};
  const screens = new Set<number>();
  let p = readLegendProbe(h.s.mem);
  let hold: ButtonName[] = [];
  let left = 0;
  let last = '';
  let still = 0;
  let maxStill = 0;
  let lastFrame = -1;
  let inState = 0;
  let prevState = -1;
  let battles = 0;
  let dialogs = 0;
  let menus = 0;
  let burst = 0;
  let bursts = 0;
  let finished = false;
  let f = 0;
  while (f < o.frames) {
    f++;
    let b: ButtonName[];
    if (o.bot && burst === 0 && rnd(400) === 0) {
      burst = 20 + rnd(180);
      bursts++;
    }
    if (p.magic !== 'BLMZ') b = [];
    else if (p.state === LS.title) b = p.selCur !== 0 ? ((p.frame & 3) < 2 ? ['UP'] : []) : (p.frame & 7) < 2 ? ['A'] : [];
    else if (o.bot && burst === 0) b = o.bot.step(p);
    else {
      if (burst > 0) burst--;
      if (left <= 0) {
        const v = rnd(100);
        const dirs: ButtonName[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        if (v < 55) {
          hold = [dirs[rnd(4)]!];
          left = 1 + rnd(40);
        } else if (v < 80) {
          hold = ['A'];
          left = 1 + rnd(3);
        } else if (v < 88) {
          hold = ['B'];
          left = 1 + rnd(3);
        } else if (v < 94) {
          hold = ['START'];
          left = 1 + rnd(2);
        } else if (v < 96) {
          hold = ['SELECT'];
          left = 1;
        } else {
          hold = [];
          left = 1 + rnd(20);
        }
      }
      left--;
      b = hold;
    }
    const mask = buttonMask(b);
    if (mask && p.magic === 'BLMZ') inputs[p.frame] = mask;
    h.step(1, b);
    p = readLegendProbe(h.s.mem);
    const k = traceKey(p);
    if (k !== last) {
      events.push(`${f}:${k}`);
      last = k;
    }
    if (p.magic !== 'BLMZ') {
      if (f > 5) problems.push(`frame ${f}: probe lost`);
      continue;
    }
    if (p.state > LS.end) problems.push(`frame ${f}: invalid state ${p.state}`);
    if (p.frame === lastFrame) {
      still++;
      maxStill = Math.max(maxStill, still);
      if (still === 120) problems.push(`frame ${f}: frame counter frozen 2 s (state ${p.state})`);
    } else still = 0;
    lastFrame = p.frame;
    if (p.state !== prevState) {
      if (p.state === LS.battle) battles++;
      if (p.state === LS.dialog) dialogs++;
      if (p.state === LS.menu) menus++;
      prevState = p.state;
      inState = 0;
    }
    inState++;
    const maxIn = PASSING_MAX[p.state];
    if (maxIn && inState === maxIn) problems.push(`frame ${f}: stuck in ${STATE_NAMES[p.state]} for ${maxIn} frames`);
    states[STATE_NAMES[p.state] ?? `?${p.state}`] = (states[STATE_NAMES[p.state] ?? `?${p.state}`] ?? 0) + 1;
    if (p.state === LS.map) screens.add(p.screen);
    if (problems.length > 20) break;
    if (o.bot && p.state === LS.end) {
      finished = true;
      break;
    }
  }
  if (p.lag) problems.push(`${p.lag} lag frames`);
  return { frames: f, finished, bursts, inputs, events, problems, states, battles, dialogs, menus, screens: [...screens].sort((a, b) => a - b), maxStill, lag: p.lag, end: p };
}
