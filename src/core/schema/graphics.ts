import { z } from 'zod';
import { schemaVersion, slugSchema } from './common.js';
import { nesColor } from './misc.js';

// Converter output contract (`graphics/<id>.json` + `graphics/<id>.chr`), frozen at the end of M3
// (PLAN §11). Later milestones may add optional fields, never remove or move them.

export const GRAPHICS_KINDS = ['tileset', 'sprite', 'screen'] as const;
export const GRAPHICS_ROLES = ['background', 'player', 'common', 'enemy', 'boss'] as const;
export type GraphicsKind = (typeof GRAPHICS_KINDS)[number];
export type GraphicsRole = (typeof GRAPHICS_ROLES)[number];

/** Sprite subpalette slots each role may use (PLAN §5.4 fixed roles). */
export const ROLE_SPRITE_SLOTS: Record<Exclude<GraphicsRole, 'background'>, readonly number[]> = {
  player: [0],
  common: [1],
  enemy: [2, 3],
  boss: [2, 3],
};

/** Metasprite frame sizes (PLAN §6 step 1). Bosses stay ≤ 32 px wide (PLAN §5.4). */
export const FRAME_SIZES = [
  [8, 8],
  [16, 16],
  [16, 24],
  [16, 32],
  [24, 24],
  [24, 32],
  [32, 32],
] as const;

export const MAX_BOSS_WIDTH = 32;
export const SPRITE_BANK_TILES = 64;
export const BG_SET_TILES = 256;
export const MAX_SPRITES_PER_FRAME = 64;
export const MAX_SPRITES_PER_LINE = 8;

const subpalette = z.tuple([nesColor, nesColor, nesColor]);

export const convertSettingsSchema = z
  .object({
    kind: z.enum(GRAPHICS_KINDS),
    role: z.enum(GRAPHICS_ROLES),
    /** `locked`: into the world's palette set (CHROMA default). `free`: compute a new set (first set of a world). */
    mode: z.enum(['locked', 'free']),
    world: slugSchema,
    /** How the (cropped) image goes into the target size. */
    fit: z.enum(['contain', 'cover', 'stretch']),
    crop: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }).strict().optional(),
    /** Target size in pixels: the whole screen, the tileset sheet, or the sprite sheet (cols × frame w). */
    width: z.number().int().min(8).max(256),
    height: z.number().int().min(8).max(240),
    /** Sprites: frame size; the target is cut row-major into frames. */
    frame: z.object({ w: z.number().int(), h: z.number().int() }).strict().optional(),
    /** Frame names in sheet order (sprites). Default: frame-1, frame-2... */
    frameNames: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/)).max(32).optional(),
    /** Player from a single image: idle, run1 (1 px bob), run2, jump (PLAN §6 "simple automatic variants"). */
    autoFrames: z.boolean().optional(),
    dither: z.enum(['none', 'bayer', 'diffusion']),
    /** 0-100. */
    ditherStrength: z.number().int().min(0).max(100),
    /** 3×3 blur before the colours are chosen (photos: less grain, fewer tiles). */
    smooth: z.boolean().optional(),
    /** Lower tile budget than the hardware one (lossy merge target). */
    maxTiles: z.number().int().min(1).max(256).optional(),
  })
  .strict();
export type ConvertSettings = z.infer<typeof convertSettingsSchema>;

export const spriteEntrySchema = z
  .object({
    x: z.number().int().min(0).max(31),
    /** Bosses may be taller than wide (32 × 48): y goes to 63. */
    y: z.number().int().min(0).max(63),
    /** Tile index inside the frame's 1 KiB bank (0-63). */
    tile: z.number().int().min(0).max(63),
    palette: z.number().int().min(0).max(3),
    flipH: z.boolean(),
    flipV: z.boolean(),
  })
  .strict();
export type SpriteEntryDoc = z.infer<typeof spriteEntrySchema>;

export const frameSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
    /** 1 KiB bank of this graphic (player: 0-3, others: 0). All frames of one animation share it. */
    bank: z.number().int().min(0).max(3),
    w: z.number().int().min(8).max(32),
    h: z.number().int().min(8).max(64),
    /** Centre of the feet, from the frame's top-left corner. */
    hotspot: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
    sprites: z.array(spriteEntrySchema).max(MAX_SPRITES_PER_FRAME),
    maxPerLine: z.number().int().min(0).max(64),
  })
  .strict();
export type FrameDoc = z.infer<typeof frameSchema>;

const warning = z.object({ fr: z.string(), en: z.string() }).strict();

export const graphicsBudgetSchema = z
  .object({
    colors: z.number().int().min(0),
    subpalettes: z.number().int().min(0).max(8),
    tiles: z.number().int().min(0),
    tilesBeforeMerge: z.number().int().min(0),
    tileCapacity: z.number().int().min(1),
    merged: z.number().int().min(0),
    metatiles: z.number().int().min(0).optional(),
    sprites: z.number().int().min(0),
    maxPerLine: z.number().int().min(0),
    banks: z.array(z.object({ index: z.number().int(), tiles: z.number().int(), capacity: z.number().int() }).strict()),
    warnings: z.array(warning),
  })
  .strict();
