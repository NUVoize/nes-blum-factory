// REBOND (movement director, PLAN §4.1 / §5.5 / §5.7): player physics, enemies, bosses. The editor
// (sliders, enemy and boss forms) and the AI share these tables and tools: same Ops, same validation.
import { z } from 'zod';
import { BUILT_AI_PATTERNS, type TuningField } from '../engine-data/contract.js';
import { BOSS_OPS, DEFAULT_BOSS_SCRIPT, formatBossScript, parseBossScript, SHOOT_PATTERNS } from '../engine-data/boss-dsl.js';
import type { FeatureFlags, FeatureId } from '../features.js';
import type { Op } from '../project/ops.js';
import { localizedText, slugSchema } from '../schema/common.js';
import { ENEMY_DEFAULTS, ENEMY_LIMITS, ENEMY_PATTERNS, type BossActor, type EnemyActor, type Level } from '../schema/engine-docs.js';
import { PHYSICS_LIMITS, PHYSICS_PRESETS, type Physics, type PhysicsPresetId } from '../schema/physics.js';
import type { Json } from '../util/json-pointer.js';
import type { DirectorTool } from './specs.js';

// ---------- physics controls (REBOND sliders) ----------

export type PhysicsGroup = 'ground' | 'air' | 'jump' | 'doubleJump' | 'ladders' | 'attack' | 'health' | 'walls' | 'water' | 'melee' | 'doors';
/** speed: 1/256 px per frame, shown as px/frame; accel: 1/256 px per frame²; frames; hp; px; ratio /256. */
export type PhysicsUnit = 'speed' | 'accel' | 'frames' | 'hp' | 'px' | 'ratio' | 'count' | 'bool';

export interface PhysicsControl {
  /** JSON Pointer into physics.json. */
  pointer: string;
  group: PhysicsGroup;
  unit: PhysicsUnit;
  min: number;
  max: number;
  /** Live tuning field ($7E00 block) the emulator preview pokes, when the engine reads one. */
  tuning?: TuningField;
  /** Stretch feature the control belongs to: hidden while the flag is off (PLAN §12.2). */
  feature?: FeatureId;
}

const L = PHYSICS_LIMITS;
const c = (pointer: string, group: PhysicsGroup, unit: PhysicsUnit, lim: readonly [number, number], tuning?: TuningField, feature?: FeatureId): PhysicsControl => ({
  pointer,
  group,
  unit,
  min: lim[0],
  max: lim[1],
  ...(tuning ? { tuning } : {}),
  ...(feature ? { feature } : {}),
});
const BOOL: readonly [number, number] = [0, 1];

