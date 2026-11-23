// SEBRING racer (BLUMR-M1): probe layout ($7F00, docs/RACER-PLAN.md 6.2) and the bots shared by the jsnes
// tier (tests/engine/racer-m1.test.ts) and the Mesen tier (tests/mesen/racer-m1.lua is the same policy,
// line for line, integers only). Bots read only the probe, so both emulators make the same decisions.
import type { ButtonName } from '../emu/nes-session.js';
import { IDLE_CYCLES } from './spike-run.js';

export const RACER_PROBE = {
  base: 0x7f00,
  version: 0x04,
  state: 0x05,
  seg: 0x06,
  curve: 0x07,
  frame: 0x08,
  speed: 0x0a,
  carX: 0x0b,
  hill: 0x0c,
  hy: 0x0d,
  phase: 0x0e,
  offroad: 0x0f,
  dist: 0x10,
  bdX: 0x12,
  lag: 0x14,
  idle: 0x16,
  idleMin: 0x18,
  time: 0x1a,
  continues: 0x1b,
  crashes: 0x1c,
  stage: 0x1d,
  checkpoint: 0x1e,
  radio: 0x1f,
  /** 8 traffic slots: lane (signed, $80 = empty) */
  lanes: 0x20,
  /** 8 traffic slots: depth (road units ahead of the car) */
  depths: 0x28,
  centre: 0x30,
  paused: 0x31,
  cpDist: 0x32,
  crashKind: 0x34,
  timeFrames: 0x35,
  clears: 0x36,
  finish: 0x37,
  /** 8 traffic slots: kind (0 free, 1 car, 2 cone, 3 bus, 4 plow, 5 pothole) */
  kinds: 0x38,
  /** test builds (TEST_CHEATS): bit 0 freezes the clock, bit 1 jumps to the next checkpoint/finish */
  cheats: 0x40,
  penalty: 0x41,
  nmiMode: 0x43,
  titles: 0x44,
  contUsed: 0x45,
  /** BLUMR-M2: snow storm mode (1 = on), honks counted on the title */
  snow: 0x46,
  honks: 0x47,
} as const;

export const RS = { boot: 0, title: 1, intro: 2, drive: 3, crash: 4, checkpoint: 5, timeover: 6, ending: 7, credits: 8, gameover: 9 } as const;

/** Lane offset at the car's line (build-racer.ts LANE_CAR). */
export const BOT_LANE_PX = 51;

export interface RacerTraffic {
  lane: number;
  depth: number;
  kind: number;
}

export interface RacerProbe {
  magic: string;
  version: number;
  state: number;
  seg: number;
  curve: number;
  frame: number;
  speed: number;
  carX: number;
  hill: number;
  hy: number;
  phase: number;
  offroad: number;
  dist: number;
  lag: number;
  idle: number;
  idleMin: number;
  time: number;
  continues: number;
  crashes: number;
  stage: number;
  checkpoint: number;
  radio: number;
  traffic: RacerTraffic[];
  centre: number;
  paused: number;
  cpDist: number;
  crashKind: number;
  timeFrames: number;
  clears: number;
  finish: number;
  penalty: number;
  nmiMode: number;
  titles: number;
  contUsed: number;
  snow: number;
  honks: number;
}

const s8 = (v: number) => (v >= 128 ? v - 256 : v);

