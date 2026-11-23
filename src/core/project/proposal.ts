import { z } from 'zod';
import { isoDate, ulidSchema } from '../schema/common.js';
import { opSchema } from './ops.js';

export const DIRECTOR_IDS = ['story', 'visual', 'movement', 'level', 'build'] as const;
export type DirectorId = (typeof DIRECTOR_IDS)[number];
export const directorIdSchema = z.enum(DIRECTOR_IDS);

// Proposal and transaction types are frozen at the end of M1 (PLAN §11).
export const proposalSchema = z
  .object({
    id: ulidSchema,
    director: directorIdSchema,
    state: z.enum(['pending', 'approved', 'rejected', 'superseded']),
    createdAt: isoDate,
    decidedAt: isoDate.optional(),
    tool: z.string(),
    summary: z.object({ fr: z.string(), en: z.string() }).strict(),
    ops: z.array(opSchema).min(1),
    warnings: z.array(z.object({ fr: z.string(), en: z.string() }).strict()),
    txId: ulidSchema.optional(),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

export const journalEntrySchema = z
  .object({
    id: ulidSchema,
    kind: z.enum(['apply', 'undo', 'redo']),
    ts: isoDate,
    director: z.union([directorIdSchema, z.literal('manual')]).optional(),
    summary: z.object({ fr: z.string(), en: z.string() }).strict().optional(),
    proposalId: ulidSchema.optional(),
    target: ulidSchema.optional(),
    ops: z.array(opSchema).optional(),
    files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }).strict()),
  })
  .strict();
export type JournalEntry = z.infer<typeof journalEntrySchema>;

export interface HistoryItem {
  id: string;
  ts: string;
  director: string;
  summary: { fr: string; en: string };
  files: string[];
  state: 'applied' | 'undone';
}
