// SEBRING racer tracks (docs/RACER-PLAN.md section 4): racer/tracks/<stage>.json, zod schema, validator
// (FR/EN messages like BLUM) and the emitter that turns a stage into the bytes racer/src reads.
// The emitter is the only place that knows the binary layout. No Node imports (the app may edit tracks).
import { z } from 'zod';
import { CURVE_MAX, CURVE_MIN, HILL_MAX, HILL_MIN } from './road-data.js';

/** km/h shown and distance per frame (distance += speed / 256 units per frame). */
export const SPEED_MAX = 220;
export const FPS = 60;
/** Units per second at full speed: 220 / 256 * 60 = 51.6. */
export const UNITS_PER_S_MAX = (SPEED_MAX / 256) * FPS;
/** Validator: a stage must be finishable at 80 % of full speed with 2 crashes. */
export const FINISH_SPEED_RATIO = 0.8;
export const CRASHES_ALLOWED = 2;
/** Time one crash costs: the penalty (CRASH_PENALTY_S) + the spin and getting back to speed. */
export const CRASH_PENALTY_S = 2;
export const CRASH_COST_S = CRASH_PENALTY_S + 5;
/** Engine eases: curve 1 level / 2 frames, hill 1 level / 4 frames. */
export const CURVE_FRAMES_PER_LEVEL = 2;
export const HILL_FRAMES_PER_LEVEL = 4;
/** Sprite budget: placed objects closer than this share the car's sprite lines (8 per line max). */
export const OBJECT_MIN_GAP = 24;
export const MAX_SEGMENTS = 64;
export const MAX_OBJECTS = 64;
export const STAGE_COUNT = 5;

export const OBJECT_KINDS = ['car', 'cone', 'bus', 'plow', 'pothole'] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];
/** Engine kind ids (0 = free slot). */
export const KIND_ID: Record<ObjectKind, number> = { car: 1, cone: 2, bus: 3, plow: 4, pothole: 5 };

const i18n = z.object({ fr: z.string().min(1).max(28), en: z.string().min(1).max(28) }).strict();

export const trackObjectSchema = z
  .object({
    at: z.number().int().min(0),
    kind: z.enum(OBJECT_KINDS),
    lane: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  })
  .strict();

export const segmentSchema = z
  .object({
    length: z.number().int().min(1).max(4000),
    curve: z.number().int(),
    hill: z.number().int(),
    traffic: z.number().int(),
    /** Roadside ground: 0 stage colour, 1 concrete, 2 dark grass, 3 earth. */
    scenery: z.number().int().min(0).max(3).default(0),
    objects: z.array(trackObjectSchema).max(MAX_OBJECTS).optional(),
    checkpoint: z.object({ addTime: z.number().int().min(1).max(99) }).strict().optional(),
  })
  .strict();

export const trackSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: i18n,
    palette: z.string().min(1),
    backdrop: z.string().min(1),
    timeStart: z.number().int().min(10).max(99),
    segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
  })
  .strict();
export type Track = z.infer<typeof trackSchema>;
export type Segment = z.infer<typeof segmentSchema>;

export interface TrackIssue {
  code: string;
  fr: string;
  en: string;
  path: string;
}

/** Absolute checkpoints (segment starts) then the finish line (addTime 0). */
export function checkpoints(t: Track): { pos: number; addTime: number }[] {
  const out: { pos: number; addTime: number }[] = [];
  let pos = 0;
  for (const s of t.segments) {
    if (s.checkpoint) out.push({ pos, addTime: s.checkpoint.addTime });
    pos += s.length;
  }
  out.push({ pos, addTime: 0 });
  return out;
}

export function trackLength(t: Track): number {
  return t.segments.reduce((a, s) => a + s.length, 0);
}

