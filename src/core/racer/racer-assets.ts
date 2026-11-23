// SEBRING racer: the art. BLUMR-M2 builds from the BLUMR-A1 kit (racer/kit/, imported by
// scripts/import-sebring-kit.mjs: original pixel art, see racer/kit/README.md); without a kit the BLUMR-M1
// placeholder art drawn in code below is used (tests only). The layout contract with racer/src:
//   CHR 1 KiB units: 0-1 road A, 2-3 road B (R0), 4+2i stage i backdrop + HUD font (R1), 16-19 sprites,
//   20-27 screens (kit): title R0 / R1, ending R0 / R1 (2 KiB each).
//   Backdrop banks: tiles $80+ = font (FONT_ORDER), then the stage's sky/skyline tiles.
//   Stage bank (PRG 2+i): nametables 2 KiB ($8000), palette 32 bytes ($8800), card palette ($8820),
//   stage card 1 KiB ($8C00).
//   Screens bank: title, game over, ending, credits (1 KiB each, NT0 layout with attributes).
import { FONT_ORDER, foldRomText, glyphPixels } from '../engine-data/art/font.js';
import { encodeTile } from '../nes/chr.js';
import { GRASS_TOP, HUD_ROWS, ROAD_TOP_ROW, buildRoadTiles, cutTiles, roadBanks, rowTables } from './road-data.js';
import { carPixels, driverPixels } from './spike-assets.js';
import { KIND_ID, type ObjectKind, type Track } from './track.js';

export const CHR_ROAD_A = 0;
export const CHR_ROAD_B = 2;
export const CHR_BACKDROP0 = 4;
export const CHR_SPRITES = 16;
export const CHR_SCREENS = 20;
export const FONT_BASE = 0x80;
/** Skyline (palette 2) spans backdrop rows 64-111; plain sky above. */
export const SKYLINE_ROW = 64;

export interface StageLook {
  sky: [number, number, number];
  skyline: [number, number, number];
  grass: number;
}

/** Dusk to night (track `palette` ids), BLUMR-A1 values (racer/kit/palettes.json `racerAssetsPALETTES`,
 * checked by tests/racer-m2.test.ts). skyline[0] = sky[2] so the two blend; never $0D. */
export const PALETTES: Record<string, StageLook> = {
  'coucher-de-soleil': { sky: [0x01, 0x04, 0x27], skyline: [0x27, 0x06, 0x38], grass: 0x1a },
  crepuscule: { sky: [0x01, 0x03, 0x26], skyline: [0x26, 0x07, 0x37], grass: 0x19 },
  soir: { sky: [0x01, 0x03, 0x15], skyline: [0x15, 0x0f, 0x27], grass: 0x09 },
  'nuit-tombante': { sky: [0x0f, 0x01, 0x03], skyline: [0x03, 0x0c, 0x30], grass: 0x0b },
  nuit: { sky: [0x0f, 0x0c, 0x01], skyline: [0x01, 0x0f, 0x38], grass: 0x08 },
};
/** Snow storm mode (secret): the roadside turns white. */
export const SNOW_GRASS = 0x30;
export const BACKDROPS = ['galeries-anjou', 'metropolitaine', 'stade-olympique', 'mont-royal', 'centre-ville'] as const;
/** Roadside ground per segment `scenery` (1-3; 0 = the stage's grass). */
export const SCENERY_GRASS = [0, 0x10, 0x0a, 0x17];

/** BLUMR-A1 sprite palettes (racer/kit/palettes.json `sprites`). */
export const SPRITE_PALETTES = [
  [0x0f, 0x16, 0x30], // player car: black, red lights, white body
  [0x0f, 0x36, 0x29], // Blum (BLUM hero palette: tuque, shirt) and trees
  [0x0f, 0x11, 0x30], // cars, bus, sign
  [0x0f, 0x27, 0x30], // cones, plow, potholes, lamps, fireworks
];
const KIND_PALETTE: Record<ObjectKind, number> = { car: 2, bus: 2, cone: 3, plow: 3, pothole: 3 };
/** Sprite sizes (tiles): 0 = 1x1 (far), 1 = 2x1, 2 = 3x2 (near). */
export const SIZE_TILES: [number, number][] = [
  [1, 1],
  [2, 1],
  [3, 2],
];

/** Font tile (in a backdrop bank) of a character; the text must already be folded. */
export function fontTile(ch: string): number {
  const i = FONT_ORDER.indexOf(ch);
  if (i < 0) throw new Error(`caractère absent de la police : « ${ch} »`);
  return FONT_BASE + i;
}

