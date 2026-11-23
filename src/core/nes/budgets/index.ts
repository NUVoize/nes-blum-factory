// World/scene budget validator (PLAN §6.1, W0 P0-2). Converting one image correctly is not enough: the
// NES limits apply to everything on screen at once. Runs on every proposal (validateBudgets) and every
// build (emitter). Every failure names the file responsible and explains itself in French.
import { buildBuiltinEnemy, buildJardinBank, buildPlayer } from '../../engine-data/builtin-chr.js';
import { TileBank } from '../chr.js';
import type { Issue } from '../../schema/common.js';
import type { EnemyActor, Level, Tileset } from '../../schema/engine-docs.js';
import {
  animationOf,
  BG_SET_TILES,
  MAX_BOSS_WIDTH,
  MAX_SPRITES_PER_FRAME,
  MAX_SPRITES_PER_LINE,
  ROLE_SPRITE_SLOTS,
  SPRITE_BANK_TILES,
  type GraphicsDoc,
  type GraphicsRole,
  type PlayerActor,
} from '../../schema/graphics.js';
import type { Palettes } from '../../schema/misc.js';
import type { Physics } from '../../schema/physics.js';
import type { Story } from '../../schema/story.js';
import type { Json } from '../../util/json-pointer.js';

export type Triple = readonly [number, number, number];
type SpriteRole = Exclude<GraphicsRole, 'background'>;

/** One graphic using one hardware subpalette slot. `colors` null = locked (takes the world's colours). */
export interface PaletteUse {
  source: string;
  slot: number;
  colors: Triple | null;
}
export interface SpriteUse extends PaletteUse {
  role: SpriteRole;
}

/** Something drawn as sprites in a level, for the per-scanline worst case. */
export interface Placed {
  source: string;
  col: number;
  row: number;
  /** Frame height in pixels (feet on the bottom of the cell). */
  h: number;
  /** Hardware sprites per line (frame width / 8). */
  perLine: number;
}

export interface WorldScene {
  world: string;
  set: Palettes['sets'][number] | null;
  bg: PaletteUse[];
  sprites: SpriteUse[];
  /** BG tiles of the world's CHR set (HUD/font have their own bank, PLAN §5.4). */
  bgTiles: Array<{ source: string; tiles: number }>;
  /** 1 KiB sprite banks (player banks, the world enemy bank, boss banks). */
  spriteBanks: Array<{ source: string; name: string; tiles: number }>;
  bosses: Array<{ source: string; width: number }>;
  levels: Array<{ source: string; name?: { fr: string; en: string }; width: number; placed: Placed[] }>;
  /** Player sprites per line + projectiles that can share the line. */
  playerPerLine: number;
}

const err = (doc: string, path: string, fr: string, en: string): Issue => ({ doc, path, fr, en, severity: 'error' });
const warn = (doc: string, path: string, fr: string, en: string): Issue => ({ doc, path, fr, en, severity: 'warning' });
const hex = (c: number) => '$' + c.toString(16).toUpperCase().padStart(2, '0');
const tripleText = (t: Triple) => t.map(hex).join(' ');

const ROLE_FR: Record<SpriteRole, string> = { player: 'héros', common: 'objets', enemy: 'ennemis', boss: 'boss' };

/** Distinct subpalettes a set of uses needs, slot by slot. */
function distinctPalettes(uses: PaletteUse[], worldSlots: readonly Triple[] | undefined): Array<{ slot: number; colors: string; sources: string[] }> {
  const out: Array<{ slot: number; colors: string; sources: string[] }> = [];
  const add = (slot: number, colors: string, source: string) => {
    const hit = out.find((o) => o.slot === slot && o.colors === colors);
    if (hit) {
      if (!hit.sources.includes(source)) hit.sources.push(source);
    } else out.push({ slot, colors, sources: [source] });
  };
  // the hardware holds the world's colours in every slot anyone uses; a graphic converted with other
  // colours (free mode, not adopted by the world) needs one more subpalette
  for (const u of uses) {
    const world = worldSlots?.[u.slot];
    add(u.slot, world ? tripleText(world) : `slot ${u.slot}`, u.source);
    if (u.colors && (!world || tripleText(u.colors) !== tripleText(world))) add(u.slot, tripleText(u.colors), u.source);
  }
  return out;
}