/** Validates a parsed track. Empty list = good. */
export function validateTrack(t: Track): TrackIssue[] {
  const issues: TrackIssue[] = [];
  const add = (code: string, path: string, fr: string, en: string) => issues.push({ code, path, fr, en });
  let prevCurve = 0;
  let prevHill = 0;
  let pos = 0;
  const objects: { pos: number; path: string }[] = [];
  t.segments.forEach((s, i) => {
    const p = `segments/${i}`;
    if (s.curve < CURVE_MIN || s.curve > CURVE_MAX)
      add('curve-range', `${p}/curve`, `Segment ${i + 1} : virage ${s.curve} hors limites (${CURVE_MIN} à ${CURVE_MAX}).`, `Segment ${i + 1}: curve ${s.curve} out of range (${CURVE_MIN} to ${CURVE_MAX}).`);
    if (s.hill < HILL_MIN || s.hill > HILL_MAX)
      add('hill-range', `${p}/hill`, `Segment ${i + 1} : côte ${s.hill} hors limites (${HILL_MIN} à ${HILL_MAX}).`, `Segment ${i + 1}: hill ${s.hill} out of range (${HILL_MIN} to ${HILL_MAX}).`);
    if (s.traffic < 0 || s.traffic > 3)
      add('traffic-range', `${p}/traffic`, `Segment ${i + 1} : circulation ${s.traffic} hors limites (0 à 3).`, `Segment ${i + 1}: traffic ${s.traffic} out of range (0 to 3).`);
    // the engine eases toward the target: the segment must be long enough to get there at full speed
    const framesAtMax = (s.length * 256) / SPEED_MAX;
    if (Math.abs(s.curve - prevCurve) * CURVE_FRAMES_PER_LEVEL > framesAtMax)
      add('curve-change', `${p}/length`, `Segment ${i + 1} : trop court pour passer du virage ${prevCurve} à ${s.curve}.`, `Segment ${i + 1}: too short to go from curve ${prevCurve} to ${s.curve}.`);
    if (Math.abs(s.hill - prevHill) * HILL_FRAMES_PER_LEVEL > framesAtMax)
      add('hill-change', `${p}/length`, `Segment ${i + 1} : trop court pour passer de la côte ${prevHill} à ${s.hill}.`, `Segment ${i + 1}: too short to go from hill ${prevHill} to ${s.hill}.`);
    prevCurve = s.curve;
    prevHill = s.hill;
    for (const [k, o] of (s.objects ?? []).entries()) {
      if (o.at >= s.length)
        add('object-range', `${p}/objects/${k}/at`, `Segment ${i + 1} : objet placé après la fin du segment.`, `Segment ${i + 1}: object placed past the end of the segment.`);
      objects.push({ pos: pos + o.at, path: `${p}/objects/${k}` });
    }
    if (s.traffic >= 3 && (s.objects?.length ?? 0) > 0)
      add('sprite-budget', `${p}/traffic`, `Segment ${i + 1} : circulation 3 et objets placés dépassent le budget de sprites.`, `Segment ${i + 1}: traffic 3 plus placed objects go over the sprite budget.`);
    pos += s.length;
  });
  objects.sort((a, b) => a.pos - b.pos);
  if (objects.length > MAX_OBJECTS)
    add('object-count', 'segments', `Trop d'objets placés : ${objects.length} (max ${MAX_OBJECTS}).`, `Too many placed objects: ${objects.length} (max ${MAX_OBJECTS}).`);
  for (let k = 1; k < objects.length; k++) {
    if (objects[k]!.pos - objects[k - 1]!.pos < OBJECT_MIN_GAP)
      add('sprite-budget', objects[k]!.path, `Deux objets à moins de ${OBJECT_MIN_GAP} unités : trop de sprites sur une ligne.`, `Two objects closer than ${OBJECT_MIN_GAP} units: too many sprites on one line.`);
  }
  if (pos > 0xfff0) add('length', 'segments', `Étape trop longue : ${pos} unités (max ${0xfff0}).`, `Stage too long: ${pos} units (max ${0xfff0}).`);
  // finishable: every checkpoint (and the finish) reached in time at 80 % of full speed with 2 crashes
  const v = UNITS_PER_S_MAX * FINISH_SPEED_RATIO;
  let available = t.timeStart;
  for (const cp of checkpoints(t)) {
    const need = cp.pos / v + CRASHES_ALLOWED * CRASH_COST_S;
    if (need > available) {
      const what = cp.addTime ? { fr: `le point de contrôle à ${cp.pos}`, en: `the checkpoint at ${cp.pos}` } : { fr: "l'arrivée", en: 'the finish' };
      add('not-finishable', 'timeStart', `Impossible d'atteindre ${what.fr} à temps : il faut ${Math.ceil(need)} s, il y en a ${available}.`, `Cannot reach ${what.en} in time: needs ${Math.ceil(need)} s, has ${available}.`);
      break;
    }
    available += cp.addTime;
  }
  return issues;
}

