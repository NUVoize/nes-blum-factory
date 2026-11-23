// One preview conversion as a plain-data job (PNG in, PNGs + CHR + JSON out), so it can run in a worker
// thread and cross IPC unchanged (PLAN §6: "it runs in a Node worker so the UI stays fluid").
import type { ConvertSettings, GraphicsDoc } from '../schema/graphics.js';
import { decodePng, encodePng, type RgbaImage } from '../util/png.js';
import { convertImage, type PaletteSet } from './convert.js';
import { colourMiss } from './fidelity.js';

export interface ConvertJob {
  png: Uint8Array;
  settings: ConvertSettings;
  id: string;
  name: string;
  paletteSet: PaletteSet | null;
}

export interface ConvertJobResult {
  ok: boolean;
  errors: Array<{ fr: string; en: string }>;
  doc: GraphicsDoc | null;
  chr: Uint8Array | null;
  /** PNG of the image after crop + fit. */
  before: Uint8Array | null;
  /** PNG of what the NES shows. */
  after: Uint8Array | null;
  proposedSet: PaletteSet | null;
  /** Share (0..1) of the picture whose colour the NES version misses (W1 P1-2). */
  colourMiss: number;
  /** The same share with new palettes (free mode), computed for locked previews only. */
  freeColourMiss: number | null;
  ms: number;
}

function freeMiss(image: RgbaImage, job: ConvertJob): number | null {
  const free = convertImage({ image, settings: { ...job.settings, mode: 'free' }, id: job.id, name: job.name, paletteSet: job.paletteSet });
  return free.doc ? colourMiss(free.before, free.after) : null;
}

export function runConvertJob(job: ConvertJob): ConvertJobResult {
  const t0 = Date.now();
  try {
    const image = decodePng(job.png);
    const out = convertImage({ image, settings: job.settings, id: job.id, name: job.name, paletteSet: job.paletteSet });
    return {
      ok: out.ok,
      errors: out.errors,
      doc: out.doc,
      chr: out.doc ? out.chr : null,
      before: out.before.width > 0 ? encodePng(out.before.data, out.before.width, out.before.height) : null,
      after: out.doc ? encodePng(out.after.data, out.after.width, out.after.height) : null,
      proposedSet: out.proposedSet,
      colourMiss: out.doc ? colourMiss(out.before, out.after) : 0,
      freeColourMiss: out.doc && job.settings.mode === 'locked' ? freeMiss(image, job) : null,
      ms: Date.now() - t0,
    };
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, errors: [{ fr: m, en: m }], doc: null, chr: null, before: null, after: null, proposedSet: null, colourMiss: 0, freeColourMiss: null, ms: Date.now() - t0 };
  }
}
