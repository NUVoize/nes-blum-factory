import { z } from 'zod';
import { isAssetPath, schemaForDoc } from '../schema/documents.js';
import { addAt, removeAt, setAt, type Json } from '../util/json-pointer.js';

// Ops: the only way a proposal changes a project (PLAN §4.3). Frozen at the end of M1 (PLAN §11).
const docPath = z.string().refine((p) => schemaForDoc(p) !== null, { message: 'document inconnu' });
const assetPath = z.string().refine((p) => isAssetPath(p), { message: 'chemin de fichier refusé' });
const pointer = z.string().regex(/^(\/[^/]*)+$/, 'pointeur JSON invalide');
const json: z.ZodType<Json> = z.json();

export const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), doc: docPath, value: json }).strict(),
  z.object({ op: z.literal('patch'), doc: docPath, pointer, value: json }).strict(),
  z.object({ op: z.literal('add'), doc: docPath, pointer, value: json }).strict(),
  z.object({ op: z.literal('remove'), doc: docPath, pointer: pointer.optional() }).strict(),
  z.object({ op: z.literal('addAsset'), path: assetPath, base64: z.string().max(2_000_000) }).strict(),
]);
export type Op = z.infer<typeof opSchema>;

export interface DocSet {
  docs: Record<string, Json>;
  assets: Record<string, Uint8Array>;
}

/** Apply ops to an in-memory copy. Throws with a French message when an op cannot apply. */
export function applyOps(state: DocSet, ops: Op[]): DocSet {
  const docs = { ...state.docs };
  const assets = { ...state.assets };
  for (const op of ops) {
    switch (op.op) {
      case 'set':
        docs[op.doc] = structuredClone(op.value);
        break;
      case 'patch':
      case 'add': {
        const cur = docs[op.doc];
        if (cur === undefined) throw new Error(`document absent : ${op.doc}`);
        docs[op.doc] = op.op === 'patch' ? setAt(cur, op.pointer, op.value) : addAt(cur, op.pointer, op.value);
        break;
      }
      case 'remove':
        if (!(op.doc in docs)) throw new Error(`document absent : ${op.doc}`);
        if (op.pointer) docs[op.doc] = removeAt(docs[op.doc]!, op.pointer);
        else delete docs[op.doc];
        break;
      case 'addAsset':
        assets[op.path] = Uint8Array.from(atob(op.base64), (c) => c.charCodeAt(0));
        break;
    }
  }
  return { docs, assets };
}

/** Canonical on-disk form of a JSON document. */
export function serializeDoc(value: Json): string {
  return JSON.stringify(value, null, 2) + '\n';
}
