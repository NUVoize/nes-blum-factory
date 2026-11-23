// Previews rebuilt from a graphics document + its CHR bytes (after a pixel edit, in the gallery, in the
// CHROMA tile sheet). Uses the master palette table, like jsnes (PLAN §6).
import { decodeTile } from '../nes/chr.js';
import { NES_RGB } from '../nes/palette.js';
import type { GraphicsDoc } from '../schema/graphics.js';
import type { RgbaImage } from '../util/png.js';
import { blankImage } from './image.js';
import type { PaletteSet } from './convert.js';

function paint(out: RgbaImage, x: number, y: number, nes: number): void {
  if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
  const i = (y * out.width + x) * 4;
  const [r, g, b] = NES_RGB[nes]!;
  out.data[i] = r;
  out.data[i + 1] = g;
  out.data[i + 2] = b;
  out.data[i + 3] = 255;
}

/** Colours of slot `slot`: the world's (locked) or the graphic's own (free, before adoption). */
function slotColors(doc: GraphicsDoc, set: PaletteSet | null, slot: number, sprite: boolean): readonly number[] {
  const own = doc.palettes.slots.find((s) => s.slot === slot)?.colors;
  const world = sprite ? set?.sprites[slot] : set?.bg[slot];
  return (doc.palettes.mode === 'locked' ? (world ?? own) : (own ?? world)) ?? [0x0f, 0x00, 0x10];
}

/** What the NES shows for this graphic (sprites: frames side by side on transparency). */
export function renderGraphics(doc: GraphicsDoc, chr: Uint8Array, set: PaletteSet | null): RgbaImage {
  const backdrop = doc.palettes.mode === 'locked' ? (set?.backdrop ?? doc.palettes.backdrop) : doc.palettes.backdrop;
  if (doc.kind === 'sprite') {
    const frames = doc.frames ?? [];
    const fw = Math.max(8, ...frames.map((f) => f.w));
    const fh = Math.max(8, ...frames.map((f) => f.h));
    const out = blankImage(fw * Math.max(1, frames.length), fh);
    frames.forEach((f, fi) => {
      for (const sp of f.sprites) {
        const t = decodeTile(chr, f.bank * 1024 + sp.tile * 16);
        const cols = slotColors(doc, set, sp.palette, true);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const v = t[(sp.flipV ? 7 - y : y) * 8 + (sp.flipH ? 7 - x : x)]!;
            if (v) paint(out, fi * fw + sp.x + x, sp.y + y, cols[v - 1]!);
          }
        }
      }
    });
    return out;
  }
  const drawTile = (out: RgbaImage, tile: number, pal: number, px: number, py: number) => {
    const t = decodeTile(chr, tile * 16);
    const cols = [backdrop, ...slotColors(doc, set, pal, false)];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) paint(out, px + x, py + y, cols[t[y * 8 + x]!]!);
  };
  if (doc.kind === 'screen' && doc.screen) {
    const out = blankImage(256, 240);
    for (let ty = 0; ty < 30; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const a = doc.screen.attributes[(ty >> 2) * 8 + (tx >> 2)]!;
        const pal = (a >> ((((ty >> 1) & 1) << 2) | (((tx >> 1) & 1) << 1))) & 3;
        drawTile(out, doc.screen.nametable[ty * 32 + tx]!, pal, tx * 8, ty * 8);
      }
    }
    return out;
  }
  const map = doc.map ?? { cols: 1, rows: 1, cells: [0] };
  const out = blankImage(map.cols * 16, map.rows * 16);
  const byId = new Map((doc.metatiles ?? []).map((m) => [m.id, m]));
  map.cells.forEach((id, i) => {
    const m = byId.get(id);
    if (!m) return;
    const bx = (i % map.cols) * 16;
    const by = Math.floor(i / map.cols) * 16;
    m.tiles.forEach((t, q) => drawTile(out, t, m.palette, bx + (q & 1) * 8, by + (q >> 1) * 8));
  });
  return out;
}

/** The CHR bank as a 16-tiles-wide sheet in four greys-or-colours (`colors` = 4 NES indices). */
export function renderTileSheet(chr: Uint8Array, offset: number, count: number, colors: readonly number[]): RgbaImage {
  const rows = Math.max(1, Math.ceil(count / 16));
  const out = blankImage(128, rows * 8);
  for (let i = 0; i < count; i++) {
    const t = decodeTile(chr, offset + i * 16);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) paint(out, (i % 16) * 8 + x, Math.floor(i / 16) * 8 + y, colors[t[y * 8 + x]!]!);
  }
  return out;
}
