// Image -> real NES graphics (PLAN §6, steps 1-8). Deterministic and pure: the same image and settings
// always give the same CHR bytes, JSON and preview. CHROMA (the AI) only chooses the settings.
// Clean-room: written from the nesdev wiki (PPU palettes, attribute tables, OAM) and PLAN §6; NesTiler's
// source is never opened.
import { DEFAULT_FEATURES, type FeatureFlags } from '../features.js';
import { encodeTile } from '../nes/chr.js';
import { labDist2, NES_LAB, NES_RGB, nearestNes, paletteDist2, rgbToOklab, type Lab } from '../nes/palette.js';
import {
  animationOf,
  BG_SET_TILES,
  FRAME_SIZES,
  MAX_SPRITES_PER_FRAME,
  MAX_SPRITES_PER_LINE,
  PLAYER_BANK_GROUPS,
  ROLE_SPRITE_SLOTS,
  SPRITE_BANK_TILES,
  type ConvertSettings,
  type FrameDoc,
  type GraphicsBudget,
  type GraphicsDoc,
} from '../schema/graphics.js';
import type { Palettes } from '../schema/misc.js';
import type { RgbaImage } from '../util/png.js';
import { blankImage, cropImage, fitImage, shiftUp, smoothImage, subImage } from './image.js';
import { assignUnits, chooseBackdrop, solveFree, type Histogram, type Triple } from './solve.js';
import { buildTileSet, type Tile } from './tiles.js';

export type PaletteSet = Palettes['sets'][number];
type Msg = { fr: string; en: string };

export interface ConvertInput {
  image: RgbaImage;
  settings: ConvertSettings;
  id: string;
  name: string;
  /** The world's palette set: the source of truth in locked mode; free mode keeps its HUD subpalette 0. */
  paletteSet: PaletteSet | null;
  flags?: FeatureFlags;
}

export interface ConvertOutput {
  ok: boolean;
  errors: Msg[];
  doc: GraphicsDoc | null;
  chr: Uint8Array;
  /** The image after crop + fit, before any NES rule (left side of the before/after). */
  before: RgbaImage;
  /** Exactly what the NES shows: rebuilt from the final tiles, palettes and sprites. */
  after: RgbaImage;
  /** Free mode: the world's palette set with the new subpalettes (to propose with the graphic). */
  proposedSet: PaletteSet | null;
}

/** Largest OKLab distance between two colours the ordered dither still mixes. */
const MAX_DITHER_GAP = 0.3;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function fail(errors: Msg[], before?: RgbaImage): ConvertOutput {
  const empty = blankImage(8, 8);
  return { ok: false, errors, doc: null, chr: new Uint8Array(0), before: before ?? empty, after: empty, proposedSet: null };
}

/** Settings sanity and target size per kind. */
export function settingsProblems(s: ConvertSettings, flags: FeatureFlags = DEFAULT_FEATURES): Msg[] {
  const out: Msg[] = [];
  if (s.dither === 'diffusion' && !flags.errorDiffusion) out.push({ fr: 'le tramage par diffusion n’est pas encore disponible', en: 'error-diffusion dithering is not available yet' });
  if (s.kind === 'screen' && (s.width !== 256 || s.height !== 240)) out.push({ fr: 'un écran fait 256 × 240 pixels', en: 'a screen is 256 × 240 pixels' });
  if (s.kind === 'tileset' && (s.width % 16 || s.height % 16)) out.push({ fr: 'une planche de tuiles se mesure en blocs de 16 pixels', en: 'a tile sheet is measured in 16-pixel blocks' });
  if (s.kind === 'tileset' && (s.width / 16) * (s.height / 16) > 127) out.push({ fr: 'planche trop grande : 127 blocs de 16 × 16 au plus', en: 'sheet too big: 127 blocks of 16 × 16 at most' });
  if ((s.kind === 'sprite') !== (s.role !== 'background')) out.push({ fr: 'ce rôle ne va pas avec ce genre d’image', en: 'this role does not fit this kind of image' });
  if (s.kind === 'sprite') {
    const f = s.frame;
    if (!f || !FRAME_SIZES.some(([w, h]) => w === f.w && h === f.h)) {
      out.push({ fr: `taille d’image de sprite refusée (${f ? `${f.w} × ${f.h}` : 'aucune'}) : 16 × 16, 16 × 24, 16 × 32, 24 × 32 ou 32 × 32`, en: 'sprite frame size refused' });
    } else if (s.autoFrames) {
      if (s.width !== f.w || s.height !== f.h) out.push({ fr: 'images automatiques : la cible a la taille d’une image', en: 'automatic frames: the target is one frame' });
      if (s.role !== 'player') out.push({ fr: 'les images automatiques sont pour le héros', en: 'automatic frames are for the hero' });
    } else if (s.width % f.w || s.height % f.h) {
      out.push({ fr: 'la planche doit contenir un nombre entier d’images', en: 'the sheet must hold a whole number of frames' });
    } else if ((s.width / f.w) * (s.height / f.h) > 32) out.push({ fr: '32 images au plus par planche', en: '32 frames at most per sheet' });
  }
  return out;
}