export function validateWorldScene(scene: WorldScene): Issue[] {
  const issues: Issue[] = [];
  const w = scene.world;

  // BG subpalettes, HUD included
  const bg = distinctPalettes(scene.bg, scene.set?.bg as Triple[] | undefined);
  if (bg.length > 4) {
    const extra = bg.filter((p) => bg.filter((q) => q.slot === p.slot).length > 1).flatMap((p) => p.sources);
    issues.push(
      err(
        extra[0] ?? 'graphics/palettes.json',
        '/palettes',
        `le monde « ${w} » demande ${bg.length} palettes de fond (la NES en a 4, HUD compris) : ${[...new Set(extra)].join(', ')} ont été converties avec d’autres couleurs. Reconvertis-les en mode verrouillé.`,
        `world "${w}" needs ${bg.length} background palettes (the NES has 4, HUD included): ${[...new Set(extra)].join(', ')} were converted with other colours. Convert them again in locked mode.`,
      ),
    );
  }

  // sprite subpalettes with fixed roles
  for (const u of scene.sprites) {
    const allowed = ROLE_SPRITE_SLOTS[u.role];
    if (!allowed.includes(u.slot)) {
      issues.push(
        err(
          u.source,
          '/palettes',
          `${u.source} utilise la palette de sprites ${u.slot}, réservée à un autre rôle : les ${ROLE_FR[u.role]} prennent ${allowed.join(' ou ')}`,
          `${u.source} uses sprite palette ${u.slot}, reserved for another role: ${u.role} uses ${allowed.join(' or ')}`,
        ),
      );
    }
  }
  const sp = distinctPalettes(scene.sprites, scene.set?.sprites as Triple[] | undefined);
  if (sp.length > 4) {
    const sources = [...new Set(sp.flatMap((p) => p.sources))];
    issues.push(
      err(
        sources[0] ?? 'graphics/palettes.json',
        '/palettes',
        `le monde « ${w} » demande ${sp.length} palettes de sprites (la NES en a 4 : héros, objets, 2 pour ennemis et boss). Images en cause : ${sources.join(', ')}. Convertis-les en mode verrouillé sur les palettes du monde.`,
        `world "${w}" needs ${sp.length} sprite palettes (the NES has 4: hero, items, 2 for enemies and boss). Images: ${sources.join(', ')}. Convert them in locked mode on the world palettes.`,
      ),
    );
  }

  // tiles
  const bgTiles = scene.bgTiles.reduce((n, t) => n + t.tiles, 0);
  if (bgTiles > BG_SET_TILES) {
    issues.push(
      err(
        scene.bgTiles[0]?.source ?? '',
        '/budget/tiles',
        `le monde « ${w} » utilise ${bgTiles} tuiles de fond (max ${BG_SET_TILES}) : ${scene.bgTiles.map((t) => `${t.source} ${t.tiles}`).join(', ')}`,
        `world "${w}" uses ${bgTiles} background tiles (max ${BG_SET_TILES})`,
      ),
    );
  }
  for (const b of scene.spriteBanks) {
    if (b.tiles > SPRITE_BANK_TILES) {
      issues.push(err(b.source, '/budget/banks', `la banque de sprites « ${b.name} » du monde « ${w} » a ${b.tiles} tuiles (max ${SPRITE_BANK_TILES})`, `sprite bank "${b.name}" in world "${w}" has ${b.tiles} tiles (max ${SPRITE_BANK_TILES})`));
    }
  }
  for (const b of scene.bosses) {
    if (b.width > MAX_BOSS_WIDTH) {
      issues.push(
        err(b.source, '/frames', `le boss ${b.source} fait ${b.width} pixels de large : en sprites, ${MAX_BOSS_WIDTH} au plus (sinon il disparaît par bandes)`, `boss ${b.source} is ${b.width} px wide: ${MAX_BOSS_WIDTH} at most as sprites`),
      );
    }
  }

  // worst case per scanline, one screen at a time (PLAN §5.4 OAM cycling)
  for (const lv of scene.levels) {
    let flagged = false;
    for (let c0 = 0; c0 + 1 <= Math.max(1, lv.width - 15) && !flagged; c0++) {
      const onScreen = lv.placed.filter((p) => p.col >= c0 && p.col < c0 + 16);
      for (let y = 0; y < 13 * 16; y++) {
        const n = scene.playerPerLine + onScreen.reduce((s, p) => s + (y >= (p.row + 1) * 16 - p.h && y < (p.row + 1) * 16 ? p.perLine : 0), 0);
        if (n > MAX_SPRITES_PER_LINE) {
          issues.push(
            warn(
              lv.source,
              '/entities',
              `${lv.name ? `« ${lv.name.fr} », ` : ''}écran ${Math.floor(c0 / 16) + 1} : jusqu’à ${n} sprites sur une même ligne (la NES en montre 8) : ça va clignoter. Écarte les ennemis en hauteur.`,
              `${lv.name ? `"${lv.name.en}", ` : ''}screen ${Math.floor(c0 / 16) + 1}: up to ${n} sprites on one line (the NES shows 8): it will flicker. Spread the enemies vertically.`,
            ),
          );
          flagged = true;
          break;
        }
      }
    }
  }
  return issues;
}

