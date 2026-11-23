// BLUMR-M1 (docs/RACER-PLAN.md section 4 and M1-T8): SEBRING track schema, validator, emitter, generated
// tables and placeholder assets. No cc65 here; the ROM runs are tests/engine/racer-m1.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAR_J, LANE_CAR, depthRow, inverseHill, readTrackFiles } from '../src/core/racer/build-racer';
import { HUD_MESSAGES, SCREENS, buildRacerAssets, hudMessage, textTiles } from '../src/core/racer/racer-assets';
import { BOT_LANE_PX, RACER_PROBE } from '../src/core/racer/racer-run';
import { HILL_MAX, HILL_MIN, hillHorizon, hillTable } from '../src/core/racer/road-data';
import { SEGMENT_BYTES, STAGE_COUNT, checkTrack, checkpoints, emitStage, emitTracksAsm, trackLength, type Track } from '../src/core/racer/track';

const ROOT = path.resolve(import.meta.dirname, '..');
const tracks = readTrackFiles(path.join(ROOT, 'racer'));

function base(): Track {
  return {
    schemaVersion: 1,
    id: 'test',
    name: { fr: 'Essai', en: 'Test' },
    palette: 'coucher-de-soleil',
    backdrop: 'galeries-anjou',
    timeStart: 40,
    segments: [
      { length: 200, curve: 0, hill: 0, traffic: 1, scenery: 0 },
      { length: 300, curve: -20, hill: 0, traffic: 2, scenery: 0, checkpoint: { addTime: 20 } },
      { length: 200, curve: 0, hill: 8, traffic: 0, scenery: 1 },
    ],
  };
}
const codes = (doc: unknown) => checkTrack(doc).issues.map((i) => i.code);