interface Prepared {
  w: number;
  h: number;
  lab: Lab[];
  snapped: Int16Array; // NES index, -1 = transparent
}

/** Steps 1-2: pixels to OKLab + nearest master palette colour, transparency for sprites. */
function prepare(img: RgbaImage, sprite: boolean): Prepared {
  const n = img.width * img.height;
  const lab: Lab[] = new Array(n);
  const snapped = new Int16Array(n);
  const cache = new Map<number, number>();
  let anyTransparent = false;
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3]! < 128) anyTransparent = true;
  // an opaque sprite image: its top-left colour is the transparent key
  let key: Lab | null = null;
  if (sprite && !anyTransparent) key = rgbToOklab(img.data[0]!, img.data[1]!, img.data[2]!);
  for (let i = 0; i < n; i++) {
    const r = img.data[i * 4]!;
    const g = img.data[i * 4 + 1]!;
    const b = img.data[i * 4 + 2]!;
    const l = rgbToOklab(r, g, b);
    lab[i] = l;
    if (img.data[i * 4 + 3]! < 128 || (key && labDist2(l, key) < 0.0016)) {
      snapped[i] = -1;
      continue;
    }
    const k = (r << 16) | (g << 8) | b;
    let c = cache.get(k);
    if (c === undefined) {
      c = nearestNes(l);
      cache.set(k, c);
    }
    snapped[i] = c;
  }
  return { w: img.width, h: img.height, lab, snapped };
}

function histogram(p: Prepared, x0: number, y0: number, w: number, h: number): Histogram {
  const hist: Histogram = new Map();
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const c = p.snapped[y * p.w + x]!;
      if (c >= 0) hist.set(c, (hist.get(c) ?? 0) + 1);
    }
  }
  return hist;
}

/**
 * Step 5: one pixel to a palette position. `colors[0]` is the backdrop (BG) or unused (sprites, where 0 is
 * transparent). Ordered Bayer dither mixes the two nearest colours in proportion.
 */
function pickValue(l: Lab, colors: readonly number[], first: number, x: number, y: number, strength: number): number {
  let i1 = first;
  let i2 = -1;
  let d1 = Infinity;
  let d2 = Infinity;
  for (let i = first; i < colors.length; i++) {
    const d = paletteDist2(l, NES_LAB[colors[i]!]!);
    if (d < d1) {
      i2 = i1;
      d2 = d1;
      i1 = i;
      d1 = d;
    } else if (d < d2) {
      i2 = i;
      d2 = d;
    }
  }
  if (strength <= 0 || i2 < 0 || i2 === i1) return i1;
  const p1 = NES_LAB[colors[i1]!]!;
  const p2 = NES_LAB[colors[i2]!]!;
  const v = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
  const vv = v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!;
  // colours far apart (sky and black) are never mixed: the dots would read as noise, not as a shade
  if (vv < 1e-9 || vv > MAX_DITHER_GAP * MAX_DITHER_GAP) return i1;
  const t = Math.min(1, Math.max(0, ((l[0] - p1[0]) * v[0]! + (l[1] - p1[1]) * v[1]! + (l[2] - p1[2]) * v[2]!) / vv));
  // mix only when the mixture really is closer to the pixel than the nearest colour alone (orange is not
  // "between" pink and green, so it is never drawn as pink and green dots)
  const mix: Lab = [p1[0] + v[0]! * t, p1[1] + v[1]! * t, p1[2] + v[2]! * t];
  if (paletteDist2(l, mix) > 0.5 * d1) return i1;
  return t * strength > BAYER4[(y & 3) * 4 + (x & 3)]! ? i2 : i1;
}