/** Folds French text to the ROM font and returns tile indices. Throws on unknown characters. */
export function textTiles(text: string): number[] {
  const f = foldRomText(text);
  if (f.unknown.length) throw new Error(`caractères absents de la police : ${f.unknown.join(' ')}`);
  return [...f.text].map(fontTile);
}

/** 32-tile HUD row with `text` centred. */
export function hudMessage(text: string): number[] {
  const t = textTiles(text);
  if (t.length > 30) throw new Error(`message HUD trop long : ${text}`);
  const row = new Array<number>(32).fill(fontTile(' '));
  const at = Math.floor((32 - t.length) / 2);
  t.forEach((v, i) => (row[at + i] = v));
  return row;
}

/** The normal HUD row: "E1  TEMPS 00   000 KM/H   0000 M". Field columns are exported for the engine. */
export const HUD_FIELDS = { stage: 2, time: 10, speed: 15, dist: 25 } as const;
export function hudTemplate(): number[] {
  const row = new Array<number>(32).fill(fontTile(' '));
  const put = (col: number, s: string) => textTiles(s).forEach((v, i) => (row[col + i] = v));
  put(1, 'E1');
  put(4, 'TEMPS 00');
  put(15, '000 KM/H');
  put(25, '0000 M');
  return row;
}

/** HUD messages (index = engine MSG_* constant). Continues digit goes at MSG_CONT_COL of message 4. */
export const HUD_MESSAGES = [
  'PAUSE',
  'POINT DE CONTRÔLE !',
  'TEMPS ÉCOULÉ !',
  'FIN DE PARTIE',
  'START : CONTINUER  (0)',
  'ÉTAPE RÉUSSIE !',
  'RADIO ANJOU 104,5',
  'MÉTROPOLITAINE FM',
  'CENTRE-VILLE NUIT',
] as const;
export const MSG_CONT_COL = (() => {
  const t = HUD_MESSAGES[4];
  return Math.floor((32 - t.length) / 2) + t.indexOf('0');
})();

// ---------------------------------------------------------------------------------------------------
// text screens

export interface TextLine {
  row: number;
  text: string;
  /** 0 white, 1 accent orange, 2 accent green. */
  pal?: number;
}

export const TEXT_PALETTE = [
  0x0f, 0x0f, 0x30, 0x0f,
  0x0f, 0x0f, 0x27, 0x0f,
  0x0f, 0x0f, 0x2a, 0x0f,
  0x0f, 0x0f, 0x10, 0x0f,
  ...SPRITE_PALETTES.flatMap((p) => [0x0f, ...p]),
];

/** 1 KiB nametable (NT0) with the lines centred, attributes per line. */
export function textScreen(lines: TextLine[]): Uint8Array {
  const nt = new Uint8Array(1024).fill(fontTile(' '));
  const attr = new Array<number>(240 / 16).fill(0); // palette per 16-px band
  for (const l of lines) {
    const t = textTiles(l.text);
    if (t.length > 30) throw new Error(`ligne trop longue : ${l.text}`);
    const at = Math.floor((32 - t.length) / 2);
    t.forEach((v, i) => (nt[l.row * 32 + at + i] = v));
    if (l.pal) attr[l.row >> 1] = l.pal;
  }
  for (let ay = 0; ay < 8; ay++) {
    const top = attr[ay * 2] ?? 0;
    const bottom = attr[ay * 2 + 1] ?? 0;
    for (let ax = 0; ax < 8; ax++) nt[960 + ay * 8 + ax] = top | (top << 2) | (bottom << 4) | (bottom << 6);
  }
  return nt;
}

