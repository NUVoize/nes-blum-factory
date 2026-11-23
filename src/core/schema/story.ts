import { z } from 'zod';
import { localeSchema, localizedText, schemaVersion, slugSchema } from './common.js';

// story.json. M1 shape + M4 world intro texts (fields are only ever added).
export const stageRefSchema = z.object({ id: slugSchema, name: localizedText(24) }).strict();

export const worldSchema = z
  .object({
    id: slugSchema,
    name: localizedText(24),
    theme: z.string().max(32),
    stages: z.array(stageRefSchema).min(1),
    /** Boss name (PLUME); the boss actor itself is REBOND's (actors/<id>.json, kind boss). */
    boss: z.string().max(24).optional(),
    /** M4: text screen shown in the ROM before the world's first stage (10 lines of 28 letters). */
    intro: localizedText(280).optional(),
  })
  .strict();

export const storySchema = z
  .object({
    schemaVersion,
    title: z.string().min(1).max(24),
    premise: localizedText(400),
    romLocale: localeSchema,
    worlds: z.array(worldSchema).min(1),
    ending: localizedText(400),
  })
  .strict();
export type Story = z.infer<typeof storySchema>;

// Budget limits (PLAN §12.1 floor). Checked by the budget validator, not zod, so the director gets a
// French reason instead of a schema dump.
export const STORY_LIMITS = { worlds: 8, stagesPerWorld: 4 } as const;

export const DEFAULT_STORY: Story = {
  schemaVersion: 1,
  title: 'MON JEU',
  premise: { fr: 'Une petite fleur part à l’aventure.', en: 'A little flower goes on an adventure.' },
  romLocale: 'fr',
  worlds: [
    {
      id: 'monde-1',
      name: { fr: 'Le jardin', en: 'The garden' },
      theme: 'jardin',
      stages: [{ id: 'niveau-1', name: { fr: 'Premiers pas', en: 'First steps' } }],
    },
  ],
  ending: { fr: 'La fleur est rentrée chez elle.', en: 'The flower is home again.' },
};
