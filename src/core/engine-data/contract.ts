// ENGINE_DATA_VERSION 1: the contract between project JSON and the NES engine (PLAN §11).
// Mirrored by engine/src/engine.h; tests/m2-contract.test.ts checks both sides agree.
// Frozen at the end of M2b: later milestones may add fields, never remove or move them.

export const ENGINE_DATA_VERSION = 1;

/** Game states, probe $7F05 (PLAN §5.8). */
export const GAME_STATE = {
  boot: 0,
  title: 1,
  story: 2,
  play: 3,
  dying: 4,
  clear: 5,
  boss: 6,
  ending: 7,
  gameOver: 8,
} as const;

/** Tile behaviours, 4 bits per metatile (PLAN §5.6). */
export const BEHAVIOUR = {
  empty: 0,
  solid: 1,
  oneWay: 2,
  ladder: 3,
  wall: 4,
  wallSlippery: 5,
  hazard: 6,
  water: 7,
  breakable: 8,
  collectible: 9,
  checkpoint: 10,
  exit: 11,
  door: 12,
  conveyorLeft: 13,
  conveyorRight: 14,
} as const;
export type BehaviourName = keyof typeof BEHAVIOUR;

/** Floor behaviours (PLAN §12.1); the others are rejected until built. */
export const FLOOR_BEHAVIOURS: readonly BehaviourName[] = ['empty', 'solid', 'oneWay', 'ladder', 'hazard', 'collectible', 'checkpoint', 'exit'];

/** Event codes, probe $7F10. */
export const EVENT = {
  none: 0,
  deathHazard: 1,
  deathPit: 2,
  deathEnemy: 3,
  checkpoint: 4,
  pickup: 5,
  exit: 6,
  respawn: 7,
  hurt: 8,
  // M4a
  kill: 9,
  bossPhase: 10,
  bossDefeated: 11,
  shot: 12,
} as const;

/** Probe flags, $7F0F. */
export const PROBE_FLAG = {
  grounded: 0x01,
  ladder: 0x02,
  wallGrab: 0x04,
  water: 0x08,
  invincible: 0x10,
  jumping: 0x20,
  dead: 0x40,
  /** M4a: the double jump of this airtime is used. */
  doubleJumped: 0x80,
} as const;

/** Enemy AI patterns (PLAN §5.7). Floor (M2b walker, M4a the other three); 5-8 are stretch. */
export const AI_PATTERN = { none: 0, walker: 1, hopper: 2, flyer: 3, shooter: 4 } as const;
export type AiPatternName = Exclude<keyof typeof AI_PATTERN, 'none'>;
export const BUILT_AI_PATTERNS: readonly AiPatternName[] = ['walker', 'hopper', 'flyer', 'shooter'];
/** Entity kinds from this value up are bosses (kind - BOSS_KIND_BASE = boss index of the level). */
export const BOSS_KIND_BASE = 0xf0;

/** Probe block layout (offsets from $7F00). */
export const PROBE = {
  base: 0x7f00,
  size: 0x40,
  magic: 0x00,
  version: 0x04,
  state: 0x05,
  world: 0x06,
  stage: 0x07,
  frame: 0x08,
  px: 0x0a,
  py: 0x0c,
  hp: 0x0d,
  lives: 0x0e,
  flags: 0x0f,
  event: 0x10,
  bossHp: 0x11,
  enemies: 0x12,
  checkpoint: 0x13,
  lag: 0x14,
  collected: 0x15,
  camX: 0x16,
  stressErrors: 0x18,
  // M4a
  shots: 0x19,
  kills: 0x1a,
  enemyShots: 0x1b,
  bossPhase: 0x1c,
  /** Text screen on show: 0 none, 1 world intro, 2 ending, 3 credits. */
  textScreen: 0x1d,
  /** Boss x in level pixels (LE), 0 when no boss. */
  bossX: 0x1e,
  /** Low byte of the player's horizontal speed (8.8, signed high byte at +1). */
  vx: 0x20,
  /** Test-only cheat byte (NBF_TEST_CHEATS builds): b0 invincible, b1 skip the stage. */
  cheats: 0x40,
} as const;

export const TEXT_SCREEN = { none: 0, intro: 1, ending: 2, credits: 3 } as const;
export const CHEAT = { invincible: 0x01, skipStage: 0x02 } as const;