export const SCREENS = {
  title: [
    { row: 6, text: 'SEBRING', pal: 1 },
    { row: 9, text: "DE L'ANJOU AU CENTRE-VILLE" },
    { row: 13, text: 'UN CADEAU POUR BLUM' },
    { row: 17, text: 'APPUIE SUR START', pal: 2 },
    // rows 23-26: the car (sprites)
    { row: 28, text: '2026' },
  ],
  gameover: [
    { row: 10, text: 'FIN DE PARTIE', pal: 1 },
    { row: 12, text: 'GAME OVER' },
    { row: 20, text: 'START : TITRE', pal: 2 },
  ],
  ending: [
    { row: 7, text: 'BONNE FÊTE BLUM !', pal: 1 },
    { row: 9, text: 'HAPPY BIRTHDAY BLUM!' },
    { row: 14, text: 'ARRIVÉE AU CENTRE-VILLE' },
    { row: 16, text: "DE L'ANJOU JUSQU'ICI" },
    { row: 22, text: 'START', pal: 2 },
  ],
  credits: [
    { row: 3, text: 'SEBRING', pal: 1 },
    { row: 5, text: "DE L'ANJOU AU CENTRE-VILLE" },
    { row: 8, text: 'UN JEU DE FRED POUR BLUM' },
    { row: 10, text: 'FAIT AVEC NES BLUM FACTORY' },
    { row: 13, text: 'OUTILS ET MOTEUR :', pal: 2 },
    { row: 15, text: 'CC65 - CA65 ET LD65 (ZLIB)' },
    { row: 17, text: 'FAMISTUDIO (MIT)' },
    { row: 19, text: 'MATHIEU GAUTHIER' },
    { row: 24, text: 'START : TITRE', pal: 2 },
  ],
} satisfies Record<string, TextLine[]>;

export function stageCard(t: Track, index: number, count: number): Uint8Array {
  const lines: TextLine[] = [
    { row: 7, text: `ÉTAPE ${index + 1} / ${count}`, pal: 1 },
    { row: 11, text: t.name.fr },
    { row: 18, text: `TEMPS : ${t.timeStart} S` },
    { row: 22, text: 'START : DÉPART', pal: 2 },
  ];
  if (t.name.en.toUpperCase() !== t.name.fr.toUpperCase()) lines.push({ row: 13, text: t.name.en, pal: 3 });
  return textScreen(lines);
}

// ---------------------------------------------------------------------------------------------------
// backdrops

const solid = (c: number) => new Uint8Array(64).fill(c);
function dither(a: number, b: number): Uint8Array {
  const t = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = (x + y) & 1 ? b : a;
  return t;
}
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Skyline {
  seed: number;
  /** Building heights in tiles (skyline rows 64-111 = 6 tiles). */
  minH: number;
  maxH: number;
  /** Landmark pixel art (palette 2: 1 sky, 2 silhouette, 3 lights), placed at tile column `col`, bottom-aligned. */
  landmark?: { col: number; rows: string[] };
}

const SKYLINES: Record<(typeof BACKDROPS)[number], Skyline> = {
  // a long low mall with a lit sign band
  'galeries-anjou': {
    seed: 1999,
    minH: 0,
    maxH: 2,
    landmark: {
      col: 20,
      rows: [
        '1111111111111111111111111111111111111111',
        '1111111111111111111111111111111111111111',
        '2222222222222222222222222222222222222222',
        '2333333333333333333333333333333333333332',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2232223222322232223222322232223222322232',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
        '2222222222222222222222222222222222222222',
      ],
    },
  },
  // the elevated highway: a deck across the skyline, pillars below
  metropolitaine: { seed: 40, minH: 0, maxH: 3 },
  // the leaning tower over the stadium
  'stade-olympique': {
    seed: 1976,
    minH: 0,
    maxH: 2,
    landmark: {
      col: 22,
      rows: [
        '1111111111111113111111111111111111111111',
        '1111111111111122111111111111111111111111',
        '1111111111111222111111111111111111111111',
        '1111111111111222111111111111111111111111',
        '1111111111112221111111111111111111111111',
        '1111111111112221111111111111111111111111',
        '1111111111122211111111111111111111111111',
        '1111111111122211111111111111111111111111',
        '1111111111222111111111111111111111111111',
        '1111111111222111111111111111111111111111',
        '1111111112221111111111111111111111111111',
        '1111111112221111111111111111111111111111',
        '1111111122211111111111111111111111111111',
        '1111111122211111111111111111111111111111',
        '1111111222111111111111111111111111111111',
        '1111111222111111111111111111111111111111',
        '1111112221111111111111111111111111111111',
        '1111112222222222222222222211111111111111',
        '1111222222222222222222222222221111111111',
        '1122222222222222222222222222222211111111',
        '1222222222222222222222222222222221111111',
        '2222222222222222222222222222222222111111',
        '2222222222222222222222222222222222211111',
        '2222222222222222222222222222222222221111',
      ],
    },
  },
  // the lit cross on the mountain
  'mont-royal': {
    seed: 1642,
    minH: 0,
    maxH: 2,
    landmark: {
      col: 12,
      rows: [
        '111111111111111111131111111111111111111111111111',
        '111111111111111111131111111111111111111111111111',
        '111111111111111113333311111111111111111111111111',
        '111111111111111111131111111111111111111111111111',
        '111111111111111111131111111111111111111111111111',
        '111111111111111111131111111111111111111111111111',
        '111111111111111111131111111111111111111111111111',
        '111111111111111222232222111111111111111111111111',
        '111111111111222222222222222111111111111111111111',
        '111111111222222222222222222222111111111111111111',
        '111111122222222222222222222222222111111111111111',
        '111112222222222222222222222222222222111111111111',
        '111222222222222222222222222222222222222211111111',
        '122222222222222222222222222222222222222222211111',
        '222222222222222222222222222222222222222222222211',
        '222222222222222222222222222222222222222222222222',
      ],
    },
  },
  // downtown towers + the rotating beacon on the tallest one
  'centre-ville': {
    seed: 1962,
    minH: 2,
    maxH: 5,
    landmark: {
      col: 30,
      rows: [
        '1111111111131111111111111111',
        '1111111111222111111111111111',
        '1111111122222221111111111111',
        '1111111122323221111111111111',
        '1111111122222221111111111111',
        '1111111122323221111111111111',
        '1111111122222221111111111111',
        '1111111122323221111111111111',
        '1111111122222221111111111111',
        '1111111122323221111111111111',
        '1111111122222221111111111111',
        '1111111122323221111111111111',
        '1111111122222221111111111111',
        '1111111122323221111111111111',
        '1111111122222221111111111111',
        '1111111122323221111111111111',
      ],
    },
  },
};

