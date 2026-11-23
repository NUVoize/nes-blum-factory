// TABLEAU (level director, PLAN §4.1 / §5.6): stages as metatile grids, entities, music. The grid editor
// and the AI share `propose_level`; the AI writes rows of characters with a legend (compact and easy to
// read back), the editor sends the numeric grid.
import { z } from 'zod';
import { LEVEL_ROWS } from '../engine-data/contract.js';
import { SONG_LIBRARY } from '../engine-data/emit.js';
import type { Op } from '../project/ops.js';
import { localizedText, slugSchema } from '../schema/common.js';
import type { Level, Tileset } from '../schema/engine-docs.js';
import type { Story } from '../schema/story.js';
import type { Json } from '../util/json-pointer.js';
import type { DirectorTool } from './specs.js';

/** Default legend characters by behaviour: the first metatile of each behaviour gets the character. */
const BEHAVIOUR_CHAR: Record<string, string> = {
  empty: '.',
  solid: '#',
  oneWay: '=',
  ladder: 'H',
  hazard: '^',
  collectible: '*',
  checkpoint: 'F',
  exit: 'E',
};

/** Character legend of a tileset: behaviour defaults, then letters and digits for the other metatiles. */
export function defaultLegend(t: Tileset): Record<string, number> {
  const legend: Record<string, number> = { '.': t.empty };
  for (const m of t.metatiles) {
    const ch = BEHAVIOUR_CHAR[m.behaviour];
    if (ch && legend[ch] === undefined) legend[ch] = m.id;
  }
  const spare = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
  for (const m of t.metatiles) {
    if (Object.values(legend).includes(m.id)) continue;
    const ch = spare.shift();
    if (!ch) break;
    legend[ch] = m.id;
  }
  return legend;
}

export function gridToRows(grid: number[][], legend: Record<string, number>): string[] {
  const back = new Map<number, string>();
  for (const [ch, id] of Object.entries(legend)) if (!back.has(id)) back.set(id, ch);
  return grid.map((row) => row.map((id) => back.get(id) ?? '?').join(''));
}

const entitySchema = z
  .object({
    actor: slugSchema,
    col: z.number().int().min(0).max(255),
    row: z.number().int().min(0).max(LEVEL_ROWS - 1),
    facing: z.enum(['left', 'right']).optional(),
  })
  .strict();

export const levelInput = z
  .object({
    id: slugSchema.describe('Stage id from story.json (levels/<id>.json)'),
    name: localizedText(24).optional(),
    world: slugSchema.optional().describe('World id (default: the world that lists this stage)'),
    tileset: slugSchema.optional().describe('Tileset id (default: the stage’s current tileset, else the first one)'),
    width: z.number().int().min(16).max(256).describe('Columns (16 per screen, 128 max = 8 screens)'),
    rows: z.array(z.string()).length(LEVEL_ROWS).optional().describe('13 strings of `width` characters, top row first; characters from the legend'),
    legend: z.record(z.string().length(1), z.number().int().min(0).max(127)).optional().describe('Character -> metatile id (default legend in the context)'),
    grid: z.array(z.array(z.number().int().min(0).max(127))).length(LEVEL_ROWS).optional().describe('Numeric grid instead of rows (editor)'),
    spawn: z.object({ col: z.number().int().min(0).max(255), row: z.number().int().min(0).max(LEVEL_ROWS - 1) }).strict(),
    entities: z.array(entitySchema).max(64).default([]),
    music: z.enum(SONG_LIBRARY).default('stage'),
    bossMusic: z.enum(SONG_LIBRARY).optional().describe('Song when the boss appears (default boss)'),
  })
  .strict();
export type LevelInput = z.input<typeof levelInput>;

function worldOfStage(story: Story | undefined, id: string): string | undefined {
  return story?.worlds.find((w) => w.stages.some((s) => s.id === id))?.id;
}

