// M4a engine tier: movement features, enemy patterns, boss DSL, ROM text screens, live tuning, lag.
// Real cc65 builds of the feature levels (src/core/engine-data/feature-levels.ts), run headless in jsnes.
// Each scripted run also writes its input trace to .tmp/m4-traces/ for the Mesen tier (M4-T11).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHEAT, EVENT, GAME_STATE, PROBE, PROBE_FLAG, TEXT_SCREEN, tuningAddress } from '../../src/core/engine-data/contract';
import { FEATURE_LEVELS, type FeatureLevel } from '../../src/core/engine-data/feature-levels';
import { buildFontBank } from '../../src/core/engine-data/builtin-chr';
import { TEXT_HEADING_ROW } from '../../src/core/engine-data/text-screens';
import type { RomHarness, Probe } from '../../src/core/emu/harness';
import type { ButtonName } from '../../src/core/emu/nes-session';
import type { BuildResult } from '../../src/core/build/engine-build';
import type { Json } from '../../src/core/util/json-pointer';
import { buildFixture, demoProjectDocs, harness, ROOT, writeShot } from './rom';

const built = (name: FeatureLevel | Record<string, Json>, emit = {}): BuildResult => buildFixture(typeof name === 'string' ? FEATURE_LEVELS[name]() : name, emit);

/** RAM reader for engine globals (ld65 labels). */
function ram(h: RomHarness, b: BuildResult, label: string) {
  const base = b.labels.get(label);
  if (base === undefined) throw new Error(`label ${label} missing`);
  return {
    u8: (i = 0) => h.s.mem[base + i]!,
    i16: (i = 0) => {
      const v = h.s.mem[base + 2 * i]! | (h.s.mem[base + 2 * i + 1]! << 8);
      return v >= 0x8000 ? v - 0x10000 : v;
    },
  };
}

/**
 * Scripted session that records the input of every frame against the probe frame counter, so the
 * Mesen tier can replay it frame for frame (M4-T11).
 */
class Script {
  readonly inputs: Array<{ f: number; b: ButtonName[] }> = [];
  readonly trace: Probe[] = [];
  constructor(
    readonly h: RomHarness,
    readonly b: BuildResult,
  ) {}
  step(n: number, hold: ButtonName[] = []): Probe {
    for (let i = 0; i < n; i++) {
      // keyed by the probe frame counter: the game polls the pad in the loop that follows it
      this.inputs.push({ f: this.h.probe().frame, b: hold });
      this.h.step(1, hold);
      this.trace.push(this.h.probe());
    }
    return this.h.probe();
  }
  until(pred: (p: Probe) => boolean, max: number, hold: ButtonName[] = []): number {
    for (let i = 1; i <= max; i++) {
      if (pred(this.step(1, hold))) return i;
    }
    return -1;
  }
  /** Title -> Start -> (story text: Start) -> play. */
  start(): void {
    this.step(60);
    this.step(2, ['START']);
    this.step(2);
    if (this.until((p) => p.state === GAME_STATE.play || p.state === GAME_STATE.story, 120) < 0) throw new Error('never left the title');
    if (this.h.probe().state === GAME_STATE.story) {
      this.step(40);
      this.step(2, ['START']);
      if (this.until((p) => p.state === GAME_STATE.play, 60) < 0) throw new Error('story screen never closed');
    }
    this.step(2);
  }
  maxLag(): number {
    return Math.max(0, ...this.trace.map((p) => p.lagFrames));
  }
  /** Saves the input trace and the final probe for the Mesen tier. */
  save(name: string, extra: Record<string, unknown> = {}): void {
    const dir = path.join(ROOT, '.tmp', 'm4-traces');
    mkdirSync(dir, { recursive: true });
    const rom = this.b.rom!;
    const end = this.h.probe();
    writeFileSync(
      path.join(dir, `${name}.json`),
      JSON.stringify({ name, romSha1: createHash('sha1').update(rom).digest('hex'), frames: this.h.frames, endFrame: end.frame, maxLag: this.maxLag(), inputs: compress(this.inputs), end, ...extra }),
    );
  }
}

