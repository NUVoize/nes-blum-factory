// BLUMR-M1 racer engine floor (docs/RACER-PLAN.md section 7, M1-T2..T5, T7), jsnes tier. The bots
// (src/core/racer/racer-run.ts) read only the probe; the Mesen twin is scripts/racer-mesen.mjs (M1-T6).
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { RomHarness, type Prefill } from '../../src/core/emu/harness';
import { parseLd65Map } from '../../src/core/nes/ld65-map';
import { buildRacer, type RacerBuild } from '../../src/core/racer/build-racer';
import { textTiles } from '../../src/core/racer/racer-assets';
import { RACER_PROBE, RS, racerBot, racerFreeCycles, readRacerProbe, type RacerBotKind, type RacerProbe } from '../../src/core/racer/racer-run';
import { JSNES, ROOT, writeShot } from './rom';

const FREE_MIN = 2000;

function build(name: string, defines: Record<string, number> = {}): RacerBuild {
  const b = buildRacer(path.join(ROOT, 'racer'), path.join(ROOT, 'engine'), defaultToolchain(ROOT), path.join(ROOT, '.tmp', 'engine-builds', `racer-${name}`), { defines });
  if (!b.ok || !b.rom) throw new Error(b.log);
  return b;
}

/** Drives with a bot until `stop` holds (checked after each frame) or `max` frames. */
function drive(h: RomHarness, kind: RacerBotKind, max: number, stop: (p: RacerProbe, prev: RacerProbe) => boolean, each?: (p: RacerProbe, prev: RacerProbe, f: number) => void): RacerProbe {
  let p = readRacerProbe(h.s.mem);
  for (let f = 1; f <= max; f++) {
    h.step(1, racerBot(p, kind));
    const prev = p;
    p = readRacerProbe(h.s.mem);
    each?.(p, prev, f);
    if (stop(p, prev)) return p;
  }
  return p;
}

