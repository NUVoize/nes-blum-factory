import { z } from 'zod';
import { schemaVersion, slugSchema } from './common.js';

// NES colour index $00-$3F; $0D is never allowed (PLAN §6 step 2).
export const nesColor = z
  .number()
  .int()
  .min(0)
  .max(0x3f)
  .refine((c) => c !== 0x0d, { message: 'la couleur $0D est interdite' });

const subpalette = z.tuple([nesColor, nesColor, nesColor]);

export const paletteSetSchema = z
  .object({
    id: slugSchema,
    backdrop: nesColor,
    bg: z.array(subpalette).min(1),
    sprites: z.array(subpalette).min(1),
  })
  .strict();

export const palettesSchema = z.object({ schemaVersion, sets: z.array(paletteSetSchema) }).strict();
export type Palettes = z.infer<typeof palettesSchema>;

export const DEFAULT_PALETTES: Palettes = {
  schemaVersion: 1,
  sets: [
    {
      id: 'monde-1',
      backdrop: 0x21,
      bg: [
        [0x0f, 0x30, 0x27],
        [0x0f, 0x1a, 0x2a],
        [0x0f, 0x17, 0x27],
        [0x0f, 0x24, 0x34],
      ],
      sprites: [
        [0x0f, 0x16, 0x36],
        [0x0f, 0x28, 0x30],
        [0x0f, 0x14, 0x24],
        [0x0f, 0x11, 0x21],
      ],
    },
  ],
};

export const audioLibrarySchema = z
  .object({
    schemaVersion,
    titleSong: z.string().max(32),
    worlds: z.array(z.object({ worldId: slugSchema, stageSong: z.string().max(32), bossSong: z.string().max(32) }).strict()),
  })
  .strict();
export type AudioLibrary = z.infer<typeof audioLibrarySchema>;

export const DEFAULT_AUDIO: AudioLibrary = {
  schemaVersion: 1,
  titleSong: 'title',
  worlds: [{ worldId: 'monde-1', stageSong: 'stage', bossSong: 'boss' }],
};
