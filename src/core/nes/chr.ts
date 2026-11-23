// NES CHR codec: 8×8 tiles, 2 bits per pixel, 16 bytes per tile (plane 0 then plane 1, MSB = left).

export const TILE_BYTES = 16;

/** pixels: 64 values 0-3, row-major. */
export function encodeTile(pixels: ArrayLike<number>): Uint8Array {
  if (pixels.length !== 64) throw new Error(`a tile has 64 pixels, got ${pixels.length}`);
  const out = new Uint8Array(TILE_BYTES);
  for (let y = 0; y < 8; y++) {
    let lo = 0;
    let hi = 0;
    for (let x = 0; x < 8; x++) {
      const v = pixels[y * 8 + x]!;
      if (v < 0 || v > 3 || !Number.isInteger(v)) throw new Error(`pixel value ${v} out of 0-3`);
      lo |= (v & 1) << (7 - x);
      hi |= ((v >> 1) & 1) << (7 - x);
    }
    out[y] = lo;
    out[y + 8] = hi;
  }
  return out;
}

export function decodeTile(bytes: ArrayLike<number>, offset = 0): Uint8Array {
  const out = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const lo = bytes[offset + y]!;
    const hi = bytes[offset + y + 8]!;
    for (let x = 0; x < 8; x++) out[y * 8 + x] = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
  }
  return out;
}

export function flipTileH(pixels: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = pixels[y * 8 + 7 - x]!;
  return out;
}

/** Pixel art rows (chars '0'-'3', '.' = 0) -> pixel array w×h. */
export function parseArt(rows: readonly string[], w: number, h: number): Uint8Array {
  if (rows.length !== h) throw new Error(`art has ${rows.length} rows, want ${h}`);
  const out = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`art row ${y} has ${row.length} columns, want ${w}: "${row}"`);
    for (let x = 0; x < w; x++) {
      const c = row[x]!;
      out[y * w + x] = c === '.' ? 0 : Number(c);
    }
  });
  return out;
}

/** Cut a w×h pixel image (multiples of 8) into tiles, row-major. */
export function sliceTiles(pixels: ArrayLike<number>, w: number, h: number): Uint8Array[] {
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < h / 8; ty++) {
    for (let tx = 0; tx < w / 8; tx++) {
      const t = new Uint8Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = pixels[(ty * 8 + y) * w + tx * 8 + x]!;
      tiles.push(t);
    }
  }
  return tiles;
}

/**
 * A tile bank under construction: dedupes identical tiles, returns indices.
 * `capacity` = 64 (1 KiB), 128 (2 KiB) or 256 (4 KiB).
 */
export class TileBank {
  private readonly tiles: Uint8Array[] = [];
  private readonly index = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly capacity: number,
  ) {}

  add(pixels: Uint8Array): number {
    const key = Array.from(pixels).join('');
    const found = this.index.get(key);
    if (found !== undefined) return found;
    if (this.tiles.length >= this.capacity) throw new Error(`banque CHR « ${this.name} » pleine (${this.capacity} tuiles)`);
    this.tiles.push(pixels);
    this.index.set(key, this.tiles.length - 1);
    return this.tiles.length - 1;
  }

  /** Put a tile at a fixed index (font layout); the slot must be free or identical. */
  put(at: number, pixels: Uint8Array): void {
    while (this.tiles.length < at) this.tiles.push(new Uint8Array(64));
    if (at < this.tiles.length) this.tiles[at] = pixels;
    else this.tiles.push(pixels);
    this.index.set(Array.from(pixels).join(''), at);
  }

  get count(): number {
    return this.tiles.length;
  }

  /** CHR bytes padded to the full capacity. */
  bytes(): Uint8Array {
    const out = new Uint8Array(this.capacity * TILE_BYTES);
    this.tiles.forEach((t, i) => out.set(encodeTile(t), i * TILE_BYTES));
    return out;
  }
}
