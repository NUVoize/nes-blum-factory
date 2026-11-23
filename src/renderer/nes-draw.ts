// Drawing NES graphics in the editor panels (REBOND previews, TABLEAU grid): CHR tiles + a palette
// triple on the master palette, exactly what the PPU shows. Pure canvas code, no emulator.
import { buildBuiltinBoss, buildBuiltinEnemy, buildJardinBank, type SpriteEntry } from '../core/engine-data/builtin-chr';
import { decodeTile, TileBank } from '../core/nes/chr';
import { NES_RGB } from '../core/nes/palette';
import type { Tileset } from '../core/schema/engine-docs';
import type { Palettes } from '../core/schema/misc';

export type Triple = readonly [number, number, number];

/** 16×16 RGBA of a metatile: 4 tiles from a BG CHR set (256 tiles) with one subpalette. */
export function metatileImage(chr: Uint8Array, tiles: readonly number[], pal: Triple, backdrop: number): ImageData {
  const img = new ImageData(16, 16);
  const colors = [backdrop, ...pal].map((c) => NES_RGB[c & 0x3f]!);
  tiles.forEach((t, q) => {
    const px = decodeTile(chr, (t & 0xff) * 16);
    const ox = (q & 1) * 8;
    const oy = (q >> 1) * 8;
    for (let i = 0; i < 64; i++) {
      const [r, g, b] = colors[px[i]!]!;
      const o = ((oy + (i >> 3)) * 16 + ox + (i & 7)) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  });
  return img;
}

/** One canvas per metatile id of a tileset (for the TABLEAU palette and grid). */
export function metatileCanvases(t: Tileset, chr: Uint8Array, set: Palettes['sets'][number] | undefined): Map<number, HTMLCanvasElement> {
  const out = new Map<number, HTMLCanvasElement>();
  for (const m of t.metatiles) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const pal = (set?.bg[m.palette] ?? set?.bg[0] ?? [0x0f, 0x10, 0x30]) as Triple;
    c.getContext('2d')!.putImageData(metatileImage(chr, m.tiles, pal, set?.backdrop ?? 0x0f), 0, 0);
    out.set(m.id, c);
  }
  return out;
}

let jardin: Uint8Array | null = null;
/** BG CHR set of a tileset: the built-in jardin bank, or a CHROMA .chr read through `asset`. */
export async function tilesetChr(t: Tileset, asset: (p: string) => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
  if (t.chr === 'builtin:jardin') return (jardin ??= buildJardinBank().bank.bytes());
  if (t.chr.startsWith('graphics/')) return asset(t.chr);
  return null;
}

/** Draws a metasprite (entries relative to the actor origin) into a canvas of w×h. */
export function drawMetasprite(canvas: HTMLCanvasElement, entries: SpriteEntry[], tilePixels: (tile: number) => Uint8Array, pals: readonly Triple[], ox = 0, oy = 0): void {
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(canvas.width, canvas.height);
  for (const e of entries) {
    const px = tilePixels(e.tile);
    const pal = pals[e.attr & 3] ?? pals[0]!;
    const fh = (e.attr & 0x40) !== 0;
    const fv = (e.attr & 0x80) !== 0;
    for (let i = 0; i < 64; i++) {
      const v = px[i]!;
      if (!v) continue;
      const x = i & 7;
      const y = i >> 3;
      const dx = ox + e.x + (fh ? 7 - x : x);
      const dy = oy + e.y + (fv ? 7 - y : y);
      if (dx < 0 || dy < 0 || dx >= canvas.width || dy >= canvas.height) continue;
      const [r, gg, b] = NES_RGB[pal[v - 1]! & 0x3f]!;
      const o = (dy * canvas.width + dx) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** First frame of a built-in enemy or boss, ready to draw (tile base $80 enemies, $C0 bosses). */
export function builtinFrame(graphics: string): { entries: SpriteEntry[]; tile: (t: number) => Uint8Array; w: number; h: number } | null {
  const m = /^builtin:(.+)$/.exec(graphics);
  if (!m) return null;
  const boss = m[1] === 'boss';
  const bank = new TileBank('apercu', 64);
  let frames: SpriteEntry[][];
  try {
    frames = boss ? buildBuiltinBoss(bank) : buildBuiltinEnemy(m[1]!, bank, 2);
  } catch {
    return null;
  }
  const bytes = bank.bytes();
  const base = boss ? 0xc0 : 0x80;
  return { entries: frames[0]!, tile: (t) => decodeTile(bytes, (t - base) * 16), w: boss ? 32 : 16, h: boss ? 32 : 16 };
}
