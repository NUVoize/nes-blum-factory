// THE LEGEND OF BLUM (BLUMZ-M1): the probe ($7F00, rpg/src/probe.s) and the test bot. The bot plays the slice
// from the probe only: it follows rpg/legend/route.json (what to do, in story order), finds its way through
// screens, doors and tiles with the compiled maps, answers choices as scripts.json says, picks the class it
// was given, and fights with the simulator's policy (src/core/rpg/legend/sim.ts policyAction). The same
// input sequence is replayed in Mesen (scripts/legend-mesen.mjs): both emulators must agree frame by frame.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ButtonName } from '../../emu/nes-session.js';
import { MAP_H, MAP_W, type CompiledScreen, type LegendMeta } from './compile.js';
import type { LegendData, Op } from './data.js';
import { policyAction } from './sim.js';

export const LEGEND_PROBE = 0x7f00;
export const LS = { boot: 0, map: 1, scroll: 2, dialog: 3, battle: 4, menu: 5, title: 6, card: 7, load: 8, classes: 9, end: 10 } as const;
export const DS = { open: 0, page: 1, clear2: 2, type: 3, wait: 4, choice: 5, close: 6 } as const;
export const BS = { intro: 0, clear: 1, type: 2, wait: 3, menu: 4, out: 5 } as const;
export const MS = { open: 0, print: 1, select: 2, items: 3, wait: 4, close: 5 } as const;
/** Cycles of one idle-loop iteration in legend.s main (inc zp / bne / cmp zp / beq). */
export const IDLE_CYCLES = 14;

export interface LegendProbe {
  magic: string;
  version: number;
  state: number;
  screen: number;
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
  hp: number;
  cursor: number;
  lag: number;
  battle: number;
  idle: number;
  idleMin: number;
  xp: number;
  turn: number;
  dSub: number;
  vpeak: number;
  chCur: number;
  talks: number;
  scrollX: number;
  scrollNt: number;
  dRow: number;
  ldStep: number;
  chapter: number;
  area: number;
  cls: number;
  level: number;
  energy: number;
  maxHp: number;
  col: number;
  charge: number;
  chN: number;
  vmOn: number;
  scrollY: number;
  mirror: number;
  flags: number[];
  items: number;
  chId: number;
  mSub: number;
  bResult: number;
  stunned: number;
  helper: number;
  mCur: number;
  saves: number;
  loadOk: number;
  winOpen: number;
  menuOpen: number;
  touchLock: number;
  ldThen: number;
  selCur: number;
  palLevel: number;
  pose: number;
  entN: number;
}

export function readLegendProbe(mem: ArrayLike<number>): LegendProbe {
  const b = (o: number) => mem[LEGEND_PROBE + o]!;
  const w = (o: number) => b(o) | (b(o + 1) << 8);
  return {
    magic: String.fromCharCode(b(0), b(1), b(2), b(3)),
    version: b(4),
    state: b(0x05),
    screen: b(0x06),
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
    hp: b(0x12),
    cursor: b(0x13),
    lag: b(0x14),
    battle: b(0x15),
    idle: w(0x16),
    idleMin: w(0x18),
    xp: b(0x1a),
    turn: b(0x1b),
    dSub: b(0x1c),
    vpeak: b(0x1d),
    chCur: b(0x1e),
    talks: b(0x1f),
    scrollX: b(0x20),
    scrollNt: b(0x21),
    dRow: b(0x22),
    ldStep: b(0x23),
    chapter: b(0x24),
    area: b(0x25),
    cls: b(0x26),
    level: b(0x27),
    energy: b(0x28),
    maxHp: b(0x29),
    col: b(0x2a),
    charge: b(0x2b),
    chN: b(0x2c),
    vmOn: b(0x2d),
    scrollY: b(0x2e),
    mirror: b(0x2f),
    flags: Array.from({ length: 32 }, (_, i) => b(0x30 + i)),
    items: b(0x50) | (b(0x51) << 8) | (b(0x52) << 16) | (b(0x53) << 24),
    chId: b(0x54),
    mSub: b(0x55),
    bResult: b(0x56),
    stunned: b(0x57),
    helper: b(0x58),
    mCur: b(0x59),
    saves: b(0x5a),
    loadOk: b(0x5b),
    winOpen: b(0x5c),
    menuOpen: b(0x5d),
    touchLock: b(0x5e),
    ldThen: b(0x5f),
    selCur: b(0x60),
    palLevel: b(0x61),
    pose: b(0x62),
    entN: b(0x63),
  };
}

