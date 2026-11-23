// NES master palette, 64 entries ($00-$3F), RGB hex. The single table shared by the converter, the
// previews and jsnes (PLAN §6, W0 P0-2.5). Frozen at M3 (M3-T1): change it and every preview, every
// conversion and the emulator change together.
// Values approximate the 2C02 PPU in its common emulator rendering.
export const NES_PALETTE: readonly string[] = [
  '#626262', '#001fb2', '#2404c8', '#5200b2', '#730076', '#800024', '#730b00', '#522800',
  '#244400', '#005700', '#005c00', '#005324', '#003c76', '#000000', '#000000', '#000000',
  '#ababab', '#0d57ff', '#4b30ff', '#8a13ff', '#bc08d6', '#d21269', '#c72e00', '#9d5400',
  '#607b00', '#209800', '#00a300', '#009942', '#007db4', '#000000', '#000000', '#000000',
  '#ffffff', '#53aeff', '#9085ff', '#d365ff', '#ff57ff', '#ff5dcf', '#ff7757', '#fa9e00',
  '#bdc700', '#7ae700', '#43f611', '#26ef7e', '#2cd5f6', '#4e4e4e', '#000000', '#000000',
  '#ffffff', '#b6e1ff', '#ced1ff', '#e9c3ff', '#ffbcff', '#ffbdf4', '#ffc6c3', '#ffd59a',
  '#e9e681', '#cef481', '#b6fb9a', '#a9fac3', '#a9f0f4', '#b8b8b8', '#000000', '#000000',
];

export function nesHex(index: number): string {
  return '$' + index.toString(16).toUpperCase().padStart(2, '0');
}

/** The black every palette uses. */
export const NES_BLACK = 0x0f;

/**
 * Indices the converter never picks (PLAN §6 step 2): $0D ("blacker than black", can upset TVs), $1D and
 * the $xE/$xF columns (duplicate blacks; $0F stays the one black), and $20 (same white as $30).
 */
export const NEVER_PICKED: ReadonlySet<number> = new Set([0x0d, 0x0e, 0x1d, 0x1e, 0x1f, 0x2e, 0x2f, 0x3e, 0x3f, 0x20]);

/** Colours the converter may choose, in index order. */
export const PICKABLE: readonly number[] = Array.from({ length: 64 }, (_, i) => i).filter((i) => !NEVER_PICKED.has(i));

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** RGB triples of the master palette. */
export const NES_RGB: readonly Rgb[] = NES_PALETTE.map(hexToRgb);

// ---------- OKLab (Björn Ottosson, public domain formulas) ----------

export type Lab = readonly [number, number, number];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = LINEAR[r]!;
  const lg = LINEAR[g]!;
  const lb = LINEAR[b]!;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab of every master palette entry. */
export const NES_LAB: readonly Lab[] = NES_RGB.map(([r, g, b]) => rgbToOklab(r, g, b));

export function labDist2(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/**
 * Distance used inside a fixed set of colours (a subpalette): lightness counts half, so a dark green
 * stays green rather than becoming a brown of the same lightness. The master-palette snap stays plain
 * OKLab (`nearestNes`).
 */
export const HUE_L_WEIGHT = 0.7;
export function paletteDist2(a: Lab, b: Lab): number {
  const dl = (a[0] - b[0]) * HUE_L_WEIGHT;
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/** Nearest NES colour in OKLab among `candidates` (default: every pickable colour). Ties: lowest index. */
export function nearestNes(lab: Lab, candidates: readonly number[] = PICKABLE): number {
  let best = candidates[0]!;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = labDist2(lab, NES_LAB[c]!);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function nearestNesRgb(r: number, g: number, b: number, candidates?: readonly number[]): number {
  return nearestNes(rgbToOklab(r, g, b), candidates);
}