export interface StageArt {
  /** 2 KiB: NT0 + NT1 (64 x 30 tiles + attributes each). */
  nametables: Uint8Array;
  palette: Uint8Array;
  /** 2 KiB CHR for R1. */
  backdrop: Uint8Array;
  backdropTiles: number;
}

export function stagePalette(look: StageLook): Uint8Array {
  return Uint8Array.from([
    0x00, look.grass, 0x16, 0x30,
    0x00, ...look.sky,
    0x00, ...look.skyline,
    0x00, 0x0f, 0x30, look.sky[0],
    ...SPRITE_PALETTES.flatMap((p) => [0x00, ...p]),
  ]);
}

/** Font tiles for a backdrop bank: glyph colour 2 on 1, bottom pixel row = 3 (the sky colour under the HUD). */
function hudFontTiles(): Uint8Array[] {
  return FONT_ORDER.map((ch) => {
    const t = glyphPixels(ch);
    for (let x = 0; x < 8; x++) t[56 + x] = 3;
    return t;
  });
}

export function stageArt(backdrop: (typeof BACKDROPS)[number], look: StageLook, roadMap: number[][]): StageArt {
  const sky = SKYLINES[backdrop];
  const tiles: Uint8Array[] = hudFontTiles();
  const index = new Map<string, number>();
  tiles.forEach((t, i) => index.set(t.join(''), i));
  const add = (t: Uint8Array): number => {
    const k = t.join('');
    let i = index.get(k);
    if (i === undefined) {
      i = tiles.length;
      if (i >= 128) throw new Error(`décor ${backdrop} : plus de 128 tuiles`);
      tiles.push(t);
      index.set(k, i);
    }
    return FONT_BASE + i;
  };
  const NT_W = 64;
  const nt = new Array<number>(NT_W * 30).fill(0);
  const set = (tx: number, ty: number, v: number) => (nt[ty * NT_W + ((tx % NT_W) + NT_W) % NT_W] = v);

  // HUD: row 0 black, row 1 the HUD template (the NMI rewrites it every frame)
  const black = add(solid(1));
  const template = hudTemplate();
  for (let tx = 0; tx < NT_W; tx++) {
    set(tx, 0, black);
    set(tx, 1, template[tx & 31]!);
  }
  // sky (palette 1) rows 16-63; rows 64-111 palette 2 (skyline), plain low sky = colour 1 there
  const skyTile = (row: number): Uint8Array => (row < 40 ? solid(1) : row < 48 ? dither(1, 2) : row < 56 ? solid(2) : dither(2, 3));
  for (let ty = HUD_ROWS / 8; ty < SKYLINE_ROW / 8; ty++) {
    const t = add(skyTile(ty * 8));
    for (let tx = 0; tx < NT_W; tx++) set(tx, ty, t);
  }
  // skyline: 6 tile rows of buildings (512 px, wraps), then the landmark painted over it
  const H = 6;
  const px = new Uint8Array(NT_W * 8 * H * 8).fill(1);
  const W = NT_W * 8;
  const rand = rng(sky.seed);
  let x = 0;
  while (x < W) {
    const w = (2 + Math.floor(rand() * 4)) * 8;
    const h = (sky.minH + Math.floor(rand() * (sky.maxH - sky.minH + 1))) * 8 + (rand() < 0.5 ? 4 : 0);
    for (let xx = x; xx < Math.min(W, x + w); xx++) {
      for (let y = H * 8 - h; y < H * 8; y++) {
        const lit = (xx % 4 === 1 && y % 6 === 2 && rand() < 0.45) ? 3 : 2;
        px[y * W + xx] = lit;
      }
    }
    x += w;
  }
  if (backdrop === 'metropolitaine') {
    // elevated deck rows 24-31 of the skyline area, pillars every 64 px, lights on the deck edge
    for (let xx = 0; xx < W; xx++) {
      for (let y = 26; y < 34; y++) px[y * W + xx] = y === 27 && xx % 8 === 3 ? 3 : 2;
      if (xx % 64 < 8) for (let y = 34; y < H * 8; y++) px[y * W + xx] = 2;
    }
  }
  if (sky.landmark) {
    const lm = sky.landmark;
    const lh = lm.rows.length;
    const lw = lm.rows[0]!.length;
    for (let y = 0; y < lh; y++) {
      for (let xx = 0; xx < lw; xx++) {
        const c = lm.rows[y]![xx]!;
        if (c === '1') continue;
        px[(H * 8 - lh + y) * W + lm.col * 8 + xx] = c.charCodeAt(0) - 48;
      }
    }
  }
  const skyTiles = cutTiles(px, W, H * 8);
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < NT_W; tx++) set(tx, SKYLINE_ROW / 8 + ty, add(skyTiles[ty * NT_W + tx]!));
  // far grass (road tile 0) and the road picture (R0 tiles)
  for (let tx = 0; tx < NT_W; tx++) set(tx, GRASS_TOP / 8, 0);
  for (let ty = 0; ty < roadMap.length; ty++) for (let tx = 0; tx < NT_W; tx++) set(tx, ROAD_TOP_ROW / 8 + ty, roadMap[ty]![tx]!);

  const nametables = new Uint8Array(2048);
  const palOfRow = (row: number) => (row < HUD_ROWS ? 3 : row < SKYLINE_ROW ? 1 : row < GRASS_TOP ? 2 : 0);
  for (let n = 0; n < 2; n++) {
    const base = n * 1024;
    for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++) nametables[base + ty * 32 + tx] = nt[ty * NT_W + n * 32 + tx]!;
    for (let ay = 0; ay < 8; ay++) {
      const top = palOfRow(ay * 32);
      const bottom = palOfRow(ay * 32 + 16);
      const v = top | (top << 2) | (bottom << 4) | (bottom << 6);
      for (let ax = 0; ax < 8; ax++) nametables[base + 960 + ay * 8 + ax] = v;
    }
  }
  const chr = new Uint8Array(2048);
  tiles.forEach((t, i) => chr.set(encodeTile(t), i * 16));
  return { nametables, palette: stagePalette(look), backdrop: chr, backdropTiles: tiles.length };
}