export const hasFlag = (p: LegendProbe, id: number) => ((p.flags[id >> 3]! >> (id & 7)) & 1) === 1;
export const hasItem = (p: LegendProbe, id: number) => ((p.items >>> id) & 1) === 1;
export function legendFreeCycles(idle: number): number {
  return idle * IDLE_CYCLES;
}

export interface RouteStep {
  until: { flag?: string; item?: string; talked?: string; menu?: boolean };
  talk?: string;
  touch?: string;
  menu?: boolean;
}
export function loadRoute(rpgDir: string): RouteStep[] {
  return (JSON.parse(readFileSync(path.join(rpgDir, 'legend', 'route.json'), 'utf8')) as { steps: RouteStep[] }).steps;
}

const DIRS = { RIGHT: [1, 0], LEFT: [-1, 0], DOWN: [0, 1], UP: [0, -1] } as const;
type Dir = keyof typeof DIRS;
const FACE_OF: Record<Dir, number> = { DOWN: 0, UP: 1, LEFT: 2, RIGHT: 3 };

/** Screens an entity's scripts can warp to (doors). */
function warpTargets(ops: Op[], out: Set<string>) {
  for (const o of ops) {
    if ('warp' in o) out.add(o.warp.screen);
    if ('if' in o) (warpTargets(o.then, out), warpTargets(o.else ?? [], out));
    if ('choice' in o) o.then.forEach((b) => warpTargets(b, out));
  }
}

export interface BotOptions {
  /** Class the bot picks (0-4). */
  cls: number;
}

/** The slice bot. step(probe) -> buttons for the next frame. Deterministic: same probes, same buttons. */
export class LegendBot {
  readonly talked = new Set<string>();
  menuDone = false;
  private menuSawText = false;
  private moveDir: Dir | null = null;
  private turned = -10;
  private lastXY = -1;
  private still = 0;
  private lastGoal = '';
  private pendingTalk: string | null = null;
  private titleFrames = 0;
  readonly entityScreen = new Map<string, CompiledScreen>();
  private readonly doors = new Map<number, { entity: string; to: number }[]>();
  readonly flagId: Map<string, number>;
  readonly itemId: Map<string, number>;

  constructor(
    readonly meta: LegendMeta,
    readonly data: LegendData,
    readonly route: RouteStep[],
    readonly opts: BotOptions,
  ) {
    this.flagId = meta.flags;
    this.itemId = meta.items;
    for (const s of meta.screens) {
      for (const e of s.entities) {
        this.entityScreen.set(e.id, s);
        const t = new Set<string>();
        for (const sc of [e.touch, e.talk]) if (sc) warpTargets(data.scripts[sc] ?? [], t);
        for (const to of t) {
          const list = this.doors.get(s.index) ?? [];
          list.push({ entity: e.id, to: meta.screenIndex.get(to)! });
          this.doors.set(s.index, list);
        }
      }
    }
  }

  /** The route step the bot is on (-1 = route done). */
  stepIndex(p: LegendProbe): number {
    return this.route.findIndex((s) => !this.done(s, p));
  }
  private done(s: RouteStep, p: LegendProbe): boolean {
    const u = s.until;
    if (u.flag !== undefined) return hasFlag(p, this.flagId.get(u.flag)!);
    if (u.item !== undefined) return hasItem(p, this.itemId.get(u.item)!);
    if (u.talked !== undefined) return this.talked.has(u.talked);
    if (u.menu) return this.menuDone;
    return true;
  }

