// Step 6 of the converter (PLAN §6): dedupe 8×8 tiles (with H/V flips for sprites) and merge the
// closest ones (Hamming distance) until the set fits its budget.

export type Tile = Uint8Array; // 64 values 0-3

export const tileKey = (t: Tile) => t.join('');

export function flipH(t: Tile): Tile {
  const o = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) o[y * 8 + x] = t[y * 8 + 7 - x]!;
  return o;
}

export function flipV(t: Tile): Tile {
  const o = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) o[y * 8 + x] = t[(7 - y) * 8 + x]!;
  return o;
}

export function hamming(a: Tile, b: Tile): number {
  let n = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++;
  return n;
}

export interface TileRef {
  tile: number;
  flipH: boolean;
  flipV: boolean;
}

export interface TileSet {
  tiles: Tile[];
  /** For each input tile, where it lives in `tiles`. */
  refs: TileRef[];
  /** Unique tiles before the lossy merge. */
  before: number;
}

/**
 * Dedupe `input`. `reserveBlank` puts the all-zero tile first (BG tile 0). `flips` lets sprites reuse a
 * mirrored tile through the OAM attribute bits. `budget` triggers the lossy merge.
 */
export function buildTileSet(input: Tile[], opts: { flips: boolean; budget: number; reserveBlank: boolean }): TileSet {
  const tiles: Tile[] = [];
  const uses: number[] = [];
  const index = new Map<string, TileRef>();
  const add = (t: Tile): TileRef => {
    const k = tileKey(t);
    const hit = index.get(k);
    if (hit) {
      uses[hit.tile]!++;
      return hit;
    }
    if (opts.flips) {
      const variants: Array<[Tile, boolean, boolean]> = [
        [flipH(t), true, false],
        [flipV(t), false, true],
        [flipV(flipH(t)), true, true],
      ];
      for (const [v, h, vv] of variants) {
        const m = index.get(tileKey(v));
        if (m && !m.flipH && !m.flipV) {
          uses[m.tile]!++;
          const ref = { tile: m.tile, flipH: h, flipV: vv };
          index.set(k, ref);
          return ref;
        }
      }
    }
    tiles.push(t);
    uses.push(1);
    const ref = { tile: tiles.length - 1, flipH: false, flipV: false };
    index.set(k, ref);
    return ref;
  };
  if (opts.reserveBlank) add(new Uint8Array(64));
  const refs = input.map(add);
  if (opts.reserveBlank) uses[0]!--;
  const before = tiles.length;
  if (tiles.length <= opts.budget) return { tiles, refs, before };
  return mergeToBudget(tiles, uses, refs, opts.budget, opts.reserveBlank, before);
}

function mergeToBudget(tiles: Tile[], uses: number[], refs: TileRef[], budget: number, keepFirst: boolean, before: number): TileSet {
  const n = tiles.length;
  // every pair once, closest first (Kruskal-style clustering)
  const pairs: number[] = [];
  const dist = new Uint8Array((n * (n - 1)) / 2);
  let p = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) dist[p++] = hamming(tiles[i]!, tiles[j]!);
  const byDist: number[][] = Array.from({ length: 65 }, () => []);
  p = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) byDist[dist[p++]!]!.push(i * n + j);
  for (const bucket of byDist) pairs.push(...bucket);

  const parent = Array.from({ length: n }, (_, i) => i);
  const weight = uses.slice();
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  let count = n;
  for (const code of pairs) {
    if (count <= budget) break;
    const a = find(Math.floor(code / n));
    const b = find(code % n);
    if (a === b) continue;
    // the more used tile survives; tile 0 (blank) always survives
    let keep = weight[a]! >= weight[b]! ? a : b;
    if (keepFirst && (a === 0 || b === 0)) keep = 0;
    const drop = keep === a ? b : a;
    parent[drop] = keep;
    weight[keep]! += weight[drop]!;
    count--;
  }
  const roots = [...new Set(Array.from({ length: n }, (_, i) => find(i)))].sort((x, y) => x - y);
  const remap = new Map(roots.map((r, i) => [r, i]));
  return {
    tiles: roots.map((r) => tiles[r]!),
    refs: refs.map((r) => ({ tile: remap.get(find(r.tile))!, flipH: r.flipH, flipV: r.flipV })),
    before,
  };
}