/**
 * Input per probe frame, run-length: [{ f, n, b }]. When one game loop spans several emulator frames
 * (stage load), the probe frame stays the same; the next loop polls the pad in the first of them, so
 * the first input recorded for a probe frame is the one the game read.
 */
function compress(inputs: Array<{ f: number; b: ButtonName[] }>): Array<{ f: number; n: number; b: ButtonName[] }> {
  const byFrame = new Map<number, ButtonName[]>();
  for (const x of inputs) if (!byFrame.has(x.f)) byFrame.set(x.f, x.b);
  const out: Array<{ f: number; n: number; b: ButtonName[] }> = [];
  for (const [f, b] of [...byFrame].sort((a, c) => a[0] - c[0])) {
    const last = out.at(-1);
    if (last && last.f + last.n === f && last.b.join() === b.join()) last.n++;
    else out.push({ f, n: 1, b });
  }
  return out;
}

const play = (name: FeatureLevel) => {
  const b = built(name);
  const s = new Script(harness(b.rom!), b);
  s.start();
  return s;
};

const grounded = (p: Probe) => (p.flags & PROBE_FLAG.grounded) !== 0;

describe('M4a movement features (M4-T3, floor)', () => {
  it('M4-T3 double jump: a second press in the air goes higher, a third does nothing', () => {
    const apex = (presses: number[][]) => {
      const s = play('doubleJump');
      const y0 = s.h.probe().py;
      let min = y0;
      let dj = false;
      for (const [hold, rest] of presses) {
        for (let i = 0; i < hold!; i++) {
          const p = s.step(1, ['A']);
          min = Math.min(min, p.py);
          dj ||= (p.flags & PROBE_FLAG.doubleJumped) !== 0;
        }
        for (let i = 0; i < rest!; i++) min = Math.min(min, s.step(1).py);
      }
      const back = s.until(grounded, 200);
      expect(s.maxLag()).toBe(0);
      return { s, apex: y0 - min, dj, back };
    };
    const single = apex([[40, 1]]);
    const double = apex([[18, 1], [30, 1]]);
    const triple = apex([[18, 1], [30, 1], [20, 1]]);
    expect(single.dj).toBe(false);
    expect(double.dj).toBe(true);
    expect(double.apex).toBeGreaterThan(single.apex + 24);
    expect(triple.apex).toBe(double.apex);
    expect(double.back).toBeGreaterThan(0);
    double.s.save('doubleJump', { apex: double.apex });
  });

  it('M4-T3 ladder: Up on a ladder climbs (ladder flag, at least 4 tiles up)', () => {
    const s = play('ladder');
    const y0 = s.h.probe().py;
    let min = y0;
    let flagged = false;
    for (let i = 0; i < 90; i++) {
      const p = s.step(1, ['UP']);
      min = Math.min(min, p.py);
      flagged ||= (p.flags & PROBE_FLAG.ladder) !== 0;
    }
    expect(flagged).toBe(true);
    expect(y0 - min).toBeGreaterThanOrEqual(64);
    expect(s.maxLag()).toBe(0);
    writeShot(s.h, 'M4-T3-ladder');
    s.save('ladder', { climbed: y0 - min });
  });

  it('M4-T3 projectile: two shots kill a 2 hp enemy (kill event, 0 enemies left)', () => {
    const s = play('projectile');
    expect(s.h.probe().enemies).toBe(1);
    s.step(2, ['B']);
    let shots = 0;
    for (let i = 0; i < 6; i++) shots = Math.max(shots, s.step(1).shots);
    expect(shots).toBe(1);
    s.step(30);
    s.step(2, ['B']);
    const n = s.until((p) => p.event === EVENT.kill, 90);
    expect(n).toBeGreaterThan(0);
    const p = s.step(2);
    expect(p.enemies).toBe(0);
    expect(s.h.s.mem[PROBE.base + PROBE.kills]).toBe(1);
    expect(s.maxLag()).toBe(0);
    s.save('projectile', { kills: 1 });
  });

  it('M4-T3 knockback + iframes: contact costs 1 hp, pushes away, then no damage while invincible', () => {
    const s = play('knockback');
    const hp0 = s.h.probe().hp;
    const x0 = s.h.probe().px;
    const n = s.until((p) => p.event === EVENT.hurt, 200);
    expect(n).toBeGreaterThan(0);
    const hit = s.h.probe();
    expect(hit.hp).toBe(hp0 - 1);
    expect(hit.flags & PROBE_FLAG.invincible).toBeTruthy();
    s.step(8);
    expect(s.h.probe().px).toBeLessThan(x0); // pushed left, away from the walker coming from the right
    // the walker walks through the player during the invincibility frames: no second hit
    for (let i = 0; i < 60; i++) expect(s.step(1).hp).toBe(hp0 - 1);
    expect(s.maxLag()).toBe(0);
    s.save('knockback', { hp: hp0 - 1 });
  });

  it('M4-T3 coyote: a jump pressed 3 frames after the ledge still jumps; 12 frames after does not', () => {
    const run = (late: number) => {
      const s = play('coyote');
      expect(s.until((p) => !grounded(p), 200, ['RIGHT'])).toBeGreaterThan(0);
      s.step(late - 1, ['RIGHT']);
      const y = s.h.probe().py;
      s.step(1, ['RIGHT', 'A']);
      const after = [s.step(1, ['RIGHT', 'A']), s.step(1, ['RIGHT', 'A']), s.step(1, ['RIGHT', 'A'])];
      return { s, rose: after[2]!.py < y };
    };
    const ok = run(3);
    expect(ok.rose).toBe(true);
    const late = run(12);
    expect(late.rose).toBe(false);
    expect(ok.s.maxLag()).toBe(0);
    ok.s.save('coyote');
  });
});

