// The demo game every new project starts from (PLAN §1.2 "a project always builds"): one world, one
// 4-screen stage on the built-in "jardin" tileset, one walker enemy type. M2b acceptance tests play it.
import type { Json } from '../util/json-pointer.js';
import type { Palettes } from '../schema/misc.js';
import type { EnemyActor, Level, Metatile, Tileset } from '../schema/engine-docs.js';
import { buildJardinBank } from './builtin-chr.js';

export const DEMO_PALETTES: Palettes = {
  schemaVersion: 1,
  sets: [
    {
      id: 'monde-1',
      backdrop: 0x21,
      bg: [
        [0x0f, 0x30, 0x16], // 0: HUD (shared): dark, white, red
        [0x0f, 0x17, 0x2a], // 1: ground: dark, brown, green
        [0x0f, 0x17, 0x37], // 2: wood and stone: dark, brown, beige
        [0x0f, 0x30, 0x25], // 3: items and hazards: dark, white, pink
      ],
      sprites: [
        [0x0f, 0x36, 0x29], // 0: player
        [0x0f, 0x30, 0x27], // 1: common
        [0x0f, 0x24, 0x14], // 2: enemies
        [0x0f, 0x16, 0x26], // 3: enemies + boss
      ],
    },
  ],
};

/** Metatile ids of the built-in "jardin" tileset. */
export const MT = { sky: 0, grass: 1, dirt: 2, block: 3, plank: 4, ladder: 5, spikes: 6, flower: 7, checkpoint: 8, exit: 9, cloud: 10, bush: 11 } as const;

const JARDIN_QUADS = buildJardinBank().quads;

const JARDIN_SPEC: Array<[keyof typeof MT, string, number, Metatile['behaviour']]> = [
  ['sky', 'ciel', 0, 'empty'],
  ['grass', 'herbe', 1, 'solid'],
  ['dirt', 'terre', 1, 'solid'],
  ['block', 'bloc', 2, 'solid'],
  ['plank', 'planche', 2, 'oneWay'],
  ['ladder', 'échelle', 2, 'ladder'],
  ['spikes', 'pics', 3, 'hazard'],
  ['flower', 'fleur', 3, 'collectible'],
  ['checkpoint', 'drapeau', 3, 'checkpoint'],
  ['exit', 'sortie', 3, 'exit'],
  ['cloud', 'nuage', 0, 'empty'],
  ['bush', 'buisson', 1, 'empty'],
];

export const JARDIN_TILESET: Tileset = {
  schemaVersion: 1,
  id: 'jardin',
  chr: 'builtin:jardin',
  empty: MT.sky,
  // `tiles` index the built-in jardin CHR set (engine-data/builtin-chr.ts).
  metatiles: JARDIN_SPEC.map(([key, name, palette, behaviour]) => ({ id: MT[key], name, tiles: JARDIN_QUADS[key]!, palette, behaviour })),
};

export const RAMPEUR: EnemyActor = {
  schemaVersion: 1,
  kind: 'enemy',
  name: { fr: 'Rampeur', en: 'Crawler' },
  pattern: 'walker',
  speed: 128,
  hp: 1,
  damage: 1,
  turnAtLedge: true,
  graphics: 'builtin:walker',
};

type Cell = [col: number, row: number];

/** Build a grid from a ground line plus placed cells. */
export function makeGrid(width: number, place: Array<[number, Cell[]]>, opts: { pits?: number[] } = {}): number[][] {
  const grid = Array.from({ length: 13 }, () => Array<number>(width).fill(MT.sky));
  for (let c = 0; c < width; c++) {
    if (opts.pits?.includes(c)) continue;
    grid[11]![c] = MT.grass;
    grid[12]![c] = MT.dirt;
  }
  for (const [mt, cells] of place) for (const [c, r] of cells) grid[r]![c] = mt;
  return grid;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const DEMO_LEVEL: Level = {
  schemaVersion: 1,
  id: 'niveau-1',
  name: { fr: 'Premiers pas', en: 'First steps' },
  world: 'monde-1',
  tileset: 'jardin',
  width: 64,
  grid: makeGrid(
    64,
    [
      [MT.cloud, [[4, 2], [13, 1], [24, 3], [37, 2], [50, 1], [58, 3]]],
      [MT.bush, [[7, 10], [28, 10], [41, 10]]],
      [MT.block, [[0, 9], [0, 10], [26, 9], [26, 10], [44, 10], [63, 9], [63, 10]]],
      [MT.plank, range(10, 13).map((c) => [c, 8] as Cell)],
      [MT.flower, [[11, 7], [12, 7], [47, 4], [49, 4], [51, 4]]],
      [MT.spikes, [[17, 10]]],
      [MT.checkpoint, [[30, 10]]],
      [MT.plank, [46, 47, 49, 50, 51, 52].map((c) => [c, 5] as Cell)],
      [MT.ladder, range(5, 10).map((r) => [48, r] as Cell)],
      [MT.exit, [[61, 10]]],
    ],
    { pits: [21, 22, 34, 35] },
  ),
  spawn: { col: 2, row: 10 },
  entities: [
    { actor: 'rampeur', col: 39, row: 10, facing: 'left' },
    { actor: 'rampeur', col: 55, row: 10, facing: 'left' },
  ],
  music: 'stage',
};

/** Documents added to a new project on top of the M1 defaults. */
export function demoDocs(): Record<string, Json> {
  return {
    'graphics/palettes.json': DEMO_PALETTES as unknown as Json,
    'tilesets/jardin.json': JARDIN_TILESET as unknown as Json,
    'levels/niveau-1.json': DEMO_LEVEL as unknown as Json,
    'actors/rampeur.json': RAMPEUR as unknown as Json,
  };
}