/** Checks of one graphic on its own, used or not (PLAN §6.1 + converter contract). */
export function validateGraphicsDoc(path: string, g: GraphicsDoc): Issue[] {
  const issues: Issue[] = [];
  if (g.kind === 'sprite') {
    const role = g.role as SpriteRole;
    for (const s of g.palettes.slots) {
      if (!ROLE_SPRITE_SLOTS[role].includes(s.slot)) {
        issues.push(err(path, '/palettes/slots', `palette de sprites ${s.slot} interdite pour les ${ROLE_FR[role]}`, `sprite palette ${s.slot} not allowed for ${role}`));
      }
    }
    const animBank = new Map<string, number>();
    for (const f of g.frames ?? []) {
      if (role === 'boss' && f.w > MAX_BOSS_WIDTH) {
        issues.push(err(path, '/frames', `boss de ${f.w} pixels de large : ${MAX_BOSS_WIDTH} au plus en sprites`, `boss ${f.w} px wide: ${MAX_BOSS_WIDTH} at most as sprites`));
      }
      if (f.sprites.length > MAX_SPRITES_PER_FRAME) issues.push(err(path, '/frames', `image « ${f.name} » : ${f.sprites.length} sprites (max 64)`, `frame "${f.name}": ${f.sprites.length} sprites (max 64)`));
      if (role !== 'player' && f.bank !== 0) issues.push(err(path, '/frames', `seul le héros a plusieurs banques`, `only the hero has several banks`));
      const a = animationOf(f.name);
      const b = animBank.get(a);
      if (b !== undefined && b !== f.bank) issues.push(err(path, '/frames', `l’animation « ${a} » est coupée entre deux banques`, `animation "${a}" is split across banks`));
      animBank.set(a, f.bank);
      for (const s of f.sprites) {
        const bank = g.budget.banks.find((x) => x.index === f.bank);
        if (bank && s.tile >= bank.tiles) issues.push(err(path, '/frames', `image « ${f.name} » : tuile ${s.tile} absente de la banque ${f.bank}`, `frame "${f.name}": tile ${s.tile} not in bank ${f.bank}`));
      }
    }
    for (const b of g.budget.banks) {
      if (b.tiles > SPRITE_BANK_TILES) issues.push(err(path, '/budget/banks', `banque ${b.index} : ${b.tiles} tuiles (max ${SPRITE_BANK_TILES})`, `bank ${b.index}: ${b.tiles} tiles (max ${SPRITE_BANK_TILES})`));
    }
  } else if (g.budget.tiles > BG_SET_TILES) {
    issues.push(err(path, '/budget/tiles', `${g.budget.tiles} tuiles de fond (max ${BG_SET_TILES})`, `${g.budget.tiles} background tiles (max ${BG_SET_TILES})`));
  }
  return issues;
}

// ---------- scenes from a project ----------

/** Graphic named by `graphics/<id>.json` or by its `.chr` path. */
function graphicsByRef(docs: Record<string, Json>, ref: string): { path: string; doc: GraphicsDoc } | null {
  const path = ref.endsWith('.chr') ? ref.replace(/\.chr$/, '.json') : ref;
  const d = docs[path] as unknown as GraphicsDoc | undefined;
  return d && d.format === 'nbf-graphics' ? { path, doc: d } : null;
}

export const usesOf = (path: string, g: GraphicsDoc): PaletteUse[] => g.palettes.slots.map((s) => ({ source: path, slot: s.slot, colors: g.palettes.mode === 'free' ? s.colors : null }));

let builtinCounts: { jardin: number; player: number; walker: number } | null = null;
function builtins() {
  if (!builtinCounts) {
    const p = new TileBank('p', 64);
    buildPlayer(p);
    const wb = new TileBank('w', 64);
    buildBuiltinEnemy('walker', wb, 2);
    builtinCounts = { jardin: buildJardinBank().bank.count, player: p.count, walker: wb.count };
  }
  return builtinCounts;
}