describe('M4a enemy patterns (M4-T4, floor)', () => {
  it('M4-T4 walker turns at a wall', () => {
    const s = play('walker');
    const ex = ram(s.h, s.b, '_e_x');
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) {
      s.step(1);
      xs.push(ex.i16(0));
    }
    const max = Math.max(...xs);
    const turnAt = xs.indexOf(max);
    expect(max).toBeGreaterThan(xs[0]!);
    expect(xs.at(-1)!).toBeLessThan(max - 16); // walked back
    expect(max).toBeLessThanOrEqual(15 * 16 - 16); // stopped at the wall at column 15
    expect(turnAt).toBeGreaterThan(0);
    expect(s.maxLag()).toBe(0);
    s.save('walker', { maxX: max });
  });

  it('M4-T4 hopper hops: rises at least 16 px and lands, at least twice in 150 frames', () => {
    const s = play('hopper');
    const ey = ram(s.h, s.b, '_e_y');
    const y0 = ey.i16(0);
    let hops = 0;
    let up = false;
    let min = y0;
    for (let i = 0; i < 150; i++) {
      s.step(1);
      const y = ey.i16(0);
      min = Math.min(min, y);
      if (!up && y <= y0 - 16) (up = true), hops++;
      if (up && y === y0) up = false;
    }
    expect(hops).toBeGreaterThanOrEqual(2);
    expect(y0 - min).toBeGreaterThanOrEqual(16);
    expect(s.maxLag()).toBe(0);
    s.save('hopper', { hops });
  });

  it('M4-T4 flyer oscillates around its start height (wave about ±24 px)', () => {
    const s = play('flyer');
    const ey = ram(s.h, s.b, '_e_y');
    const base = ram(s.h, s.b, '_e_by').i16(0);
    const ys: number[] = [];
    for (let i = 0; i < 140; i++) {
      s.step(1);
      ys.push(ey.i16(0));
    }
    expect(Math.min(...ys)).toBeLessThanOrEqual(base - 20);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(base + 20);
    // back near the start after a full wave (64 frames)
    expect(Math.abs(ys[63]! - ys[127]!)).toBeLessThanOrEqual(2);
    expect(s.maxLag()).toBe(0);
    s.save('flyer');
  });

  it('M4-T4 shooter fires at the player within its period, the shot flies towards the player', () => {
    const s = play('shooter');
    const n = s.until((p) => p.enemyShots > 0, 80);
    expect(n).toBeGreaterThan(0);
    const esx = ram(s.h, s.b, '_es_x');
    const x1 = esx.i16(0);
    s.step(10);
    expect(esx.i16(0)).toBeLessThan(x1); // player is to the left
    // standing still, the shot reaches the player
    expect(s.until((p) => p.event === EVENT.hurt, 120)).toBeGreaterThan(0);
    expect(s.maxLag()).toBe(0);
    s.save('shooter');
  });
});

