// Imports the BLUMA sample-game art (NES-BLUM-FACTORY-ASSETS/sample-game, read-only) as the placeholder
// art set every new project starts with (MILESTONES M3). Output: src/core/engine-data/art/placeholder-art.ts
// (graphics documents in the converter contract + CHR bytes as base64). Run: node scripts/import-sample-art.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assetsRepo = path.resolve(root, '..', 'NES-BLUM-FACTORY-ASSETS');
const sg = path.join(assetsRepo, 'sample-game');
const commit = execFileSync('git', ['-C', assetsRepo, 'log', '-1', '--format=%h', '--', 'sample-game'], { encoding: 'utf8' }).trim();
const json = (p) => JSON.parse(readFileSync(path.join(sg, p), 'utf8'));
const chrOf = (p, from) => new Uint8Array(readFileSync(path.resolve(path.dirname(path.join(sg, from)), p)));
const slug = (s) => s.toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '');
const WORLD = 'monde-1';
const FLOOR_FALLBACK = { 4: 1, 5: 1, 7: 0, 8: 1 };

function budget(kind, banks, frames) {
  const tiles = banks.reduce((n, b) => n + b.tiles, 0);
  return {
    colors: 0,
    subpalettes: 0,
    tiles,
    tilesBeforeMerge: tiles,
    tileCapacity: banks.reduce((n, b) => n + b.capacity, 0),
    merged: 0,
    sprites: frames ? Math.max(0, ...frames.map((f) => f.sprites.length)) : 0,
    maxPerLine: frames ? Math.max(0, ...frames.map((f) => f.maxPerLine)) : 0,
    banks,
    warnings: [],
  };
}

const frameOf = (f, bank) => ({
  name: slug(f.name),
  bank,
  w: f.w,
  h: f.h,
  hotspot: { x: f.hotspot.x, y: f.hotspot.y },
  sprites: f.sprites.map((s) => ({ x: s.x, y: s.y, tile: s.tile, palette: s.palette, flipH: !!s.flipH, flipV: !!s.flipV })),
  maxPerLine: f.maxPerLine,
});

// BLUM-Q1: names Blum reads in CHROMA's library (the assets use ids without accents)
const WORLD_NAME = { potager: 'Potager', cabane: 'Cabane', chantier: 'Chantier', tempete: 'Tempête' };
const BOSS_NAME = { castor: 'Castor', gros_frette: 'Gros Frette', roi_cones: 'Roi des cônes', taupe: 'Taupe', yeti: 'Yéti' };

function spriteDoc(id, name, role, file, slots) {
  const d = json(file);
  const bankIdx = Object.keys(d.banks).map(Number).sort((a, b) => a - b);
  const chr = new Uint8Array(1024 * (Math.max(...bankIdx) + 1));
  for (const b of bankIdx) chr.set(chrOf(d.banks[b].chr, file).subarray(0, 1024), b * 1024);
  const frames = d.frames.map((f) => frameOf(f, f.bank ?? 0));
  const animations = {};
  for (const f of frames) (animations[f.name.replace(/-?\d+$/, '') || f.name] ??= { frames: [], frameDuration: 8, loop: true }).frames.push(f.name);
  const banks = bankIdx.map((b) => ({ index: b, tiles: d.banks[b].tiles, capacity: 64 }));
  return {
    doc: {
      schemaVersion: 1,
      format: 'nbf-graphics',
      id,
      name,
      kind: 'sprite',
      role,
      source: `sample-game/${file} (NES-BLUM-FACTORY-ASSETS ${commit})`,
      preview: `graphics/${id}.png`,
      chr: `graphics/${id}.chr`,
      bankSize: 1024,
      settings: null,
      palettes: { world: WORLD, mode: 'locked', backdrop: 0x21, slots },
      frames,
      animations,
      budget: { ...budget('sprite', banks, frames), subpalettes: slots.length },
    },
    chr,
  };
}

