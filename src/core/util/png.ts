// Minimal RGBA PNG encoder (screenshots of emulator frames, converter previews). fflate for zlib.
import { unzlibSync, zlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** rgba: width*height*4 bytes. `scale` repeats pixels (nearest neighbour). */
export function encodePng(rgba: Uint8Array, width: number, height: number, scale = 1): Uint8Array {
  const w = width * scale;
  const h = height * scale;
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / scale);
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const si = (sy * width + Math.floor(x / scale)) * 4;
      raw.set(rgba.subarray(si, si + 4), row + 1 + x * 4);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface RgbaImage {
  width: number;
  height: number;
  /** width*height*4 bytes, straight alpha. */
  data: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * PNG decoder for what the app meets: 8-bit grey / grey+alpha / RGB / RGBA, indexed 1/2/4/8-bit with
 * tRNS, 16-bit channels (high byte kept). Interlaced files are refused with a French message.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((v, i) => bytes[i] !== v)) throw new Error('ce fichier n’est pas une image PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let ctype = 0;
  let interlace = 0;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(o + 8);
      height = dv.getUint32(o + 12);
      depth = bytes[o + 16]!;
      ctype = bytes[o + 17]!;
      interlace = bytes[o + 20]!;
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!width || !height) throw new Error('image PNG sans en-tête');
  if (width * height > 4096 * 4096) throw new Error('image trop grande (max 4096 × 4096)');
  if (interlace) throw new Error('image PNG entrelacée : enregistre-la sans entrelacement');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!channels) throw new Error(`type de PNG inconnu (${ctype})`);
  const total = idat.reduce((n, d) => n + d.length, 0);
  const z = new Uint8Array(total);
  let zo = 0;
  for (const d of idat) (z.set(d, zo), (zo += d.length));
  const raw = unzlibSync(z);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const ro = y * (stride + 1);
    const f = raw[ro]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[ro + 1 + i]!;
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 0xff;
    }
    for (let xPix = 0; xPix < width; xPix++) {
      const di = (y * width + xPix) * 4;
      const sample = (ch: number): number => {
        if (depth === 8) return cur[xPix * channels + ch]!;
        if (depth === 16) return cur[(xPix * channels + ch) * 2]!;
        const bitPos = (xPix * channels + ch) * depth;
        return (cur[bitPos >> 3]! >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1);
      };
      if (ctype === 3) {
        const idx = sample(0);
        out[di] = plte?.[idx * 3] ?? 0;
        out[di + 1] = plte?.[idx * 3 + 1] ?? 0;
        out[di + 2] = plte?.[idx * 3 + 2] ?? 0;
        out[di + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      } else {
        const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
        if (ctype === 0 || ctype === 4) {
          const g = Math.round(sample(0) * scale);
          out[di] = out[di + 1] = out[di + 2] = g;
          out[di + 3] = ctype === 4 ? sample(1) : 255;
        } else {
          out[di] = sample(0);
          out[di + 1] = sample(1);
          out[di + 2] = sample(2);
          out[di + 3] = ctype === 6 ? sample(3) : 255;
        }
      }
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}