describe('M4a boss DSL in the ROM (M4-T5)', () => {
  it('M4-T5 a 2-phase boss switches phase at its hp threshold and is defeated by a scripted input', () => {
    const s = play('boss');
    // walk right until the boss shows up (state 6, camera locked)
    expect(s.until((p) => p.state === GAME_STATE.boss, 300, ['RIGHT'])).toBeGreaterThan(0);
    const entered = s.h.probe();
    expect(entered.bossHp).toBe(4);
    s.step(10, ['RIGHT']);
    const phases: number[] = [];
    let clearedAt = -1;
    for (let i = 0; i < 900 && clearedAt < 0; i++) {
      const p = s.step(1, i % 18 < 2 ? ['B'] : []);
      phases.push(s.h.s.mem[PROBE.base + PROBE.bossPhase]!);
      if (p.bossHp <= 2 && p.bossHp > 0) expect(s.h.s.mem[PROBE.base + PROBE.bossPhase]).toBe(1);
      if (p.state === GAME_STATE.clear) clearedAt = i;
      if (p.state === GAME_STATE.dying) throw new Error('player died in the boss fight');
      if (i === 100) writeShot(s.h, 'M4-T5-boss');
    }
    expect(clearedAt).toBeGreaterThan(0);
    expect(phases).toContain(1);
    const end = s.h.probe();
    expect(end.event).toBe(EVENT.bossDefeated);
    expect(end.bossHp).toBe(0);
    expect(s.maxLag()).toBe(0);
    s.save('boss', { clearedAt });
  });
});

