// Single-tile pixel editor (PLAN §12.1 "CHROMA convert + single-tile edit"): one 8×8 tile of a converted
// graphic, 4 values per pixel. Goes through a normal proposal (undo, history), like everything else.
import { z } from 'zod';
import { renderGraphics } from '../convert/render.js';
import { encodeTile } from '../nes/chr.js';
import type { Op } from '../project/ops.js';
import { graphicsDocSchema } from '../schema/graphics.js';
import type { Json } from '../util/json-pointer.js';
import { encodePng } from '../util/png.js';
import { toBase64, worldSet } from './chroma.js';

export const editTileInput = z
  .object({
    graphic: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).describe('Graphic id (graphics/<id>.json)'),
    bank: z.number().int().min(0).max(3).describe('1 KiB bank for sprites (0 for backgrounds)'),
    tile: z.number().int().min(0).max(255),
    pixels: z.array(z.number().int().min(0).max(3)).length(64).describe('64 values 0-3, row by row'),
  })
  .strict();
export type EditTileInput = z.infer<typeof editTileInput>;

export function editTileOps(input: EditTileInput, docs: Record<string, Json>, asset: ((p: string) => Uint8Array | undefined) | undefined): { ops: Op[]; summary: { fr: string; en: string } } {
  const path = `graphics/${input.graphic}.json`;
  const parsed = graphicsDocSchema.safeParse(docs[path]);
  if (!parsed.success) throw new Error(`graphisme « ${input.graphic} » introuvable`);
  const doc = parsed.data;
  const chr = asset?.(doc.chr)?.slice();
  if (!chr) throw new Error(`fichier ${doc.chr} introuvable`);
  const bank = doc.budget.banks.find((b) => b.index === (doc.kind === 'sprite' ? input.bank : 0));
  if (!bank || input.tile >= bank.tiles) throw new Error(`tuile ${input.tile} absente de la banque ${input.bank}`);
  const offset = (doc.kind === 'sprite' ? input.bank * 1024 : 0) + input.tile * 16;
  const tile = encodeTile(input.pixels);
  // BLUM-Q1: an unchanged tile made a proposal that « aucun changement » refused only at approval
  if (tile.every((v, i) => v === chr[offset + i])) throw new Error('rien n’a changé dans cette tuile : peins au moins un pixel avec une autre couleur');
  chr.set(tile, offset);
  const after = renderGraphics(doc, chr, worldSet(docs, doc.palettes.world));
  const ops: Op[] = [{ op: 'addAsset', path: doc.chr, base64: toBase64(chr) }];
  if (doc.preview) ops.push({ op: 'addAsset', path: doc.preview, base64: toBase64(encodePng(after.data, after.width, after.height)) });
  return {
    ops,
    summary: { fr: `Tuile ${input.tile} de « ${doc.name} » retouchée à la main.`, en: `Tile ${input.tile} of "${doc.name}" edited by hand.` },
  };
}
