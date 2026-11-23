// Built-in CHR banks: font/HUD (2 KiB), "jardin" world tiles (4 KiB), player (1 KiB), walker (part of an
// enemy bank). Laid out deterministically so tilesets/jardin.json can name tile indices.
import { flipTileH, parseArt, sliceTiles, TileBank } from '../nes/chr.js';
import { FONT_ICONS, FONT_ORDER, glyphPixels } from './art/font.js';
import { FLYER_FRAMES, HOPPER_FRAMES, JARDIN_METATILES, PLAYER_FRAMES, SHOOTER_FRAMES, SHOT_TILES, WALKER_FRAMES } from './art/builtin.js';

export interface FontBank {
  bank: TileBank;
  /** glyph -> tile index */
  glyphs: Map<string, number>;
  icons: { heart: number; flower: number; life: number; times: number };
}

export function buildFontBank(): FontBank {
  const bank = new TileBank('police', 128);
  const glyphs = new Map<string, number>();
  for (const ch of FONT_ORDER) {
    bank.put(bank.count, glyphPixels(ch));
    glyphs.set(ch, bank.count - 1);
  }
  const icon = (rows: readonly string[]) => {
    bank.put(bank.count, parseArt(rows, 8, 8));
    return bank.count - 1;
  };
  const icons = { heart: icon(FONT_ICONS.heart), flower: icon(FONT_ICONS.flower), life: icon(FONT_ICONS.life), times: icon(FONT_ICONS.times) };
  return { bank, glyphs, icons };
}

/** Metatile order of the jardin art; each quadrant gets the next tile unless it is blank (tile 0). */
const JARDIN_ORDER = ['sky', 'grass', 'dirt', 'block', 'plank', 'ladder', 'spikes', 'flower', 'checkpoint', 'exit', 'cloud', 'bush'] as const;

export function buildJardinBank(): { bank: TileBank; quads: Record<string, [number, number, number, number]> } {
  const bank = new TileBank('jardin', 256);
  bank.put(0, new Uint8Array(64));
  const quads: Record<string, [number, number, number, number]> = {};
  const seen = new Map<string, number>([['0'.repeat(64), 0]]);
  for (const name of JARDIN_ORDER) {
    const tiles = sliceTiles(parseArt(JARDIN_METATILES[name]!, 16, 16), 16, 16);
    quads[name] = tiles.map((t) => {
      const key = Array.from(t).join('');
      const known = seen.get(key);
      if (known !== undefined) return known;
      bank.put(bank.count, t);
      seen.set(key, bank.count - 1);
      return bank.count - 1;
    }) as [number, number, number, number];
  }
  return { bank, quads };
}

export interface SpriteEntry {
  x: number;
  y: number;
  tile: number;
  attr: number;
}

/** A metasprite frame: tiles added to `bank`, entries relative to the actor's hitbox origin. */
export function frameSprites(
  bank: TileBank,
  rows: readonly string[],
  w: number,
  h: number,
  opts: { tileBase: number; palette: number; dx: number; dy: number; flip: boolean },
): SpriteEntry[] {
  const tiles = sliceTiles(parseArt(rows, w, h), w, h);
  const cols = w / 8;
  const out: SpriteEntry[] = [];
  tiles.forEach((t, i) => {
    if (t.every((v) => v === 0)) return; // fully transparent: no hardware sprite
    const tx = i % cols;
    const ty = Math.floor(i / cols);
    const idx = bank.add(t);
    void flipTileH; // flips are done by the PPU attribute bit, not by extra tiles
    out.push({
      x: opts.dx + 8 * (opts.flip ? cols - 1 - tx : tx),
      y: opts.dy + 8 * ty,
      tile: opts.tileBase + idx,
      attr: (opts.palette & 3) | (opts.flip ? 0x40 : 0),
    });
  });
  return out;
}

export const PLAYER_FRAME_ORDER = ['idle', 'run1', 'run2', 'jump'] as const;

/** Player metasprites: 4 frames right, then the same 4 flipped. Hitbox 12×20 inside a 16×24 frame. */
export function buildPlayer(bank: TileBank): SpriteEntry[][] {
  const right = PLAYER_FRAME_ORDER.map((f) => frameSprites(bank, PLAYER_FRAMES[f], 16, 24, { tileBase: 0x00, palette: 0, dx: -2, dy: -4, flip: false }));
  const left = PLAYER_FRAME_ORDER.map((f) => frameSprites(bank, PLAYER_FRAMES[f], 16, 24, { tileBase: 0x00, palette: 0, dx: -2, dy: -4, flip: true }));
  return [...right, ...left];
}

const BUILTIN_ENEMIES: Record<string, readonly (readonly string[])[]> = { walker: WALKER_FRAMES, hopper: HOPPER_FRAMES, flyer: FLYER_FRAMES, shooter: SHOOTER_FRAMES };
export const BUILTIN_ENEMY_NAMES = Object.keys(BUILTIN_ENEMIES);

/** Built-in enemy graphics by name: 2 frames right, 2 frames left (palette = sprite subpalette). */
export function buildBuiltinEnemy(name: string, bank: TileBank, palette: number): SpriteEntry[][] {
  const frames = BUILTIN_ENEMIES[name];
  if (!frames) throw new Error(`graphisme intégré inconnu : builtin:${name}`);
  const right = frames.map((f) => frameSprites(bank, f, 16, 16, { tileBase: 0x80, palette, dx: 0, dy: 0, flip: false }));
  const left = frames.map((f) => frameSprites(bank, f, 16, 16, { tileBase: 0x80, palette, dx: 0, dy: 0, flip: true }));
  return [...right, ...left];
}

/** Pixel art scaled ×2 (each pixel becomes 2×2). */
function scale2(rows: readonly string[]): string[] {
  return rows.flatMap((r) => {
    const wide = [...r].map((c) => c + c).join('');
    return [wide, wide];
  });
}

/** Built-in boss « gros rampeur »: the walker drawn twice as big, 32×32, palette 3 (PLAN §5.4 roles). */
export function buildBuiltinBoss(bank: TileBank): SpriteEntry[][] {
  const frames = WALKER_FRAMES.map(scale2);
  const right = frames.map((f) => frameSprites(bank, f, 32, 32, { tileBase: 0xc0, palette: 3, dx: 0, dy: 0, flip: false }));
  const left = frames.map((f) => frameSprites(bank, f, 32, 32, { tileBase: 0xc0, palette: 3, dx: 0, dy: 0, flip: true }));
  return [...right, ...left];
}

/** Common sprite bank (R3, tiles $40-$7F): projectiles. Returns the bank and the tile numbers. */
export function buildCommonBank(): { bank: TileBank; playerShot: number; enemyShot: number } {
  const bank = new TileBank('commun', 64);
  const p = bank.add(parseArt(SHOT_TILES.player, 8, 8));
  const e = bank.add(parseArt(SHOT_TILES.enemy, 8, 8));
  return { bank, playerShot: 0x40 + p, enemyShot: 0x40 + e };
}