export const proposeLevel: DirectorTool<z.output<typeof levelInput>> = {
  name: 'propose_level',
  description: 'Propose a whole stage: metatile rows (13 strings) with a legend, the start, enemies/boss placements and music. Replaces levels/<id>.json after approval.',
  input: levelInput,
  toOps(input, docs) {
    const story = docs['story.json'] as unknown as Story | undefined;
    const path = `levels/${input.id}.json`;
    const current = docs[path] as unknown as Level | undefined;
    const tilesetId = input.tileset ?? current?.tileset ?? firstTileset(docs);
    const tileset = docs[`tilesets/${tilesetId}.json`] as unknown as Tileset | undefined;
    if (!tileset) throw new Error(`jeu de tuiles « ${tilesetId} » introuvable`);
    let grid: number[][];
    if (input.grid) grid = input.grid;
    else if (input.rows) {
      const legend = { ...defaultLegend(tileset), ...(input.legend ?? {}) };
      grid = input.rows.map((row, r) => {
        if ([...row].length !== input.width) throw new Error(`la ligne ${r + 1} a ${[...row].length} caractères au lieu de ${input.width}`);
        return [...row].map((ch, c) => {
          const id = legend[ch];
          if (id === undefined) throw new Error(`caractère « ${ch} » inconnu (ligne ${r + 1}, colonne ${c + 1}) : ajoute-le à la légende`);
          return id;
        });
      });
    } else throw new Error('il faut les lignes (rows) ou la grille (grid) du niveau');
    const world = input.world ?? current?.world ?? worldOfStage(story, input.id) ?? story?.worlds[0]?.id ?? 'monde-1';
    const name = input.name ?? current?.name ?? story?.worlds.flatMap((w) => w.stages).find((s) => s.id === input.id)?.name ?? { fr: input.id };
    // the editor sends no boss song: a stage keeps the one it has
    const bossMusic = input.bossMusic ?? current?.bossMusic;
    const level: Level = { schemaVersion: 1, id: input.id, name, world, tileset: tileset.id, width: input.width, grid, spawn: input.spawn, entities: input.entities, music: input.music, ...(bossMusic ? { bossMusic } : {}) };
    const ops: Op[] = [{ op: 'set', doc: path, value: level as unknown as Json }];
    // a stage the story does not list yet joins its world
    const wi = story?.worlds.findIndex((w) => w.id === world) ?? -1;
    const listed = !!worldOfStage(story, input.id);
    if (story && !listed && wi >= 0) ops.push({ op: 'add', doc: 'story.json', pointer: `/worlds/${wi}/stages/-`, value: { id: input.id, name } as unknown as Json });
    return {
      ops,
      summary: {
        fr: `Niveau « ${name.fr} » : ${Math.ceil(input.width / 16)} écran(s), ${input.entities.length} personnage(s)${!listed && wi >= 0 ? ', ajouté à l’histoire' : ''}.`,
        en: `Stage "${name.en ?? name.fr}": ${Math.ceil(input.width / 16)} screen(s), ${input.entities.length} actor(s)${!listed && wi >= 0 ? ', added to the story' : ''}.`,
      },
    };
  },
};

export function firstTileset(docs: Record<string, Json>): string {
  if ('tilesets/jardin.json' in docs) return 'jardin';
  const p = Object.keys(docs).find((k) => /^tilesets\/[a-z0-9-]+\.json$/.test(k));
  return p ? p.slice('tilesets/'.length, -'.json'.length) : 'jardin';
}

/**
 * A flat starter stage (PLUME creates one per new stage so a project always builds): ground, a start
 * on the left, the exit at the right end.
 */
export function stubLevel(docs: Record<string, Json>, id: string, world: string, name: Level['name']): Level | null {
  const tilesetId = firstTileset(docs);
  const t = docs[`tilesets/${tilesetId}.json`] as unknown as Tileset | undefined;
  if (!t) return null;
  const solid = t.metatiles.find((m) => m.behaviour === 'solid');
  const exit = t.metatiles.find((m) => m.behaviour === 'exit');
  if (!solid || !exit) return null;
  const width = 32;
  const grid = Array.from({ length: LEVEL_ROWS }, (_, r) => Array.from({ length: width }, () => (r >= 11 ? solid.id : t.empty)));
  grid[10]![width - 3] = exit.id;
  return { schemaVersion: 1, id, name, world, tileset: t.id, width, grid, spawn: { col: 2, row: 10 }, entities: [], music: 'stage' };
}

/** What TABLEAU sees: the story's stages, tilesets with their legend, each level as rows, the actors. */
export function tableauContext(docs: Record<string, Json>): Json {
  const tilesets = Object.entries(docs)
    .filter(([p]) => /^tilesets\/[a-z0-9-]+\.json$/.test(p))
    .map(([, v]) => {
      const t = v as unknown as Tileset;
      const legend = defaultLegend(t);
      return {
        id: t.id,
        legend: Object.fromEntries(Object.entries(legend).map(([ch, id]) => [ch, `${id} ${t.metatiles.find((m) => m.id === id)?.name ?? ''} (${t.metatiles.find((m) => m.id === id)?.behaviour ?? 'empty'})`])),
      };
    });
  const levels = Object.entries(docs)
    .filter(([p]) => /^levels\/[a-z0-9-]+\.json$/.test(p))
    .map(([, v]) => {
      const l = v as unknown as Level;
      const t = docs[`tilesets/${l.tileset}.json`] as unknown as Tileset | undefined;
      return { id: l.id, world: l.world, tileset: l.tileset, width: l.width, spawn: l.spawn, entities: l.entities, rows: t ? gridToRows(l.grid, defaultLegend(t)) : [] };
    });
  const actors = Object.entries(docs)
    .filter(([p]) => /^actors\/[a-z0-9-]+\.json$/.test(p) && p !== 'actors/player.json')
    .map(([p, v]) => ({ id: p.slice(7, -5), kind: (v as { kind?: string }).kind, pattern: (v as { pattern?: string }).pattern }));
  const story = docs['story.json'] as unknown as Story | undefined;
  return { worlds: story?.worlds.map((w) => ({ id: w.id, stages: w.stages.map((s) => s.id) })) ?? [], tilesets, levels, actors } as unknown as Json;
}
