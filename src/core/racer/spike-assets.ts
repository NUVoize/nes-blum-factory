// SEBRING engine spike (BLUMR-PLAN): CHR, nametables, palette and road tables for racer/spike.
// Placeholder art, drawn here in code (ours, original). Contract with racer/spike/src/spike.s:
//   CHR 1 KiB units 0-1 road A, 2-3 road B (BG $0000, R0), 4-5 backdrop + HUD (BG $0800, R1 = 4),
//   8 sprites (R2 = 8). PRG bank 1-2 = road banks (curve + hill tables), fixed bank = row tables.
import { encodeTile } from '../nes/chr.js';
import {
  GRASS_TOP,
  HUD_ROWS,
  ROAD_TOP_ROW,
  SKYLINE_TOP,
  art,
  buildRoadTiles,
  cutTiles,
  roadBanks,
  rowTables,
} from './road-data.js';

export const SPIKE_PALETTE = [
  // BG: road, sky, skyline, HUD (colour 3 of the HUD = top sky colour, so the HUD split line is invisible)
  0x00, 0x1a, 0x16, 0x30,
  0x00, 0x01, 0x13, 0x27,
  0x00, 0x27, 0x0c, 0x38,
  0x00, 0x0f, 0x30, 0x01,
  // sprites: car (black, red lights, white body), driver (green tuque, hair, skin), digits, unused
  0x00, 0x0f, 0x16, 0x30,
  0x00, 0x1a, 0x07, 0x37,
  0x00, 0x30, 0x28, 0x0f,
  0x00, 0x0f, 0x0f, 0x0f,
];

/** 5×7 glyphs ('#' = ink). Only what the spike and the plan's HUD need. */
const GLYPHS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
};

/** HUD text on BG tile row 1 (lines 8-15): "SEBRING" at column 1, "KM/H" at column 25. */
export const HUD_TEXT: { col: number; text: string }[] = [
  { col: 1, text: 'SEBRING' },
  { col: 25, text: 'KM/H' },
];

function glyphTile(ch: string, ink: number, paper: number, bottom: number): Uint8Array {
  const g = GLYPHS[ch];
  const t = new Uint8Array(64).fill(paper);
  if (g) for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (g[y]![x] === '#') t[y * 8 + x + 1] = ink;
  for (let x = 0; x < 8; x++) t[56 + x] = bottom;
  return t;
}

const solid = (c: number) => new Uint8Array(64).fill(c);
function dither(a: number, b: number): Uint8Array {
  const t = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = (x + y) & 1 ? b : a;
  return t;
}

/** Deterministic PRNG (same as the harness dirty boot). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rear view of a convertible, 32×24, colours: 1 black, 2 red lights, 3 white body. lean -1/0/1. */
export function carPixels(lean: number): Uint8Array {
  const w = 32;
  const px = new Uint8Array(w * 24);
  const put = (x: number, y: number, c: number) => {
    if (x >= 0 && x < w && y >= 0 && y < 24) px[y * w + x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c);
  };
  const top = lean; // the upper body shifts with the lean
  // windshield frame and open cabin (seen from behind)
  rect(7 + top, 3, 24 + top, 3, 1);
  rect(6 + top, 4, 6 + top, 8, 1);
  rect(25 + top, 4, 25 + top, 8, 1);
  rect(7 + top, 5, 24 + top, 9, 1);
  // headrests (body colour)
  rect(9 + top, 4, 12 + top, 7, 3);
  rect(19 + top, 4, 22 + top, 7, 3);
  // body
  rect(3, 8, 28, 8, 3);
  rect(2, 9, 29, 9, 3);
  rect(1, 10, 30, 17, 3);
  rect(7 + top, 8, 24 + top, 9, 1);
  // trunk line, tail lights, plate (blank, no logo), bumper
  rect(4, 11, 27, 11, 1);
  rect(2, 12, 8, 14, 2);
  rect(23, 12, 29, 14, 2);
  rect(12, 14, 19, 16, 1);
  rect(13, 15, 18, 15, 3);
  rect(1, 17, 30, 17, 1);
  // tyres and shadow
  rect(1, 18, 6, 22, 1);
  rect(25, 18, 30, 22, 1);
  rect(7, 18, 24, 19, 1);
  rect(3, 23, 28, 23, 1);
  return px;
}

/** Driver's head from behind, 8×8, sprite palette 1: 1 green tuque, 2 hair, 3 skin. */
export function driverPixels(): Uint8Array {
  return art(['..111...', '.11111..', '1111111.', '.11111..', '.22222..', '.22222..', '.32223..', '..222...'], 8, 8);
}

export interface SpikeAssets {
  chr: Uint8Array;
  nametables: Uint8Array;
  palette: Uint8Array;
  roadBanks: Uint8Array[];
  rowTables: Uint8Array;
  roadTileCount: number;
  backdropTileCount: number;
  /** Sprite tile indices (pattern table $1000). */
  sprites: { car: [number, number, number]; driver: number; digits: number };
}

