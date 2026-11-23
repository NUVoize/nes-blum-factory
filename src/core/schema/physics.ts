import { z } from 'zod';
import { schemaVersion } from './common.js';

// PLAN §5.5. Speeds/accelerations in 1/256 px per frame (8.8 fixed point). Every value has min/max;
// the REBOND sliders (M4b) and the validator share this table.
export const PHYSICS_LIMITS = {
  walkAccel: [4, 96],
  runMax: [128, 768],
  friction: [4, 128],
  turnBoost: [0, 64],
  gravity: [8, 96],
  maxFall: [256, 1280],
  airControl: [0, 256],
  jumpVelocity: [512, 1792],
  jumpCut: [0, 256],
  coyoteFrames: [0, 12],
  jumpBufferFrames: [0, 12],
  doubleJumpVelocity: [256, 1536],
  wallSlideSpeed: [32, 512],
  wallJumpX: [128, 768],
  wallJumpY: [256, 1536],
  wallJumpLockFrames: [0, 30],
  climbSpeed: [64, 512],
  swimGravity: [2, 48],
  strokeVelocity: [128, 1024],
  maxSwimFall: [64, 512],
  meleeFrames: [4, 30],
  meleeHitbox: [8, 32],
  projectileSpeed: [256, 1536],
  projectileMax: [1, 3],
  projectileCooldown: [4, 60],
  hp: [1, 8],
  knockbackX: [0, 768],
  knockbackY: [0, 1024],
  iframes: [0, 180],
  enterDelayFrames: [0, 60],
} as const satisfies Record<string, readonly [number, number]>;

type LimitKey = keyof typeof PHYSICS_LIMITS;
const n = (k: LimitKey) => z.number().int().min(PHYSICS_LIMITS[k][0]).max(PHYSICS_LIMITS[k][1]);

export const physicsSchema = z
  .object({
    schemaVersion,
    walkAccel: n('walkAccel'),
    runMax: n('runMax'),
    friction: n('friction'),
    turnBoost: n('turnBoost'),
    gravity: n('gravity'),
    maxFall: n('maxFall'),
    airControl: n('airControl'),
    jumpVelocity: n('jumpVelocity'),
    jumpCut: n('jumpCut'),
    coyoteFrames: n('coyoteFrames'),
    jumpBufferFrames: n('jumpBufferFrames'),
    doubleJump: z.object({ enabled: z.boolean(), velocity: n('doubleJumpVelocity') }).strict(),
    wallGrab: z
      .object({
        enabled: z.boolean(),
        wallSlideSpeed: n('wallSlideSpeed'),
        wallJump: z.object({ x: n('wallJumpX'), y: n('wallJumpY'), lockFrames: n('wallJumpLockFrames') }).strict(),
      })
      .strict(),
    ladders: z.object({ climbSpeed: n('climbSpeed'), canJumpOff: z.boolean() }).strict(),
    swim: z
      .object({
        enabled: z.boolean(),
        swimGravity: n('swimGravity'),
        strokeVelocity: n('strokeVelocity'),
        maxSwimFall: n('maxSwimFall'),
      })
      .strict(),
    melee: z.object({ enabled: z.boolean(), frames: n('meleeFrames'), hitbox: n('meleeHitbox') }).strict(),
    projectile: z
      .object({
        enabled: z.boolean(),
        speed: n('projectileSpeed'),
        maxOnScreen: n('projectileMax'),
        cooldown: n('projectileCooldown'),
      })
      .strict(),
    health: z
      .object({ hp: n('hp'), knockback: z.object({ x: n('knockbackX'), y: n('knockbackY') }).strict(), iframes: n('iframes') })
      .strict(),
    doors: z.object({ enterDelayFrames: n('enterDelayFrames') }).strict(),
  })
  .strict();
export type Physics = z.infer<typeof physicsSchema>;

export const DEFAULT_PHYSICS: Physics = {
  schemaVersion: 1,
  walkAccel: 24,
  runMax: 384,
  friction: 32,
  turnBoost: 16,
  gravity: 40,
  maxFall: 1024,
  airControl: 160,
  jumpVelocity: 1152,
  jumpCut: 128,
  coyoteFrames: 6,
  jumpBufferFrames: 6,
  doubleJump: { enabled: true, velocity: 896 },
  wallGrab: { enabled: false, wallSlideSpeed: 128, wallJump: { x: 384, y: 1024, lockFrames: 8 } },
  ladders: { climbSpeed: 192, canJumpOff: true },
  swim: { enabled: false, swimGravity: 8, strokeVelocity: 512, maxSwimFall: 256 },
  melee: { enabled: false, frames: 12, hitbox: 16 },
  projectile: { enabled: true, speed: 768, maxOnScreen: 2, cooldown: 16 },
  health: { hp: 3, knockback: { x: 384, y: 512 }, iframes: 90 },
  doors: { enterDelayFrames: 20 },
};

/** REBOND presets (offline path): « léger », « lourd », « flottant ». */
export const PHYSICS_PRESETS = {
  leger: { ...DEFAULT_PHYSICS, gravity: 28, jumpVelocity: 1024, maxFall: 768, airControl: 224 },
  lourd: { ...DEFAULT_PHYSICS, gravity: 64, jumpVelocity: 1408, maxFall: 1280, airControl: 96, runMax: 320 },
  flottant: { ...DEFAULT_PHYSICS, gravity: 16, jumpVelocity: 768, maxFall: 512, airControl: 256, coyoteFrames: 10 },
} as const satisfies Record<string, Physics>;
export type PhysicsPresetId = keyof typeof PHYSICS_PRESETS;
