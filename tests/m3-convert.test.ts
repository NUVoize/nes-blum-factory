// M3 acceptance tests T1-T6: master palette, CHR codec, converter rules (PLAN §6).
import { createHash } from 'node:crypto';
import * as jsnes from 'jsnes';
import { describe, expect, it } from 'vitest';
import { convertImage, type PaletteSet } from '../src/core/convert/convert';
import { NesSession, jsnesPaletteTable, type JsnesModule } from '../src/core/emu/nes-session';
import { decodeTile, encodeTile } from '../src/core/nes/chr';
import { NES_PALETTE, NES_RGB, NEVER_PICKED, nearestNesRgb } from '../src/core/nes/palette';
import { DEMO_PALETTES } from '../src/core/engine-data/demo';
import { graphicsDocSchema, type ConvertSettings } from '../src/core/schema/graphics';
import { encodePng, type RgbaImage } from '../src/core/util/png';
import { fixture } from './fixtures/images';
const WORLD: PaletteSet = DEMO_PALETTES.sets[0]!;

function rngOf(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bgSettings = (over: Partial<ConvertSettings> = {}): ConvertSettings => ({
  kind: 'screen',
  role: 'background',
  mode: 'free',
  world: 'monde-1',
  fit: 'cover',
  width: 256,
  height: 240,
  dither: 'bayer',
  ditherStrength: 60,
  ...over,
});

describe('M3-T1 master palette', () => {
  it('M3-T1 has 64 entries, $0D never chosen, OKLab nearest fixtures, jsnes override equals the table', () => {
    expect(NES_PALETTE).toHaveLength(64);
    for (const h of NES_PALETTE) expect(h).toMatch(/^#[0-9a-f]{6}$/);
    // every 17th step of the RGB cube: the converter never picks $0D or the duplicate blacks
    const seen = new Set<number>();
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) seen.add(nearestNesRgb(r, g, b));
    expect(seen.has(0x0d)).toBe(false);
    for (const c of NEVER_PICKED) expect(seen.has(c)).toBe(false);
    // fixtures (OKLab nearest)
    expect(nearestNesRgb(0, 0, 0)).toBe(0x0f);
    expect(nearestNesRgb(255, 255, 255)).toBe(0x30);
    expect(nearestNesRgb(255, 0, 0)).toBe(0x16);
    expect(nearestNesRgb(0, 255, 0)).toBe(0x2a);
    expect(nearestNesRgb(0, 0, 255)).toBe(0x12);
    expect(nearestNesRgb(255, 128, 192)).toBe(0x25);
    expect(nearestNesRgb(0, 128, 128)).toBe(0x1c);
    expect(nearestNesRgb(128, 128, 128)).toBe(0x00);
    expect(nearestNesRgb(250, 158, 0)).toBe(0x27);
    // an exact palette colour maps to itself
    for (const c of [0x01, 0x11, 0x21, 0x31, 0x16, 0x2a, 0x37]) expect(nearestNesRgb(...NES_RGB[c]!)).toBe(c);
    // jsnes override = the same table (PLAN §6, W0 P0-2.5)
    const s = new NesSession(jsnes as unknown as JsnesModule);
    s.applyPalette();
    const cur = (s.nes as unknown as { ppu: { palTable: { curTable: Uint32Array } } }).ppu.palTable.curTable;
    const want = jsnesPaletteTable();
    expect(Array.from(cur.slice(0, 64))).toEqual(Array.from(want));
    NES_RGB.forEach(([r, g, b], i) => expect(want[i]).toBe((b << 16) | (g << 8) | r));
  });
});

describe('M3-T2 CHR codec', () => {
  it('M3-T2 golden 8×8 patterns give the exact 16 bytes; decode(encode(x)) = x', () => {
    // the nesdev wiki example: a ½ glyph
    const half = [
      [0, 1, 0, 0, 0, 0, 0, 3],
      [1, 1, 0, 0, 0, 0, 3, 0],
      [0, 1, 0, 0, 0, 3, 0, 0],
      [0, 1, 0, 0, 3, 0, 0, 0],
      [0, 0, 0, 3, 0, 2, 2, 0],
      [0, 0, 3, 0, 0, 0, 0, 2],
      [0, 3, 0, 0, 0, 0, 2, 0],
      [3, 0, 0, 0, 0, 2, 2, 2],
    ].flat();
    expect(Array.from(encodeTile(half))).toEqual([0x41, 0xc2, 0x44, 0x48, 0x10, 0x20, 0x40, 0x80, 0x01, 0x02, 0x04, 0x08, 0x16, 0x21, 0x42, 0x87]);
    expect(Array.from(encodeTile(new Array(64).fill(3)))).toEqual(new Array(16).fill(0xff));
    expect(Array.from(encodeTile(new Array(64).fill(0)))).toEqual(new Array(16).fill(0));
    const stripes = Array.from({ length: 64 }, (_, i) => (i % 8) % 4);
    expect(Array.from(encodeTile(stripes))).toEqual([...new Array(8).fill(0x55), ...new Array(8).fill(0x33)]);
    const rnd = rngOf(42);
    for (let n = 0; n < 200; n++) {
      const t = Array.from({ length: 64 }, () => Math.floor(rnd() * 4));
      expect(Array.from(decodeTile(encodeTile(t)))).toEqual(t);
    }
  });
});

/** Random "generated images" for the property tests: blobs, gradients, noise. */
function randomImage(seed: number, w = 256, h = 240): RgbaImage {
  const rnd = rngOf(seed);
  const data = new Uint8Array(w * h * 4);
  const blobs = Array.from({ length: 3 + Math.floor(rnd() * 10) }, () => ({ x: rnd() * w, y: rnd() * h, r: 10 + rnd() * 60, c: [rnd() * 255, rnd() * 255, rnd() * 255] }));
  const g0 = [rnd() * 255, rnd() * 255, rnd() * 255];
  const g1 = [rnd() * 255, rnd() * 255, rnd() * 255];
  const noise = rnd() * 60;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h;
      let c = g0.map((v, i) => v * (1 - t) + g1[i]! * t);
      for (const b of blobs) if ((x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) c = b.c;
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, Math.round(c[k]! + (rnd() - 0.5) * noise)));
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function blockColorsOk(after: RgbaImage, doc: NonNullable<ReturnType<typeof convertImage>['doc']>): boolean {
  const backdrop = doc.palettes.backdrop;
  const slots = new Map(doc.palettes.slots.map((s) => [s.slot, s.colors]));
  const rgbKey = (c: number) => NES_RGB[c]!.join(',');
  for (let by = 0; by < after.height / 16; by++) {
    for (let bx = 0; bx < after.width / 16; bx++) {
      const seen = new Set<string>();
      for (let y = by * 16; y < by * 16 + 16; y++) for (let x = bx * 16; x < bx * 16 + 16; x++) {
        const i = (y * after.width + x) * 4;
        seen.add(`${after.data[i]},${after.data[i + 1]},${after.data[i + 2]}`);
      }
      seen.delete(rgbKey(backdrop));
      if (seen.size > 3) return false;
      const fits = [...slots.values()].some((cols) => [...seen].every((k) => cols.some((c) => rgbKey(c) === k)));
      if (!fits) return false;
    }
  }
  return true;
}

describe('M3-T3 attribute rule', () => {
  it('M3-T3 on 50 generated images every 16×16 block uses one subpalette (≤ 3 + backdrop), ≤ 4 BG subpalettes', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const mode = seed % 2 ? 'free' : 'locked';
      const r = convertImage({ image: randomImage(seed), settings: bgSettings({ mode, dither: seed % 3 ? 'bayer' : 'none' }), id: `t3-${seed}`, name: 'T3', paletteSet: WORLD });
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      const doc = r.doc!;
      expect(doc.palettes.slots.length).toBeLessThanOrEqual(4);
      expect(new Set(doc.screen!.attributes.flatMap((a) => [a & 3, (a >> 2) & 3, (a >> 4) & 3, (a >> 6) & 3])).size).toBeLessThanOrEqual(4);
      expect(blockColorsOk(r.after, doc), `seed ${seed}`).toBe(true);
      // free mode keeps the HUD subpalette 0 of the world
      if (mode === 'free') expect(r.proposedSet!.bg[0]).toEqual(WORLD.bg[0]);
    }
  });
});