function tileAt(values: Uint8Array, w: number, tx: number, ty: number): Tile {
  const t = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = values[(ty * 8 + y) * w + tx * 8 + x]!;
  return t;
}

function paint(out: RgbaImage, px: number, py: number, nes: number, alpha = 255): void {
  if (px < 0 || py < 0 || px >= out.width || py >= out.height) return;
  const i = (py * out.width + px) * 4;
  const [r, g, b] = NES_RGB[nes]!;
  out.data[i] = r;
  out.data[i + 1] = g;
  out.data[i + 2] = b;
  out.data[i + 3] = alpha;
}

function countColors(img: RgbaImage): number {
  const set = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]! >= 128) set.add((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!);
  return set.size;
}

export function convertImage(input: ConvertInput): ConvertOutput {
  const s = input.settings;
  const flags = input.flags ?? DEFAULT_FEATURES;
  const problems = settingsProblems(s, flags);
  if (problems.length) return fail(problems);
  const set = input.paletteSet;
  if (s.mode === 'locked' && (!set || set.bg.length < 4 || set.sprites.length < 4)) {
    return fail([{ fr: `le monde « ${s.world} » n’a pas encore ses 4 + 4 palettes : convertis d’abord en mode libre`, en: `world "${s.world}" has no full palette set yet: convert in free mode first` }]);
  }
  const src = s.crop ? cropImage(input.image, s.crop) : input.image;
  const fitted = fitImage(src, s.width, s.height, s.fit);
  const target = s.smooth ? smoothImage(fitted) : fitted;
  return s.kind === 'sprite' ? convertSprites(input, target) : convertBackground(input, target);
}

// ---------- backgrounds: screen and tileset ----------