// ---------------------------------------------------------------------------------------------------
// sprites

type Rect = [number, number, number, number, number]; // x0 y0 x1 y1 (fractions 0-1) colour

/** Rear views drawn from fractional rectangles, so one drawing serves the three sizes. */
const KIND_ART: Record<ObjectKind, Rect[]> = {
  car: [
    [0.08, 0.3, 0.92, 0.85, 2],
    [0.22, 0.05, 0.78, 0.35, 2],
    [0.28, 0.12, 0.72, 0.32, 1],
    [0.1, 0.5, 0.26, 0.62, 3],
    [0.74, 0.5, 0.9, 0.62, 3],
    [0.08, 0.85, 0.24, 1, 1],
    [0.76, 0.85, 0.92, 1, 1],
  ],
  bus: [
    [0.04, 0, 0.96, 0.88, 2],
    [0.1, 0.08, 0.9, 0.4, 1],
    [0.04, 0.55, 0.96, 0.62, 3],
    [0.08, 0.88, 0.24, 1, 1],
    [0.76, 0.88, 0.92, 1, 1],
  ],
  plow: [
    [0.15, 0.1, 0.85, 0.7, 2],
    [0.3, 0.15, 0.7, 0.4, 1],
    [0.4, 0, 0.6, 0.1, 3],
    [0, 0.7, 1, 0.86, 3],
    [0.1, 0.86, 0.3, 1, 1],
    [0.7, 0.86, 0.9, 1, 1],
  ],
  cone: [
    [0.4, 0.05, 0.6, 0.3, 2],
    [0.33, 0.3, 0.67, 0.45, 3],
    [0.28, 0.45, 0.72, 0.8, 2],
    [0.15, 0.8, 0.85, 1, 1],
  ],
  pothole: [
    [0.2, 0.62, 0.8, 0.95, 2],
    [0.08, 0.7, 0.92, 0.88, 2],
    [0.25, 0.68, 0.75, 0.9, 1],
  ],
};

