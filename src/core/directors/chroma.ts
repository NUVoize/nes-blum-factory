// CHROMA's conversion tool (PLAN §6): the AI chooses crop, kind, size, palette mode and names; the
// conversion itself is the deterministic converter. One proposal writes graphics/<id>.{json,chr,png},
// keeps the dropped image in graphics/sources/, and optionally hooks the result up (hero, tileset).
import { z } from 'zod';
import { convertImage, type ConvertOutput, type PaletteSet } from '../convert/convert.js';
import type { Op } from '../project/ops.js';
import { slugSchema } from '../schema/common.js';
import type { Tileset } from '../schema/engine-docs.js';
import { convertSettingsSchema, GRAPHICS_KINDS, GRAPHICS_ROLES, type ConvertSettings, type GraphicsDoc, type PlayerActor } from '../schema/graphics.js';
import type { Palettes } from '../schema/misc.js';
import type { Story } from '../schema/story.js';
import type { Json } from '../util/json-pointer.js';
import { decodePng, encodePng } from '../util/png.js';

/** Images Blum dropped in the CHROMA panel, waiting to be converted (kept in main, never in a document). */
export interface SourceImages {
  get(id: string): Uint8Array | undefined;
  list(): Array<{ id: string; width: number; height: number; name: string }>;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const graphicId = slugSchema.refine((v) => v !== 'palettes', { message: '« palettes » est réservé' });

export const conversionInput = z
  .object({
    source: z.string().regex(/^[a-z0-9-]{1,40}$/).describe('Id of an image Blum dropped (project context, "sources")'),
    id: graphicId.describe('Id of the new graphic (lowercase, digits, dashes)'),
    name: z.string().min(1).max(32),
    kind: z.enum(GRAPHICS_KINDS).describe('tileset: 16×16 blocks for levels; sprite: character frames; screen: a full 256×240 picture'),
    role: z.enum(GRAPHICS_ROLES).describe('background for tileset/screen; player, common, enemy or boss for sprites'),
    mode: z.enum(['locked', 'free']).default('locked').describe('locked = the world palettes (default); free = new palettes, only for the first images of a world'),
    world: slugSchema.optional().describe('World id (default: the first world)'),
    fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
    crop: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }).strict().optional(),
    width: z.number().int().min(8).max(256).optional(),
    height: z.number().int().min(8).max(240).optional(),
    frame: z.object({ w: z.number().int(), h: z.number().int() }).strict().optional().describe('Sprite frame size: 16×16, 16×24, 16×32, 24×32 or 32×32'),
    frameNames: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/)).max(32).optional(),
    autoFrames: z.boolean().optional().describe('Hero from one picture: idle, run1, run2, jump made automatically'),
    dither: z.enum(['none', 'bayer']).default('bayer'),
    ditherStrength: z.number().int().min(0).max(100).default(50),
    smooth: z.boolean().optional().describe('Soften photo grain first (fewer tiles)'),
    maxTiles: z.number().int().min(1).max(256).optional(),
    use: z.enum(['none', 'player', 'tileset']).default('none').describe('player: the hero uses it; tileset: create tilesets/<id>.json for the level editor'),
    reason: z.string().max(200).default(''),
  })
  .strict();
export type ConversionInput = z.input<typeof conversionInput>;

/** Target sizes when the director does not give them. */
export function defaultTarget(kind: ConvertSettings['kind'], role: ConvertSettings['role'], imgW: number, imgH: number, frame?: { w: number; h: number }, autoFrames?: boolean): { width: number; height: number; frame?: { w: number; h: number } } {
  if (kind === 'screen') return { width: 256, height: 240 };
  if (kind === 'tileset') {
    const scale = Math.min(1, 128 / imgW, 112 / imgH);
    const w = Math.max(16, Math.min(128, Math.round((imgW * scale) / 16) * 16));
    const h = Math.max(16, Math.min(112, Math.round((imgH * scale) / 16) * 16));
    return { width: w, height: h };
  }
  const f = frame ?? (role === 'boss' ? { w: 32, h: 32 } : role === 'player' ? { w: 16, h: 24 } : { w: 16, h: 16 });
  if (autoFrames) return { width: f.w, height: f.h, frame: f };
  const cols = Math.max(1, Math.min(8, Math.round(imgW / imgH / (f.w / f.h))));
  return { width: f.w * cols, height: f.h, frame: f };
}