function convertBackground(input: ConvertInput, img: RgbaImage): ConvertOutput {
  const s = input.settings;
  const set = input.paletteSet;
  const p = prepare(img, false);
  const bw = s.width / 16;
  const bh = Math.ceil(s.height / 16);
  const units: Histogram[] = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) units.push(histogram(p, bx * 16, by * 16, 16, Math.min(16, s.height - by * 16)));

  let backdrop: number;
  let pals: Triple[];
  let assign: number[];
  let proposedSet: PaletteSet | null = null;
  if (s.mode === 'locked') {
    backdrop = set!.backdrop;
    pals = set!.bg.slice(0, 4) as Triple[];
    assign = assignUnits(units, pals, backdrop).assign;
  } else {
    const fixed: Triple[] = set?.bg[0] ? [set.bg[0] as Triple] : [];
    const k = 4 - fixed.length;
    backdrop = chooseBackdrop(units, k, fixed);
    const r = solveFree(units, k, backdrop, fixed);
    pals = [...fixed, ...r.palettes];
    assign = r.assign;
    proposedSet = {
      id: s.world,
      backdrop,
      bg: pals.map((x) => [...x] as Triple),
      sprites: set?.sprites.map((x) => [...x] as Triple) ?? [
        [0x0f, 0x16, 0x36],
        [0x0f, 0x28, 0x30],
        [0x0f, 0x14, 0x24],
        [0x0f, 0x11, 0x21],
      ],
    };
  }

  // step 5: palette positions
  const strength = s.dither === 'none' ? 0 : s.ditherStrength / 100;
  const values = new Uint8Array(s.width * bh * 16);
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const i = y * p.w + x;
      if (p.snapped[i]! < 0) continue;
      const pal = pals[assign[Math.floor(y / 16) * bw + Math.floor(x / 16)]!]!;
      values[y * s.width + x] = pickValue(p.lab[i]!, [backdrop, ...pal], 0, x, y, strength);
    }
  }

  // step 6: tiles
  const tw = s.width / 8;
  const th = Math.ceil(s.height / 8);
  const raw: Tile[] = [];
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) raw.push(tileAt(values, s.width, tx, ty));
  const budgetTiles = Math.min(BG_SET_TILES, s.maxTiles ?? BG_SET_TILES);
  const ts = buildTileSet(raw, { flips: false, budget: budgetTiles, reserveBlank: true });
  const chr = new Uint8Array(4096);
  ts.tiles.forEach((t, i) => chr.set(encodeTile(t), i * 16));

  const errors: Msg[] = [];
  const warnings: Msg[] = [];
  if (ts.before > ts.tiles.length) {
    warnings.push({
      fr: `${ts.before} tuiles différentes : ${ts.before - ts.tiles.length} fusionnées avec leur plus proche voisine pour tenir dans ${budgetTiles}`,
      en: `${ts.before} different tiles: ${ts.before - ts.tiles.length} merged into their closest neighbour to fit ${budgetTiles}`,
    });
  }

  // step 8: layout per kind + the "after" image from the final tiles
  const after = blankImage(s.width, s.height);
  const tileIdx = (tx: number, ty: number) => ts.refs[ty * tw + tx]!.tile;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const t = ts.tiles[tileIdx(tx, ty)]!;
      const pal = pals[assign[Math.floor(ty / 2) * bw + Math.floor(tx / 2)]!]!;
      const cols = [backdrop, ...pal];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) paint(after, tx * 8 + x, ty * 8 + y, cols[t[y * 8 + x]!]!);
    }
  }

  let metatiles: GraphicsDoc['metatiles'];
  let map: GraphicsDoc['map'];
  let screen: GraphicsDoc['screen'];
  if (s.kind === 'tileset') {
    const mt: NonNullable<GraphicsDoc['metatiles']> = [{ id: 0, tiles: [0, 0, 0, 0], palette: 0 }];
    const keyOf = (q: number[], pal: number) => `${q.join(',')}|${pal}`;
    const ids = new Map<string, number>([[keyOf([0, 0, 0, 0], 0), 0]]);
    const cells: number[] = [];
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const q = [tileIdx(bx * 2, by * 2), tileIdx(bx * 2 + 1, by * 2), tileIdx(bx * 2, by * 2 + 1), tileIdx(bx * 2 + 1, by * 2 + 1)];
        const pal = q.every((v) => v === 0) ? 0 : assign[by * bw + bx]!;
        const k = keyOf(q, pal);
        let id = ids.get(k);
        if (id === undefined) {
          id = mt.length;
          ids.set(k, id);
          mt.push({ id, tiles: q as [number, number, number, number], palette: pal });
        }
        cells.push(id);
      }
    }
    if (mt.length > 128) errors.push({ fr: `${mt.length} métatuiles différentes (max 128) : simplifie l’image`, en: `${mt.length} different metatiles (max 128): simplify the image` });
    metatiles = mt;
    map = { cols: bw, rows: bh, cells };
  } else {
    const nametable: number[] = [];
    for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++) nametable.push(tileIdx(tx, ty));
    const attributes: number[] = [];
    for (let ay = 0; ay < 8; ay++) {
      for (let ax = 0; ax < 8; ax++) {
        const at = (bx: number, by: number) => (by < bh && bx < bw ? assign[by * bw + bx]! : 0);
        attributes.push(at(ax * 2, ay * 2) | (at(ax * 2 + 1, ay * 2) << 2) | (at(ax * 2, ay * 2 + 1) << 4) | (at(ax * 2 + 1, ay * 2 + 1) << 6));
      }
    }
    screen = { nametable, attributes };
  }

  const used = [...new Set(assign)].sort();
  const budget: GraphicsBudget = {
    colors: countColors(after),
    subpalettes: used.length,
    tiles: ts.tiles.length,
    tilesBeforeMerge: ts.before,
    tileCapacity: budgetTiles,
    merged: ts.before - ts.tiles.length,
    ...(metatiles ? { metatiles: metatiles.length } : {}),
    sprites: 0,
    maxPerLine: 0,
    banks: [{ index: 0, tiles: ts.tiles.length, capacity: BG_SET_TILES }],
    warnings,
  };
  const doc: GraphicsDoc = {
    schemaVersion: 1,
    format: 'nbf-graphics',
    id: input.id,
    name: input.name,
    kind: s.kind,
    role: 'background',
    source: `graphics/sources/${input.id}.png`,
    preview: `graphics/${input.id}.png`,
    chr: `graphics/${input.id}.chr`,
    bankSize: 4096,
    settings: s,
    palettes: { world: s.world, mode: s.mode, backdrop, slots: used.map((slot) => ({ slot, colors: [...pals[slot]!] as Triple })) },
    ...(metatiles ? { metatiles, map } : {}),
    ...(screen ? { screen } : {}),
    budget,
  };
  return { ok: errors.length === 0, errors, doc, chr, before: img, after, proposedSet };
}