function drawKind(kind: ObjectKind, w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h);
  // small sizes use a narrower box so a far car reads as a car, not a square
  const bw = w === 8 ? 6 : w;
  const ox = (w - bw) / 2;
  for (const [x0, y0, x1, y1, c] of KIND_ART[kind]) {
    const ax = Math.round(ox + x0 * bw);
    const bx = Math.max(ax + 1, Math.round(ox + x1 * bw));
    const ay = Math.round(y0 * h);
    const by = Math.max(ay + 1, Math.round(y1 * h));
    for (let y = ay; y < by && y < h; y++) for (let x = ax; x < bx && x < w; x++) px[y * w + x] = c;
  }
  return px;
}

export interface SpriteArt {
  chr: Uint8Array;
  car: [number, number, number];
  driver: number;
  /** Driver: head + shoulders tiles per frame (the second frame sways the tuque's sprout). */
  driverTiles: [number, number, number, number];
  /** Player pose by lean index 0-4 (hard left, soft left, straight, soft right, hard right). */
  leanTile: number[];
  leanAttr: number[];
  /** Spin: 8 poses (attr $40 = mirrored). */
  spinTile: number[];
  spinAttr: number[];
  /** Flip: the roll pose shown at the start and end of the arc (null = straight only). */
  flipRoll: number | null;
  /** First tile per (kind id * 3 + size); tiles are row-major within the size's box. */
  kindTile: number[];
  /** Palette per kind id. */
  kindAttr: number[];
  /** Fireworks and effects: bursts 2 frames each (large = 2 x 2 tiles, row-major from the first). */
  fx: { burstSmall: [number, number]; burstLarge: [number, number]; smoke: [number, number]; honk: number } | null;
  count: number;
}

export function spriteArt(): SpriteArt {
  const spr: Uint8Array[] = [];
  for (const lean of [0, -1, 1]) spr.push(...cutTiles(carPixels(lean), 32, 24));
  const driver = spr.length;
  spr.push(driverPixels());
  const kindTile = new Array<number>(6 * 3).fill(0);
  const kindAttr = new Array<number>(6).fill(0);
  for (const kind of Object.keys(KIND_ID) as ObjectKind[]) {
    const id = KIND_ID[kind];
    kindAttr[id] = KIND_PALETTE[kind];
    SIZE_TILES.forEach(([cw, ch], size) => {
      kindTile[id * 3 + size] = spr.length;
      spr.push(...cutTiles(drawKind(kind, cw * 8, ch * 8), cw * 8, ch * 8));
    });
  }
  if (spr.length > 256) throw new Error('sprites : plus de 256 tuiles');
  const chr = new Uint8Array(4096);
  spr.forEach((t, i) => chr.set(encodeTile(t), i * 16));
  return {
    chr,
    car: [0, 12, 24],
    driver,
    driverTiles: [driver, driver, driver, driver],
    leanTile: [12, 12, 0, 24, 24],
    leanAttr: [0, 0, 0, 0, 0],
    // M1 spin: straight, lean left, then both mirrored
    spinTile: [0, 12, 0, 12, 0, 12, 0, 12],
    spinAttr: [0, 0, 0x40, 0x40, 0, 0, 0x40, 0x40],
    flipRoll: null,
    kindTile,
    kindAttr,
    fx: null,
    count: spr.length,
  };
}

// ---------------------------------------------------------------------------------------------------
// the BLUMR-A1 kit (racer/kit/, read by build-racer.ts)

/** The parts of racer/kit/sprites.json the engine needs. */
export interface KitSpriteSheet {
  player: { frames: Record<string, number> };
  driver: { engine: { SPR_DRIVER: number; shoulders: number; headFrame2: number; shouldersFrame2: number } };
  traffic: { kinds: Record<string, { sizes: { size: number; tile: number }[]; palette: number }> };
  fx: Record<string, { tiles: number[] }[]>;
}

