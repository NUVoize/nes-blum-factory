// BOULON (build director, PLAN §4.1 / §7): his repairs are normal proposals that change other documents.
// `propose_split_stage` cuts a stage that is too long into two stages in a row (the first one ends on an
// exit, the second starts on solid ground); approved by Blum like any other proposal.
import { z } from 'zod';
import { LEVEL_ROWS } from '../engine-data/contract.js';
import { FLOOR_MAX_WIDTH } from '../engine-data/emit.js';
import type { Op } from '../project/ops.js';
import { slugSchema } from '../schema/common.js';
import type { Level, Tileset } from '../schema/engine-docs.js';
import { STORY_LIMITS, type Story } from '../schema/story.js';
import type { Json } from '../util/json-pointer.js';
import type { DirectorTool, ToolOutput } from './specs.js';

export const splitStageInput = z
  .object({
    stage: slugSchema.describe('Stage id to split (levels/<id>.json)'),
    at: z.number().int().min(16).max(240).optional().describe('Column where the second stage starts (default: a column near the middle with ground on both sides)'),
  })
  .strict();
export type SplitStageInput = z.infer<typeof splitStageInput>;

const MIN_PART = 16;

function behaviourOf(t: Tileset): (id: number) => string {
  const m = new Map(t.metatiles.map((x) => [x.id, x.behaviour]));
  return (id) => m.get(id) ?? 'empty';
}

/** Topmost row r of column c with solid ground under two free rows (where a hero can stand), or -1. */
function standRow(level: Level, t: Tileset, c: number): number {
  const b = behaviourOf(t);
  const free = (r: number) => r >= 0 && ['empty', 'collectible', 'checkpoint'].includes(b(level.grid[r]![c]!));
  for (let r = 2; r < LEVEL_ROWS; r++) {
    const ground = b(level.grid[r]![c]!);
    if ((ground === 'solid' || ground === 'oneWay') && free(r - 1) && free(r - 2)) return r;
  }
  return -1;
}

function unusedId(docs: Record<string, Json>, base: string): string {
  for (const suffix of ['b', '2', '3', '4', '5']) {
    const id = `${base.slice(0, 31 - suffix.length)}-${suffix}`;
    if (!(`levels/${id}.json` in docs)) return id;
  }
  throw new Error('aucun identifiant libre pour le nouveau niveau');
}

