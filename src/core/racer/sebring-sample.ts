// « Jeu d'exemple SEBRING » (BLUMR-M2): the racer's 5 tracks as one JSON the app loads
// (resources/samples/SEBRING/SEBRING-pistes.json, next to the prebuilt SEBRING.nes). Same track schema and
// validator as the build (track.ts), so a future « genre Course » editor reads and writes this file.
// No Node imports (renderer-safe).
import { STAGE_COUNT, checkTrack, trackLength, type Track, type TrackIssue } from './track.js';

export const SEBRING_FOLDER = 'SEBRING';
export const SEBRING_ROM = 'SEBRING.nes';
export const SEBRING_TRACKS = 'SEBRING-pistes.json';

export interface SebringSample {
  format: 'sebring-pistes';
  schemaVersion: 1;
  title: string;
  stages: Track[];
}

export interface SebringStageView {
  id: string;
  name: { fr: string; en: string };
  length: number;
  timeStart: number;
}

/** Bundles the track documents (racer/tracks order). Throws on an invalid track. */
export function sebringSample(docs: unknown[]): SebringSample {
  const stages = docs.map((d, i) => {
    const r = checkTrack(d);
    if (!r.track || r.issues.length) throw new Error(`piste ${i + 1} : ${r.issues.map((x) => x.fr).join(' ; ')}`);
    return r.track;
  });
  return { format: 'sebring-pistes', schemaVersion: 1, title: 'SEBRING', stages };
}

/** Reads a bundle back: the stages, or the issues (FR + EN) that make it unusable. */
export function readSebringSample(doc: unknown): { stages: SebringStageView[]; tracks: Track[]; issues: TrackIssue[] } {
  const issues: TrackIssue[] = [];
  const o = doc as Partial<SebringSample> | null;
  if (!o || o.format !== 'sebring-pistes' || o.schemaVersion !== 1 || !Array.isArray(o.stages)) {
    return { stages: [], tracks: [], issues: [{ code: 'format', path: '', fr: 'Ce fichier n’est pas un fichier de pistes SEBRING.', en: 'This is not a SEBRING tracks file.' }] };
  }
  const tracks: Track[] = [];
  o.stages.forEach((d, i) => {
    const r = checkTrack(d);
    for (const is of r.issues) issues.push({ ...is, path: `stages/${i}/${is.path}` });
    if (r.track) tracks.push(r.track);
  });
  if (o.stages.length !== STAGE_COUNT) issues.push({ code: 'stage-count', path: 'stages', fr: `Il faut ${STAGE_COUNT} étapes, il y en a ${o.stages.length}.`, en: `${STAGE_COUNT} stages needed, found ${o.stages.length}.` });
  return { stages: tracks.map((t) => ({ id: t.id, name: t.name, length: trackLength(t), timeStart: t.timeStart })), tracks, issues };
}