export const PHYSICS_CONTROLS: readonly PhysicsControl[] = [
  c('/walkAccel', 'ground', 'accel', L.walkAccel, 'walkAccel'),
  c('/runMax', 'ground', 'speed', L.runMax, 'runMax'),
  c('/friction', 'ground', 'accel', L.friction, 'friction'),
  c('/turnBoost', 'ground', 'accel', L.turnBoost, 'turnBoost'),
  c('/gravity', 'air', 'accel', L.gravity, 'gravity'),
  c('/maxFall', 'air', 'speed', L.maxFall, 'maxFall'),
  c('/airControl', 'air', 'ratio', L.airControl, 'airControl'),
  c('/jumpVelocity', 'jump', 'speed', L.jumpVelocity, 'jumpVelocity'),
  c('/jumpCut', 'jump', 'speed', L.jumpCut, 'jumpCut'),
  c('/coyoteFrames', 'jump', 'frames', L.coyoteFrames, 'coyoteFrames'),
  c('/jumpBufferFrames', 'jump', 'frames', L.jumpBufferFrames, 'jumpBufferFrames'),
  c('/doubleJump/enabled', 'doubleJump', 'bool', BOOL, 'doubleJumpEnabled'),
  c('/doubleJump/velocity', 'doubleJump', 'speed', L.doubleJumpVelocity, 'doubleJumpVelocity'),
  c('/ladders/climbSpeed', 'ladders', 'speed', L.climbSpeed, 'climbSpeed'),
  c('/ladders/canJumpOff', 'ladders', 'bool', BOOL, 'canJumpOff'),
  c('/projectile/enabled', 'attack', 'bool', BOOL, 'projectileEnabled'),
  c('/projectile/speed', 'attack', 'speed', L.projectileSpeed, 'projectileSpeed'),
  c('/projectile/maxOnScreen', 'attack', 'count', L.projectileMax, 'projectileMax'),
  c('/projectile/cooldown', 'attack', 'frames', L.projectileCooldown, 'projectileCooldown'),
  c('/health/hp', 'health', 'hp', L.hp, 'hp'),
  c('/health/knockback/x', 'health', 'speed', L.knockbackX, 'knockbackX'),
  c('/health/knockback/y', 'health', 'speed', L.knockbackY, 'knockbackY'),
  c('/health/iframes', 'health', 'frames', L.iframes, 'iframes'),
  // stretch: hidden until built (PLAN §12.2)
  c('/wallGrab/enabled', 'walls', 'bool', BOOL, undefined, 'wallGrab'),
  c('/wallGrab/wallSlideSpeed', 'walls', 'speed', L.wallSlideSpeed, undefined, 'wallGrab'),
  c('/wallGrab/wallJump/x', 'walls', 'speed', L.wallJumpX, undefined, 'wallGrab'),
  c('/wallGrab/wallJump/y', 'walls', 'speed', L.wallJumpY, undefined, 'wallGrab'),
  c('/wallGrab/wallJump/lockFrames', 'walls', 'frames', L.wallJumpLockFrames, undefined, 'wallGrab'),
  c('/swim/enabled', 'water', 'bool', BOOL, undefined, 'swim'),
  c('/swim/swimGravity', 'water', 'accel', L.swimGravity, undefined, 'swim'),
  c('/swim/strokeVelocity', 'water', 'speed', L.strokeVelocity, undefined, 'swim'),
  c('/swim/maxSwimFall', 'water', 'speed', L.maxSwimFall, undefined, 'swim'),
  c('/melee/enabled', 'melee', 'bool', BOOL, undefined, 'melee'),
  c('/melee/frames', 'melee', 'frames', L.meleeFrames, undefined, 'melee'),
  c('/melee/hitbox', 'melee', 'px', L.meleeHitbox, undefined, 'melee'),
  c('/doors/enterDelayFrames', 'doors', 'frames', L.enterDelayFrames, undefined, 'doors'),
];

/** The sliders the REBOND panel shows: stretch controls only when their feature is on. */
export function physicsControls(flags: FeatureFlags): PhysicsControl[] {
  return PHYSICS_CONTROLS.filter((x) => !x.feature || flags[x.feature]);
}

/** Read a control's value (booleans as 0/1). */
export function controlValue(p: Physics, pointer: string): number {
  let v: unknown = p;
  for (const k of pointer.split('/').slice(1)) v = (v as Record<string, unknown>)[k];
  return typeof v === 'boolean' ? (v ? 1 : 0) : (v as number);
}

/** Enemy patterns the REBOND form offers: built ones only (stretch patterns need extraEnemies and the engine). */
export function enemyPatternChoices(flags: FeatureFlags): Array<EnemyActor['pattern']> {
  return ENEMY_PATTERNS.filter((p) => (BUILT_AI_PATTERNS as readonly string[]).includes(p) && (['walker', 'hopper', 'flyer', 'shooter'].includes(p) || flags.extraEnemies));
}

// ---------- tools ----------

const physicsChange = z
  .object({
    pointer: z.string().regex(/^\/[a-zA-Z/]+$/).describe('JSON Pointer into physics.json, e.g. /gravity or /doubleJump/enabled'),
    value: z.union([z.number().int(), z.boolean()]),
  })
  .strict();
export const physicsInput = z
  .object({
    preset: z.enum(['leger', 'lourd', 'flottant']).optional().describe('Start from a preset before applying the changes'),
    changes: z.array(physicsChange).max(30),
    reason: z.string().max(200),
  })
  .strict();
export type PhysicsInput = z.infer<typeof physicsInput>;