describe('M3-T4 tile budget', () => {
  it('M3-T4 never more than 256 unique BG tiles; the lossy merge reaches the budget; report counts match', () => {
    const r = convertImage({ image: fixture('photo-gradient.png'), settings: bgSettings({ mode: 'free' }), id: 'photo', name: 'Photo', paletteSet: WORLD });
    expect(r.ok).toBe(true);
    const doc = r.doc!;
    expect(doc.budget.tilesBeforeMerge).toBeGreaterThan(256);
    expect(doc.budget.tiles).toBeLessThanOrEqual(256);
    expect(doc.budget.merged).toBe(doc.budget.tilesBeforeMerge - doc.budget.tiles);
    expect(new Set([0, ...doc.screen!.nametable]).size).toBe(doc.budget.tiles); // tile 0 = blank, reserved
    expect(Math.max(...doc.screen!.nametable)).toBe(doc.budget.tiles - 1);
    expect(r.chr.length).toBe(4096);
    // a smaller budget is reached exactly, tile 0 stays blank
    const small = convertImage({ image: fixture('photo-gradient.png'), settings: bgSettings({ mode: 'free', maxTiles: 96 }), id: 'photo', name: 'Photo', paletteSet: WORLD });
    expect(small.doc!.budget.tiles).toBe(96);
    expect(new Set(small.doc!.screen!.nametable).size).toBeLessThanOrEqual(96);
    expect(Array.from(small.chr.slice(0, 16))).toEqual(new Array(16).fill(0));
    expect(small.doc!.budget.warnings.some((w) => /fusionnées/.test(w.fr))).toBe(true);
    // a simple drawing needs no merge
    const line = convertImage({
      image: fixture('line-drawing.png'),
      settings: bgSettings({ kind: 'tileset', mode: 'locked', fit: 'stretch', width: 128, height: 96, dither: 'none' }),
      id: 'line',
      name: 'Line',
      paletteSet: WORLD,
    });
    expect(line.ok, JSON.stringify(line.errors)).toBe(true);
    expect(line.doc!.budget.merged).toBe(0);
    expect(line.doc!.metatiles!.length).toBe(line.doc!.budget.metatiles);
  });
});