export function buildSpikeAssets(): SpikeAssets {
  const chr = new Uint8Array(128 * 1024);
  const road = buildRoadTiles();
  chr.set(road.chrA, 0);
  chr.set(road.chrB, 2048);

  // backdrop + HUD tiles at CHR $1000 (R1 = 4), nametable indices $80-$FF
  const bd: Uint8Array[] = [];
  const bdIndex = new Map<string, number>();
  const addBd = (t: Uint8Array): number => {
    const k = t.join('');
    let i = bdIndex.get(k);
    if (i === undefined) {
      i = bd.length;
      if (i >= 128) throw new Error('backdrop needs more than 128 tiles');
      bd.push(t);
      bdIndex.set(k, i);
    }
    return 0x80 + i;
  };
  const NT_W = 64;
  const nt = new Array<number>(NT_W * 30).fill(0);
  const set = (tx: number, ty: number, v: number) => (nt[ty * NT_W + tx] = v);

  // HUD (palette 3): row 0 black, row 1 black with a blue bottom line, text in row 1
  const black = addBd(solid(1));
  const hudRow1 = addBd(glyphTile(' ', 2, 1, 3));
  for (let tx = 0; tx < NT_W; tx++) {
    set(tx, 0, black);
    set(tx, 1, hudRow1);
  }
  for (const { col, text } of HUD_TEXT) [...text].forEach((ch, i) => set(col + i, 1, addBd(glyphTile(ch, 2, 1, 3))));

  // sky (palette 1), rows 16-79
  const skyRow = (row: number): Uint8Array => {
    if (row < 48) return solid(1);
    if (row < 56) return dither(1, 2);
    if (row < 64) return solid(2);
    if (row < 72) return dither(2, 3);
    return solid(3);
  };
  for (let ty = HUD_ROWS / 8; ty < SKYLINE_TOP / 8; ty++) {
    const t = addBd(skyRow(ty * 8));
    for (let tx = 0; tx < NT_W; tx++) set(tx, ty, t);
  }

  // skyline (palette 2: 1 orange sky, 2 silhouette, 3 windows), rows 80-111, 512 px wide, tiles aligned
  const rand = rng(1999);
  const heights: number[] = [];
  while (heights.length < NT_W) {
    const w = 2 + Math.floor(rand() * 4);
    const h = Math.floor(rand() * 5); // 0-4 tiles
    for (let i = 0; i < w && heights.length < NT_W; i++) heights.push(h);
  }
  const sky = addBd(solid(1));
  const wall = addBd(solid(2));
  const windowsA = addBd(art(['22222222', '23222322', '23222322', '22222222', '22222222', '22232223', '22232223', '22222222'], 8, 8));
  const windowsB = addBd(art(['22222222', '22322232', '22322232', '22222222', '22222222', '22222222', '23222322', '22222222'], 8, 8));
  const tiers = SKYLINE_TOP / 8;
  for (let tx = 0; tx < NT_W; tx++) {
    for (let k = 0; k < 4; k++) {
      const ty = tiers + k;
      const fromBottom = 3 - k;
      const built = fromBottom < heights[tx]! || fromBottom === 0;
      set(tx, ty, built ? ((tx * 7 + ty * 3) % 5 === 0 ? windowsA : (tx + ty) % 3 === 0 ? windowsB : wall) : sky);
    }
  }
  // far grass (road palette tile 0) and the road picture
  for (let tx = 0; tx < NT_W; tx++) set(tx, GRASS_TOP / 8, 0);
  for (let ty = 0; ty < road.map.length; ty++) for (let tx = 0; tx < NT_W; tx++) set(tx, ROAD_TOP_ROW / 8 + ty, road.map[ty]![tx]!);

  bd.forEach((t, i) => chr.set(encodeTile(t), 4096 + i * 16));

  // nametables: NT0 = columns 0-31, NT1 = columns 32-63, each 960 tiles + 64 attribute bytes
  const nametables = new Uint8Array(2048);
  const palOfRow = (row: number) => (row < HUD_ROWS ? 3 : row < SKYLINE_TOP ? 1 : row < GRASS_TOP ? 2 : 0);
  for (let n = 0; n < 2; n++) {
    const base = n * 1024;
    for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++) nametables[base + ty * 32 + tx] = nt[ty * NT_W + n * 32 + tx]!;
    for (let ay = 0; ay < 8; ay++) {
      const top = palOfRow(ay * 32);
      const bottom = palOfRow(ay * 32 + 16);
      const v = top | (top << 2) | (bottom << 4) | (bottom << 6);
      for (let ax = 0; ax < 8; ax++) nametables[base + 960 + ay * 8 + ax] = v;
    }
  }

  // sprites at CHR $2000 (R2 = 8): 3 car frames (12 tiles each), driver, digits 0-9
  const spr: Uint8Array[] = [];
  for (const lean of [0, -1, 1]) spr.push(...cutTiles(carPixels(lean), 32, 24));
  const driver = spr.length;
  spr.push(driverPixels());
  const digits = spr.length;
  for (let d = 0; d < 10; d++) spr.push(glyphTile(String(d), 1, 0, 0));
  spr.forEach((t, i) => chr.set(encodeTile(t), 8192 + i * 16));

  return {
    chr,
    nametables,
    palette: Uint8Array.from(SPIKE_PALETTE),
    roadBanks: roadBanks(),
    rowTables: rowTables(),
    roadTileCount: road.unique,
    backdropTileCount: bd.length,
    sprites: { car: [0, 12, 24], driver, digits },
  };
}