describe('M4a story text screens (M4-T2)', () => {
  const docs = () => {
    const d = demoProjectDocs();
    const story = d['story.json'] as { worlds: Array<Record<string, unknown>>; ending: { fr: string } };
    story.worlds[0]!.intro = { fr: 'À toi de jouer : la fête est prête, Blum ! Ça va être génial.' };
    story.ending = { fr: 'Bonne fête Blum ! Le jardin a retrouvé ses couleurs.' };
    return d;
  };

  it('M4-T2 the intro text screen shows (probe state 2) with accented tiles, then play; ending and credits after the last stage', () => {
    const b = buildFixture(docs(), { testCheats: true });
    const h = harness(b.rom!);
    h.step(60);
    h.step(2, ['START']);
    expect(h.runUntil((p) => p.state === GAME_STATE.story, 60)).toBeGreaterThan(0);
    h.step(5);
    expect(h.s.mem[PROBE.base + PROBE.textScreen]).toBe(TEXT_SCREEN.intro);
    const font = buildFontBank();
    const screen = h.nametableTiles(0, 0, 32, 30);
    for (const ch of ['À', 'Ê', 'Ç']) expect(screen, `tile for ${ch}`).toContain(font.glyphs.get(ch));
    // the heading names the world
    const row4 = h.nametableTiles(0, TEXT_HEADING_ROW, 32).map((t) => [...font.glyphs].find(([, v]) => v === t)?.[0] ?? '?').join('');
    expect(row4).toContain('MONDE 1');
    writeShot(h, 'M4-T2-intro');
    h.step(40);
    h.step(2, ['START']);
    expect(h.runUntil((p) => p.state === GAME_STATE.play, 60)).toBeGreaterThan(0);
    // test cheat: skip the stage -> clear -> ending (state 7) -> credits -> title
    h.s.mem[PROBE.base + PROBE.cheats] = CHEAT.skipStage;
    expect(h.runUntil((p) => p.state === GAME_STATE.clear, 10)).toBeGreaterThan(0);
    expect(h.runUntil((p) => p.state === GAME_STATE.ending, 200)).toBeGreaterThan(0);
    h.step(5);
    expect(h.s.mem[PROBE.base + PROBE.textScreen]).toBe(TEXT_SCREEN.ending);
    writeShot(h, 'M4-T2-ending');
    h.step(40);
    h.step(2, ['START']);
    expect(h.runUntil(() => h.s.mem[PROBE.base + PROBE.textScreen] === TEXT_SCREEN.credits, 30)).toBeGreaterThan(0);
    h.step(5);
    const credits = h
      .nametableTiles(0, 0, 32, 30)
      .map((t) => [...font.glyphs].find(([, v]) => v === t)?.[0] ?? '?')
      .join('');
    for (const notice of ['NESDOUG.LIB (MIT)', 'NESLIB (DOMAINE PUBLIC)', 'FAMISTUDIO (MIT)']) expect(credits).toContain(notice);
    writeShot(h, 'M4-T2-credits');
    h.step(40);
    h.step(2, ['START']);
    expect(h.runUntil((p) => p.state === GAME_STATE.title, 30)).toBeGreaterThan(0);
  });

  it('NBF_TEST_CHEATS is off in a normal build: poking the cheat byte does nothing', () => {
    const b = buildFixture(docs());
    const h = harness(b.rom!);
    h.step(60);
    h.step(2, ['START']);
    h.runUntil((p) => p.state === GAME_STATE.story, 60);
    h.step(40);
    h.step(2, ['START']);
    expect(h.runUntil((p) => p.state === GAME_STATE.play, 60)).toBeGreaterThan(0);
    h.s.mem[PROBE.base + PROBE.cheats] = CHEAT.skipStage | CHEAT.invincible;
    h.step(30);
    expect(h.probe().state).toBe(GAME_STATE.play);
  });
});

describe('M4a live tuning (M4-T6)', () => {
  it('M4-T6 poking jumpVelocity in the $7E00 block changes the jump in the running ROM, no rebuild', () => {
    const b = buildFixture(demoProjectDocs());
    const h = harness(b.rom!);
    const s = new Script(h, b);
    s.start();
    const apex = () => {
      const y0 = h.probe().py;
      let min = y0;
      for (let i = 0; i < 50; i++) min = Math.min(min, s.step(1, ['A']).py);
      s.until(grounded, 200);
      s.step(5);
      return y0 - min;
    };
    const before = apex();
    const addr = tuningAddress('jumpVelocity');
    const v = h.s.mem[addr]! | (h.s.mem[addr + 1]! << 8);
    const boosted = Math.round(v * 1.25);
    h.s.mem[addr] = boosted & 0xff;
    h.s.mem[addr + 1] = boosted >> 8;
    const after = apex();
    expect(after).toBeGreaterThan(before * 1.3);
  });
});

describe('M4a lag (M4-T10)', () => {
  it('M4-T10 stress: 6 enemies (2 shooters) + player shots stay under 5 % lag frames', () => {
    const s = play('stress');
    const lag0 = s.h.probe().lagFrames;
    const frames = 600;
    let maxEnemies = 0;
    let maxShots = 0;
    for (let i = 0; i < frames; i++) {
      const p = s.step(1, i % 20 < 2 ? ['B'] : i % 60 < 30 ? ['RIGHT'] : ['LEFT']);
      maxEnemies = Math.max(maxEnemies, p.enemies);
      maxShots = Math.max(maxShots, p.enemyShots + p.shots);
      if (p.state !== GAME_STATE.play) break;
    }
    const lag = (s.h.probe().lagFrames - lag0 + 256) % 256;
    expect(maxEnemies).toBeGreaterThanOrEqual(6);
    expect(maxShots).toBeGreaterThanOrEqual(3);
    expect(lag / frames).toBeLessThan(0.05);
    writeShot(s.h, 'M4-T10-stress');
    s.save('stress', { lag });
  });
});