/** One scene per story world, from the project documents (the emitter's view of the cartridge). */
export function collectWorldScenes(docs: Record<string, Json>): WorldScene[] {
  const story = docs['story.json'] as unknown as Story | undefined;
  const palettes = docs['graphics/palettes.json'] as unknown as Palettes | undefined;
  const physics = docs['physics.json'] as unknown as Physics | undefined;
  if (!story || !palettes) return [];
  const projectiles = physics?.projectile.enabled ? physics.projectile.maxOnScreen : 0;
  const player = docs['actors/player.json'] as unknown as PlayerActor | undefined;
  const playerG = player ? graphicsByRef(docs, player.graphics) : null;

  return story.worlds.map((world) => {
    const set = palettes.sets.find((s) => s.id === world.id) ?? palettes.sets[0] ?? null;
    const scene: WorldScene = {
      world: world.id,
      set,
      bg: [{ source: 'HUD', slot: 0, colors: null }],
      sprites: [],
      bgTiles: [],
      spriteBanks: [],
      bosses: [],
      levels: [],
      playerPerLine: 2 + projectiles,
    };
    if (playerG) {
      scene.sprites.push(...usesOf(playerG.path, playerG.doc).map((u) => ({ ...u, role: 'player' as const })));
      for (const b of playerG.doc.budget.banks) scene.spriteBanks.push({ source: playerG.path, name: `héros ${b.index}`, tiles: b.tiles });
      scene.playerPerLine = Math.max(...(playerG.doc.frames ?? []).map((f) => f.maxPerLine), 1) + projectiles;
    } else {
      scene.sprites.push({ source: 'builtin:hero', slot: 0, colors: null, role: 'player' });
      scene.spriteBanks.push({ source: 'builtin:hero', name: 'héros', tiles: builtins().player });
    }
    const tilesets = new Set<string>();
    const enemyGraphics = new Map<string, number>();
    for (const st of world.stages) {
      const lpath = `levels/${st.id}.json`;
      const level = docs[lpath] as unknown as Level | undefined;
      if (!level) continue;
      const tileset = docs[`tilesets/${level.tileset}.json`] as unknown as Tileset | undefined;
      if (tileset && !tilesets.has(tileset.chr)) {
        tilesets.add(tileset.chr);
        const g = graphicsByRef(docs, tileset.chr);
        if (g) {
          scene.bg.push(...usesOf(g.path, g.doc));
          scene.bgTiles.push({ source: g.path, tiles: g.doc.budget.tiles });
        } else scene.bgTiles.push({ source: `tilesets/${tileset.id}.json`, tiles: builtins().jardin });
      }
      const placed: Placed[] = [];
      for (const e of level.entities) {
        const apath = `actors/${e.actor}.json`;
        const actor = docs[apath] as unknown as EnemyActor | undefined;
        if (!actor || actor.kind !== 'enemy') continue;
        const g = graphicsByRef(docs, actor.graphics);
        if (g) {
          if (!enemyGraphics.has(g.path)) {
            enemyGraphics.set(g.path, g.doc.budget.tiles);
            scene.sprites.push(...usesOf(g.path, g.doc).map((u) => ({ ...u, role: 'enemy' as const })));
          }
          const f = g.doc.frames?.[0];
          placed.push({ source: apath, col: e.col, row: e.row, h: f?.h ?? 16, perLine: Math.max(1, f?.maxPerLine ?? 2) });
        } else {
          if (!enemyGraphics.has(actor.graphics)) {
            enemyGraphics.set(actor.graphics, builtins().walker);
            scene.sprites.push({ source: actor.graphics, slot: 2, colors: null, role: 'enemy' });
          }
          placed.push({ source: apath, col: e.col, row: e.row, h: 16, perLine: 2 });
        }
      }
      scene.levels.push({ source: lpath, name: { fr: level.name?.fr ?? level.id, en: level.name?.en ?? level.id }, width: level.width, placed });
    }
    if (enemyGraphics.size) scene.spriteBanks.push({ source: [...enemyGraphics.keys()][0]!, name: 'ennemis', tiles: [...enemyGraphics.values()].reduce((a, b) => a + b, 0) });
    return scene;
  });
}

/** Every world of the project + every graphic on its own. */
export function validateProjectBudgets(docs: Record<string, Json>): Issue[] {
  const issues: Issue[] = [];
  for (const [p, v] of Object.entries(docs)) {
    const g = v as unknown as GraphicsDoc;
    if (/^graphics\/[a-z0-9-]+\.json$/.test(p) && g && (g as { format?: string }).format === 'nbf-graphics') issues.push(...validateGraphicsDoc(p, g));
  }
  for (const scene of collectWorldScenes(docs)) issues.push(...validateWorldScene(scene));
  return issues;
}
