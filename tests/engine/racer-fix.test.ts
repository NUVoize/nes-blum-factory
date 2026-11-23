// BLUMR-FIX (runs\reports\BLUMR-W.md), jsnes tier. F1: on time over, one single Start press anywhere after
// the 0.5 s guard takes the continue (the bots tap Start from the first frame, so they never saw the gaps).
// F2: traffic x is projected from the live curve table with R6 = the live road bank, so a car never jumps
// sideways for one frame when the road bank flips (curve crossing -1 <-> 0).
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { RomHarness } from '../../src/core/emu/harness';
import { buildRacer, type RacerBuild } from '../../src/core/racer/build-racer';
import { RS, racerBot, readRacerProbe, type RacerProbe } from '../../src/core/racer/racer-run';
import { JSNES, ROOT } from './rom';

function build(name: string, defines: Record<string, number> = {}): RacerBuild {
  const b = buildRacer(path.join(ROOT, 'racer'), path.join(ROOT, 'engine'), defaultToolchain(ROOT), path.join(ROOT, '.tmp', 'engine-builds', `racer-fix-${name}`), { defines });
  if (!b.ok || !b.rom) throw new Error(b.log);
  return b;
}

/** Title and card with the bot's Start taps, then hands off the pad while driving: returns on the first time-over frame. */
function toTimeover(rom: Uint8Array): RomHarness {
  const h = new RomHarness(JSNES, rom);
  let p = readRacerProbe(h.s.mem);
  for (let f = 0; f < 4000; f++) {
    h.step(1, racerBot(p, 'idle'));
    p = readRacerProbe(h.s.mem);
    if (p.state === RS.timeover) return h;
  }
  throw new Error('no time over');
}

/** Waits `delay` frames on the time-over screen, presses Start for one frame, then lets go. */
function pressOnceAfter(rom: Uint8Array, delay: number): RacerProbe {
  const h = toTimeover(rom);
  h.step(delay, []);
  h.step(1, ['START']);
  h.step(3, []);
  return readRacerProbe(h.s.mem);
}

describe('BLUMR-FIX racer (jsnes)', () => {
  let time8: RacerBuild;
  let rel: RacerBuild;
  beforeAll(() => {
    time8 = build('time8', { TIME_OVERRIDE: 8 });
    rel = build('release');
  });

  it('F1 one Start press at +2 s and at +7 s takes the continue: same stage from the start, 2 continues left', () => {
    for (const delay of [120, 420]) {
      const p = pressOnceAfter(time8.rom!, delay);
      expect(p.state, `+${delay} f`).toBe(RS.drive);
      expect([p.stage, p.dist, p.continues, p.contUsed], `+${delay} f`).toEqual([0, 0, 2, 1]);
    }
  });

  it('F1 every single press from 0.5 s to the end of the 10 s window continues; earlier presses are ignored', () => {
    for (let delay = 40; delay <= 590; delay += 30) expect(pressOnceAfter(time8.rom!, delay).state, `+${delay} f`).toBe(RS.drive);
    expect(pressOnceAfter(time8.rom!, 10).state).toBe(RS.timeover); // the 0.5 s guard against a held Start
  });

  it('F2 no traffic car jumps sideways for one frame when the road bank flips (stage 1, race bot)', () => {
    const at = (name: string) => {
      const a = rel.labels.get(name);
      if (a === undefined) throw new Error(`label ${name}`);
      return a;
    };
    const [kBank, oKind, oVis, oX, oXh] = ['k_bank', 'o_kind', 'o_vis', 'o_x', 'o_xh'].map(at) as [number, number, number, number, number];
    const h = new RomHarness(JSNES, rel.rom!);
    const m = h.s.mem;
    const hist: Array<{ bank: number; racing: boolean; xs: Array<number | null> }> = [];
    let p = readRacerProbe(m);
    for (let f = 0; f < 9000 && p.clears < 1; f++) {
      h.step(1, racerBot(p, 'race'));
      p = readRacerProbe(m);
      const xs: Array<number | null> = [];
      for (let i = 0; i < 8; i++) xs.push(m[oKind + i] && m[oVis + i] ? ((((m[oXh + i]! << 8) | m[oX + i]!) << 16) >> 16) : null);
      hist.push({ bank: m[kBank]!, racing: p.state >= RS.drive && p.state <= RS.timeover, xs });
    }
    expect(p.clears).toBe(1);
    let flips = 0;
    const spikes: string[] = [];
    for (let f = 1; f < hist.length - 1; f++) {
      const [a, b, c] = [hist[f - 1]!, hist[f]!, hist[f + 1]!];
      if (a.bank !== b.bank && b.racing) flips++;
      for (let i = 0; i < 8; i++) {
        const [x0, x1, x2] = [a.xs[i], b.xs[i], c.xs[i]];
        if (x0 == null || x1 == null || x2 == null) continue;
        const d1 = x1 - x0;
        const d2 = x2 - x1;
        if (Math.abs(d1) > 16 && Math.abs(d2) > 16 && Math.sign(d1) !== Math.sign(d2)) spikes.push(`frame ${f} slot ${i}: ${x0} ${x1} ${x2}`);
      }
    }
    expect(flips).toBeGreaterThan(0);
    expect(spikes).toEqual([]);
    expect(p.lag).toBe(0);
  });
});
