// SEBRING racer (BLUMR, docs/RACER-PLAN.md): generated data for the pseudo-3D road kernel.
// Everything here is computed from a few numbers, so the engine spike and the future track emitter
// share one source of truth. No Node imports (the app may preview it later).
//
// Nametable rows (vertical mirroring, 512 px wide = NT0 + NT1, PLAN-RACER §3):
//   0-15     HUD (NT0 only)
//   16-111   backdrop: sky (16-79), skyline (80-111); rows 16-35 are plain sky (hill shift margin)
//   112-119  far grass (road palette)
//   120-239  road picture: a straight perspective road, centre at x = 256, horizon above row 120
// The kernel picks, per screen line, a nametable row (hills) and an X scroll (curves); stripes are a
// CHR bank swap per line (variant A light / variant B dark).
import { encodeTile } from '../nes/chr.js';

export const ROAD_TOP_ROW = 120;
export const ROAD_ROWS = 120;
export const HUD_ROWS = 16;
export const SKY_SOLID_END = 36;
export const SKYLINE_TOP = 80;
export const GRASS_TOP = 112;
/** Flat horizon screen line (first road line). */
export const FLAT_HORIZON = 120;
export const CURVE_MIN = -32;
export const CURVE_MAX = 31;
export const HILL_MIN = -10;
export const HILL_MAX = 15;
/** Kernel lines are at most 240 - (FLAT_HORIZON - HILL_MAX) = 135: hill tables fit in page bytes 0-135. */
export const HILL_TABLE_BYTES = 136;
/** Curve tables use page bytes 136-255 through a pointer at page + 16 indexed by row 120-239. */
export const CURVE_PTR_OFFSET = 16;
/** Curve offset at the horizon for the strongest level (px). */
export const CURVE_MAX_PX = 112;
/** Stripe depth constant: z = STRIPE_K / n, band = 2 z units. */
export const STRIPE_K = 1000;
/** Rows nearer the horizon than this (n lines) never flip stripes (they would alias). */
export const STRIPE_FREEZE_N = 24;

export const ROAD_COLORS = { asphalt: 0, grass: 1, red: 2, white: 3 } as const;

/** Road geometry at n lines below the horizon (n = 1..120): half widths in px. */
export function roadShape(n: number): { half: number; rumble: number; centre: number } {
  return { half: 3.5 + n, rumble: 1 + n / 9, centre: 0.4 + n / 80 };
}

/** Colour index of road picture pixel (x 0-511, local row j 0-119) for a stripe variant. */
export function roadPixel(x: number, j: number, variant: 'A' | 'B'): number {
  const { half, rumble, centre } = roadShape(j + 1);
  const d = Math.abs(x + 0.5 - 256);
  if (d < centre) return variant === 'A' ? ROAD_COLORS.white : ROAD_COLORS.asphalt;
  if (d < half - rumble) return ROAD_COLORS.asphalt;
  if (d < half) return variant === 'A' ? ROAD_COLORS.white : ROAD_COLORS.red;
  return ROAD_COLORS.grass;
}

export interface RoadTiles {
  /** 2 KiB each: tiles $00-$7F for variant A and variant B (same indices). */
  chrA: Uint8Array;
  chrB: Uint8Array;
  /** Tile index per (tile column 0-63, tile row 0-14) of the road picture. */
  map: number[][];
  unique: number;
}

const tileKey = (a: Uint8Array, b: Uint8Array) => Array.from(a).join('') + '|' + Array.from(b).join('');

/** Tile 0 = solid grass (both variants). Throws when the road needs more than 128 tiles. */
export function buildRoadTiles(): RoadTiles {
  const chrA = new Uint8Array(2048);
  const chrB = new Uint8Array(2048);
  const index = new Map<string, number>();
  const add = (a: Uint8Array, b: Uint8Array): number => {
    const k = tileKey(a, b);
    let i = index.get(k);
    if (i === undefined) {
      i = index.size;
      if (i >= 128) throw new Error('road picture needs more than 128 tiles');
      index.set(k, i);
      chrA.set(encodeTile(a), i * 16);
      chrB.set(encodeTile(b), i * 16);
    }
    return i;
  };
  const grass = new Uint8Array(64).fill(ROAD_COLORS.grass);
  add(grass, grass);
  const map: number[][] = [];
  for (let ty = 0; ty < ROAD_ROWS / 8; ty++) {
    const row: number[] = [];
    for (let tx = 0; tx < 64; tx++) {
      const a = new Uint8Array(64);
      const b = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          a[y * 8 + x] = roadPixel(tx * 8 + x, ty * 8 + y, 'A');
          b[y * 8 + x] = roadPixel(tx * 8 + x, ty * 8 + y, 'B');
        }
      }
      row.push(add(a, b));
    }
    map.push(row);
  }
  return { chrA, chrB, map, unique: index.size };
}