  step(p: LegendProbe): ButtonName[] {
    if (p.magic !== 'BLMZ') return [];
    const pulse = (p.frame & 3) < 2;
    const press = (b: ButtonName): ButtonName[] => (pulse ? [b] : []);
    // a talk that started a script counts as done
    if (this.pendingTalk && p.vmOn) {
      this.talked.add(this.pendingTalk);
      this.pendingTalk = null;
    }
    switch (p.state) {
      case LS.title:
        // BLUMZ-F2: stay on the title for a moment (its screenshot), go down to CONTINUER and back up (the
        // cursor shot), then start
        if (p.palLevel !== 0) return [];
        this.titleFrames++;
        if (this.titleFrames < 30) return [];
        if (this.titleFrames < 50) return p.selCur === 0 && this.titleFrames < 40 ? press('DOWN') : [];
        return p.selCur !== 0 ? press('UP') : press('A');
      case LS.card:
        return press('A');
      case LS.classes:
        if (p.selCur !== this.opts.cls) return press('DOWN');
        return press('A');
      case LS.dialog:
        if (p.menuOpen) this.menuSawText = true;
        if (p.dSub === DS.wait) return press('A');
        if (p.dSub === DS.choice) {
          const want = this.meta.choices.find((c) => c.id === p.chId)?.bot ?? 0;
          if (p.chCur !== want) return press('RIGHT');
          return press('A');
        }
        return [];
      case LS.menu:
        if (p.mSub === MS.select) {
          if (!this.menuSawText) return p.mCur === 0 ? press('A') : press('UP');
          this.menuDone = true;
          return press('B');
        }
        return [];
      case LS.battle:
        return this.fight(p, press);
      case LS.map:
        return this.walk(p, press);
      default:
        return [];
    }
  }

  private fight(p: LegendProbe, press: (b: ButtonName) => ButtonName[]): ButtonName[] {
    if (p.bSub === BS.wait) return press('A');
    if (p.bSub !== BS.menu) return [];
    const cls = this.data.classes.classes[p.cls]!;
    const act = policyAction({ charge: p.charge !== 0, hp: p.hp, maxHp: p.maxHp, collations: p.col, energy: p.energy, cost: cls.cost });
    const want = { attack: 0, power: 1, item: 2, defend: 3 }[act];
    if (p.cursor < want) return press('DOWN');
    if (p.cursor > want) return press('UP');
    return press('A');
  }

  private walk(p: LegendProbe, press: (b: ButtonName) => ButtonName[]): ButtonName[] {
    const si = this.stepIndex(p);
    if (si < 0) return [];
    const st = this.route[si]!;
    if (st.menu) return press('START');
    // keep walking to the next tile boundary
    const aligned = p.px % 16 === 0 && p.py % 16 === 0;
    const xy = p.screen * 65536 + p.px * 256 + p.py;
    this.still = xy === this.lastXY ? this.still + 1 : 0;
    this.lastXY = xy;
    if (!aligned && this.moveDir && this.still < 3) return [this.moveDir];
    this.moveDir = null;
    if (!aligned) {
      // off the grid (an enemy or a door touched mid-tile, or a human-like detour): back to the nearest tile,
      // trying the other ways in turn when a wall is in the way
      const ways: Dir[] = [];
      if (p.py % 16) ways.push(p.py % 16 < 8 ? 'UP' : 'DOWN', p.py % 16 < 8 ? 'DOWN' : 'UP');
      if (p.px % 16) ways.push(p.px % 16 < 8 ? 'LEFT' : 'RIGHT', p.px % 16 < 8 ? 'RIGHT' : 'LEFT');
      return [ways[Math.floor(this.still / 4) % ways.length]!];
    }
    const target = (st.talk ?? st.touch)!;
    const goalKey = `${si}:${target}`;
    if (goalKey !== this.lastGoal) this.lastGoal = goalKey;
    const tscr = this.entityScreen.get(target);
    if (!tscr) return [];
    const scr = this.meta.screens[p.screen]!;
    const here = (p.py / 16) * MAP_W + p.px / 16;
    // which entity / edge to reach on this screen
    let goal: { kind: 'entity'; id: string; talk: boolean } | { kind: 'exit'; dir: Dir } | null = null;
    if (p.screen === tscr.index) goal = { kind: 'entity', id: target, talk: !!st.talk };
    else {
      const hop = this.nextHop(p.screen, tscr.index, p);
      if (!hop) return [];
      goal = hop.door ? { kind: 'entity', id: hop.door, talk: false } : { kind: 'exit', dir: hop.dir! };
    }
    const blocked = this.blockedTiles(scr, p);
    if (goal.kind === 'exit') {
      const d = goal.dir;
      const [dx, dy] = DIRS[d];
      const ends = new Set<number>();
      for (let t = 0; t < MAP_W * MAP_H; t++) {
        const x = t % MAP_W;
        const y = Math.floor(t / MAP_W);
        if ((dx === 1 && x === MAP_W - 1) || (dx === -1 && x === 0) || (dy === 1 && y === MAP_H - 1) || (dy === -1 && y === 0)) if (!blocked.has(t)) ends.add(t);
      }
      if (ends.has(here)) return [d];
      return this.go(here, ends, blocked);
    }
    const e = scr.entities.find((x) => x.id === goal.id)!;
    const et = e.y * MAP_W + e.x;
    const spots = new Map<number, Dir>();
    for (const [d, [dx, dy]] of Object.entries(DIRS) as [Dir, readonly [number, number]][]) {
      const ax = e.x - dx;
      const ay = e.y - dy;
      if (ax < 0 || ax >= MAP_W || ay < 0 || ay >= MAP_H) continue;
      const at = ay * MAP_W + ax;
      if (!blocked.has(at)) spots.set(at, d);
      else if (goal.talk && scr.counter[at]) {
        const bx = e.x - 2 * dx;
        const by = e.y - 2 * dy;
        if (bx >= 0 && bx < MAP_W && by >= 0 && by < MAP_H && !blocked.has(by * MAP_W + bx)) spots.set(by * MAP_W + bx, d);
      }
    }
    void et;
    const face = spots.get(here);
    if (face !== undefined) {
      if (!goal.talk) {
        this.moveDir = face; // walk into it: keep pushing until something happens
        return [face];
      }
      if (p.facing !== FACE_OF[face]) return this.turned === p.frame - 1 ? [] : ((this.turned = p.frame), [face]);
      if (p.touchLock) return [];
      if (pulse(p)) this.pendingTalk = target === goal.id ? target : null;
      return press('A');
    }
    return this.go(here, new Set(spots.keys()), blocked);
  }

