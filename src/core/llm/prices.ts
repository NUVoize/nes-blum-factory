import { z } from 'zod';
import type { ModelId, Usage } from './types.js';

// config/prices.json (PLAN §4.5): editable copy in the app data folder; every amount is an « estimation ».
const rate = z.object({ input: z.number().min(0), output: z.number().min(0), cacheWrite: z.number().min(0), cacheRead: z.number().min(0) }).strict();

export const pricesSchema = z
  .object({
    schemaVersion: z.literal(1),
    currency: z.literal('USD'),
    unit: z.string(),
    checkedAt: z.string(),
    source: z.string(),
    note: z.string().optional(),
    models: z.record(z.string(), rate),
  })
  .strict();
export type Prices = z.infer<typeof pricesSchema>;

export const DEFAULT_MODELS = {
  directors: 'claude-sonnet-5-5',
  quality: 'claude-opus-5-5',
  chores: 'claude-haiku-5-5',
} as const satisfies Record<string, ModelId>;

export interface Cost {
  usd: number;
  /** False when the model is missing from prices.json: the amount is then unknown, not zero. */
  known: boolean;
  estimate: true;
}

export function costOf(prices: Prices, model: ModelId, u: Usage): Cost {
  const r = prices.models[model];
  if (!r) return { usd: 0, known: false, estimate: true };
  const usd =
    (u.input_tokens * r.input + u.output_tokens * r.output + u.cache_creation_input_tokens * r.cacheWrite + u.cache_read_input_tokens * r.cacheRead) /
    1_000_000;
  return { usd, known: true, estimate: true };
}

export function formatCost(c: Cost, locale: 'fr' | 'en'): string {
  if (!c.known) return locale === 'fr' ? 'coût inconnu (estimation)' : 'unknown cost (estimate)';
  const amount = c.usd < 0.01 ? c.usd.toFixed(4) : c.usd.toFixed(2);
  return locale === 'fr' ? `${amount.replace('.', ',')} $ US (estimation)` : `US$${amount} (estimate)`;
}