export interface RacerKit {
  /** Kit stage index -> backdrop id (palettes.json `stages`). */
  backdrops: string[];
  backdropChr: Uint8Array[];
  /** 4 KiB stage banks (stageBank layout): nametables, palette, card. */
  stageBanks: Uint8Array[];
  spritesChr: Uint8Array;
  sprites: KitSpriteSheet;
  /** 4 x 1 KiB: title, game over, ending, credits. */
  screens: Uint8Array;
  /** title R0, title R1, ending R0, ending R1 (2 KiB each). */
  screenChr: Uint8Array[];
  titlePalette: Uint8Array;
  endingPalette: Uint8Array;
  /** FamiStudio ca65 export (music_data_blum_music, sounds). */
  music: string;
  sfx: string;
  source: string;
}

export function kitSpriteArt(kit: RacerKit): SpriteArt {
  const f = kit.sprites.player.frames;
  const need = (k: string) => {
    const v = f[k];
    if (v === undefined) throw new Error(`kit sprites : pose absente « ${k} »`);
    return v;
  };
  const d = kit.sprites.driver.engine;
  const kindTile = new Array<number>(6 * 3).fill(0);
  const kindAttr = new Array<number>(6).fill(0);
  for (const kind of Object.keys(KIND_ID) as ObjectKind[]) {
    const k = kit.sprites.traffic.kinds[kind];
    if (!k) throw new Error(`kit sprites : sorte absente « ${kind} »`);
    kindAttr[KIND_ID[kind]] = k.palette;
    for (const s of k.sizes) kindTile[KIND_ID[kind] * 3 + s.size] = s.tile;
  }
  const fx1 = (name: string, i: number) => {
    const t = kit.sprites.fx[name]?.[i]?.tiles[0];
    if (t === undefined) throw new Error(`kit sprites : effet absent « ${name} »`);
    return t;
  };
  const [straight, soft, hard] = [need('straight'), need('soft-left'), need('hard-left')];
  const [r34, side, f34, front] = [need('spin-rear34'), need('spin-side'), need('spin-front34'), need('spin-front')];
  return {
    chr: kit.spritesChr,
    car: [straight, soft, soft],
    driver: d.SPR_DRIVER,
    driverTiles: [d.SPR_DRIVER, d.shoulders, d.headFrame2, d.shouldersFrame2],
    // right = the left poses mirrored
    leanTile: [hard, soft, straight, soft, hard],
    leanAttr: [0, 0, 0, 0x40, 0x40],
    spinTile: [straight, r34, side, f34, front, f34, side, r34],
    spinAttr: [0, 0, 0, 0, 0, 0x40, 0x40, 0x40],
    flipRoll: need('flip-roll'),
    kindTile,
    kindAttr,
    fx: {
      burstSmall: [fx1('burst-small', 0), fx1('burst-small', 1)],
      burstLarge: [fx1('burst-large', 0), fx1('burst-large', 1)],
      smoke: [fx1('smoke', 0), fx1('smoke', 1)],
      honk: fx1('honk', 0),
    },
    count: 256,
  };
}

/** Writes `text` centred on a 32-tile row of a nametable, blanking the row with `blank` first. */
export function putRow(nt: Uint8Array, row: number, text: string, blank: number): void {
  const t = textTiles(text);
  if (t.length > 30) throw new Error(`ligne trop longue : ${text}`);
  nt.fill(blank, row * 32, row * 32 + 32);
  const at = Math.floor((32 - t.length) / 2);
  t.forEach((v, i) => (nt[row * 32 + at + i] = v));
}

/** Kit card with this track's own text (stage number, names) on rows 1, 20, 22 of the kit layout. */
export function kitCard(kitCardNt: Uint8Array, t: Track, index: number, count: number): Uint8Array {
  const card = Uint8Array.from(kitCardNt);
  const blank = card[0]!;
  putRow(card, 1, `ÉTAPE ${index + 1} / ${count}`, blank);
  putRow(card, 20, t.name.fr.toUpperCase(), blank);
  if (t.name.en.toUpperCase() !== t.name.fr.toUpperCase()) putRow(card, 22, t.name.en.toUpperCase(), blank);
  else card.fill(blank, 22 * 32, 23 * 32);
  return card;
}

/** Credits line under the tools (the kit has a build step id there). */
export const CREDITS_ART_LINE = 'DESSINS ET MUSIQUE ORIGINAUX';

// ---------------------------------------------------------------------------------------------------
// everything the build needs

