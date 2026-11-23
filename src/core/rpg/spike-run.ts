// LEGEND OF BLUM engine spike: probe layout, the bot (same policy as tests/mesen/rpg-spike.lua) and the
// shot list shared by the jsnes run (tests/engine/rpg-spike.test.ts) and Mesen (scripts/rpg-mesen.mjs).
import type { ButtonName } from '../emu/nes-session.js';

export const RPG_PROBE_BASE = 0x7f00;
export const RPG_STATE = { boot: 0, map: 1, scroll: 2, dialog: 3, battle: 4 } as const;
export const RPG_BATTLE = { in: 0, msg: 1, wait: 2, menu: 3, out: 4 } as const;
export const RPG_DIALOG = { box: 0, type: 1, wait: 2, close: 3 } as const;
export const FLAG_CLOCHE = 1;
export const FLAG_CRAYONS = 2;

/** Cycles of one idle-loop iteration in spike.s main (inc zp / bne / cmp zp / beq). */
export const IDLE_CYCLES = 14;

export interface RpgProbe {
  magic: string;
  state: number;
  room: number;
  px: number;
  frame: number;
  py: number;
  facing: number;
  curNt: number;
  tOff: number;
  dPage: number;
  dI: number;
  bSub: number;
  ehp: number;
  php: number;
  cursor: number;
  lag: number;
  flags: number;
  idle: number;
  idleMin: number;
  xp: number;
  turn: number;
  dSub: number;
  vpeak: number;
  items: number;
  talked: number;
  scrollX: number;
  scrollNt: number;
  dRow: number;
  tStep: number;
}

export function readRpgProbe(mem: Uint8Array): RpgProbe {
  const b = (o: number) => mem[RPG_PROBE_BASE + o]!;
  const w = (o: number) => b(o) | (b(o + 1) << 8);
  return {
    magic: String.fromCharCode(b(0), b(1), b(2), b(3)),
    state: b(0x05),
    room: b(0x06),
    px: b(0x07),
    frame: w(0x08),
    py: b(0x0a),
    facing: b(0x0b),
    curNt: b(0x0c),
    tOff: b(0x0d),
    dPage: b(0x0e),
    dI: b(0x0f),
    bSub: b(0x10),
    ehp: b(0x11),
    php: b(0x12),
    cursor: b(0x13),
    lag: b(0x14),
    flags: b(0x15),
    idle: w(0x16),
    idleMin: w(0x18),
    xp: b(0x1a),
    turn: b(0x1b),
    dSub: b(0x1c),
    vpeak: b(0x1d),
    items: b(0x1e),
    talked: b(0x1f),
    scrollX: b(0x20),
    scrollNt: b(0x21),
    dRow: b(0x22),
    tStep: b(0x23),
  };
}

/** Where the bot stops walking once the battle is won (shows the enemy gone). */
export const BOT_END_X = 200;
/** Spike route: talk to Madame Bélanger (y 88 = blocked by her), walk down to the exit row (y 112),
 * right through the transition, right into the crayon enemy, battle with Pouvoir first then Attaque. */
export function rpgBot(p: RpgProbe): ButtonName[] {
  if (p.magic !== 'BLMZ') return [];
  const pulse = (p.frame & 3) < 2; // a press is 2 frames down, 2 frames up
  switch (p.state) {
    case RPG_STATE.map:
      if (p.room === 0) {
        if (!(p.flags & FLAG_CLOCHE)) return p.py > 88 ? ['UP'] : pulse ? ['A'] : [];
        return p.py < 112 ? ['DOWN'] : ['RIGHT'];
      }
      return p.px < BOT_END_X ? ['RIGHT'] : [];
    case RPG_STATE.dialog:
      return p.dSub === RPG_DIALOG.wait && pulse ? ['A'] : [];
    case RPG_STATE.battle: {
      if (p.bSub === RPG_BATTLE.wait) return pulse ? ['A'] : [];
      if (p.bSub === RPG_BATTLE.menu) {
        const target = p.turn === 0 ? 1 : 0;
        if (p.cursor < target) return pulse ? ['DOWN'] : [];
        if (p.cursor > target) return pulse ? ['UP'] : [];
        return pulse ? ['A'] : [];
      }
      return [];
    }
    default:
      return [];
  }
}

/** Shots are taken this many frames after the probe first matches (the NMI writes the last text the
 * frame after the main thread queued it). */
export const SHOT_DELAY = 2;

export interface RpgShot {
  name: string;
  /** First frame where the probe matches (the shot is SHOT_DELAY frames later). */
  when: (p: RpgProbe) => boolean;
  /** Same condition as a Lua expression over the probe table `p` (Mesen twin). */
  lua: string;
}

export const RPG_SHOTS: RpgShot[] = [
  { name: 'start', when: (p) => p.frame === 30, lua: 'p.frame == 30' },
  { name: 'walk-up', when: (p) => p.state === 1 && p.py === 100, lua: 'p.state == 1 and p.py == 100' },
  { name: 'dialog-1', when: (p) => p.state === 3 && p.dSub === 2 && p.dPage === 0, lua: 'p.state == 3 and p.dSub == 2 and p.dPage == 0' },
  { name: 'dialog-2', when: (p) => p.state === 3 && p.dSub === 2 && p.dPage === 1, lua: 'p.state == 3 and p.dSub == 2 and p.dPage == 1' },
  { name: 'dialog-3', when: (p) => p.state === 3 && p.dSub === 2 && p.dPage === 2, lua: 'p.state == 3 and p.dSub == 2 and p.dPage == 2' },
  { name: 'after-dialog', when: (p) => p.state === 1 && (p.flags & 1) === 1 && p.py === 100, lua: 'p.state == 1 and (p.flags & 1) == 1 and p.py == 100' },
  { name: 'scroll-mid', when: (p) => p.state === 2 && p.tOff === 128, lua: 'p.state == 2 and p.tOff == 128' },
  { name: 'room-2', when: (p) => p.state === 1 && p.room === 1 && p.px === 40, lua: 'p.state == 1 and p.room == 1 and p.px == 40' },
  { name: 'battle-intro', when: (p) => p.state === 4 && p.bSub === 2 && p.turn === 0, lua: 'p.state == 4 and p.bSub == 2 and p.turn == 0' },
  { name: 'battle-menu', when: (p) => p.state === 4 && p.bSub === 3 && p.turn === 0 && p.cursor === 1, lua: 'p.state == 4 and p.bSub == 3 and p.turn == 0 and p.cursor == 1' },
  { name: 'battle-power', when: (p) => p.state === 4 && p.bSub === 2 && p.turn === 1 && p.ehp === 11, lua: 'p.state == 4 and p.bSub == 2 and p.turn == 1 and p.ehp == 11' },
  { name: 'battle-win', when: (p) => p.state === 4 && p.bSub === 2 && p.ehp === 0 && p.xp > 0, lua: 'p.state == 4 and p.bSub == 2 and p.ehp == 0 and p.xp > 0' },
  { name: 'after-battle', when: (p) => p.state === 1 && p.room === 1 && p.px === BOT_END_X, lua: `p.state == 1 and p.room == 1 and p.px == ${BOT_END_X}` },
];

export function rpgFreeCycles(idle: number): number {
  return idle * IDLE_CYCLES;
}
