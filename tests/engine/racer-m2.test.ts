// BLUMR-M2 (docs/RACER-PLAN.md section 10), jsnes tier: the A1 art + music build, the 5 real-route stages
// played through without cheats (M2-T1/T2), fireworks on the ending, the A1 crash poses, the secret snow
// storm mode, and a byte-identical rebuild (M2-T4). The Mesen twin is scripts/racer-mesen.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { RomHarness } from '../../src/core/emu/harness';
import { buildRacer, type RacerBuild } from '../../src/core/racer/build-racer';
import { SNOW_GRASS } from '../../src/core/racer/racer-assets';
import { RS, racerBot, racerFreeCycles, readRacerProbe, type RacerBotKind, type RacerProbe } from '../../src/core/racer/racer-run';
import type { ButtonName } from '../../src/core/emu/nes-session';
import { JSNES, ROOT, writeShot } from './rom';

const FREE_MIN = 2000;

function build(name: string, defines: Record<string, number> = {}): RacerBuild {
  const b = buildRacer(path.join(ROOT, 'racer'), path.join(ROOT, 'engine'), defaultToolchain(ROOT), path.join(ROOT, '.tmp', 'engine-builds', `racer-m2-${name}`), { defines });
  if (!b.ok || !b.rom) throw new Error(b.log);
  return b;
}

function drive(h: RomHarness, kind: RacerBotKind, max: number, stop: (p: RacerProbe, prev: RacerProbe) => boolean, each?: (p: RacerProbe, prev: RacerProbe) => void, pad?: (p: RacerProbe) => ButtonName[] | null): RacerProbe {
  let p = readRacerProbe(h.s.mem);
  for (let f = 1; f <= max; f++) {
    h.step(1, pad?.(p) ?? racerBot(p, kind));
    const prev = p;
    p = readRacerProbe(h.s.mem);
    each?.(p, prev);
    if (stop(p, prev)) return p;
  }
  return p;
}

/** Presses `seq` on the title (one button per 12 frames, released in between), from a title already shown. */
function titleSequence(h: RomHarness, seq: ButtonName[]): RacerProbe {
  for (const b of seq) {
    h.step(1, [b]);
    h.step(11, []);
  }
  return readRacerProbe(h.s.mem);
}

