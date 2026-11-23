import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFile } from '../core/util/atomic.js';
import { DEFAULT_MODELS } from '../core/llm/prices.js';
import type { Settings } from '../shared/api.js';

export const settingsSchema = z
  .object({
    locale: z.enum(['fr', 'en']),
    uiScale: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    volume: z.number().int().min(0).max(100),
    muted: z.boolean(),
    models: z.object({ directors: z.string().min(1), quality: z.string().min(1), chores: z.string().min(1) }).strict(),
    qualityMax: z.boolean(),
    monthlyCapUsd: z.number().min(0).max(10_000).nullable(),
    projectsDir: z.string().min(1),
  })
  .strict();

export function defaultSettings(projectsDir: string): Settings {
  return {
    locale: 'fr',
    uiScale: 2,
    volume: 40,
    muted: false,
    models: { ...DEFAULT_MODELS },
    qualityMax: false,
    monthlyCapUsd: null,
    projectsDir,
  };
}

export class SettingsStore {
  private value: Settings;

  constructor(
    private readonly file: string,
    defaults: Settings,
  ) {
    let loaded: Settings = defaults;
    if (existsSync(file)) {
      const parsed = settingsSchema.safeParse({ ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) });
      if (parsed.success) loaded = parsed.data;
    }
    this.value = loaded;
  }

  get(): Settings {
    return structuredClone(this.value);
  }

  set(patch: Partial<Settings>): Settings {
    const next = settingsSchema.parse({ ...this.value, ...patch });
    atomicWriteFile(this.file, JSON.stringify(next, null, 2) + '\n');
    this.value = next;
    return this.get();
  }
}