export const proposePhysics: DirectorTool<PhysicsInput> = {
  name: 'propose_physics',
  description: 'Propose player movement parameters (integers, 1/256 px per frame). Optional preset, then pointer/value changes.',
  input: physicsInput,
  toOps(input) {
    const ops: Op[] = [];
    if (input.preset) ops.push({ op: 'set', doc: 'physics.json', value: PHYSICS_PRESETS[input.preset as PhysicsPresetId] as unknown as Json });
    for (const ch of input.changes) ops.push({ op: 'patch', doc: 'physics.json', pointer: ch.pointer, value: ch.value });
    if (ops.length === 0) throw new Error('aucun changement proposé');
    return {
      ops,
      summary: {
        fr: [input.preset ? `réglage « ${input.preset} »` : '', input.changes.length ? `${input.changes.length} changement(s)` : '', input.reason]
          .filter(Boolean)
          .join(', ')
          .replace(/^/, 'Mouvements : ') + '.',
        en: [input.preset ? `preset "${input.preset}"` : '', input.changes.length ? `${input.changes.length} change(s)` : '', input.reason]
          .filter(Boolean)
          .join(', ')
          .replace(/^/, 'Movement: ') + '.',
      },
    };
  },
};

const placeSchema = z
  .object({
    level: slugSchema.describe('Stage id (levels/<id>.json)'),
    col: z.number().int().min(0).max(255),
    row: z.number().int().min(0).max(12),
    facing: z.enum(['left', 'right']).optional(),
  })
  .strict();

const lim = (k: keyof typeof ENEMY_LIMITS) => z.number().int().min(ENEMY_LIMITS[k][0]).max(ENEMY_LIMITS[k][1]);

export const enemyInput = z
  .object({
    id: slugSchema.refine((v) => v !== 'player', { message: '« player » est réservé au héros' }).describe('Enemy id, file actors/<id>.json'),
    name: localizedText(24),
    pattern: z.enum(ENEMY_PATTERNS).describe('walker: walks, turns at walls; hopper: hops; flyer: sine wave in the air; shooter: fires at the player'),
    speed: lim('speed').describe('Horizontal speed, 1/256 px per frame (0 = stands still)'),
    hp: lim('hp'),
    damage: lim('damage'),
    turnAtLedge: z.boolean().default(false),
    graphics: z.string().regex(/^(builtin:[a-z0-9-]+|graphics\/[a-z0-9-]{1,32}\.json)$/).optional().describe('Default: the built-in drawing of the pattern'),
    frames: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/)).min(1).max(2).optional(),
    period: lim('period').optional().describe('hopper: frames between hops; flyer: frames per wave; shooter: frames between shots'),
    jump: lim('jump').optional().describe('hopper jump speed'),
    amplitude: lim('amplitude').optional().describe('flyer wave height in px'),
    shotSpeed: lim('shotSpeed').optional().describe('shooter shot speed'),
    place: z.array(placeSchema).max(12).optional().describe('Put the enemy in stages'),
  })
  .strict();
export type EnemyInput = z.input<typeof enemyInput>;

/** Ops that add entities to levels (appended to the level's entity list). */
function placeOps(docs: Record<string, Json>, actor: string, place: z.infer<typeof placeSchema>[] | undefined): Op[] {
  const ops: Op[] = [];
  for (const p of place ?? []) {
    const lp = `levels/${p.level}.json`;
    if (!(lp in docs)) throw new Error(`niveau « ${p.level} » introuvable`);
    ops.push({ op: 'add', doc: lp, pointer: '/entities/-', value: { actor, col: p.col, row: p.row, ...(p.facing ? { facing: p.facing } : {}) } });
  }
  return ops;
}

export const proposeEnemy: DirectorTool<z.output<typeof enemyInput>> = {
  name: 'propose_enemy',
  description: 'Create or replace an enemy (actors/<id>.json): AI pattern and its numbers, optionally placed in stages.',
  input: enemyInput,
  toOps(input, docs) {
    const { id, place, graphics, ...rest } = input;
    const actor: EnemyActor = {
      schemaVersion: 1,
      kind: 'enemy',
      ...rest,
      graphics: graphics ?? `builtin:${['walker', 'hopper', 'flyer', 'shooter'].includes(input.pattern) ? input.pattern : 'walker'}`,
    };
    const existed = `actors/${id}.json` in docs;
    return {
      ops: [{ op: 'set', doc: `actors/${id}.json`, value: actor as unknown as Json }, ...placeOps(docs, id, place)],
      summary: {
        fr: `Ennemi « ${input.name.fr} » (${PATTERN_FR[input.pattern]}, ${input.hp} vie(s))${existed ? ' modifié' : ''}${place?.length ? `, placé ${place.length} fois` : ''}.`,
        en: `Enemy "${input.name.en ?? input.name.fr}" (${input.pattern}, ${input.hp} hp)${existed ? ' changed' : ''}${place?.length ? `, placed ${place.length} time(s)` : ''}.`,
      },
    };
  },
};