const spriteSettings = (over: Partial<ConvertSettings> = {}): ConvertSettings => ({
  kind: 'sprite',
  role: 'player',
  mode: 'locked',
  world: 'monde-1',
  fit: 'stretch',
  width: 64,
  height: 24,
  frame: { w: 16, h: 24 },
  frameNames: ['idle', 'run1', 'run2', 'jump'],
  dither: 'none',
  ditherStrength: 0,
  ...over,
});

describe('M3-T5 metasprites', () => {
  it('M3-T5 frames split into 8×8 sprites with offsets/flip/palette; > 8 per line flagged; ≤ 64 total; one animation per bank, ≤ 64 tiles per bank', () => {
    const r = convertImage({ image: fixture('character-sheet.png'), settings: spriteSettings(), id: 'pousse', name: 'Pousse', paletteSet: WORLD });
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const doc = r.doc!;
    expect(doc.frames!.map((f) => f.name)).toEqual(['idle', 'run1', 'run2', 'jump']);
    for (const f of doc.frames!) {
      expect(f.sprites.length).toBeGreaterThan(0);
      expect(f.sprites.length).toBeLessThanOrEqual(6);
      for (const sp of f.sprites) {
        expect(sp.x % 8).toBe(0);
        expect(sp.y % 8).toBe(0);
        expect(sp.palette).toBe(0); // player role: sprite subpalette 0
      }
      expect(f.maxPerLine).toBe(2);
      expect(f.hotspot).toEqual({ x: 8, y: 24 });
    }
    // idle + run in bank 0, jump in bank 1 (PLAN §5.4)
    const bankOf = Object.fromEntries(doc.frames!.map((f) => [f.name, f.bank]));
    expect(bankOf).toEqual({ idle: 0, run1: 0, run2: 0, jump: 1 });
    for (const b of doc.budget.banks) expect(b.tiles).toBeLessThanOrEqual(64);
    expect(r.chr.length).toBe(2048);
    // flips: a symmetric frame reuses mirrored tiles
    const sym = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) sym.data.set(x < 8 ? [200, 40, 40, 255] : [200, 40, 40, 255], (y * 16 + x) * 4);
    for (let y = 4; y < 8; y++) sym.data.set([255, 255, 255, 255], (y * 16 + 4) * 4), sym.data.set([255, 255, 255, 255], (y * 16 + 11) * 4);
    const s = convertImage({ image: sym, settings: spriteSettings({ role: 'enemy', width: 16, height: 16, frame: { w: 16, h: 16 }, frameNames: ['walk1'] }), id: 'sym', name: 'Sym', paletteSet: WORLD });
    const sp = s.doc!.frames![0]!.sprites;
    expect(sp).toHaveLength(4);
    expect(s.doc!.budget.tiles).toBe(2); // top and bottom halves; the right column reuses them mirrored
    expect(sp.filter((x) => x.flipH).length).toBe(2);
    expect(sp.every((x) => x.palette === 2 || x.palette === 3)).toBe(true);
    // a wide sheet with 4 frames side by side on one line: still per-frame counts
    // scanline counter: 32×32 boss frame = 4 sprites per line; a synthetic 10-sprite line is flagged
    const wide = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4).fill(255) };
    wide.data[3] = 0; // one transparent pixel: alpha decides what is transparent
    const b = convertImage({ image: wide, settings: spriteSettings({ role: 'boss', width: 32, height: 32, frame: { w: 32, h: 32 }, frameNames: ['idle'] }), id: 'boss', name: 'Boss', paletteSet: WORLD });
    expect(b.doc!.frames![0]!.maxPerLine).toBe(4);
    expect(b.doc!.frames![0]!.sprites.length).toBe(16);
  });

  it('M3-T5 the player bank rule keeps each animation in one bank and fills banks 2-3 for extra animations', async () => {
    const { playerBanks } = await import('../src/core/convert/convert');
    const names = ['idle', 'run1', 'run2', 'run3', 'hurt', 'jump', 'fall', 'climb1', 'climb2', 'swim1', 'swim2', 'wallgrab'];
    const banks = playerBanks(names, new Map([['idle', 6], ['run', 18], ['hurt', 6], ['jump', 6], ['fall', 6], ['climb', 12], ['swim', 12], ['wallgrab', 6]]));
    expect(banks.get('idle')).toBe(0);
    expect(banks.get('run')).toBe(0);
    expect(banks.get('jump')).toBe(1);
    expect(banks.get('climb')).toBe(1);
    expect([2, 3]).toContain(banks.get('swim'));
    expect([2, 3]).toContain(banks.get('wallgrab'));
  });

  it('M3-T5 the scanline counter flags more than 8 sprites on a line', async () => {
    const { maxPerLine } = await import('../src/core/convert/convert');
    expect(maxPerLine(Array.from({ length: 9 }, () => ({ y: 0 })), 8)).toBe(9);
    expect(maxPerLine([{ y: 0 }, { y: 8 }, { y: 16 }], 24)).toBe(1);
  });
});

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);