const out = [];
// hero: 3 banks (idle/run/hurt, jump/fall/climb/throw, wallgrab/victory)
{
  const d = json('gfx/hero/blum.json');
  out.push(spriteDoc('heros-blum', 'Blum', 'player', 'gfx/hero/blum.json', [{ slot: 0, colors: d.palette.colors }]));
}
// common items and projectiles
{
  const d = json('gfx/common/common.json');
  out.push(spriteDoc('objets', 'Objets', 'common', 'gfx/common/common.json', [{ slot: 1, colors: d.palette.colors }]));
}
// tilesets + enemies per world
for (let w = 1; w <= 4; w++) {
  const t = json(`gfx/tilesets/w${w}.json`);
  const world = slug(t.worldId);
  const e = json(`gfx/enemies/w${w}.json`);
  const slots = Object.entries(e.palettes).map(([s, c]) => ({ slot: Number(s), colors: c }));
  out.push(spriteDoc(`ennemis-${world}`, `Ennemis ${WORLD_NAME[t.worldId] ?? t.worldId}`, 'enemy', `gfx/enemies/w${w}.json`, slots));
  const chr = new Uint8Array(4096);
  chr.set(chrOf(t.bank.chr, `gfx/tilesets/w${w}.json`).subarray(0, 4096));
  const metatiles = t.metatiles.map((m) => ({ id: m.id, tiles: m.tiles, palette: m.palette }));
  const cols = Math.max(...t.metatiles.map((m) => m.sheet.x)) / 16 + 1;
  const rows = Math.max(...t.metatiles.map((m) => m.sheet.y)) / 16 + 1;
  const cells = Array(cols * rows).fill(0);
  for (const m of t.metatiles) cells[(m.sheet.y / 16) * cols + m.sheet.x / 16] = m.id;
  out.push({
    doc: {
      schemaVersion: 1,
      format: 'nbf-graphics',
      id: `tuiles-${world}`,
      name: `Tuiles ${WORLD_NAME[t.worldId] ?? t.worldId}`,
      kind: 'tileset',
      role: 'background',
      source: `sample-game/gfx/tilesets/w${w}.json (NES-BLUM-FACTORY-ASSETS ${commit})`,
      preview: `graphics/tuiles-${world}.png`,
      chr: `graphics/tuiles-${world}.chr`,
      bankSize: 4096,
      settings: null,
      palettes: { world, mode: 'free', backdrop: t.backdrop, slots: t.palettes.map((c, i) => ({ slot: i, colors: c })) },
      metatiles,
      map: { cols, rows, cells },
      budget: { ...budget('tileset', [{ index: 0, tiles: t.bank.tiles, capacity: 256 }]), subpalettes: 4, metatiles: metatiles.length },
    },
    chr,
    // behaviours for tilesets/<id>.json, with the sample's floor fallback (every map's `fallback`: grab and
    // slippery walls -> solid, water -> empty, breakable crates -> solid)
    behaviours: Object.fromEntries(t.metatiles.map((m) => [m.id, [m.name, FLOOR_FALLBACK[m.behaviour] ?? m.behaviour]])),
  });
}
// bosses (all ≤ 32 px wide; height up to 48)
for (const b of ['castor', 'taupe', 'yeti', 'gros_frette', 'roi_cones']) {
  const d = json(`gfx/bosses/${b}.json`);
  const slots = Object.entries(d.palettes).map(([s, c]) => ({ slot: Number(s), colors: c }));
  out.push(spriteDoc(`boss-${slug(b)}`, BOSS_NAME[b] ?? b.replace('_', ' '), 'boss', `gfx/bosses/${b}.json`, slots));
}

const body = out
  .map((o) => `  {\n    doc: ${JSON.stringify(o.doc)} as unknown as GraphicsDoc,\n    chr: '${Buffer.from(o.chr).toString('base64')}',${o.behaviours ? `\n    behaviours: ${JSON.stringify(o.behaviours)},` : ''}\n  },`)
  .join('\n');
const sha = createHash('sha256').update(body).digest('hex').slice(0, 16);
const ts = `// GENERATED by scripts/import-sample-art.mjs from NES-BLUM-FACTORY-ASSETS/sample-game @ ${commit} (BLUMA, original art,
// see ASSETS.md). Do not edit by hand: re-run the script. Content hash ${sha}.
import type { GraphicsDoc } from '../../schema/graphics.js';

export interface PlaceholderArt {
  doc: GraphicsDoc;
  /** CHR bytes, base64. */
  chr: string;
  /** Tilesets: metatile id -> [name, behaviour number (PLAN §5.6)], floor-safe. */
  behaviours?: Record<string, [string, number]>;
}

export const PLACEHOLDER_SOURCE = 'NES-BLUM-FACTORY-ASSETS/sample-game @ ${commit}';

export const PLACEHOLDER_ART: PlaceholderArt[] = [
${body}
];
`;
writeFileSync(path.join(root, 'src', 'core', 'engine-data', 'art', 'placeholder-art.ts'), ts);
console.log(`placeholder art: ${out.length} graphics from ${commit}`);