describe('BLUMR-M2 racer (jsnes)', () => {
  let rel: RacerBuild;
  beforeAll(() => {
    rel = build('release');
  });

  it('M2-T4 the release ROM rebuilds byte-identical; it carries the A1 kit and sound', () => {
    const again = build('again');
    expect(Buffer.from(again.rom!).equals(Buffer.from(rel.rom!))).toBe(true);
    expect(rel.assets!.kitSource).toMatch(/sebring @ /);
    expect(rel.rom!.length).toBe(16 + 256 * 1024 + 128 * 1024);
    // the app's sample (npm run racer:handover) is this very ROM: never stale
    const shipped = readFileSync(path.join(ROOT, 'resources', 'samples', 'SEBRING', 'SEBRING.nes'));
    expect(shipped.equals(Buffer.from(rel.rom!)), 'resources/samples/SEBRING/SEBRING.nes is stale: npm run racer:handover').toBe(true);
  });

  it('M2-T1/T2 race bot, no cheats: title -> 5 real-route stages -> ending (fireworks) -> credits -> title', () => {
    const h = new RomHarness(JSNES, rel.rom!);
    const clears: RacerProbe[] = [];
    const starts = new Map<number, number>();
    const seconds: number[] = [];
    const shot = new Set<string>();
    const fx = rel.assets!.sprites.fx!;
    const fwTiles = new Set([...fx.burstSmall, ...fx.burstLarge.flatMap((t) => [t, t + 1, t + 2, t + 3])]);
    let fireworks = 0;
    let minFree = Infinity;
    const end = drive(
      h,
      'race',
      40000,
      (p) => p.titles >= 2,
      (p, prev) => {
        if (p.state === RS.drive && prev.state === RS.intro) starts.set(p.stage, p.frame);
        // the stage index moves on with the clear: the stage just finished is stage - 1
        if (p.clears !== prev.clears) (clears.push(p), seconds.push((p.frame - starts.get(p.stage - 1)!) / 60));
        if (p.nmiMode === 2 && p.state >= RS.drive && p.state <= RS.timeover) minFree = Math.min(minFree, racerFreeCycles(p.idle));
        if (p.state === RS.ending) fireworks = Math.max(fireworks, h.sprites().filter((s) => fwTiles.has(s.tile)).length);
        const name =
          p.state === RS.intro && p.frame % 64 === 40 ? `racer-m2-card${p.stage + 1}` :
          p.state === RS.drive && p.nmiMode === 2 && p.speed > 200 && p.dist > 900 ? `racer-m2-stage${p.stage + 1}` :
          p.state === RS.ending && p.frame % 128 === 30 ? 'racer-m2-ending' : p.state === RS.credits && p.frame % 64 === 40 ? 'racer-m2-credits' : '';
        if (name && !shot.has(name)) (shot.add(name), writeShot(h, name));
      },
    );
    expect(clears.map((c) => c.stage)).toEqual([1, 2, 3, 4, 5]);
    for (const c of clears) expect(c.time).toBeGreaterThan(20); // friendly: plenty of time left at each finish
    for (const s of seconds) expect(s).toBeGreaterThan(80), expect(s).toBeLessThan(130);
    const total = seconds.reduce((a, b) => a + b, 0) / 60;
    expect(total).toBeGreaterThan(7.5); // the bot drives flat out; a person takes about 10-12 minutes
    expect(total).toBeLessThan(10.5);
    expect(end.state).toBe(RS.title);
    expect(end.contUsed).toBeLessThanOrEqual(1);
    expect(end.lag).toBe(0);
    expect(Math.min(minFree, racerFreeCycles(end.idleMin))).toBeGreaterThanOrEqual(FREE_MIN);
    expect(fireworks).toBeGreaterThanOrEqual(4);
  });

  it('crash poses come from the A1 sheet: spin poses cycle (mirrored half the turn), the flip rolls', () => {
    const h = new RomHarness(JSNES, rel.rom!);
    const s = rel.assets!.sprites;
    const seen = new Set<number>();
    const mirrored = new Set<boolean>();
    drive(
      h,
      'crash',
      4000,
      (q) => q.crashes >= 3 && q.state === RS.drive,
      (q, prev) => {
        if (q.state !== RS.crash || prev.state !== RS.crash) return; // OAM shows the frame before the hit
        const car = h.sprites().filter((o) => (o.attr & 3) === 0 && o.y < 0xef);
        if (car.length) (seen.add(car.reduce((m, o) => Math.min(m, o.tile), 255)), mirrored.add((car[0]!.attr & 0x40) !== 0));
      },
    );
    const poses = new Set([...s.spinTile, s.flipRoll!, s.car[0]]);
    for (const t of seen) expect(poses.has(t), `tile ${t}`).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(mirrored.has(true)).toBe(true);
    writeShot(h, 'racer-m2-after-crash');
  });

  it('secret snow storm: 3 honks (B) then Select on the title; white roadside, flakes, slippery but drivable', () => {
    const h = new RomHarness(JSNES, rel.rom!);
    drive(h, 'race', 600, (p) => p.state === RS.title && p.frame > 30, undefined, () => []);
    // a wrong combo does nothing
    let p = titleSequence(h, ['B', 'B', 'SELECT']);
    expect(p.snow).toBe(0);
    expect(p.honks).toBe(0);
    p = titleSequence(h, ['B', 'B', 'B']);
    expect(p.honks).toBe(3);
    p = titleSequence(h, ['SELECT']);
    expect(p.snow).toBe(1);
    const flake = rel.assets!.sprites.fx!.smoke[1];
    expect(h.sprites().filter((o) => o.tile === flake).length).toBe(8); // flakes on the title say so
    writeShot(h, 'racer-m2-title-snow');
    const d = drive(h, 'race', 900, (q) => q.state === RS.drive && q.nmiMode === 2 && q.dist > 200);
    expect(d.state).toBe(RS.drive);
    expect(h.s.nametableByte(0x3f01)).toBe(SNOW_GRASS);
    expect(h.sprites().filter((o) => o.tile === flake).length).toBeGreaterThanOrEqual(4);
    writeShot(h, 'racer-m2-snow');
    const q = drive(h, 'race', 1800, () => false);
    expect(q.lag).toBe(0);
    expect(q.dist).toBeGreaterThan(800);
    expect(q.snow).toBe(1);
  });
});