describe('BLUMR-M1 racer (jsnes)', () => {
  let rel: RacerBuild;
  beforeAll(() => {
    rel = build('release');
  });

  it('M1-T2 BLUM cartridge header; fixed banks and every bank inside 8 KiB', () => {
    const rom = rel.rom!;
    expect(Array.from(rom.subarray(0, 11))).toEqual([0x4e, 0x45, 0x53, 0x1a, 0x10, 0x10, 0x40, 0x08, 0x00, 0x00, 0x07]);
    expect(rom.length).toBe(16 + 256 * 1024 + 128 * 1024);
    const segs = parseLd65Map(rel.map).segments;
    const size = (names: string[]) => segs.filter((s) => names.includes(s.name)).reduce((a, s) => a + s.size, 0);
    const fixedC = size(['ROWTABS', 'KERNEL', 'CODE', 'RODATA']);
    const fixedE = size(['STARTUP', 'FSCODE', 'INVTAB']) + 6;
    expect(fixedC).toBeLessThanOrEqual(8192);
    expect(fixedE).toBeLessThanOrEqual(8192);
    expect(fixedC + fixedE + size(['SOUND'])).toBeLessThanOrEqual(24 * 1024);
    for (const s of segs) if (s.name !== 'CHARS') expect(s.size, s.name).toBeLessThanOrEqual(8192);
  });

  it('M1-T3 + M1-T5 race bot: title -> 5 stages with time left -> ending -> credits -> title, 0 lag, free CPU >= 2000', () => {
    const h = new RomHarness(JSNES, rel.rom!);
    const clears: RacerProbe[] = [];
    const states = new Set<number>();
    const shot = new Set<string>();
    let minFree = Infinity;
    const end = drive(
      h,
      'race',
      40000, // BLUMR-M2 real-route stages: about 32 000 frames for the whole game
      (p) => p.titles >= 2,
      (p, prev) => {
        states.add(p.state);
        if (p.clears !== prev.clears) clears.push(p);
        if (p.nmiMode === 2 && p.state >= RS.drive && p.state <= RS.timeover) minFree = Math.min(minFree, racerFreeCycles(p.idle));
        const name = p.state === RS.drive && p.nmiMode === 2 && p.speed === 220 && p.dist > 300 ? `racer-m1-stage${p.stage + 1}` : p.state === RS.ending ? 'racer-m1-ending' : p.state === RS.credits ? 'racer-m1-credits' : '';
        if (name && !shot.has(name) && (p.state === RS.drive || p.frame % 64 === 40)) {
          shot.add(name);
          writeShot(h, name);
        }
      },
    );
    expect(clears.map((c) => c.stage)).toEqual([1, 2, 3, 4, 5]);
    for (const c of clears) expect(c.time).toBeGreaterThan(0); // time left at each finish line
    expect([RS.title, RS.intro, RS.drive, RS.checkpoint, RS.ending, RS.credits].every((s) => states.has(s))).toBe(true);
    expect(end.state).toBe(RS.title);
    expect(end.lag).toBe(0);
    expect(Math.min(minFree, racerFreeCycles(end.idleMin))).toBeGreaterThanOrEqual(FREE_MIN);
    // the ending text is in the ROM (screens bank): BLUMR-M2 draws « BONNE FÊTE BLUM ! » in big letters (the
    // A1 ending, compared byte for byte in tests/racer-m2.test.ts) over the font line below
    expect(Buffer.from(rel.rom!).includes(Buffer.from(textTiles('HAPPY BIRTHDAY BLUM!')))).toBe(true);
  });

  it('M1-T4 crash bot: spin or flip (state 4) then back to driving, with the time penalty', () => {
    const h = new RomHarness(JSNES, rel.rom!);
    let before: RacerProbe | null = null;
    let crashed: RacerProbe | null = null;
    const p = drive(
      h,
      'crash',
      3000,
      (q, prev) => crashed !== null && prev.state === RS.crash && q.state === RS.drive,
      (q, prev) => {
        if (q.state === RS.crash && prev.state !== RS.crash) (before = prev), (crashed = q);
      },
    );
    expect(crashed).not.toBeNull();
    expect(p.state).toBe(RS.drive);
    expect(p.crashes).toBe(1);
    expect(p.penalty).toBe(2);
    expect([1, 2]).toContain(crashed!.crashKind);
    // the penalty is taken at the hit, on top of the running clock
    expect(before!.time - crashed!.time).toBeGreaterThanOrEqual(2);
    expect(p.speed).toBe(0); // standing start after the recovery
    expect(p.offroad).toBe(0);
    writeShot(h, 'racer-m1-after-crash');
  });

  it('M1-T4 idle bot: time over -> continue -> same stage from the start; 3 continues used -> game over -> title', () => {
    const b = build('time8', { TIME_OVERRIDE: 8 });
    const h = new RomHarness(JSNES, b.rom!);
    const restarts: RacerProbe[] = [];
    let timeovers = 0;
    let gameover = false;
    let pending = false;
    const end = drive(
      h,
      'idle',
      6000,
      (p) => p.titles >= 2,
      (p, prev) => {
        if (p.state === RS.timeover && prev.state !== RS.timeover) timeovers++;
        if (p.state === RS.gameover) gameover = true;
        if (prev.state === RS.timeover && p.state === RS.intro) throw new Error('continue must not show the card again');
        if (pending && p.time > 0) (restarts.push(p), (pending = false)); // the reload spans a couple of frames
        if (prev.state === RS.timeover && p.state === RS.drive) pending = true;
      },
    );
    expect(timeovers).toBe(4);
    expect(restarts.map((r) => [r.stage, r.dist, r.continues, r.time])).toEqual([
      [0, 0, 2, 8],
      [0, 0, 1, 8],
      [0, 0, 0, 8],
    ]);
    expect(gameover).toBe(true);
    expect(end.state).toBe(RS.title);
    expect(end.contUsed).toBe(3);
    expect(end.lag).toBe(0);
  });

  it('pause (Start) freezes the race; Select switches the radio', () => {
    const h = new RomHarness(JSNES, rel.rom!);
    let p = drive(h, 'race', 400, (q) => q.state === RS.drive && q.speed > 100);
    h.step(1, ['START']);
    h.step(1, []);
    p = readRacerProbe(h.s.mem);
    expect(p.paused).toBe(1);
    const frozen = { dist: p.dist, time: p.time, timeFrames: p.timeFrames };
    h.step(90, []);
    p = readRacerProbe(h.s.mem);
    expect({ dist: p.dist, time: p.time, timeFrames: p.timeFrames }).toEqual(frozen);
    writeShot(h, 'racer-m1-pause');
    h.step(1, ['START']);
    h.step(1, ['A']);
    expect(readRacerProbe(h.s.mem).paused).toBe(0);
    h.step(1, ['A', 'SELECT']);
    h.step(1, ['A']);
    p = readRacerProbe(h.s.mem);
    expect(p.radio).toBe(1);
    writeShot(h, 'racer-m1-radio');
    expect(p.lag).toBe(0);
  });

  it('M1-T5 cheat build (test only): the checkpoint jump reaches the ending through the 5 stage cards', () => {
    const b = build('cheats', { TEST_CHEATS: 1 });
    const h = new RomHarness(JSNES, b.rom!);
    const cards: number[] = [];
    const end = drive(
      h,
      'race',
      8000,
      (p) => p.state === RS.credits,
      (p, prev) => {
        if (p.state === RS.intro && prev.state !== RS.intro) cards.push(p.stage);
        if (p.state === RS.drive && p.frame % 30 === 0) h.s.mem[RACER_PROBE.base + RACER_PROBE.cheats] = 2;
      },
    );
    expect(cards).toEqual([0, 1, 2, 3, 4]);
    expect(end.state).toBe(RS.credits);
    expect(end.clears).toBe(5);
    // the release ROM ignores the cheat byte
    const r = new RomHarness(JSNES, rel.rom!);
    drive(r, 'race', 300, (p) => p.state === RS.drive && p.dist > 50);
    r.s.mem[RACER_PROBE.base + RACER_PROBE.cheats] = 3;
    const q = drive(r, 'race', 30, () => false);
    expect(q.checkpoint).toBe(0);
  });

  it('M1-T7 dirty boot (0xFF and 3 seeds): title, then 600 frames of driving with 0 lag', () => {
    const fills: Prefill[] = [0xff, { seed: 1 }, { seed: 2 }, { seed: 3 }];
    for (const prefill of fills) {
      const h = new RomHarness(JSNES, rel.rom!, { prefill });
      const t = drive(h, 'race', 600, (p) => p.state === RS.title);
      expect(t.state, JSON.stringify(prefill)).toBe(RS.title);
      const d = drive(h, 'race', 600, (p) => p.state === RS.drive);
      expect(d.state).toBe(RS.drive);
      const p = drive(h, 'race', 600, () => false);
      expect(p.lag, JSON.stringify(prefill)).toBe(0);
      expect([RS.drive, RS.checkpoint]).toContain(p.state);
      expect(p.dist).toBeGreaterThan(200);
    }
  });
});
