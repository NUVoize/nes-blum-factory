// Step 1 of the converter (PLAN §6): crop, fit into the target size, resample. Pure, RGBA in and out.
import type { RgbaImage } from '../util/png.js';

export type Fit = 'contain' | 'cover' | 'stretch';

export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function cropImage(img: RgbaImage, c: { x: number; y: number; w: number; h: number }): RgbaImage {
  const x0 = Math.min(Math.max(0, c.x), img.width - 1);
  const y0 = Math.min(Math.max(0, c.y), img.height - 1);
  const w = Math.max(1, Math.min(c.w, img.width - x0));
  const h = Math.max(1, Math.min(c.h, img.height - y0));
  const out = blankImage(w, h);
  for (let y = 0; y < h; y++) out.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return out;
}

/**
 * Resample to w×h. Downscaling averages every source pixel under the target pixel (premultiplied alpha,
 * so transparent edges do not darken); upscaling repeats pixels (pixel art stays crisp).
 */
export function resample(img: RgbaImage, w: number, h: number): RgbaImage {
  if (img.width === w && img.height === h) return { width: w, height: h, data: img.data.slice() };
  const out = blankImage(w, h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      if (sx <= 1 && sy <= 1) {
        const si = (Math.min(img.height - 1, Math.floor(y0 + sy / 2)) * img.width + Math.min(img.width - 1, Math.floor(x0 + sx / 2))) * 4;
        out.data.set(img.data.subarray(si, si + 4), (y * w + x) * 4);
        continue;
      }
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const si = (yy * img.width + xx) * 4;
          const al = img.data[si + 3]! / 255;
          r += img.data[si]! * al * wgt;
          g += img.data[si + 1]! * al * wgt;
          b += img.data[si + 2]! * al * wgt;
          a += al * wgt;
          wsum += wgt;
        }
      }
      const di = (y * w + x) * 4;
      if (a > 0) {
        out.data[di] = Math.round(r / a);
        out.data[di + 1] = Math.round(g / a);
        out.data[di + 2] = Math.round(b / a);
      }
      out.data[di + 3] = wsum > 0 ? Math.round((a / wsum) * 255) : 0;
    }
  }
  return out;
}

/** Fit `img` into w×h. `contain` leaves transparent margins, `cover` crops the centre. */
export function fitImage(img: RgbaImage, w: number, h: number, fit: Fit): RgbaImage {
  if (fit === 'stretch') return resample(img, w, h);
  const scale = fit === 'contain' ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
  const rw = Math.max(1, Math.round(img.width * scale));
  const rh = Math.max(1, Math.round(img.height * scale));
  const scaled = resample(img, rw, rh);
  const out = blankImage(w, h);
  const ox = Math.floor((w - rw) / 2);
  const oy = Math.floor((h - rh) / 2);
  for (let y = 0; y < h; y++) {
    const syy = y - oy;
    if (syy < 0 || syy >= rh) continue;
    for (let x = 0; x < w; x++) {
      const sxx = x - ox;
      if (sxx < 0 || sxx >= rw) continue;
      const si = (syy * rw + sxx) * 4;
      out.data.set(scaled.data.subarray(si, si + 4), (y * w + x) * 4);
    }
  }
  return out;
}

/** Shift an image up by `dy` pixels (the 1-px "bob" run frame); the bottom row becomes transparent. */
export function shiftUp(img: RgbaImage, dy: number): RgbaImage {
  const out = blankImage(img.width, img.height);
  out.data.set(img.data.subarray(dy * img.width * 4));
  return out;
}

/** Copy the w×h region at (x, y). */
export function subImage(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  return cropImage(img, { x, y, w, h });
}

/** 3×3 box blur of the colour (alpha kept): quiets photo grain, which would otherwise eat the tile budget. */
export function smoothImage(img: RgbaImage): RgbaImage {
  const out = blankImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const di = (y * img.width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
          const si = (yy * img.width + xx) * 4;
          if (img.data[si + 3]! < 128) continue;
          r += img.data[si]!;
          g += img.data[si + 1]!;
          b += img.data[si + 2]!;
          n++;
        }
      }
      if (n) {
        out.data[di] = Math.round(r / n);
        out.data[di + 1] = Math.round(g / n);
        out.data[di + 2] = Math.round(b / n);
      }
      out.data[di + 3] = img.data[di + 3]!;
    }
  }
  return out;
}