export const PATTERN_FR: Record<EnemyActor['pattern'], string> = {
  walker: 'marcheur',
  hopper: 'sauteur',
  flyer: 'volant',
  shooter: 'tireur',
  patrol: 'patrouilleur',
  chaser: 'chasseur',
  turret: 'tourelle',
  dropper: 'largueur',
};

export const bossInput = z
  .object({
    id: slugSchema.describe('Boss id: actors/<id>.json and scripts/<id>.json'),
    name: localizedText(24),
    hp: z.number().int().min(1).max(32),
    damage: z.number().int().min(1).max(4),
    graphics: z.string().regex(/^(builtin:[a-z0-9-]+|graphics\/[a-z0-9-]{1,32}\.json)$/).default('builtin:boss').describe('builtin:boss or a CHROMA boss graphic'),
    frames: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/)).min(1).max(2).optional(),
    script: z
      .string()
      .max(2000)
      .describe(`Boss DSL, one step per line. "phase" starts the first phase, "phase hp<=N" the next one (at most 2). Ops: ${BOSS_OPS.join(', ')}. move_to <column> <speed 1-4>; wait <frames>; jump <vx -64..64> <vy 16..112>; shoot <${SHOOT_PATTERNS.join('|')}> <speed 16-96>; spawn <enemy id>; charge <speed 16-96>; vulnerable on|off; flash <frames>.`),
    place: placeSchema.optional().describe('Put the boss in a stage (usually near its end)'),
  })
  .strict();
export type BossInput = z.input<typeof bossInput>;

export const proposeBoss: DirectorTool<z.output<typeof bossInput>> = {
  name: 'propose_boss',
  description: 'Create or replace a boss: hp, damage, graphics and its fight written in the boss DSL (phases by hp threshold).',
  input: bossInput,
  toOps(input, docs) {
    const parsed = parseBossScript(input.script);
    if (!parsed.script) throw new Error(parsed.errors.map((e) => e.fr).join(' ; '));
    const actor: BossActor = {
      schemaVersion: 1,
      kind: 'boss',
      name: input.name,
      hp: input.hp,
      damage: input.damage,
      graphics: input.graphics,
      ...(input.frames ? { frames: input.frames } : {}),
      script: input.id,
    };
    const ops: Op[] = [
      { op: 'set', doc: `scripts/${input.id}.json`, value: parsed.script as unknown as Json },
      { op: 'set', doc: `actors/${input.id}.json`, value: actor as unknown as Json },
    ];
    if (input.place) {
      // one boss per stage: a new placement replaces the stage's previous boss
      const lp = `levels/${input.place.level}.json`;
      const level = docs[lp] as unknown as Level | undefined;
      if (!level) throw new Error(`niveau « ${input.place.level} » introuvable`);
      const isBoss = (a: string) => (docs[`actors/${a}.json`] as { kind?: string } | undefined)?.kind === 'boss' || a === input.id;
      const entities = [...level.entities.filter((e) => !isBoss(e.actor)), { actor: input.id, col: input.place.col, row: input.place.row }];
      ops.push({ op: 'patch', doc: lp, pointer: '/entities', value: entities as unknown as Json });
    }
    const phases = parsed.script.phases.length;
    return {
      ops,
      summary: {
        fr: `Boss « ${input.name.fr} » : ${input.hp} vies, ${phases} phase(s)${input.place ? `, dans « ${input.place.level} »` : ''}.`,
        en: `Boss "${input.name.en ?? input.name.fr}": ${input.hp} hp, ${phases} phase(s)${input.place ? `, in "${input.place.level}"` : ''}.`,
      },
    };
  },
};

/** Form defaults for a new enemy / boss (offline path). */
export function newEnemyInput(pattern: EnemyActor['pattern'], id: string): z.output<typeof enemyInput> {
  const extra = (ENEMY_DEFAULTS as Record<string, Record<string, number>>)[pattern] ?? {};
  return { id, name: { fr: PATTERN_FR[pattern].replace(/^./, (s) => s.toUpperCase()) }, pattern, speed: pattern === 'shooter' ? 0 : 128, hp: 1, damage: 1, turnAtLedge: pattern === 'walker', ...extra };
}

export const DEFAULT_BOSS_TEXT = formatBossScript(DEFAULT_BOSS_SCRIPT);
