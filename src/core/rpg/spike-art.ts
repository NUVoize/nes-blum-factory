// LEGEND OF BLUM engine spike (BLUMZ-PLAN): placeholder art drawn here in code (ours, original), the
// RPG dialogue font (BLUM's capitals + new lower case with French accents) and the CHR layout.
// Contract with rpg/spike/src/spike.s:
//   BG $0000 (R0 = CHR 1 KiB unit 0, R1 = unit 2): tile 0 = backdrop, then font, window frame, map
//   metatile tiles, battle enemy. Sprites $1000 (R2-R5 = units 4-7): metasprites of 4 tiles (TL TR BL BR).
import { glyphPixels, FONT_ORDER } from '../engine-data/art/font.js';
import { encodeTile } from '../nes/chr.js';

/** Lower case, 5 wide × 8 high (row 7 = descender), drawn for the RPG dialogue box. */
const LOWER: Record<string, string> = {
  a: '..... ..... .###. ....# .#### #...# .#### .....',
  b: '#.... #.... ####. #...# #...# #...# ####. .....',
  c: '..... ..... .#### #.... #.... #.... .#### .....',
  d: '....# ....# .#### #...# #...# #...# .#### .....',
  e: '..... ..... .###. #...# ##### #.... .###. .....',
  f: '..##. .#... .#... ####. .#... .#... .#... .....',
  g: '..... ..... .#### #...# #...# .#### ....# .###.',
  h: '#.... #.... ####. #...# #...# #...# #...# .....',
  i: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###. .....',
  j: '...#. ..... ..##. ...#. ...#. ...#. #..#. .##..',
  k: '#.... #.... #..#. #.#.. ##... #.#.. #..#. .....',
  l: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###. .....',
  m: '..... ..... ##.#. #.#.# #.#.# #.#.# #...# .....',
  n: '..... ..... ####. #...# #...# #...# #...# .....',
  o: '..... ..... .###. #...# #...# #...# .###. .....',
  p: '..... ..... ####. #...# #...# ####. #.... #....',
  q: '..... ..... .#### #...# #...# .#### ....# ....#',
  r: '..... ..... #.##. ##..# #.... #.... #.... .....',
  s: '..... ..... .#### #.... .###. ....# ####. .....',
  t: '.#... .#... ####. .#... .#... .#..# ..##. .....',
  u: '..... ..... #...# #...# #...# #..## .##.# .....',
  v: '..... ..... #...# #...# #...# .#.#. ..#.. .....',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#. .....',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...# .....',
  y: '..... ..... #...# #...# #...# .#### ....# .###.',
  z: '..... ..... ##### ...#. ..#.. .#... ##### .....',
};
/** Accented lower case: accent rows 0-1 over the base letter's rows 2-7 (ç: cedilla in row 7). */
const ACCENTS: Record<string, [string, string]> = {
  é: ['e', '...#. ..#..'],
  è: ['e', '.#... ..#..'],
  ê: ['e', '..#.. .#.#.'],
  ë: ['e', '.#.#. .....'],
  à: ['a', '.#... ..#..'],
  â: ['a', '..#.. .#.#.'],
  î: ['i', '..#.. .#.#.'],
  ï: ['i', '.#.#. .....'],
  ô: ['o', '..#.. .#.#.'],
  û: ['u', '..#.. .#.#.'],
  ù: ['u', '.#... ..#..'],
  ü: ['u', '.#.#. .....'],
};
for (const [ch, [base, top]] of Object.entries(ACCENTS)) LOWER[ch] = `${top} ${LOWER[base]!.split(' ').slice(2).join(' ')}`;
LOWER['ç'] = `${LOWER.c!.split(' ').slice(0, 7).join(' ')} ..#..`;

/** RPG font order: index 0 of the font = ' ' (box fill). BG tile = FONT_FIRST + index. */
export const RPG_FONT_ORDER: readonly string[] = [...FONT_ORDER, ...Object.keys(LOWER)];
export const FONT_FIRST = 1;

/**
 * Accented capitals of the RPG font (BLUMZ-F2, BLUMZ-W P2-2). BLUM's capitals put a 1-pixel accent right on
 * the letter, which vanishes in the dialogue box (« À SUIVRE » read « A SUIVRE »). Here the accent takes rows
 * 0-1 as in the lower case and the letter is one row shorter (rows 2-6, same baseline); Ç = C + cedilla in row 7.
 * BLUM's own font (engine-data/art/font.ts) is untouched.
 */
