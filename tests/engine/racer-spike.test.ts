// BLUMR-PLAN engine spike (docs/RACER-PLAN.md section 4): the pseudo-3D road ROM builds with the
// factory toolchain and, driven by the bot in jsnes for 60 s, shows curves both ways, a hill, a crest,
// speed stripes and a steering car, with 0 lag frames and a measured CPU budget left for the game.
// The accurate-tier twin (hblank timing of every kernel write) is scripts/racer-spike.mjs on Mesen.
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { RomHarness } from '../../src/core/emu/harness';
import { NES_RGB } from '../../src/core/nes/palette';
import { buildSpike } from '../../src/core/racer/build-spike';
import { FLAT_HORIZON, HILL_MAX } from '../../src/core/racer/road-data';
import { SPIKE_SHOTS, freeCycles, readSpikeProbe, shotMatches, spikeBot, type SpikeProbe } from '../../src/core/racer/spike-run';
import { JSNES, ROOT, writeShot } from './rom';

const FRAMES = 3600;
const ASPHALT = NES_RGB[0x00]!;

interface Seen {
  frame: number;
  probe: SpikeProbe;
  rgba: Uint8Array;
}

const isAsphalt = (rgba: Uint8Array, x: number, y: number) => {
  const i = (y * 256 + x) * 4;
  return rgba[i] === ASPHALT[0] && rgba[i + 1] === ASPHALT[1] && rgba[i + 2] === ASPHALT[2];
};
/** Mean x of asphalt pixels on a line (NaN if none). */
function roadCentre(rgba: Uint8Array, y: number): number {
  let n = 0;
  let sum = 0;
  for (let x = 0; x < 248; x++) if (isAsphalt(rgba, x, y)) (n++, (sum += x));
  return n ? sum / n : NaN;
}
function firstRoadLine(rgba: Uint8Array): number {
  for (let y = 16; y < 240; y++) for (let x = 0; x < 248; x++) if (isAsphalt(rgba, x, y)) return y;
  return -1;
}

describe('BLUMR-PLAN racer engine spike (jsnes)', () => {
  const shots = new Map<string, Seen>();
  const segs = new Set<number>();
  let last: SpikeProbe;
  let minFree = Infinity;
  let rom: Uint8Array;

  beforeAll(() => {
    const b = buildSpike(path.join(ROOT, 'racer', 'spike'), defaultToolchain(ROOT), path.join(ROOT, '.tmp', 'engine-builds', 'racer-spike'));
    if (!b.ok || !b.rom) throw new Error(b.log);
    rom = b.rom;
    const h = new RomHarness(JSNES, rom);
    let p = readSpikeProbe(h.s.mem);
    for (let f = 1; f <= FRAMES; f++) {
      h.step(1, spikeBot(p));
      p = readSpikeProbe(h.s.mem);
      segs.add(p.seg);
      if (f > 10) minFree = Math.min(minFree, freeCycles(p.idle));
      for (const s of SPIKE_SHOTS) {
        if (!shots.has(s.name) && shotMatches(s, f, p)) {
          shots.set(s.name, { frame: f, probe: p, rgba: h.rgba() });
          writeShot(h, `racer-spike-${s.name}`);
        }
      }
    }
    last = p;
  });

  it('boots on the BLUM cartridge (MMC3, 256 KiB PRG, 128 KiB CHR, 8 KiB PRG-RAM)', () => {
    expect(Array.from(rom.subarray(0, 11))).toEqual([0x4e, 0x45, 0x53, 0x1a, 0x10, 0x10, 0x40, 0x08, 0x00, 0x00, 0x07]);
    expect(rom.length).toBe(16 + 256 * 1024 + 128 * 1024);
    expect(last.magic).toBe('SBRG');
  });

  it('drives the whole demo track with 0 lag frames and keeps >= 8000 free cycles per frame', () => {
    expect([...segs].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(last.lag).toBe(0);
    expect(minFree).toBeGreaterThanOrEqual(8000);
    expect(shots.size).toBe(SPIKE_SHOTS.length);
  });

  it('bends the road: far road left on the left curve, right on the right curve', () => {
    const straight = roadCentre(shots.get('straight')!.rgba, 130);
    const left = roadCentre(shots.get('left-curve')!.rgba, 130);
    const right = roadCentre(shots.get('right-curve')!.rgba, 130);
    expect(Math.abs(straight - 128)).toBeLessThan(6);
    expect(left).toBeLessThan(straight - 30);
    expect(right).toBeGreaterThan(straight + 30);
    // near the car the road barely moves (curves grow toward the horizon)
    expect(Math.abs(roadCentre(shots.get('left-curve')!.rgba, 236) - 128)).toBeLessThan(12);
  });

  it('raises the horizon uphill and cuts the far road at a crest', () => {
    const flat = firstRoadLine(shots.get('straight')!.rgba);
    const up = firstRoadLine(shots.get('uphill')!.rgba);
    expect(Math.abs(flat - FLAT_HORIZON)).toBeLessThanOrEqual(2);
    expect(up).toBeLessThanOrEqual(flat - HILL_MAX + 2);
    const crest = shots.get('crest')!.rgba;
    const top = firstRoadLine(crest);
    let width = 0;
    for (let x = 0; x < 248; x++) if (isAsphalt(crest, x, top + 1)) width++;
    expect(width).toBeGreaterThan(60); // the visible road starts wide: the far part is behind the crest
  });

  it('moves the stripes with speed: consecutive frames differ on the road, not on the HUD', () => {
    const f = ['stripes-0', 'stripes-1', 'stripes-2', 'stripes-3'].map((n) => shots.get(n)!);
    expect(f[0]!.probe.speed).toBeGreaterThan(150);
    let roadDiff = 0;
    let hudDiff = 0;
    for (let i = 0; i < 3; i++) {
      for (let y = 0; y < 240; y++) {
        for (let x = 0; x < 248; x++) {
          const k = (y * 256 + x) * 4;
          const d = f[i]!.rgba[k] !== f[i + 1]!.rgba[k] || f[i]!.rgba[k + 1] !== f[i + 1]!.rgba[k + 1];
          if (!d) continue;
          if (y >= 130 && y < 184) roadDiff++;
          else if (y < 8) hudDiff++;
        }
      }
    }
    expect(roadDiff).toBeGreaterThan(200);
    expect(hudDiff).toBe(0);
  });

  it('steers the car: the bot keeps it on the road through every curve', () => {
    expect(last.offroad).toBe(0);
    for (const s of shots.values()) expect(s.probe.carX).toBeGreaterThan(60);
    for (const s of shots.values()) expect(s.probe.carX).toBeLessThan(196);
  });
});