// ---------- sprites: metasprite frames ----------

interface FrameCut {
  name: string;
  img: RgbaImage;
}

function cutFrames(s: ConvertSettings, img: RgbaImage): FrameCut[] {
  const f = s.frame!;
  if (s.autoFrames) {
    return [
      { name: 'idle', img },
      { name: 'run1', img: shiftUp(img, 1) },
      { name: 'run2', img },
      { name: 'jump', img },
    ];
  }
  const cols = s.width / f.w;
  const rows = s.height / f.h;
  const out: FrameCut[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const sub = subImage(img, c * f.w, r * f.h, f.w, f.h);
      let empty = true;
      for (let k = 3; k < sub.data.length; k += 4) if (sub.data[k]! >= 128) empty = false;
      if (empty && i > 0) continue;
      out.push({ name: s.frameNames?.[i] ?? `frame-${i + 1}`, img: sub });
    }
  }
  return out;
}

/** Player frames -> banks: one animation per bank, floor groups first (PLAN §5.4). */
export function playerBanks(names: string[], tilesPerAnim: Map<string, number>): Map<string, number> {
  const bankOf = new Map<string, number>();
  const fill = [0, 0, 0, 0];
  const anims = [...new Set(names.map(animationOf))];
  for (const a of anims) {
    const want = PLAYER_BANK_GROUPS[a];
    if (want !== undefined) {
      bankOf.set(a, want);
      fill[want]! += tilesPerAnim.get(a) ?? 0;
    }
  }
  for (const a of anims) {
    if (bankOf.has(a)) continue;
    const need = tilesPerAnim.get(a) ?? 0;
    let b = [2, 3, 0, 1].find((x) => fill[x]! + need <= SPRITE_BANK_TILES);
    if (b === undefined) b = fill.indexOf(Math.min(...fill));
    bankOf.set(a, b);
    fill[b]! += need;
  }
  return bankOf;
}