const SHORT: Record<string, string> = {
  E: '##### #.... ####. #.... #####',
  A: '.###. #...# ##### #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. .###.',
  O: '.###. #...# #...# #...# .###.',
  U: '#...# #...# #...# #...# .###.',
};
const UPPER_ACCENTS: Record<string, [string, string]> = {
  É: ['E', '...#. ..#..'],
  È: ['E', '.#... ..#..'],
  Ê: ['E', '..#.. .#.#.'],
  Ë: ['E', '.#.#. .....'],
  À: ['A', '.#... ..#..'],
  Â: ['A', '..#.. .#.#.'],
  Î: ['I', '..#.. .#.#.'],
  Ï: ['I', '.#.#. .....'],
  Ô: ['O', '..#.. .#.#.'],
  Û: ['U', '..#.. .#.#.'],
  Ù: ['U', '.#... ..#..'],
  Ü: ['U', '.#.#. .....'],
};
const UPPER: Record<string, string> = { Ç: '.###. #...# #.... #.... #.... #...# .###. ..#..' };
for (const [ch, [base, top]] of Object.entries(UPPER_ACCENTS)) UPPER[ch] = `${top} ${SHORT[base]!} .....`;

function rowsPixels(ch: string, art: string): Uint8Array {
  const out = new Uint8Array(64).fill(1);
  const rows = art.split(' ');
  if (rows.length !== 8) throw new Error(`glyphe « ${ch} » : ${rows.length} lignes au lieu de 8`);
  rows.forEach((row, y) => {
    for (let x = 0; x < 5; x++) if (row[x] === '#') out[y * 8 + 1 + x] = 2;
  });
  return out;
}

export function fontPixels(ch: string): Uint8Array {
  return ch in LOWER ? rowsPixels(ch, LOWER[ch]!) : ch in UPPER ? rowsPixels(ch, UPPER[ch]!) : glyphPixels(ch);
}

const TEXT_FOLD: Record<string, string> = { '’': "'", '‘': "'", '“': '«', '”': '»', '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ' };

/** Text -> BG tile indices. Throws on a character the font does not have (the validator reports it first). */
export function encodeText(text: string): number[] {
  const out: number[] = [];
  for (const raw of text) {
    for (const ch of TEXT_FOLD[raw] ?? raw) {
      const i = RPG_FONT_ORDER.indexOf(ch);
      if (i < 0) throw new Error(`caractère absent de la police : « ${ch} »`);
      out.push(FONT_FIRST + i);
    }
  }
  return out;
}

export function unknownChars(text: string): string[] {
  const bad: string[] = [];
  for (const raw of text) for (const ch of TEXT_FOLD[raw] ?? raw) if (!RPG_FONT_ORDER.includes(ch)) bad.push(ch);
  return bad;
}

/** Text length in tiles (after folding). */
export function textWidth(text: string): number {
  let n = 0;
  for (const raw of text) n += [...(TEXT_FOLD[raw] ?? raw)].length;
  return n;
}

// ---- pixel helpers ----
const rows8 = (s: string) => s.trim().split(/\s+/);
function px(rows: string[], w: number, h: number): Uint8Array {
  if (rows.length !== h) throw new Error(`art: ${rows.length} rows, want ${h}`);
  const out = new Uint8Array(w * h);
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`art row ${y}: ${r.length} columns, want ${w}: ${r}`);
    for (let x = 0; x < w; x++) out[y * w + x] = r[x] === '.' ? 0 : Number(r[x]);
  });
  return out;
}
function cut16(p: Uint8Array): Uint8Array[] {
  const t: Uint8Array[] = [];
  for (const [ox, oy] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) {
    const a = new Uint8Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) a[y * 8 + x] = p[(oy + y) * 16 + ox + x]!;
    t.push(a);
  }
  return t;
}
function gen16(f: (x: number, y: number) => number): Uint8Array {
  const p = new Uint8Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p[y * 16 + x] = f(x, y);
  return p;
}

// ---- window frame (palette 0: 1 = window blue, 2 = white, 3 = accent) ----
const FRAME_TL = rows8('00000000 00000000 00002222 00021111 00211111 00211111 00211111 00211111');
const flipH = (r: string[]) => r.map((s) => [...s].reverse().join(''));
const flipV = (r: string[]) => [...r].reverse();
const TOP = rows8('00000000 00000000 22222222 11111111 11111111 11111111 11111111 11111111');
const LEFT = rows8('00211111 00211111 00211111 00211111 00211111 00211111 00211111 00211111');
const ARROW = rows8('11111111 11111111 13333311 11333111 11131111 11111111 11111111 11111111');
const FRAME = {
  tl: FRAME_TL,
  tr: flipH(FRAME_TL),
  bl: flipV(FRAME_TL),
  br: flipV(flipH(FRAME_TL)),
  top: TOP,
  bottom: flipV(TOP),
  left: LEFT,
  right: flipH(LEFT),
  arrow: ARROW,
};