  /** Tiles Blum cannot stand on: solid metatiles and visible entities. */
  private blockedTiles(scr: CompiledScreen, p: LegendProbe): Set<number> {
    const b = new Set<number>();
    scr.solid.forEach((s, i) => (s ? b.add(i) : undefined));
    for (const e of scr.entities) if (this.visible(e, p)) b.add(e.y * MAP_W + e.x);
    return b;
  }
  visible(e: { ifFlag: string | null; unlessFlag: string | null }, p: LegendProbe): boolean {
    return (!e.ifFlag || hasFlag(p, this.flagId.get(e.ifFlag)!)) && (!e.unlessFlag || !hasFlag(p, this.flagId.get(e.unlessFlag)!));
  }

  /** One step of a breadth-first path from `from` to any tile of `ends`. */
  private go(from: number, ends: Set<number>, blocked: Set<number>): ButtonName[] {
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    let hit = -1;
    while (q.length) {
      const u = q.shift()!;
      if (ends.has(u)) {
        hit = u;
        break;
      }
      const ux = u % MAP_W;
      const uy = Math.floor(u / MAP_W);
      for (const [dx, dy] of Object.values(DIRS)) {
        const vx = ux + dx;
        const vy = uy + dy;
        if (vx < 0 || vx >= MAP_W || vy < 0 || vy >= MAP_H) continue;
        const v = vy * MAP_W + vx;
        if (prev.has(v) || blocked.has(v)) continue;
        prev.set(v, u);
        q.push(v);
      }
    }
    if (hit < 0) return [];
    let t = hit;
    while (prev.get(t) !== from && prev.get(t) !== -1) t = prev.get(t)!;
    if (t === from) return [];
    const dx = (t % MAP_W) - (from % MAP_W);
    const dy = Math.floor(t / MAP_W) - Math.floor(from / MAP_W);
    const d: Dir = dx === 1 ? 'RIGHT' : dx === -1 ? 'LEFT' : dy === 1 ? 'DOWN' : 'UP';
    this.moveDir = d;
    return [d];
  }

