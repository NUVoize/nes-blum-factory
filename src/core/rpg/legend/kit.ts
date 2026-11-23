// THE LEGEND OF BLUM (BLUMZ-M1): the BLUMZ-A1 art + music kit as imported into rpg/kit/ by
// scripts/import-legend-kit.mjs (CHR banks, metatile tables, palettes, nametables, metasprites, FamiStudio
// export). Read-only here: the compiler places the banks and draws nothing itself.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface KitSprite {
  x: number;
  y: number;
  tile: number;
  palette: number;
  flipH: number;
  flipV: number;
}
export interface KitFrame {
  w: number;
  h: number;
  hotspot: { x: number; y: number };
  sprites: KitSprite[];
}
export interface KitTileset {
  id: string;
  metatiles: { index: number; ch: string; name: string; palette: number; solid: boolean; counter: boolean; trigger: boolean; tiles: number[]; attr: number }[];
  chr: Uint8Array;
  table: Uint8Array;
  palette: Uint8Array;
}
export interface KitEnemyArt {
  id: string;
  name: string;
  short: string;
  w: number;
  h: number;
  grid: number[][];
  chr: Uint8Array;
}

export interface LegendKit {
  dir: string;
  source: string;
  ui: Uint8Array;
  font: { first: number; order: string[] };
  frame: Record<'tl' | 'tr' | 'bl' | 'br' | 'top' | 'bottom' | 'left' | 'right' | 'arrow', number>;
  common: Record<string, number>;
  tilesets: Map<string, KitTileset>;
  blumChr: Uint8Array;
  blumMap: Record<string, KitFrame>;
  blumBattle: Record<string, KitFrame>;
  npcChr: { ch00: Uint8Array; ch01: Uint8Array };
  /** NPC id -> chr set ('ch00' | 'ch01') and frames (down0, down1, up, side). */
  npcs: Map<string, { set: 'ch00' | 'ch01'; name: string; frames: Record<string, KitFrame> }>;
  mapChr: Uint8Array;
  mapEnemies: Map<string, KitFrame[]>;
  objects: Map<string, KitFrame>;
  fxChr: Uint8Array;
  fxPowers: Map<string, KitFrame[]>;
  fxCommon: Map<string, KitFrame[]>;
  backdrops: Map<string, { chr: Uint8Array; nametable: Uint8Array }>;
  enemies: Map<string, KitEnemyArt>;
  battlePalettes: Map<string, Uint8Array>;
  title: { chr: Uint8Array; nametable: Uint8Array; palette: Uint8Array; cursorRow: number };
  classes: { nametable: Uint8Array };
  music: string;
  sfx: string;
  sound: Record<string, number>;
}

export function kitPresent(kitDir: string): boolean {
  return existsSync(path.join(kitDir, 'manifest.json'));
}

export function loadLegendKit(kitDir: string): LegendKit {
  const bin = (f: string) => new Uint8Array(readFileSync(path.join(kitDir, f)));
  const json = <T>(f: string): T => JSON.parse(readFileSync(path.join(kitDir, f), 'utf8')) as T;
  const manifest = json<{
    palettes: { battle: Record<string, string> };
    sound: { legendSound: Record<string, number> };
    tilesets: Record<string, unknown>;
  }>('manifest.json');
  const ui = json<{ fontFirst: number; fontOrder: string[]; frame: LegendKit['frame']; common: Record<string, number> }>('gfx/ui/ui.json');

  const tilesets = new Map<string, KitTileset>();
  for (const id of Object.keys(manifest.tilesets)) {
    const doc = json<{ metatiles: KitTileset['metatiles'] }>(`gfx/tilesets/${id}.json`);
    tilesets.set(id, { id, metatiles: doc.metatiles, chr: bin(`chr/${id}.chr`), table: bin(`metatiles/${id}.bin`), palette: bin(`palettes/${id}.bin`) });
  }
  const blum = json<{ map: Record<string, KitFrame>; battle: Record<string, KitFrame> }>('gfx/blum/blum-enfant.json');
  const npcs = new Map<string, { set: 'ch00' | 'ch01'; name: string; frames: Record<string, KitFrame> }>();
  for (const set of ['ch00', 'ch01'] as const) {
    const doc = json<{ characters: Record<string, { name: string; frames: Record<string, KitFrame> }> }>(`gfx/npcs/npcs-${set}.json`);
    for (const [id, c] of Object.entries(doc.characters)) npcs.set(id, { set, name: c.name, frames: c.frames });
  }
  const em = json<{ enemies: Record<string, { frames: KitFrame[] }>; objects: Record<string, KitFrame> }>('gfx/enemies/enemies-map.json');
  const fx = json<{ powers: Record<string, { frames: KitFrame[] }>; common: Record<string, { frames: KitFrame[] }> }>('gfx/fx/fx.json');
  const backdrops = new Map<string, { chr: Uint8Array; nametable: Uint8Array }>();
  for (const b of ['classe', 'cour', 'salon']) backdrops.set(b, { chr: bin(`chr/battle-bg-${b}.chr`), nametable: bin(`battle/bg-${b}.bin`) });
  const enemies = new Map<string, KitEnemyArt>();
  for (const e of ['crayon', 'marie-claude', 'mouton', 'boulette']) {
    const d = json<{ name: string; shortName: string; w: number; h: number; grid: number[][] }>(`gfx/enemies/${e}.json`);
    enemies.set(e, { id: e, name: d.name, short: d.shortName, w: d.w, h: d.h, grid: d.grid, chr: bin(`chr/enemy-${e}.chr`) });
  }
  const battlePalettes = new Map<string, Uint8Array>();
  for (const [pair, file] of Object.entries(manifest.palettes.battle)) battlePalettes.set(pair, bin(file.replace(/^engine\//, '')));
  const title = json<{ cursorRow: number }>('gfx/screens/title.json');
  return {
    dir: kitDir,
    source: readFileSync(path.join(kitDir, 'SOURCE.txt'), 'utf8').split(/\r?\n/)[0]!.trim(),
    ui: bin('chr/ui.chr'),
    font: { first: ui.fontFirst, order: ui.fontOrder },
    frame: ui.frame,
    common: ui.common,
    tilesets,
    blumChr: bin('chr/blum-enfant.chr'),
    blumMap: blum.map,
    blumBattle: blum.battle,
    npcChr: { ch00: bin('chr/npcs-ch00.chr'), ch01: bin('chr/npcs-ch01.chr') },
    npcs,
    mapChr: bin('chr/enemies-map.chr'),
    mapEnemies: new Map(Object.entries(em.enemies).map(([k, v]) => [k, v.frames])),
    objects: new Map(Object.entries(em.objects)),
    fxChr: bin('chr/fx.chr'),
    fxPowers: new Map(Object.entries(fx.powers).map(([k, v]) => [k, v.frames])),
    fxCommon: new Map(Object.entries(fx.common).map(([k, v]) => [k, v.frames])),
    backdrops,
    enemies,
    battlePalettes,
    title: { chr: bin('chr/title.chr'), nametable: bin('screens/title.bin'), palette: bin('palettes/title.bin'), cursorRow: title.cursorRow },
    classes: { nametable: bin('screens/classes.bin') },
    music: readFileSync(path.join(kitDir, 'audio', 'music.s'), 'utf8'),
    sfx: readFileSync(path.join(kitDir, 'audio', 'sfx.s'), 'utf8'),
    sound: manifest.sound.legendSound,
  };
}