// ---- metatiles (16×16). Palettes: 0 text, 1 indoor browns, 2 carpet reds, 3 outdoor greens/tan ----
export interface MetatileArt {
  ch: string;
  palette: number;
  solid: boolean;
  pixels: Uint8Array;
}
const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
export const METATILES: MetatileArt[] = [
  // wall top: dark brown with a light rim at the bottom
  { ch: '#', palette: 1, solid: true, pixels: gen16((x, y) => (y >= 14 ? 2 : (x + y) % 8 === 0 ? 2 : 1)) },
  // wall face: cream wallpaper with brown stripes, dark baseboard
  { ch: 'w', palette: 1, solid: true, pixels: gen16((x, y) => (y >= 13 ? 1 : x % 4 === 1 ? 2 : 3)) },
  // wood floor: planks 4 px high, staggered joints
  { ch: '.', palette: 1, solid: false, pixels: gen16((x, y) => (y % 4 === 3 ? 1 : (x + (y >> 2) * 5) % 8 === 0 ? 1 : 2)) },
  // table: dark outline, cream top, brown front
  {
    ch: 'T',
    palette: 1,
    solid: true,
    pixels: gen16((x, y) => (x === 0 || x === 15 || y === 0 || y === 15 ? 1 : y < 10 ? 3 : y < 12 ? 1 : x < 3 || x > 12 ? 2 : 1)),
  },
  // carpet: red diamonds
  { ch: '=', palette: 2, solid: false, pixels: gen16((x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? 1 : (Math.abs(x - 7.5) + Math.abs(y - 7.5)) % 6 < 1.5 ? 3 : 2)) },
  // grass: green with dark tufts
  { ch: 'g', palette: 3, solid: false, pixels: gen16((x, y) => (hash(x, y) % 13 === 0 || (hash(x, y + 1) % 13 === 0 && y < 15) ? 1 : 2)) },
  // path: tan with specks
  { ch: ':', palette: 3, solid: false, pixels: gen16((x, y) => (hash(x + 3, y) % 17 === 0 ? 2 : 3)) },
  // tree: round canopy, trunk
  {
    ch: 't',
    palette: 3,
    solid: true,
    pixels: gen16((x, y) => {
      const dx = x - 7.5;
      const dy = y - 6;
      const d = dx * dx + dy * dy;
      if (y >= 12) return x >= 6 && x <= 9 ? 3 : 2;
      if (d < 30) return (x + y) % 5 === 0 ? 2 : 1;
      if (d < 50) return 0;
      return 2;
    }),
  },
  // fence: tan posts and rails over grass
  { ch: 'f', palette: 3, solid: true, pixels: gen16((x, y) => (x % 8 === 2 || x % 8 === 3 ? (y >= 2 ? 3 : 2) : y === 5 || y === 6 || y === 11 || y === 12 ? 3 : y === 13 ? 1 : 2)) },
];

// ---- sprites (16×16). Sprite palettes: 0 Blum, 1 Madame Bélanger, 2 crayon enemy, 3 cursor ----
const BLUM_DOWN = [
  '......3333......',
  '....33333333....',
  '...3333333333...',
  '...1111111111...',
  '...1222222221...',
  '...2212222122...',
  '...2222222222...',
  '....22211222....',
  '.....222222.....',
  '....33333333....',
  '...2333333332...',
  '...2333333332...',
  '....33333333....',
  '....11111111....',
  '....111..111....',
  '....11....11....',
];
const BLUM_UP = [
  '......3333......',
  '....33333333....',
  '...3333333333...',
  '...3333333333...',
  '...1111111111...',
  '...1111111111...',
  '...2111111112...',
  '....22111122....',
  '.....222222.....',
  '....33333333....',
  '...2333333332...',
  '...2333333332...',
  '....33333333....',
  '....11111111....',
  '....111..111....',
  '....11....11....',
];
const BLUM_SIDE = [
  '.....3333.......',
  '....33333333....',
  '...333333333....',
  '...11111111.....',
  '...112222222....',
  '...112222212....',
  '...1122222222...',
  '....2222212.....',
  '.....22222......',
  '.....333333.....',
  '....3332333.....',
  '....3332333.....',
  '.....333333.....',
  '.....111111.....',
  '.....11..11.....',
  '....11....11....',
];
const walk = (a: string[], last2: [string, string]) => [...a.slice(0, 14), ...last2];
const BELANGER = [
  '....11111111....',
  '...1111111111...',
  '...1111111111...',
  '...1222222221...',
  '...2212222122...',
  '...2222222222...',
  '....22211222....',
  '.....222222.....',
  '...3333333333...',
  '..233333333332..',
  '..233333333332..',
  '...3333333333...',
  '...3333333333...',
  '..333333333333..',
  '....22....22....',
  '....11....11....',
];
const CRAYON = [
  '.......11.......',
  '......1331......',
  '.....133331.....',
  '.....122221.....',
  '....12222221....',
  '....12222221....',
  '....21122112....',
  '....12122121....',
  '....12222221....',
  '....12111121....',
  '....12222221....',
  '....12222221....',
  '....13333331....',
  '....13333331....',
  '...11.1..1.11...',
  '..11..1..1..11..',
];
const CURSOR = rows8('2....... 22...... 222..... 2222.... 222..... 22...... 2....... ........');