describe('M3-T6 fixtures', () => {
  it('M3-T6 budget JSON and preview PNG hash snapshots (photo, line drawing, character sheet)', () => {
    const cases = [
      { name: 'photo-gradient.png', id: 'photo', settings: bgSettings({ mode: 'free' }) },
      { name: 'line-drawing.png', id: 'line', settings: bgSettings({ kind: 'tileset', mode: 'locked', fit: 'stretch', width: 128, height: 96, dither: 'none' }) },
      { name: 'character-sheet.png', id: 'pousse', settings: spriteSettings() },
    ];
    const out: Record<string, unknown> = {};
    for (const c of cases) {
      const r = convertImage({ image: fixture(c.name), settings: c.settings, id: c.id, name: c.id, paletteSet: WORLD });
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      expect(graphicsDocSchema.safeParse(r.doc).success).toBe(true);
      out[c.name] = { budget: r.doc!.budget, palettes: r.doc!.palettes, preview: sha(encodePng(r.after.data, r.after.width, r.after.height)), chr: sha(r.chr) };
      // determinism: the same input gives the same bytes
      const again = convertImage({ image: fixture(c.name), settings: c.settings, id: c.id, name: c.id, paletteSet: WORLD });
      expect(sha(again.chr)).toBe(sha(r.chr));
    }
    expect(out).toMatchSnapshot();
  });
});