  /** First hop (an edge direction or a door entity) of the shortest screen path. */
  private nextHop(from: number, to: number, p: LegendProbe): { dir?: Dir; door?: string } | null {
    const prev = new Map<number, { s: number; dir?: Dir; door?: string }>();
    prev.set(from, { s: -1 });
    const q = [from];
    while (q.length) {
      const u = q.shift()!;
      if (u === to) break;
      const s = this.meta.screens[u]!;
      const outs: { s: number; dir?: Dir; door?: string }[] = [];
      for (const [d, t] of Object.entries(s.exits) as [string, number][]) outs.push({ s: t, dir: d.toUpperCase() as Dir });
      for (const dr of this.doors.get(u) ?? []) {
        const e = s.entities.find((x) => x.id === dr.entity)!;
        if (this.visible(e, p)) outs.push({ s: dr.to, door: dr.entity });
      }
      for (const o of outs) {
        if (prev.has(o.s)) continue;
        prev.set(o.s, { s: u, dir: o.dir, door: o.door });
        q.push(o.s);
      }
    }
    if (!prev.has(to)) return null;
    let t = to;
    while (prev.get(t)!.s !== from) t = prev.get(t)!.s;
    const h = prev.get(t)!;
    return { dir: h.dir, door: h.door };
  }
}

function pulse(p: LegendProbe): boolean {
  return (p.frame & 3) < 2;
}

/** Button mask in the Mesen replay format (A 1, B 2, SELECT 4, START 8, UP 16, DOWN 32, LEFT 64, RIGHT 128). */
export function buttonMask(b: ButtonName[]): number {
  const bit: Record<ButtonName, number> = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
  return b.reduce((m, x) => m | bit[x], 0);
}

// ---- one bot run in jsnes (engine tests, Mesen reference, soak) ----

export interface SliceRunOptions {
  maxFrames?: number;
  /** Called after every frame (screenshots, WRAM snapshots). */
  onFrame?: (p: LegendProbe, frame: number, buttons: ButtonName[]) => void;
  /** Stop when this returns true (after onFrame). */
  until?: (p: LegendProbe) => boolean;
}
export interface SliceRun {
  end: LegendProbe;
  frames: number;
  finished: boolean;
  /** probe frame at poll time -> button mask (the Mesen replay format, m4-replay.lua) */
  inputs: Record<number, number>;
  /** state changes: "frame:state/screen/dSub/bSub/mSub/turn/cursor" */
  events: string[];
  freeMin: number;
  vpeak: number;
  screens: Set<number>;
  battles: { battle: number; turns: number; won: boolean; hpLeft: number }[];
  stunnedSeen: boolean;
  enemyHealSeen: boolean;
}
export const traceKey = (q: LegendProbe) => [q.state, q.screen, q.dSub, q.bSub, q.mSub, q.turn, q.cursor].join('/');

/** Plays with the bot until the end card (or maxFrames). `h` is a RomHarness-like object. */
export function playSlice(h: { step(n: number, hold: ButtonName[]): void; s: { mem: ArrayLike<number> } }, bot: LegendBot, opts: SliceRunOptions = {}): SliceRun {
  const max = opts.maxFrames ?? 20000;
  let p = readLegendProbe(h.s.mem);
  const inputs: Record<number, number> = {};
  const events: string[] = [];
  let last = '';
  let freeMin = Infinity;
  const screens = new Set<number>();
  const battles: SliceRun['battles'] = [];
  let inBattle = false;
  let lastEhp = 0;
  let stunnedSeen = false;
  let enemyHealSeen = false;
  let f = 0;
  let finished = false;
  while (f < max) {
    const b = bot.step(p);
    const mask = buttonMask(b);
    if (mask && p.magic === 'BLMZ') inputs[p.frame] = mask;
    h.step(1, b);
    f++;
    p = readLegendProbe(h.s.mem);
    const k = traceKey(p);
    if (k !== last) {
      events.push(`${f}:${k}`);
      last = k;
    }
    if (f > 10) freeMin = Math.min(freeMin, legendFreeCycles(p.idle));
    if (p.state === LS.map) screens.add(p.screen);
    if (p.state === LS.battle) {
      if (!inBattle) {
        inBattle = true;
        lastEhp = p.ehp;
      }
      if (p.stunned) stunnedSeen = true;
      if (p.ehp > lastEhp) enemyHealSeen = true;
      lastEhp = p.ehp;
    } else if (inBattle) {
      inBattle = false;
      battles.push({ battle: p.battle, turns: p.turn, won: p.bResult === 1, hpLeft: p.hp });
    }
    opts.onFrame?.(p, f, b);
    if (p.state === LS.end) {
      finished = true;
      break;
    }
    if (opts.until?.(p)) break;
  }
  return { end: p, frames: f, finished, inputs, events, freeMin, vpeak: p.vpeak, screens, battles, stunnedSeen, enemyHealSeen };
}