/** The split itself (pure): two levels and the story entry, or a French reason. */
export function splitStageOps(docs: Record<string, Json>, input: SplitStageInput): ToolOutput {
  const levelPath = `levels/${input.stage}.json`;
  const level = docs[levelPath] as unknown as Level | undefined;
  if (!level) throw new Error(`niveau « ${input.stage} » introuvable`);
  const tileset = docs[`tilesets/${level.tileset}.json`] as unknown as Tileset | undefined;
  if (!tileset) throw new Error(`jeu de tuiles « ${level.tileset} » introuvable`);
  const exitTile = tileset.metatiles.find((m) => m.behaviour === 'exit');
  if (!exitTile) throw new Error(`le jeu de tuiles « ${tileset.id} » n’a pas de tuile de sortie`);
  const story = docs['story.json'] as unknown as Story | undefined;
  const wi = story?.worlds.findIndex((w) => w.stages.some((s) => s.id === level.id)) ?? -1;
  if (!story || wi < 0) throw new Error(`le niveau « ${level.id} » n’est dans aucun monde de l’histoire`);
  const world = story.worlds[wi]!;
  if (world.stages.length >= STORY_LIMITS.stagesPerWorld) {
    throw new Error(`le monde « ${world.name.fr} » a déjà ${world.stages.length} niveaux (max ${STORY_LIMITS.stagesPerWorld}) : raccourcis plutôt ce niveau avec TABLEAU`);
  }
  const W = level.width;
  if (W < 2 * MIN_PART) throw new Error(`le niveau « ${level.id} » est trop court pour être coupé`);

  // cut column: both parts at most 8 screens, the first ends on ground (exit), the second starts on ground
  const lo = Math.max(MIN_PART, W - FLOOR_MAX_WIDTH);
  const hi = Math.min(FLOOR_MAX_WIDTH, W - MIN_PART);
  const candidates: number[] = [];
  if (input.at !== undefined) candidates.push(input.at);
  else for (let d = 0; d <= W; d++) for (const c of [Math.round(W / 2) - d, Math.round(W / 2) + d]) if (c >= lo && c <= hi && !candidates.includes(c)) candidates.push(c);
  let cut = -1;
  let exitRow = -1;
  let spawnCol = -1;
  let spawnRow = -1;
  for (const c of candidates) {
    if (c < lo || c > hi) continue;
    const r = standRow(level, tileset, c - 1);
    if (r < 0) continue;
    for (let k = 1; k < 8 && c + k < W; k++) {
      const sr = standRow(level, tileset, c + k);
      if (sr >= 0 && !level.entities.some((e) => e.col === c + k)) {
        cut = c;
        exitRow = r - 1;
        spawnCol = k;
        spawnRow = sr - 1;
        break;
      }
    }
    if (cut >= 0) break;
  }
  if (cut < 0) {
    throw new Error(input.at !== undefined ? `impossible de couper à la colonne ${input.at} : il faut du sol des deux côtés` : 'aucun endroit avec du sol des deux côtés pour couper ce niveau');
  }

  const newId = unusedId(docs, level.id);
  const short = (s: string, tail: string) => `${s.slice(0, 24 - tail.length)}${tail}`;
  const nameA: Level['name'] = { fr: short(level.name.fr, ' 1'), ...(level.name.en !== undefined ? { en: short(level.name.en, ' 1') } : {}) };
  const nameB: Level['name'] = { fr: short(level.name.fr, ' 2'), ...(level.name.en !== undefined ? { en: short(level.name.en, ' 2') } : {}) };
  const gridA = level.grid.map((row) => row.slice(0, cut));
  gridA[exitRow]![cut - 1] = exitTile.id;
  const partA: Level = {
    ...level,
    name: nameA,
    width: cut,
    grid: gridA,
    spawn: level.spawn.col < cut ? level.spawn : { col: 1, row: level.spawn.row },
    entities: level.entities.filter((e) => e.col < cut && !(e.col === cut - 1 && e.row === exitRow)),
  };
  const partB: Level = {
    ...level,
    id: newId,
    name: nameB,
    width: W - cut,
    grid: level.grid.map((row) => row.slice(cut)),
    spawn: { col: spawnCol, row: spawnRow },
    entities: level.entities.filter((e) => e.col >= cut).map((e) => ({ ...e, col: e.col - cut })),
  };
  const si = world.stages.findIndex((s) => s.id === level.id);
  const ops: Op[] = [
    { op: 'set', doc: levelPath, value: partA as unknown as Json },
    { op: 'set', doc: `levels/${newId}.json`, value: partB as unknown as Json },
    { op: 'patch', doc: 'story.json', pointer: `/worlds/${wi}/stages/${si}/name`, value: nameA as unknown as Json },
    { op: 'add', doc: 'story.json', pointer: `/worlds/${wi}/stages/${si + 1}`, value: { id: newId, name: nameB } as unknown as Json },
  ];
  const screens = (w: number) => Math.ceil(w / 16);
  return {
    ops,
    summary: {
      fr: `Couper « ${level.name.fr} » (${screens(W)} écrans) en deux niveaux : « ${nameA.fr} » (${screens(cut)} écrans, finit sur une sortie) puis « ${nameB.fr} » (${screens(W - cut)} écrans).`,
      en: `Split "${level.name.en ?? level.name.fr}" (${screens(W)} screens) into two stages: "${nameA.en ?? nameA.fr}" (${screens(cut)} screens, ends on an exit) then "${nameB.en ?? nameB.fr}" (${screens(W - cut)} screens).`,
    },
  };
}

export const proposeSplitStage: DirectorTool<SplitStageInput> = {
  name: 'propose_split_stage',
  description: 'Split a stage that is too long (more than 8 screens) into two stages in a row: the first ends on an exit, the second starts on ground. Use it when the build report says a stage is too wide or a data bank overflows.',
  input: splitStageInput,
  toOps: (input, docs) => splitStageOps(docs, input),
};

/** What BOULON sees: the cartridge and each stage's size and world. */
export function boulonContext(docs: Record<string, Json>): Json {
  const story = docs['story.json'] as unknown as Story | undefined;
  const stages = Object.entries(docs)
    .filter(([p]) => /^levels\/[a-z0-9-]+\.json$/.test(p))
    .map(([, v]) => {
      const l = v as unknown as Level;
      return { id: l.id, world: l.world, width: l.width, screens: Math.ceil(l.width / 16), enemies: l.entities.length };
    });
  return {
    cartridge: docs['cartridge.json'] ?? null,
    worlds: story?.worlds.map((w) => ({ id: w.id, stages: w.stages.map((s) => s.id) })) ?? [],
    stages,
  } as unknown as Json;
}