export interface ScreenLook {
  /** CHR units for R0 and R1. */
  r0: number;
  r1: number;
  palette: Uint8Array;
}

export interface RacerAssets {
  chr: Uint8Array;
  roadBanks: Uint8Array[];
  rowTables: Uint8Array;
  stages: StageArt[];
  cards: Uint8Array[];
  /** Stage card palettes (kit: the race palette with HUD colour 3 black). */
  cardPalettes: Uint8Array[];
  screens: { title: Uint8Array; gameover: Uint8Array; ending: Uint8Array; credits: Uint8Array };
  /** Per screen, engine order: title, game over, ending, credits. */
  screenLooks: ScreenLook[];
  sprites: SpriteArt;
  roadTiles: number;
  /** Kit source line, or null for the placeholder art. */
  kitSource: string | null;
}

export function buildRacerAssets(tracks: Track[], kit: RacerKit | null = null): RacerAssets {
  const chr = new Uint8Array(128 * 1024);
  const road = buildRoadTiles();
  chr.set(road.chrA, CHR_ROAD_A * 1024);
  chr.set(road.chrB, CHR_ROAD_B * 1024);
  const sprites = kit ? kitSpriteArt(kit) : spriteArt();
  chr.set(sprites.chr, CHR_SPRITES * 1024);
  const kitIndex = (t: Track) => {
    const k = kit!.backdrops.indexOf(t.backdrop);
    if (k < 0) throw new Error(`décor inconnu : ${t.backdrop} (${kit!.backdrops.join(', ')})`);
    return k;
  };
  const stages = tracks.map((t, i): StageArt => {
    const look = PALETTES[t.palette];
    if (!look) throw new Error(`palette inconnue : ${t.palette} (${Object.keys(PALETTES).join(', ')})`);
    if (!kit) {
      if (!(BACKDROPS as readonly string[]).includes(t.backdrop)) throw new Error(`décor inconnu : ${t.backdrop} (${BACKDROPS.join(', ')})`);
      const s = stageArt(t.backdrop as (typeof BACKDROPS)[number], look, road.map);
      chr.set(s.backdrop, (CHR_BACKDROP0 + 2 * i) * 1024);
      return s;
    }
    const k = kitIndex(t);
    const backdrop = kit.backdropChr[k]!;
    chr.set(backdrop, (CHR_BACKDROP0 + 2 * i) * 1024);
    // the palette is the track's (any look on any backdrop); the kit's own pairs give its bytes back
    return { nametables: kit.stageBanks[k]!.slice(0, 0x800), palette: stagePalette(look), backdrop, backdropTiles: 128 };
  });
  const cardPalettes = stages.map((s) => (kit ? Uint8Array.from(s.palette, (v, i) => (i === 15 ? 0x0f : v)) : Uint8Array.from(TEXT_PALETTE)));
  const cards = tracks.map((t, i) => (kit ? kitCard(kit.stageBanks[kitIndex(t)]!.slice(0xc00, 0x1000), t, i, tracks.length) : stageCard(t, i, tracks.length)));
  let screens: RacerAssets['screens'];
  let screenLooks: ScreenLook[];
  if (kit) {
    kit.screenChr.forEach((c, i) => chr.set(c, (CHR_SCREENS + 2 * i) * 1024));
    const part = (i: number) => kit.screens.slice(i * 1024, i * 1024 + 1024);
    const credits = part(3);
    putRow(credits, 23, CREDITS_ART_LINE, credits[0]!);
    screens = { title: part(0), gameover: part(1), ending: part(2), credits };
    const title = { r0: CHR_SCREENS, r1: CHR_SCREENS + 2, palette: kit.titlePalette };
    screenLooks = [title, title, { r0: CHR_SCREENS + 4, r1: CHR_SCREENS + 6, palette: kit.endingPalette }, title];
  } else {
    screens = { title: textScreen(SCREENS.title), gameover: textScreen(SCREENS.gameover), ending: textScreen(SCREENS.ending), credits: textScreen(SCREENS.credits) };
    const text = { r0: CHR_ROAD_A, r1: CHR_BACKDROP0, palette: Uint8Array.from(TEXT_PALETTE) };
    screenLooks = [text, text, text, text];
  }
  return {
    chr,
    roadBanks: roadBanks(),
    rowTables: rowTables(),
    stages,
    cards,
    cardPalettes,
    screens,
    screenLooks,
    sprites,
    roadTiles: road.unique,
    kitSource: kit?.source ?? null,
  };
}

