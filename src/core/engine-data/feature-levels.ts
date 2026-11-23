// Feature test levels (MILESTONES M4-T3/T4/T5/T10/T11): one small project per engine feature, built on
// the demo project. The jsnes engine tier plays them with input scripts; the Mesen tier replays the
// same inputs. Also handy as a quick look at each feature in the emulator.
import { DEFAULT_AUDIO } from '../schema/misc.js';
import { DEFAULT_PHYSICS } from '../schema/physics.js';
import { DEFAULT_CARTRIDGE } from '../schema/project.js';
import { DEFAULT_STORY } from '../schema/story.js';
import type { BossActor, EnemyActor, Level } from '../schema/engine-docs.js';
import type { Json } from '../util/json-pointer.js';
import type { BossScript } from './boss-dsl.js';
import { demoDocs, makeGrid, MT } from './demo.js';

type Cell = [col: number, row: number];
type Place = Array<[number, Cell[]]>;

/** M1 defaults + the demo stage: what a new project contains (without the CHROMA placeholder art). */
export function demoProject(): Record<string, Json> {
  return structuredClone({
    'cartridge.json': DEFAULT_CARTRIDGE,
    'story.json': { ...DEFAULT_STORY, title: 'BLUM DEMO' },
    'physics.json': DEFAULT_PHYSICS,
    'audio/library.json': DEFAULT_AUDIO,
    ...demoDocs(),
  }) as unknown as Record<string, Json>;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export function enemy(pattern: EnemyActor['pattern'], extra: Partial<EnemyActor> = {}): EnemyActor {
  const names: Record<string, string> = { walker: 'Rampeur', hopper: 'Sauteur', flyer: 'Volant', shooter: 'Cracheur' };
  return {
    schemaVersion: 1,
    kind: 'enemy',
    name: { fr: names[pattern] ?? pattern },
    pattern,
    speed: 0,
    hp: 1,
    damage: 1,
    turnAtLedge: false,
    graphics: `builtin:${['walker', 'hopper', 'flyer', 'shooter'].includes(pattern) ? pattern : 'walker'}`,
    ...extra,
  };
}

interface FixtureSpec {
  width?: number;
  place?: Place;
  pits?: number[];
  spawn: Cell;
  entities?: Level['entities'];
  actors?: Record<string, EnemyActor | BossActor>;
  scripts?: Record<string, BossScript>;
  physics?: Record<string, unknown>;
}

/** Demo project with its single stage replaced. */
export function fixture(spec: FixtureSpec): Record<string, Json> {
  const docs = demoProject();
  const width = spec.width ?? 32;
  const level = docs['levels/niveau-1.json'] as unknown as Level;
  docs['levels/niveau-1.json'] = {
    ...level,
    width,
    grid: makeGrid(width, spec.place ?? [], { pits: spec.pits ?? [] }),
    spawn: { col: spec.spawn[0], row: spec.spawn[1] },
    entities: spec.entities ?? [],
  } as unknown as Json;
  for (const [id, a] of Object.entries(spec.actors ?? {})) docs[`actors/${id}.json`] = structuredClone(a) as unknown as Json;
  for (const [id, s] of Object.entries(spec.scripts ?? {})) docs[`scripts/${id}.json`] = structuredClone(s) as unknown as Json;
  if (spec.physics) docs['physics.json'] = { ...(docs['physics.json'] as object), ...spec.physics } as unknown as Json;
  return docs;
}

export const BOSS_FIXTURE_SCRIPT: BossScript = {
  schemaVersion: 1,
  phases: [
    { steps: [{ op: 'vulnerable', on: true }, { op: 'wait', frames: 60 }, { op: 'shoot', pattern: 'aimed', speed: 32 }, { op: 'wait', frames: 60 }] },
    {
      hpBelow: 2,
      steps: [
        { op: 'flash', frames: 20 },
        { op: 'jump', vx: 0, vy: 48 },
        { op: 'wait', frames: 30 },
        { op: 'shoot', pattern: 'spread', speed: 32 },
        { op: 'wait', frames: 30 },
      ],
    },
  ],
};

/** The feature levels by name. */
export const FEATURE_LEVELS = {
  /** Flat ground: single jump vs jump + double jump. */
  doubleJump: () => fixture({ spawn: [2, 10], place: [[MT.exit, [[30, 10]]]] }),
  /** Ladder from the ground to a ledge at row 4. */
  ladder: () => fixture({ spawn: [6, 10], place: [[MT.ladder, range(4, 10).map((r) => [6, r] as Cell)], [MT.block, range(7, 12).map((c) => [c, 4] as Cell)], [MT.exit, [[30, 10]]]] }),
  /** A still walker with 2 hp in front of the player. */
  projectile: () =>
    fixture({ spawn: [3, 10], place: [[MT.exit, [[30, 10]]]], entities: [{ actor: 'statue', col: 10, row: 10 }], actors: { statue: enemy('walker', { hp: 2 }) } }),
  /** A walker coming at the player: hurt, knockback, iframes. */
  knockback: () =>
    fixture({ spawn: [3, 10], place: [[MT.exit, [[30, 10]]]], entities: [{ actor: 'rampeur2', col: 9, row: 10, facing: 'left' }], actors: { rampeur2: enemy('walker', { speed: 128 }) } }),
  /** A ledge at row 8 above the ground; double jump off so a late press does nothing. */
  coyote: () =>
    fixture({
      spawn: [2, 7],
      place: [[MT.block, range(0, 7).map((c) => [c, 8] as Cell)], [MT.exit, [[30, 10]]]],
      physics: { doubleJump: { enabled: false, velocity: 896 } },
    }),
  /** Walker between two walls. */
  walker: () =>
    fixture({
      spawn: [1, 10],
      place: [[MT.block, [[8, 10], [15, 10]]], [MT.exit, [[30, 10]]]],
      entities: [{ actor: 'rampeur2', col: 11, row: 10 }],
      actors: { rampeur2: enemy('walker', { speed: 192 }) },
    }),
  hopper: () =>
    fixture({ spawn: [1, 10], place: [[MT.exit, [[30, 10]]]], entities: [{ actor: 'sauteur', col: 12, row: 10 }], actors: { sauteur: enemy('hopper', { period: 40, jump: 896 }) } }),
  flyer: () =>
    fixture({ spawn: [1, 10], place: [[MT.exit, [[30, 10]]]], entities: [{ actor: 'volant', col: 12, row: 6 }], actors: { volant: enemy('flyer', { period: 64, amplitude: 24 }) } }),
  shooter: () =>
    fixture({ spawn: [2, 10], place: [[MT.exit, [[30, 10]]]], entities: [{ actor: 'cracheur', col: 12, row: 10 }], actors: { cracheur: enemy('shooter', { period: 50, shotSpeed: 384 }) } }),
  /** 2-screen arena with a 4 hp, 2-phase boss at the right. */
  boss: () =>
    fixture({
      spawn: [2, 10],
      place: [[MT.block, [[31, 9], [31, 10]]]],
      entities: [{ actor: 'gros-rampeur', col: 24, row: 10 }],
      actors: { 'gros-rampeur': { schemaVersion: 1, kind: 'boss', name: { fr: 'Gros rampeur' }, hp: 4, damage: 1, graphics: 'builtin:boss', script: 'gros-rampeur' } },
      scripts: { 'gros-rampeur': BOSS_FIXTURE_SCRIPT },
    }),
  /** Lag stress: 6 enemies on one screen (2 shooters) while the player fires. */
  stress: () =>
    fixture({
      spawn: [2, 10],
      place: [[MT.exit, [[30, 10]]]],
      entities: [
        { actor: 'rampeur2', col: 8, row: 10 },
        { actor: 'sauteur', col: 10, row: 10 },
        { actor: 'volant', col: 11, row: 6 },
        { actor: 'cracheur', col: 13, row: 10 },
        { actor: 'cracheur', col: 14, row: 8 },
        { actor: 'volant', col: 15, row: 4 },
      ],
      actors: {
        rampeur2: enemy('walker', { speed: 128, hp: 8 }),
        sauteur: enemy('hopper', { period: 30, hp: 8 }),
        volant: enemy('flyer', { period: 48, speed: 64, hp: 8 }),
        cracheur: enemy('shooter', { period: 30, hp: 8 }),
      },
      physics: { health: { hp: 8, knockback: { x: 384, y: 512 }, iframes: 180 } },
    }),
} as const;
export type FeatureLevel = keyof typeof FEATURE_LEVELS;