export function worldSet(docs: Record<string, Json>, world: string): PaletteSet | null {
  const pal = docs['graphics/palettes.json'] as unknown as Palettes | undefined;
  return pal?.sets.find((s) => s.id === world) ?? null;
}

export function firstWorld(docs: Record<string, Json>): string {
  const story = docs['story.json'] as unknown as Story | undefined;
  const pal = docs['graphics/palettes.json'] as unknown as Palettes | undefined;
  return story?.worlds[0]?.id ?? pal?.sets[0]?.id ?? 'monde-1';
}

/** Full converter settings from a (possibly partial) tool input and the image size. */
export function settingsFor(input: z.output<typeof conversionInput>, imgW: number, imgH: number, docs: Record<string, Json>): ConvertSettings {
  const autoFrames = input.autoFrames ?? (input.kind === 'sprite' && input.role === 'player' && !input.frameNames && imgW / imgH < 1.2);
  const t = defaultTarget(input.kind, input.role, imgW, imgH, input.frame, autoFrames);
  // a hero sheet without names: the engine's animation order (PLAN §5.4 floor grouping)
  const frameNames = input.frameNames ?? (input.kind === 'sprite' && input.role === 'player' && !autoFrames && t.frame ? HERO_SHEET_ORDER.slice(0, Math.min(HERO_SHEET_ORDER.length, (input.width ?? t.width) / t.frame.w)) : undefined);
  return convertSettingsSchema.parse({
    kind: input.kind,
    role: input.role,
    mode: input.mode,
    world: input.world ?? firstWorld(docs),
    fit: input.fit,
    ...(input.crop ? { crop: input.crop } : {}),
    width: input.width ?? t.width,
    height: input.height ?? t.height,
    ...(t.frame ? { frame: t.frame } : {}),
    ...(frameNames ? { frameNames } : {}),
    ...(input.kind === 'sprite' && autoFrames ? { autoFrames: true } : {}),
    dither: input.dither,
    ditherStrength: input.ditherStrength,
    ...(input.smooth ? { smooth: true } : {}),
    ...(input.maxTiles ? { maxTiles: input.maxTiles } : {}),
  });
}

/** Default names of a hero sheet's frames, left to right. */
export const HERO_SHEET_ORDER = ['idle', 'run1', 'run2', 'jump', 'fall', 'run3', 'hurt', 'climb1'];

const KIND_FR: Record<string, string> = { tileset: 'jeu de tuiles', screen: 'écran', sprite: 'sprite' };
const ROLE_FR: Record<string, string> = { background: 'décor', player: 'héros', common: 'objets', enemy: 'ennemi', boss: 'boss' };

/** Run the converter on a dropped image; throws a French message when it cannot. */
export function runConversion(input: z.output<typeof conversionInput>, docs: Record<string, Json>, sources: SourceImages | undefined): { settings: ConvertSettings; png: Uint8Array; out: ConvertOutput } {
  const png = sources?.get(input.source);
  if (!png) throw new Error(`image « ${input.source} » introuvable : dépose-la d’abord dans le panneau de CHROMA`);
  const image = decodePng(png);
  const settings = settingsFor(input, image.width, image.height, docs);
  const out = convertImage({ image, settings, id: input.id, name: input.name, paletteSet: worldSet(docs, settings.world) });
  if (!out.ok || !out.doc) throw new Error(out.errors.map((e) => e.fr).join(' ; ') || 'conversion impossible');
  return { settings, png, out };
}

