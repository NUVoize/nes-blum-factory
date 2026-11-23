// How far "what the NES shows" is from the dropped image (W1 P1-2). In locked mode a colour the world
// palette does not carry snaps to another hue (an orange hero turns pink). Any 3-colour slot loses
// something, so the hint compares locked mode with what new palettes would give for the same image.
// Compared on small blocks in linear light, so dithering averages out.
import { rgbToOklab } from '../nes/palette.js';
import type { RgbaImage } from '../util/png.js';

const BLOCK = 4;
/** OKLab distance above which a block reads as a different colour (a hue change, not a shade). */
const BLOCK_MISS = 0.1;
/** How much more of the picture locked mode must miss than new palettes before CHROMA suggests them. */
export const COLOUR_MISS_HINT = 0.2;

/** True when « Nouvelles palettes » would show the image clearly closer than the world's palette. */
export function suggestNewPalettes(r: { colourMiss: number; freeColourMiss: number | null }): boolean {
  return r.freeColourMiss !== null && r.colourMiss - r.freeColourMiss > COLOUR_MISS_HINT;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const LIN = Float64Array.from({ length: 256 }, (_, i) => toLinear(i));
const toByte = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

/** Mean colour of the opaque pixels of one block, or null when the block is transparent. */
function blockMean(img: RgbaImage, bx: number, by: number): { lab: readonly [number, number, number]; n: number } | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = by; y < Math.min(by + BLOCK, img.height); y++) {
    for (let x = bx; x < Math.min(bx + BLOCK, img.width); x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3]! < 128) continue;
      r += LIN[img.data[i]!]!;
      g += LIN[img.data[i + 1]!]!;
      b += LIN[img.data[i + 2]!]!;
      n++;
    }
  }
  return n ? { lab: rgbToOklab(toByte(r / n), toByte(g / n), toByte(b / n)), n } : null;
}

/** Share (0..1) of the opaque "before" picture whose colour the "after" picture misses. */
export function colourMiss(before: RgbaImage, after: RgbaImage): number {
  if (before.width !== after.width || before.height !== after.height) return 0;
  let total = 0;
  let missed = 0;
  for (let by = 0; by < before.height; by += BLOCK) {
    for (let bx = 0; bx < before.width; bx += BLOCK) {
      const a = blockMean(before, bx, by);
      if (!a) continue;
      total += a.n;
      const b = blockMean(after, bx, by);
      const d = b ? Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2]) : Infinity;
      if (d > BLOCK_MISS) missed += a.n;
    }
  }
  return total ? missed / total : 0;
}