export function readRacerProbe(mem: Uint8Array): RacerProbe {
  const P = RACER_PROBE;
  const b = (o: number) => mem[P.base + o]!;
  const w = (o: number) => b(o) | (b(o + 1) << 8);
  const traffic: RacerTraffic[] = [];
  for (let i = 0; i < 8; i++) if (b(P.kinds + i)) traffic.push({ lane: s8(b(P.lanes + i)), depth: b(P.depths + i), kind: b(P.kinds + i) });
  return {
    magic: String.fromCharCode(b(0), b(1), b(2), b(3)),
    version: b(P.version),
    state: b(P.state),
    seg: b(P.seg),
    curve: s8(b(P.curve)),
    frame: w(P.frame),
    speed: b(P.speed),
    carX: b(P.carX),
    hill: s8(b(P.hill)),
    hy: b(P.hy),
    phase: b(P.phase),
    offroad: b(P.offroad),
    dist: w(P.dist),
    lag: b(P.lag),
    idle: w(P.idle),
    idleMin: w(P.idleMin),
    time: b(P.time),
    continues: b(P.continues),
    crashes: b(P.crashes),
    stage: b(P.stage),
    checkpoint: b(P.checkpoint),
    radio: b(P.radio),
    traffic,
    centre: b(P.centre),
    paused: b(P.paused),
    cpDist: w(P.cpDist),
    crashKind: b(P.crashKind),
    timeFrames: b(P.timeFrames),
    clears: b(P.clears),
    finish: b(P.finish),
    penalty: b(P.penalty),
    nmiMode: b(P.nmiMode),
    titles: b(P.titles),
    contUsed: b(P.contUsed),
    snow: b(P.snow),
    honks: b(P.honks),
  };
}

export const racerFreeCycles = (idle: number) => idle * IDLE_CYCLES;

/** Start pressed on 4 frames of 16: a fresh press each time (menus read new presses). */
const tapStart = (p: RacerProbe): ButtonName[] => ((p.frame & 15) < 4 ? ['START'] : []);

export type RacerBotKind = 'race' | 'crash' | 'idle';

/** Free road ahead per lane (-1, 0, 1): depth of the nearest object at least 6 units ahead, 255 if none. */
export function laneClearance(p: RacerProbe): [number, number, number] {
  const c: [number, number, number] = [255, 255, 255];
  for (const t of p.traffic) if (t.depth >= 6 && t.lane >= -1 && t.lane <= 1 && t.depth < c[t.lane + 1]!) c[t.lane + 1] = t.depth;
  return c;
}

/**
 * race: hold A, keep a lane with free road ahead: under 70 free units, move to a freer lane whose way there
 * (every lane crossed, target included) is free for more than 25 units, nearest lanes first; brake when the
 * car's lane and the chosen lane are both blocked within 40 units.
 * crash: hold A and steer into the lane of the nearest object. idle: never touch the pad while driving.
 * Every bot taps Start on menus, stage cards and the continue prompt.
 */
export function racerBot(p: RacerProbe, kind: RacerBotKind = 'race'): ButtonName[] {
  if (p.magic !== 'SBRG') return [];
  if (p.state !== RS.drive && p.state !== RS.checkpoint) return p.state === RS.crash ? [] : tapStart(p);
  if (p.paused) return tapStart(p);
  if (kind === 'idle') return [];
  const clear = laneClearance(p);
  // current lane = the lane centre nearest to the car
  let cur = 0;
  let bestD = 9999;
  for (let l = -1; l <= 1; l++) {
    const d = Math.abs(p.centre + l * BOT_LANE_PX - p.carX);
    if (d < bestD) (bestD = d), (cur = l);
  }
  let target = cur;
  if (kind === 'crash') {
    let near = 255;
    for (const t of p.traffic) if (t.depth >= 6 && t.depth < near && t.lane >= -1 && t.lane <= 1) (near = t.depth), (target = t.lane);
  } else if (clear[cur + 1]! < 70) {
    // move to a freer lane only if every lane on the way (target included) is free for 25 units
    let best = clear[cur + 1]!;
    for (const l of [cur - 1, cur + 1, cur - 2, cur + 2]) {
      if (l < -1 || l > 1) continue;
      let path = 255;
      for (let k = Math.min(l, cur); k <= Math.max(l, cur); k++) if (k !== cur) path = Math.min(path, clear[k + 1]!);
      if (path > 25 && clear[l + 1]! > best) (best = clear[l + 1]!), (target = l);
    }
  }
  const out: ButtonName[] = [];
  const blocked = kind === 'race' && clear[cur + 1]! < 40 && clear[target + 1]! < 40;
  out.push(blocked ? 'B' : 'A');
  const tx = p.centre + target * BOT_LANE_PX;
  if (p.carX < tx - 4) out.push('RIGHT');
  else if (p.carX > tx + 4) out.push('LEFT');
  return out;
}