/** X scroll per road row for a curve level (road centre on screen = 256 - X). */
export function curveTable(level: number): Uint8Array {
  const out = new Uint8Array(ROAD_ROWS);
  const k = CURVE_MAX_PX / (32 * 119 * 119);
  for (let j = 0; j < ROAD_ROWS; j++) {
    const m = 119 - j; // lines above the bottom row
    out[j] = Math.max(0, Math.min(255, Math.round(128 - level * k * m * m)));
  }
  return out;
}

/** First road screen line for a hill level. */
export function hillHorizon(level: number): number {
  return FLAT_HORIZON - Math.max(0, level);
}

/**
 * Nametable row per kernel line k (screen line horizon + k) for a hill level.
 * Uphill (level > 0): the horizon rises and the far road stretches. Crest (level < 0): the far road
 * is cut (rows from 120 + 4*|level|) and the near road stretches up to the flat horizon.
 */
export function hillTable(level: number): Uint8Array {
  const out = new Uint8Array(HILL_TABLE_BYTES).fill(239);
  const lines = 240 - hillHorizon(level);
  const top = level >= 0 ? 119 : 119 - 4 * -level; // rows from the bottom shown on the top line
  const span = lines - 1;
  const a = (span - top) / (span * span); // row-from-bottom(m) = m - a m^2, value `top` at m = span
  for (let k = 0; k < lines; k++) {
    const m = span - k;
    out[k] = 239 - Math.max(0, Math.min(119, Math.round(m - a * m * m)));
  }
  return out;
}

/** Per-row tables in one 1 KiB block: zTab, hiTab, loTab, maskTab (256 bytes each, indexed by row). */
export function rowTables(): Uint8Array {
  const out = new Uint8Array(1024);
  for (let row = 0; row < 256; row++) {
    const n = row - (ROAD_TOP_ROW - 1);
    const road = row >= ROAD_TOP_ROW && row < 240;
    out[row] = road ? Math.round(STRIPE_K / n) & 0xff : 0;
    out[256 + row] = (row >> 6) & 3; // $2006 first write: nametable 0, coarse Y bits 3-4
    out[512 + row] = (row << 2) & 0xe0; // $2006 second write: coarse Y bits 0-2 (| X >> 3)
    out[768 + row] = road && n >= STRIPE_FREEZE_N ? 2 : 0; // CHR R0 = 0 (A) or 2 (B)
  }
  return out;
}

/** The two 8 KiB road banks: page p = hill table p (bytes 0-135) + curve table bank*32+p (136-255). */
export function roadBanks(): Uint8Array[] {
  const banks = [new Uint8Array(8192), new Uint8Array(8192)];
  for (let b = 0; b < 2; b++) {
    for (let p = 0; p < 32; p++) {
      const page = banks[b]!.subarray(p * 256, p * 256 + 256);
      const hill = HILL_MIN + p;
      if (hill <= HILL_MAX) page.set(hillTable(hill), 0);
      page.set(curveTable(CURVE_MIN + b * 32 + p), CURVE_PTR_OFFSET + ROAD_TOP_ROW);
    }
  }
  return banks;
}

/** Pixel-art rows -> 2bpp pixel array; '.'/' ' = 0, '1'-'3' = colour. */
export function art(rows: string[], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = rows[y] ?? '';
    for (let x = 0; x < w; x++) {
      const c = r[x] ?? '.';
      out[y * w + x] = c >= '1' && c <= '3' ? c.charCodeAt(0) - 48 : 0;
    }
  }
  return out;
}

/** Cuts a w×h pixel image into 8×8 tiles, row-major. */
export function cutTiles(px: Uint8Array, w: number, h: number): Uint8Array[] {
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < h / 8; ty++) {
    for (let tx = 0; tx < w / 8; tx++) {
      const t = new Uint8Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = px[(ty * 8 + y) * w + tx * 8 + x]!;
      tiles.push(t);
    }
  }
  return tiles;
}
