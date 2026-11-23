import { z } from 'zod';
import { isoDate, localeSchema, schemaVersion, ulidSchema } from './common.js';

export const PROJECT_FORMAT = 'nbf-project';

export const projectManifestSchema = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    schemaVersion,
    id: ulidSchema,
    title: z.string().min(1).max(32),
    locale: localeSchema,
    /** ENGINE_DATA_VERSION the documents were written for (1 since M2b; 0 = made before M2b). */
    engineDataVersion: z.number().int().min(0).max(255),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();
export type ProjectManifest = z.infer<typeof projectManifestSchema>;

// PLAN §5.1: MMC3 profile. Sizes in KiB.
export const cartridgeSchema = z
  .object({
    schemaVersion,
    mapper: z.literal(4),
    submapper: z.literal(0),
    prgRomKiB: z.union([z.literal(256), z.literal(512)]),
    chrRomKiB: z.union([z.literal(128), z.literal(256)]),
    prgRamKiB: z.literal(8),
    battery: z.boolean(),
    mirroring: z.literal('software'),
    region: z.literal('ntsc'),
  })
  .strict();
export type Cartridge = z.infer<typeof cartridgeSchema>;

export const DEFAULT_CARTRIDGE: Cartridge = {
  schemaVersion: 1,
  mapper: 4,
  submapper: 0,
  prgRomKiB: 256,
  chrRomKiB: 128,
  prgRamKiB: 8,
  battery: false,
  mirroring: 'software',
  region: 'ntsc',
};