function convertSprites(input: ConvertInput, img: RgbaImage): ConvertOutput {
  const s = input.settings;
  const set = input.paletteSet;
  const role = s.role as Exclude<typeof s.role, 'background'>;
  const slots = ROLE_SPRITE_SLOTS[role];
  const f = s.frame!;
  const frames = cutFrames(s, img);
  const prepared = frames.map((fr) => prepare(fr.img, true));
  // units: 8×8 cells of every frame
  const units: Histogram[] = [];
  const unitOf: Array<{ frame: number; cx: number; cy: number }> = [];
  prepared.forEach((p, fi) => {
    for (let cy = 0; cy < f.h / 8; cy++) {
      for (let cx = 0; cx < f.w / 8; cx++) {
        const h = histogram(p, cx * 8, cy * 8, 8, 8);
        if (h.size === 0) continue;
        units.push(h);
        unitOf.push({ frame: fi, cx, cy });
      }
    }
  });
  if (units.length === 0) return fail([{ fr: 'l’image est entièrement transparente', en: 'the image is fully transparent' }], img);

  let pals: Triple[];
  let assign: number[];
  let proposedSet: PaletteSet | null = null;
  if (s.mode === 'locked') {
    pals = slots.map((sl) => set!.sprites[sl] as Triple);
    assign = assignUnits(units, pals, null).assign;
  } else {
    const r = solveFree(units, slots.length, null);
    pals = r.palettes;
    assign = r.assign;
    if (set) {
      const sprites = set.sprites.map((x) => [...x] as Triple);
      slots.forEach((sl, i) => (sprites[sl] = [...pals[i]!] as Triple));
      proposedSet = { ...set, bg: set.bg.map((x) => [...x] as Triple), sprites };
    }
  }

  // step 5 + 6: values per cell, tiles per frame
  const strength = s.dither === 'none' ? 0 : s.ditherStrength / 100;
  const cellTiles: Tile[] = [];
  const cellPal: number[] = [];
  units.forEach((_, ui) => {
    const { frame, cx, cy } = unitOf[ui]!;
    const p = prepared[frame]!;
    const pal = pals[assign[ui]!]!;
    const t = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (cy * 8 + y) * p.w + cx * 8 + x;
        if (p.snapped[i]! < 0) continue;
        t[y * 8 + x] = pickValue(p.lab[i]!, [0, ...pal], 1, cx * 8 + x, cy * 8 + y, strength);
      }
    }
    cellTiles.push(t);
    cellPal.push(slots[assign[ui]!]!);
  });

  // bank per frame
  const names = frames.map((fr) => fr.name);
  const bankOfFrame: number[] = [];
  if (role === 'player') {
    const perAnim = new Map<string, number>();
    unitOf.forEach((u) => {
      const a = animationOf(names[u.frame]!);
      perAnim.set(a, (perAnim.get(a) ?? 0) + 1);
    });
    const banks = playerBanks(names, perAnim);
    names.forEach((n) => bankOfFrame.push(banks.get(animationOf(n))!));
  } else names.forEach(() => bankOfFrame.push(0));

  const bankCount = Math.max(...bankOfFrame) + 1;
  const warnings: Msg[] = [];
  const errors: Msg[] = [];
  const chr = new Uint8Array(bankCount * 1024);
  const bankInfo: GraphicsBudget['banks'] = [];
  const refOfUnit = new Array<{ tile: number; flipH: boolean; flipV: boolean }>(units.length);
  const bankTiles: Tile[][] = [];
  let before = 0;
  for (let b = 0; b < bankCount; b++) {
    const idx = units.map((_, ui) => ui).filter((ui) => bankOfFrame[unitOf[ui]!.frame] === b);
    const capacity = Math.min(SPRITE_BANK_TILES, s.maxTiles ?? SPRITE_BANK_TILES);
    const ts = buildTileSet(
      idx.map((ui) => cellTiles[ui]!),
      { flips: true, budget: capacity, reserveBlank: false },
    );
    before += ts.before;
    idx.forEach((ui, k) => (refOfUnit[ui] = ts.refs[k]!));
    ts.tiles.forEach((t, i) => chr.set(encodeTile(t), b * 1024 + i * 16));
    bankTiles.push(ts.tiles);
    bankInfo.push({ index: b, tiles: ts.tiles.length, capacity: SPRITE_BANK_TILES });
    if (ts.before > ts.tiles.length) {
      warnings.push({
        fr: `banque ${b} : ${ts.before} tuiles, ${ts.before - ts.tiles.length} fusionnées pour tenir dans ${capacity}`,
        en: `bank ${b}: ${ts.before} tiles, ${ts.before - ts.tiles.length} merged to fit ${capacity}`,
      });
    }
  }

  // step 7: metasprites, scanline counter
  const frameDocs: FrameDoc[] = frames.map((fr, fi) => {
    const sprites = unitOf.flatMap((u, ui) =>
      u.frame === fi ? [{ x: u.cx * 8, y: u.cy * 8, tile: refOfUnit[ui]!.tile, palette: cellPal[ui]!, flipH: refOfUnit[ui]!.flipH, flipV: refOfUnit[ui]!.flipV }] : [],
    );
    return { name: fr.name, bank: bankOfFrame[fi]!, w: f.w, h: f.h, hotspot: { x: f.w / 2, y: f.h }, sprites, maxPerLine: maxPerLine(sprites, f.h) };
  });
  const worstLine = Math.max(0, ...frameDocs.map((d) => d.maxPerLine));
  const worstCount = Math.max(0, ...frameDocs.map((d) => d.sprites.length));
  if (worstLine > MAX_SPRITES_PER_LINE) {
    warnings.push({ fr: `${worstLine} sprites sur une même ligne (la NES en montre 8) : ça va clignoter`, en: `${worstLine} sprites on one line (the NES shows 8): it will flicker` });
  }
  if (worstCount > MAX_SPRITES_PER_FRAME) errors.push({ fr: `${worstCount} sprites dans une image (max 64)`, en: `${worstCount} sprites in one frame (max 64)` });

  // the "after" sheet: frames side by side, rebuilt from the final tiles
  const after = blankImage(f.w * frameDocs.length, f.h);
  frameDocs.forEach((d, fi) => {
    for (const sp of d.sprites) {
      const t = bankTiles[d.bank]![sp.tile]!;
      const cols = [0, ...pals[slots.indexOf(sp.palette)]!];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = t[(sp.flipV ? 7 - y : y) * 8 + (sp.flipH ? 7 - x : x)]!;
          if (v) paint(after, fi * f.w + sp.x + x, sp.y + y, cols[v]!);
        }
      }
    }
  });
  const before_ = blankImage(f.w * frames.length, f.h);
  frames.forEach((fr, fi) => {
    for (let y = 0; y < f.h; y++) before_.data.set(fr.img.data.subarray(y * f.w * 4, (y + 1) * f.w * 4), (y * before_.width + fi * f.w) * 4);
  });

  const animations: GraphicsDoc['animations'] = {};
  for (const n of names) {
    const a = animationOf(n);
    (animations[a] ??= { frames: [], frameDuration: 8, loop: true }).frames.push(n);
  }
  const usedSlots = [...new Set(cellPal)].sort();
  const budget: GraphicsBudget = {
    colors: countColors(after),
    subpalettes: usedSlots.length,
    tiles: bankInfo.reduce((n, b) => n + b.tiles, 0),
    tilesBeforeMerge: before,
    tileCapacity: SPRITE_BANK_TILES * bankCount,
    merged: before - bankInfo.reduce((n, b) => n + b.tiles, 0),
    sprites: worstCount,
    maxPerLine: worstLine,
    banks: bankInfo,
    warnings,
  };
  const doc: GraphicsDoc = {
    schemaVersion: 1,
    format: 'nbf-graphics',
    id: input.id,
    name: input.name,
    kind: 'sprite',
    role,
    source: `graphics/sources/${input.id}.png`,
    preview: `graphics/${input.id}.png`,
    chr: `graphics/${input.id}.chr`,
    bankSize: 1024,
    settings: s,
    palettes: {
      world: s.world,
      mode: s.mode,
      backdrop: set?.backdrop ?? 0x0f,
      slots: usedSlots.map((slot) => ({ slot, colors: [...pals[slots.indexOf(slot)]!] as Triple })),
    },
    frames: frameDocs,
    animations,
    budget,
  };
  return { ok: errors.length === 0, errors, doc, chr, before: before_, after, proposedSet };
}

/** Most hardware sprites sharing one scanline in a frame (PLAN §6 step 7). */
export function maxPerLine(sprites: ReadonlyArray<{ y: number }>, h: number): number {
  let worst = 0;
  for (let y = 0; y < Math.max(h, 32); y++) {
    const n = sprites.filter((sp) => y >= sp.y && y < sp.y + 8).length;
    if (n > worst) worst = n;
  }
  return worst;
}
