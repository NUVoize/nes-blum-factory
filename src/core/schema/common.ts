import { z } from 'zod';
import { ULID_RE } from '../util/ulid.js';

export const SCHEMA_VERSION = 1;
export const schemaVersion = z.literal(SCHEMA_VERSION);
export const ulidSchema = z.string().regex(ULID_RE, 'identifiant ULID invalide');
export const localeSchema = z.enum(['fr', 'en']);
export const isoDate = z.string().datetime({ offset: true });
export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'identifiant invalide (minuscules, chiffres, tirets)');

/** French first; English optional. */
export const localizedText = (max: number) =>
  z.object({ fr: z.string().max(max), en: z.string().max(max).optional() }).strict();

/** A validation problem, always explained in both languages for the UI. */
export interface Issue {
  doc: string;
  path: string;
  fr: string;
  en: string;
  severity: 'error' | 'warning';
}