/** Level header in a data bank (16 bytes). */
export const LEVEL_HEADER = {
  width: 0,
  spawnCol: 1,
  spawnRow: 2,
  world: 3,
  chrBg: 4,
  chrEnemies: 5,
  song: 6,
  mtCount: 7,
  mtPtr: 8,
  entPtr: 10,
  rlePtr: 12,
  emptyMt: 14,
  /** M6: song index played when the stage's boss appears. */
  bossSong: 15,
  size: 16,
} as const;

export const LEVEL_ROWS = 13;
export const MAX_METATILES = 128;
export const MAX_ENTITIES = 64;
export const MAX_ENEMIES = 8;
/** Player shots on screen at once (physics projectile.maxOnScreen ≤ 3). */
export const MAX_SHOTS = 3;
export const MAX_ENEMY_SHOTS = 4;

/** Live tuning block at $7E00 (PLAN §5.3): magic "BLMT", version, then 16-bit LE fields. */
export const TUNING = {
  base: 0x7e00,
  magic: [0x42, 0x4c, 0x4d, 0x54], // "BLMT"
  versionOffset: 4,
  fieldsOffset: 0x10,
} as const;

/** Tuning fields in block order. Never reorder: the emulator preview pokes these offsets. */
export const TUNING_FIELDS = [
  'walkAccel',
  'runMax',
  'friction',
  'turnBoost',
  'gravity',
  'maxFall',
  'airControl',
  'jumpVelocity',
  'jumpCut',
  'coyoteFrames',
  'jumpBufferFrames',
  'doubleJumpEnabled',
  'doubleJumpVelocity',
  'climbSpeed',
  'canJumpOff',
  'projectileEnabled',
  'projectileSpeed',
  'projectileMax',
  'projectileCooldown',
  'hp',
  'knockbackX',
  'knockbackY',
  'iframes',
] as const;
export type TuningField = (typeof TUNING_FIELDS)[number];

export function tuningAddress(field: TuningField): number {
  return TUNING.base + TUNING.fieldsOffset + 2 * TUNING_FIELDS.indexOf(field);
}

/** C macro names in gen/config.h for each tuning field the engine reads. */
export const TUNING_MACROS: Partial<Record<TuningField, string>> = {
  walkAccel: 'T_WALKACCEL',
  runMax: 'T_RUNMAX',
  friction: 'T_FRICTION',
  turnBoost: 'T_TURNBOOST',
  gravity: 'T_GRAVITY',
  maxFall: 'T_MAXFALL',
  airControl: 'T_AIRCONTROL',
  jumpVelocity: 'T_JUMPVEL',
  jumpCut: 'T_JUMPCUT',
  coyoteFrames: 'T_COYOTE',
  jumpBufferFrames: 'T_JUMPBUF',
  doubleJumpEnabled: 'T_DJ_ON',
  doubleJumpVelocity: 'T_DJ_VEL',
  climbSpeed: 'T_CLIMB',
  canJumpOff: 'T_CANJUMPOFF',
  projectileEnabled: 'T_SHOT_ON',
  projectileSpeed: 'T_SHOT_SPEED',
  projectileMax: 'T_SHOT_MAX',
  projectileCooldown: 'T_SHOT_COOLDOWN',
  hp: 'T_HP',
  knockbackX: 'T_KNOCKX',
  knockbackY: 'T_KNOCKY',
  iframes: 'T_IFRAMES',
};

/** PRG banks (PLAN §5.3). */
export const PRG_BANK = { firstData: 0, lastData: 27, sound: 28, fixedA000: 29, fixedC000: 30, fixedE000: 31 } as const;

/** CHR-ROM layout in 1 KiB banks (PLAN §5.4). */
export const CHR_BANK = {
  font: 0, // 2 KiB: HUD + font + story text (BG $0000 during the HUD)
  title: 2, // 2 KiB: title extras (BG $0800 on the title screen)
  worldBase: 4, // 4 KiB per world: R0 = base, R1 = base + 2
  player: 32, // 4 x 1 KiB (R2 switched per animation group)
  common: 36, // items, projectiles (R3)
  enemiesBase: 40, // 1 KiB per world (R4)
  boss: 48, // 1 KiB per boss (R5)
  total: 128,
} as const;

/** Worlds the cartridge holds: one enemy bank each (40..47) and one palette set each. */
export const MAX_WORLDS = 8;
/** Distinct background tile sets: banks 4..31 = 7 sets of 4 KiB. */
export const MAX_BG_SETS = 7;