/** Conversion -> Ops (the same for the AI tool, the manual button and the sample replay). */
export function conversionOps(input: z.output<typeof conversionInput>, docs: Record<string, Json>, sources: SourceImages | undefined): { ops: Op[]; summary: { fr: string; en: string }; warnings: Array<{ fr: string; en: string }> } {
  const { settings, png, out } = runConversion(input, docs, sources);
  const doc = out.doc!;
  const ops: Op[] = [
    { op: 'addAsset', path: `graphics/sources/${input.id}.png`, base64: toBase64(png) },
    { op: 'addAsset', path: `graphics/${input.id}.chr`, base64: toBase64(out.chr) },
    { op: 'addAsset', path: `graphics/${input.id}.png`, base64: toBase64(encodePng(out.after.data, out.after.width, out.after.height)) },
    { op: 'set', doc: `graphics/${input.id}.json`, value: doc as unknown as Json },
  ];
  if (settings.mode === 'free' && out.proposedSet) {
    const pal = docs['graphics/palettes.json'] as unknown as Palettes;
    const idx = pal.sets.findIndex((s) => s.id === settings.world);
    ops.push(
      idx >= 0
        ? { op: 'patch', doc: 'graphics/palettes.json', pointer: `/sets/${idx}`, value: out.proposedSet as unknown as Json }
        : { op: 'add', doc: 'graphics/palettes.json', pointer: '/sets/-', value: out.proposedSet as unknown as Json },
    );
  }
  if (input.use === 'player') {
    if (doc.role !== 'player') throw new Error('seul un sprite de héros peut devenir le héros');
    const actor: PlayerActor = { schemaVersion: 1, kind: 'player', name: { fr: input.name.slice(0, 24) }, graphics: `graphics/${input.id}.json` };
    ops.push({ op: 'set', doc: 'actors/player.json', value: actor as unknown as Json });
  }
  if (input.use === 'tileset') {
    if (doc.kind !== 'tileset') throw new Error('seul un jeu de tuiles peut servir aux niveaux');
    const tileset: Tileset = {
      schemaVersion: 1,
      id: input.id,
      chr: `graphics/${input.id}.chr`,
      empty: 0,
      metatiles: doc.metatiles!.map((m) => ({ id: m.id, name: m.id === 0 ? 'vide' : `bloc ${m.id}`, tiles: m.tiles, palette: m.palette, behaviour: m.tiles.every((t) => t === 0) ? 'empty' : 'solid' })),
    };
    ops.push({ op: 'set', doc: `tilesets/${input.id}.json`, value: tileset as unknown as Json });
  }
  const b = doc.budget;
  const what = doc.kind === 'sprite' ? `${ROLE_FR[doc.role]}, ${doc.frames!.length} image(s)` : KIND_FR[doc.kind];
  return {
    ops,
    summary: {
      fr: `Graphisme « ${input.name} » (${what}) : ${b.tiles} tuiles, ${b.subpalettes} palette(s), mode ${settings.mode === 'locked' ? 'verrouillé' : 'libre'}${input.use === 'player' ? ', devient le héros' : ''}${input.use === 'tileset' ? ', prêt pour les niveaux' : ''}.${input.reason ? ' ' + input.reason : ''}`,
      en: `Graphic "${input.name}" (${doc.kind}${doc.kind === 'sprite' ? ' ' + doc.role : ''}): ${b.tiles} tiles, ${b.subpalettes} palette(s), ${settings.mode} mode${input.use === 'player' ? ', becomes the hero' : ''}${input.use === 'tileset' ? ', ready for levels' : ''}.`,
    },
    warnings: b.warnings,
  };
}

/** What CHROMA sees of the project: palettes, existing graphics (no pixels), dropped images. */
export function chromaContext(docs: Record<string, Json>, sources: SourceImages | undefined): Json {
  const graphics = Object.entries(docs)
    .filter(([p, v]) => /^graphics\/[a-z0-9-]+\.json$/.test(p) && (v as { format?: string }).format === 'nbf-graphics')
    .map(([p, v]) => {
      const g = v as unknown as GraphicsDoc;
      return { path: p, name: g.name, kind: g.kind, role: g.role, world: g.palettes.world, mode: g.palettes.mode, tiles: g.budget.tiles, frames: g.frames?.map((f) => f.name) ?? null };
    });
  return {
    palettes: docs['graphics/palettes.json'] ?? null,
    worlds: ((docs['story.json'] as unknown as Story | undefined)?.worlds ?? []).map((w) => w.id),
    hero: (docs['actors/player.json'] as unknown as PlayerActor | undefined)?.graphics ?? 'builtin:hero',
    graphics,
    sources: sources?.list() ?? [],
  } as unknown as Json;
}
