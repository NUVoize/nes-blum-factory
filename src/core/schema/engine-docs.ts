import { z } from 'zod';
import { BEHAVIOUR, LEVEL_ROWS, MAX_METATILES, type BehaviourName } from '../engine-data/contract.js';
import { localizedText, schemaVersion, slugSchema } from './common.js';

// ENGINE_DATA_VERSION 1 documents read by the emitter (M2b). M4b's editors write the same shapes.

const behaviourNames = Object.keys(BEHAVIOUR) as [BehaviourName, ...BehaviourName[]];

export const metatileSchema = z
  .object({
    id: z.number().int().min(0).max(MAX_METATILES - 1),
    name: z.string().min(1).max(24),
    /** 4 BG tile indices in the world's CHR set: top-left, top-right, bottom-left, bottom-right. */
    tiles: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
    /** BG subpalette 0-3 (0 is shared with the HUD). */
    palette: z.number().int().min(0).max(3),
    behaviour: z.enum(behaviourNames),
  })
  .strict();
export type Metatile = z.infer<typeof metatileSchema>;

export const tilesetSchema = z
  .object({
    schemaVersion,
    id: slugSchema,
    /** `builtin:<name>` (shipped placeholder CHR) or `graphics/<id>.chr` (CHROMA, M3). */
    chr: z.string().regex(/^(builtin:[a-z0-9-]+|graphics\/[a-z0-9-]{1,32}\.chr)$/),
    /** Metatile drawn when a collectible is taken. */
    empty: z.number().int().min(0).max(MAX_METATILES - 1),
    metatiles: z.array(metatileSchema).min(1).max(MAX_METATILES),
  })
  .strict()
  .superRefine((t, ctx) => {
    const ids = new Set<number>();
    t.metatiles.forEach((m, i) => {
      if (ids.has(m.id)) ctx.addIssue({ code: 'custom', path: ['metatiles', i, 'id'], message: `id de métatuile en double : ${m.id}` });
      ids.add(m.id);
    });
    if (!ids.has(t.empty)) ctx.addIssue({ code: 'custom', path: ['empty'], message: `métatuile vide ${t.empty} absente` });
  });
export type Tileset = z.infer<typeof tilesetSchema>;

const cell = z.object({ col: z.number().int().min(0).max(255), row: z.number().int().min(0).max(LEVEL_ROWS - 1) }).strict();

export const levelEntitySchema = z
  .object({
    actor: slugSchema,
    col: z.number().int().min(0).max(255),
    row: z.number().int().min(0).max(LEVEL_ROWS - 1),
    facing: z.enum(['left', 'right']).optional(),
  })
  .strict();

export const levelSchema = z
  .object({
    schemaVersion,
    id: slugSchema,
    name: localizedText(24),
    /** World id (story.json) whose palette set and CHR banks the stage uses. */
    world: slugSchema,
    tileset: slugSchema,
    /** Width in metatile columns (16 per screen). */
    width: z.number().int().min(16).max(256),
    /** LEVEL_ROWS rows of `width` metatile ids. */
    grid: z.array(z.array(z.number().int().min(0).max(MAX_METATILES - 1))).length(LEVEL_ROWS),
    spawn: cell,
    entities: z.array(levelEntitySchema).max(64),
    /** Song id from the built-in library. */
    music: z.string().min(1).max(32),
    /** M6: song when the boss appears (default « boss »). */
    bossMusic: z.string().min(1).max(32).optional(),
  })
  .strict()
  .superRefine((l, ctx) => {
    l.grid.forEach((row, r) => {
      if (row.length !== l.width) ctx.addIssue({ code: 'custom', path: ['grid', r], message: `la ligne ${r} a ${row.length} colonnes au lieu de ${l.width}` });
    });
    if (l.spawn.col >= l.width) ctx.addIssue({ code: 'custom', path: ['spawn', 'col'], message: 'le départ est hors du niveau' });
    l.entities.forEach((e, i) => {
      if (e.col >= l.width) ctx.addIssue({ code: 'custom', path: ['entities', i, 'col'], message: 'ennemi hors du niveau' });
    });
  });
export type Level = z.infer<typeof levelSchema>;

/** Enemy AI patterns. Floor: walker, hopper, flyer, shooter; the other four are stretch (`extraEnemies`). */
export const ENEMY_PATTERNS = ['walker', 'hopper', 'flyer', 'shooter', 'patrol', 'chaser', 'turret', 'dropper'] as const;
export type EnemyPattern = (typeof ENEMY_PATTERNS)[number];

/** Per-pattern parameter defaults (M4a). `period` in frames; `jump`/`shotSpeed` in 1/256 px per frame. */
export const ENEMY_DEFAULTS = {
  hopper: { period: 60, jump: 896 },
  flyer: { period: 96, amplitude: 24 },
  shooter: { period: 90, shotSpeed: 384 },
} as const;

export const ENEMY_LIMITS = {
  speed: [0, 768],
  hp: [1, 8],
  damage: [1, 4],
  period: [16, 255],
  jump: [256, 1536],
  amplitude: [4, 48],
  shotSpeed: [128, 1024],
} as const satisfies Record<string, readonly [number, number]>;

const lim = (k: keyof typeof ENEMY_LIMITS) => z.number().int().min(ENEMY_LIMITS[k][0]).max(ENEMY_LIMITS[k][1]);

/** Enemy actor (`actors/<id>.json`, kind "enemy"). */
export const enemyActorSchema = z
  .object({
    schemaVersion,
    kind: z.literal('enemy'),
    name: localizedText(24),
    pattern: z.enum(ENEMY_PATTERNS),
    /** Horizontal speed, 1/256 px per frame. 0 = stands still. */
    speed: lim('speed'),
    hp: lim('hp'),
    damage: lim('damage'),
    turnAtLedge: z.boolean(),
    /** `builtin:<name>` or `graphics/<id>.json` (M3). */
    graphics: z.string().regex(/^(builtin:[a-z0-9-]+|graphics\/[a-z0-9-]{1,32}\.json)$/),
    /** CHROMA graphics: the 2 walk frames by name (default: the first two frames). */
    frames: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/)).min(1).max(2).optional(),
    /** M4a. hopper: frames between hops; flyer: frames per wave; shooter: frames between shots. */
    period: lim('period').optional(),
    /** M4a hopper: jump speed. */
    jump: lim('jump').optional(),
    /** M4a flyer: wave height in pixels (up and down from the start). */
    amplitude: lim('amplitude').optional(),
    /** M4a shooter: projectile speed. */
    shotSpeed: lim('shotSpeed').optional(),
  })
  .strict();
export type EnemyActor = z.infer<typeof enemyActorSchema>;

/** Boss actor (`actors/<id>.json`, kind "boss", M4a). Its behaviour is `scripts/<script>.json` (boss DSL). */
export const bossActorSchema = z
  .object({
    schemaVersion,
    kind: z.literal('boss'),
    name: localizedText(24),
    hp: z.number().int().min(1).max(32),
    damage: z.number().int().min(1).max(4),
    /** `builtin:boss` or a CHROMA graphic with role boss (≤ 32 px wide). */
    graphics: z.string().regex(/^(builtin:[a-z0-9-]+|graphics\/[a-z0-9-]{1,32}\.json)$/),
    frames: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/)).min(1).max(2).optional(),
    script: slugSchema,
  })
  .strict();
export type BossActor = z.infer<typeof bossActorSchema>;

/** Any actor document other than the player. */
export const actorSchema = z.discriminatedUnion('kind', [enemyActorSchema, bossActorSchema]);
export type Actor = z.infer<typeof actorSchema>;