export type GraphicsBudget = z.infer<typeof graphicsBudgetSchema>;

export const graphicsDocSchema = z
  .object({
    schemaVersion,
    format: z.literal('nbf-graphics'),
    id: slugSchema,
    name: z.string().min(1).max(32),
    kind: z.enum(GRAPHICS_KINDS),
    role: z.enum(GRAPHICS_ROLES),
    /** Original image as dropped (`graphics/sources/<id>.png`), or where built-in art comes from. */
    source: z.string().max(120).nullable(),
    /** Converted preview (`graphics/<id>.png`). */
    preview: z.string().regex(/^graphics\/[a-z0-9-]{1,32}\.png$/).nullable(),
    chr: z.string().regex(/^graphics\/[a-z0-9-]{1,32}\.chr$/),
    /** Tiles per CHR bank in the .chr file: 1024 bytes (sprites, 64 tiles) or 4096 (backgrounds, 256 tiles). */
    bankSize: z.union([z.literal(1024), z.literal(4096)]),
    settings: convertSettingsSchema.nullable(),
    palettes: z
      .object({
        world: slugSchema,
        mode: z.enum(['locked', 'free']),
        backdrop: nesColor,
        /** Hardware subpalette slots this graphic uses and their colours at conversion time. */
        slots: z.array(z.object({ slot: z.number().int().min(0).max(3), colors: subpalette }).strict()).max(4),
      })
      .strict(),
    /** Tileset: 16×16 metatiles (4 BG tile indices + BG subpalette). Behaviours live in tilesets/<id>.json. */
    metatiles: z
      .array(z.object({ id: z.number().int().min(0).max(127), tiles: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]), palette: z.number().int().min(0).max(3) }).strict())
      .max(128)
      .optional(),
    /** Tileset: the sheet as metatile ids, row-major. */
    map: z.object({ cols: z.number().int().min(1), rows: z.number().int().min(1), cells: z.array(z.number().int().min(0)) }).strict().optional(),
    /** Screen: 32×30 nametable + 64 attribute bytes. */
    screen: z.object({ nametable: z.array(z.number().int().min(0).max(255)).length(960), attributes: z.array(z.number().int().min(0).max(255)).length(64) }).strict().optional(),
    frames: z.array(frameSchema).max(32).optional(),
    animations: z.record(z.string(), z.object({ frames: z.array(z.string()).min(1), frameDuration: z.number().int().min(1).max(60), loop: z.boolean() }).strict()).optional(),
    budget: graphicsBudgetSchema,
  })
  .strict()
  .superRefine((g, ctx) => {
    if (g.kind === 'sprite' && !g.frames?.length) ctx.addIssue({ code: 'custom', path: ['frames'], message: 'un sprite a au moins une image' });
    if (g.kind === 'tileset' && !g.metatiles?.length) ctx.addIssue({ code: 'custom', path: ['metatiles'], message: 'un jeu de tuiles a au moins une métatuile' });
    if (g.kind === 'screen' && !g.screen) ctx.addIssue({ code: 'custom', path: ['screen'], message: 'un écran a une table de noms' });
    if ((g.kind === 'sprite') !== (g.role !== 'background')) ctx.addIssue({ code: 'custom', path: ['role'], message: 'rôle incompatible avec le genre' });
  });
export type GraphicsDoc = z.infer<typeof graphicsDocSchema>;

/** `actors/player.json`: which graphic the hero uses (PLAN §3). Absent = built-in placeholder hero. */
export const playerActorSchema = z
  .object({
    schemaVersion,
    kind: z.literal('player'),
    name: z.object({ fr: z.string().min(1).max(24), en: z.string().max(24).optional() }).strict(),
    /** `builtin:<name>` or `graphics/<id>.json` (role player). */
    graphics: z.string().regex(/^(builtin:[a-z0-9-]+|graphics\/[a-z0-9-]{1,32}\.json)$/),
  })
  .strict();
export type PlayerActor = z.infer<typeof playerActorSchema>;

/** Player animation groups -> bank (PLAN §5.4 floor grouping). Other names fill banks 2-3. */
export const PLAYER_BANK_GROUPS: Record<string, number> = {
  idle: 0,
  run: 0,
  hurt: 0,
  jump: 1,
  fall: 1,
  climb: 1,
  attack: 1,
  throw: 1,
  shoot: 1,
};

/** Animation name of a frame: its name without a trailing number ("run2" -> "run"). */
export function animationOf(frameName: string): string {
  return frameName.replace(/-?\d+$/, '') || frameName;
}