/** Parses + validates a track document; zod errors become issues too. */
export function checkTrack(doc: unknown): { track: Track | null; issues: TrackIssue[] } {
  const r = trackSchema.safeParse(doc);
  if (!r.success) {
    return {
      track: null,
      issues: r.error.issues.map((e) => ({ code: 'schema', path: e.path.join('/'), fr: `Format invalide (${e.path.join('/')}) : ${e.message}`, en: `Invalid format (${e.path.join('/')}): ${e.message}` })),
    };
  }
  return { track: r.data, issues: validateTrack(r.data) };
}

/** Segment record: length (2), curve, hill, traffic, scenery. Terminated by length 0. */
export const SEGMENT_BYTES = 6;

export interface EmittedStage {
  segments: number[];
  /** pos (2), kind, lane; terminated by pos $FFFF. */
  objects: number[];
  /** pos (2), addTime; the last record is the finish (addTime 0). */
  checkpoints: number[];
  length: number;
}

export function emitStage(t: Track): EmittedStage {
  const segments: number[] = [];
  const objs: { pos: number; kind: number; lane: number }[] = [];
  let pos = 0;
  for (const s of t.segments) {
    segments.push(s.length & 0xff, s.length >> 8, s.curve & 0xff, s.hill & 0xff, s.traffic, s.scenery);
    for (const o of s.objects ?? []) objs.push({ pos: pos + o.at, kind: KIND_ID[o.kind], lane: o.lane & 0xff });
    pos += s.length;
  }
  segments.push(0, 0, 0, 0, 0, 0);
  objs.sort((a, b) => a.pos - b.pos);
  const objects = objs.flatMap((o) => [o.pos & 0xff, o.pos >> 8, o.kind, o.lane]);
  objects.push(0xff, 0xff, 0, 0);
  const cps = checkpoints(t).flatMap((c) => [c.pos & 0xff, c.pos >> 8, c.addTime]);
  return { segments, objects, checkpoints: cps, length: pos };
}

const bytes = (label: string, b: number[]) => {
  const lines = [`${label}:`];
  for (let i = 0; i < b.length; i += 16) lines.push(`    .byte ${b.slice(i, i + 16).join(', ')}`);
  return lines.join('\n');
};

/** ca65 source for all stages: per-stage tables + index tables (`stage_*`). */
export function emitTracksAsm(tracks: Track[]): string {
  const out = ['; generated by src/core/racer/track.ts (emitTracksAsm): do not edit', `STAGE_COUNT = ${tracks.length}`, '.segment "RODATA"'];
  tracks.forEach((t, i) => {
    const e = emitStage(t);
    out.push(`; ${i + 1} ${t.id}: ${e.length} units, ${t.timeStart} s`);
    out.push(bytes(`stage${i}_segs`, e.segments), bytes(`stage${i}_objs`, e.objects), bytes(`stage${i}_cps`, e.checkpoints));
  });
  const idx = (name: string, f: (i: number) => string) => `${name}: .byte ${tracks.map((_, i) => f(i)).join(', ')}`;
  out.push(
    idx('stage_segs_lo', (i) => `<stage${i}_segs`),
    idx('stage_segs_hi', (i) => `>stage${i}_segs`),
    idx('stage_objs_lo', (i) => `<stage${i}_objs`),
    idx('stage_objs_hi', (i) => `>stage${i}_objs`),
    idx('stage_cps_lo', (i) => `<stage${i}_cps`),
    idx('stage_cps_hi', (i) => `>stage${i}_cps`),
    `stage_time: .byte ${tracks.map((t) => t.timeStart).join(', ')}`,
  );
  return out.join('\n') + '\n';
}