describe('BLUMR-M1 tracks', () => {
  it('the 5 placeholder stages follow the route and pass the validator', () => {
    expect(tracks).toHaveLength(STAGE_COUNT);
    const parsed = tracks.map((t) => checkTrack(t));
    for (const r of parsed) expect(r.issues).toEqual([]);
    expect(parsed.map((r) => r.track!.id)).toEqual(['anjou', 'metropolitaine', 'sherbrooke', 'plateau', 'centre-ville']);
    for (const r of parsed) {
      expect(checkpoints(r.track!).filter((c) => c.addTime > 0).length).toBeGreaterThanOrEqual(1);
      expect(trackLength(r.track!)).toBeGreaterThan(1000);
    }
  });

  it('M1-T8 rejects out-of-range curve and hill, with French and English messages', () => {
    const t = base();
    t.segments[0]!.curve = 40;
    t.segments[2]!.hill = -11;
    const r = checkTrack(t);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['curve-range', 'hill-range']));
    const c = r.issues.find((i) => i.code === 'curve-range')!;
    expect(c.fr).toMatch(/virage 40 hors limites/);
    expect(c.en).toMatch(/curve 40 out of range/);
  });

  it('M1-T8 rejects a stage that cannot be finished in time (80 % speed, 2 crashes)', () => {
    const t = base();
    t.timeStart = 10;
    const r = checkTrack(t);
    const i = r.issues.find((x) => x.code === 'not-finishable')!;
    expect(i.fr).toMatch(/Impossible d'atteindre/);
    expect(i.en).toMatch(/Cannot reach/);
    expect(codes(base())).toEqual([]);
  });

  it('M1-T8 rejects traffic over the sprite budget: objects too close, density 3 with placed objects', () => {
    const t = base();
    t.segments[0]!.objects = [
      { at: 50, kind: 'car', lane: 0 },
      { at: 60, kind: 'cone', lane: 1 },
    ];
    const r = checkTrack(t);
    const i = r.issues.find((x) => x.code === 'sprite-budget')!;
    expect(i.fr).toMatch(/trop de sprites/);
    expect(i.en).toMatch(/too many sprites/);
    const u = base();
    u.segments[1]!.traffic = 3;
    u.segments[1]!.objects = [{ at: 10, kind: 'cone', lane: 0 }];
    expect(codes(u)).toContain('sprite-budget');
  });

  it('M1-T8 rejects a segment too short to reach its curve or hill, and bad formats', () => {
    const t = base();
    t.segments[1]!.length = 20; // 20 levels need 40 frames, 20 units last 23 frames at full speed
    expect(codes(t)).toContain('curve-change');
    const u = base();
    u.segments[2]!.length = 20;
    expect(codes(u)).toContain('hill-change');
    expect(codes({ ...base(), timeStart: 'x' })).toEqual(['schema']);
  });

  it('emits 6-byte segments, sorted objects and checkpoints ending with the finish', () => {
    const t = base();
    t.segments[2]!.objects = [{ at: 30, kind: 'pothole', lane: -1 }];
    t.segments[0]!.objects = [{ at: 100, kind: 'car', lane: 1 }];
    const e = emitStage(t);
    expect(SEGMENT_BYTES).toBe(6);
    expect(e.segments.slice(0, 6)).toEqual([200, 0, 0, 0, 1, 0]);
    expect(e.segments.slice(6, 12)).toEqual([44, 1, 0xec, 0, 2, 0]);
    expect(e.segments.slice(-6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(e.objects).toEqual([100, 0, 1, 1, 530 & 0xff, 530 >> 8, 5, 0xff, 0xff, 0xff, 0, 0]);
    expect(e.checkpoints).toEqual([200, 0, 20, 700 & 0xff, 700 >> 8, 0]);
    expect(emitTracksAsm([t])).toMatch(/STAGE_COUNT = 1[\s\S]*stage0_segs:[\s\S]*stage_time: .byte 40/);
  });
});

describe('BLUMR-M1 tables and assets', () => {
  it('the inverse hill tables invert the kernel row tables', () => {
    for (let lv = HILL_MIN; lv <= HILL_MAX; lv++) {
      const t = hillTable(lv);
      const inv = inverseHill(lv);
      for (let j = 0; j < 120; j++) {
        const k = inv[j]!;
        if (k === 255) {
          expect(t[0]!).toBeGreaterThan(120 + j);
          continue;
        }
        expect(k).toBeLessThan(240 - hillHorizon(lv));
        expect(t[k]!).toBeGreaterThanOrEqual(120 + j);
        if (k > 0) expect(t[k - 1]!).toBeLessThan(120 + j);
      }
    }
  });

  it('depth -> row and lane constants agree with the bot', () => {
    expect(depthRow(250)).toBe(4);
    expect(depthRow(11)).toBe(91);
    expect(LANE_CAR).toBe(BOT_LANE_PX);
    expect(CAR_J).toBe(80);
  });

  it('assets fit the CHR budget: backdrop banks <= 128 tiles, sprites <= 256, every text in the font', () => {
    const parsed = tracks.map((t) => checkTrack(t).track!);
    const a = buildRacerAssets(parsed);
    for (const s of a.stages) {
      expect(s.backdropTiles).toBeLessThanOrEqual(128);
      expect(s.nametables).toHaveLength(2048);
      expect(s.palette).toHaveLength(32);
      expect([...s.palette]).not.toContain(0x0d);
    }
    expect(a.sprites.count).toBeLessThanOrEqual(256);
    expect(a.roadTiles).toBeLessThanOrEqual(128);
    expect(a.cards).toHaveLength(STAGE_COUNT);
    for (const m of HUD_MESSAGES) expect(hudMessage(m)).toHaveLength(32);
    // the ending text sits in the ROM's screens bank as font tiles
    const bonne = textTiles('BONNE FÊTE BLUM !');
    const ending = [...a.screens.ending];
    expect(ending.join(',')).toContain(bonne.join(','));
    expect(SCREENS.credits.map((l) => l.text).join(' ')).toMatch(/FAMISTUDIO \(MIT\)/);
  });

  it('probe contract: every RACER_PROBE field is written by racer/src/sebring.s', () => {
    const src = readFileSync(path.join(ROOT, 'racer', 'src', 'sebring.s'), 'utf8');
    const written = new Set([...src.matchAll(/sta PROBE\+\$([0-9A-F]{2})/g)].map((m) => parseInt(m[1]!, 16)));
    const fromNmiOrReset = [RACER_PROBE.lag, RACER_PROBE.version, RACER_PROBE.cheats];
    for (const [k, o] of Object.entries(RACER_PROBE)) {
      if (k === 'base' || fromNmiOrReset.includes(o as never)) continue;
      expect(written.has(o), `probe field ${k} ($${o.toString(16)})`).toBe(true);
    }
  });
});