export const SPRITE_ART: Record<string, string[]> = {
  blumDown0: BLUM_DOWN,
  blumDown1: walk(BLUM_DOWN, ['....111..11.....', '...11......11...']),
  blumUp0: BLUM_UP,
  blumUp1: walk(BLUM_UP, ['.....11..111....', '...11......11...']),
  blumSide0: BLUM_SIDE,
  blumSide1: walk(BLUM_SIDE, ['....11...11.....', '...11.....11....']),
  belanger: BELANGER,
  crayon0: CRAYON,
  crayon1: walk(CRAYON, ['..11.1....1.11..', '.11..1....1..11.']),
};

export interface SpikeArt {
  chr: Uint8Array; // 8 KiB: BG 4 KiB ($0000) + sprites 4 KiB ($1000)
  tiles: {
    space: number;
    frame: Record<keyof typeof FRAME, number>;
    metatiles: Array<{ ch: string; tl: number; tr: number; bl: number; br: number; palette: number; solid: boolean }>;
    enemy: number[]; // 16 BG tiles, 4×4, row-major
  };
  sprites: Record<keyof typeof SPRITE_ART, number> & { cursor: number };
  bgTileCount: number;
  spriteTileCount: number;
}

export function buildSpikeArt(): SpikeArt {
  const bg: Uint8Array[] = [new Uint8Array(64)];
  const add = (t: Uint8Array) => {
    const key = t.join('');
    const i = bg.findIndex((x) => x.join('') === key);
    if (i >= 0) return i;
    bg.push(t);
    return bg.length - 1;
  };
  // font first, in order, no dedupe (index = FONT_FIRST + font index)
  for (const ch of RPG_FONT_ORDER) bg.push(fontPixels(ch));
  const space = FONT_FIRST;
  const frame = Object.fromEntries(Object.entries(FRAME).map(([k, r]) => [k, add(px(r, 8, 8))])) as Record<keyof typeof FRAME, number>;
  const metatiles = METATILES.map((m) => {
    const [tl, tr, bl, br] = cut16(m.pixels).map(add) as [number, number, number, number];
    return { ch: m.ch, tl, tr, bl, br, palette: m.palette, solid: m.solid };
  });
  // battle enemy: the crayon sprite scaled ×2 as 4×4 BG tiles (battle palette 1 = crayon colours)
  const big = px(CRAYON, 16, 16);
  const enemy: number[] = [];
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const t = new Uint8Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = big[((ty * 8 + y) >> 1) * 16 + ((tx * 8 + x) >> 1)]!;
      enemy.push(add(t));
    }
  }
  if (bg.length > 256) throw new Error(`BG tiles ${bg.length} > 256`);

  const spr: Uint8Array[] = [new Uint8Array(64)];
  const sprites = {} as Record<string, number>;
  for (const [name, art] of Object.entries(SPRITE_ART)) {
    sprites[name] = spr.length;
    spr.push(...cut16(px(art, 16, 16)));
  }
  sprites.cursor = spr.length;
  spr.push(px(CURSOR, 8, 8));
  if (spr.length > 256) throw new Error(`sprite tiles ${spr.length} > 256`);

  const chr = new Uint8Array(8192);
  bg.forEach((t, i) => chr.set(encodeTile(t), i * 16));
  spr.forEach((t, i) => chr.set(encodeTile(t), 4096 + i * 16));
  return {
    chr,
    tiles: { space, frame, metatiles, enemy },
    sprites: sprites as SpikeArt['sprites'],
    bgTileCount: bg.length,
    spriteTileCount: spr.length,
  };
}
