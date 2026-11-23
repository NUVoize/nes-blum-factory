// Steps 3-4 of the converter (PLAN §6): pick the subpalette of every unit (16×16 BG block or 8×8
// hardware sprite). Locked mode only chooses among the world's subpalettes; free mode computes new ones.
// Written from the nesdev wiki description of the attribute/palette limits (clean-room, PLAN §6).
import { labDist2, NES_BLACK, NES_LAB } from '../nes/palette.js';

export type Triple = [number, number, number];

/** A unit's colours after snapping to the master palette: NES index -> pixel count. */
export type Histogram = Map<number, number>;

const D = (a: number, b: number) => labDist2(NES_LAB[a]!, NES_LAB[b]!);

/** Cost of drawing `hist` with `colors` (squared OKLab distance × pixels). */
export function histError(hist: Histogram, colors: readonly number[]): number {
  let e = 0;
  for (const [c, w] of hist) {
    let best = Infinity;
    for (const p of colors) {
      const d = D(c, p);
      if (d < best) best = d;
    }
    e += best * w;
  }
  return e;
}

const withBackdrop = (p: readonly number[], backdrop: number | null) => (backdrop === null ? p : [backdrop, ...p]);

/** Best palette index for each unit among `palettes` (locked mode, and the assignment step of free mode). */
export function assignUnits(units: Histogram[], palettes: readonly (readonly number[])[], backdrop: number | null): { assign: number[]; error: number } {
  let error = 0;
  const assign = units.map((h) => {
    let best = 0;
    let bestE = Infinity;
    palettes.forEach((p, i) => {
      const e = histError(h, withBackdrop(p, backdrop));
      if (e < bestE - 1e-12) {
        bestE = e;
        best = i;
      }
    });
    error += bestE;
    return best;
  });
  return { assign, error };
}

function merged(units: Histogram[], idx: number[]): Histogram {
  const out: Histogram = new Map();
  for (const i of idx) for (const [c, w] of units[i]!) out.set(c, (out.get(c) ?? 0) + w);
  return out;
}

/** Greedy choice of up to 3 colours minimising the error of `hist` (backdrop always available). */
export function bestColors(hist: Histogram, backdrop: number | null): number[] {
  const cands = [...hist.entries()]
    .filter(([c]) => c !== backdrop)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 16)
    .map(([c]) => c);
  const chosen: number[] = [];
  while (chosen.length < 3 && chosen.length < cands.length) {
    let best = -1;
    let bestE = Infinity;
    for (const c of cands) {
      if (chosen.includes(c)) continue;
      const e = histError(hist, withBackdrop([...chosen, c], backdrop));
      if (e < bestE - 1e-12) {
        bestE = e;
        best = c;
      }
    }
    if (best < 0) break;
    chosen.push(best);
  }
  return chosen;
}

export function padTriple(colors: readonly number[]): Triple {
  const out = colors.slice(0, 3);
  while (out.length < 3) out.push(NES_BLACK);
  return out as Triple;
}

/**
 * Free mode: compute `k` new subpalettes (≤ 3 colours each). `fixed` subpalettes already exist (the
 * HUD's BG subpalette 0) and units may use them; they come first in the returned assignment indices.
 */
export function solveFree(units: Histogram[], k: number, backdrop: number | null, fixed: readonly Triple[] = []): { palettes: Triple[]; assign: number[]; error: number } {
  const order = units.map((h, i) => ({ i, w: [...h.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.w - a.w || a.i - b.i);
  const sets: number[][] = [];
  for (const { i } of order) {
    const top = [...units[i]!.entries()]
      .filter(([c]) => c !== backdrop)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3)
      .map(([c]) => c);
    if (top.length === 0) continue;
    if (sets.some((s) => top.every((c) => s.includes(c)))) continue;
    let bestS = -1;
    let bestGrow = Infinity;
    sets.forEach((s, si) => {
      const union = new Set([...s, ...top]);
      if (union.size <= 3 && union.size - s.length < bestGrow) {
        bestGrow = union.size - s.length;
        bestS = si;
      }
    });
    if (bestS >= 0) sets[bestS] = [...new Set([...sets[bestS]!, ...top])];
    else if (sets.length < k) sets.push(top);
  }
  while (sets.length < k) sets.push([]);

  let palettes = sets.map((s) => [...s]);
  for (let iter = 0; iter < 6; iter++) {
    const all = [...fixed.map((f) => [...f]), ...palettes];
    const assign = assignUnits(units, all, backdrop).assign;
    const next = palettes.map((_, pi) => {
      const members = assign.flatMap((a, ui) => (a === fixed.length + pi ? [ui] : []));
      if (members.length === 0) return palettes[pi]!;
      return bestColors(merged(units, members), backdrop);
    });
    // a free palette nobody uses takes the worst-served unit's colours
    next.forEach((p, pi) => {
      if (assign.includes(fixed.length + pi) || units.length === 0) return;
      let worst = -1;
      let worstE = -1;
      units.forEach((h, ui) => {
        const e = histError(h, withBackdrop(all[assign[ui]!]!, backdrop));
        if (e > worstE) {
          worstE = e;
          worst = ui;
        }
      });
      if (worst >= 0 && worstE > 0) next[pi] = bestColors(units[worst]!, backdrop);
      else next[pi] = p;
    });
    const same = JSON.stringify(next) === JSON.stringify(palettes);
    palettes = next;
    if (same) break;
  }
  const final = [...fixed.map((f) => [...f]), ...palettes];
  const r = assignUnits(units, final, backdrop);
  return { palettes: palettes.map(padTriple), assign: r.assign, error: r.error };
}

/** Free mode backdrop (BG): try the most frequent colours, keep the one that leaves the least error. */
export function chooseBackdrop(units: Histogram[], k: number, fixed: readonly Triple[]): number {
  const total: Histogram = new Map();
  for (const h of units) for (const [c, w] of h) total.set(c, (total.get(c) ?? 0) + w);
  const cands = [...total.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([c]) => c);
  if (cands.length === 0) return NES_BLACK;
  let best = cands[0]!;
  let bestE = Infinity;
  for (const c of cands) {
    const e = solveFree(units, k, c, fixed).error;
    if (e < bestE - 1e-12) {
      bestE = e;
      best = c;
    }
  }
  return best;
}
