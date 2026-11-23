// Builds the SEBRING racer ROM (racer/, BLUMR-M1 + M2): tracks -> validator -> generated data in gen/, then
// ca65 + ld65 from the factory's pinned cc65 toolchain. Art and sound come from the BLUMR-A1 kit in
// racer/kit/ (scripts/import-sebring-kit.mjs); without it, the M1 placeholder art and BLUM's songs.
// The FamiStudio engine is copied from engine/audio (BLUM's own file, never edited).
// Same cartridge as BLUM (DEFAULT_CARTRIDGE). Argument arrays, no shell (PLAN §7.1).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseLabels, toolchainPresent, type Toolchain } from '../build/engine-build.js';
import { headerForCartridge } from '../nes/header.js';
import { DEFAULT_CARTRIDGE } from '../schema/project.js';
import {
  CHR_BACKDROP0,
  CHR_ROAD_A,
  CHR_SPRITES,
  SNOW_GRASS,
  HUD_FIELDS,
  HUD_MESSAGES,
  MSG_CONT_COL,
  SCENERY_GRASS,
  SIZE_TILES,
  TEXT_PALETTE,
  buildRacerAssets,
  fontTile,
  hudMessage,
  hudTemplate,
  type KitSpriteSheet,
  type RacerAssets,
  type RacerKit,
} from './racer-assets.js';
import { CURVE_MIN, HILL_MAX, HILL_MIN, ROAD_ROWS, hillHorizon, hillTable } from './road-data.js';
import { CRASH_PENALTY_S, KIND_ID, STAGE_COUNT, checkTrack, emitTracksAsm, type Track, type TrackIssue } from './track.js';

/** Road row (0 = horizon) used for the car's lane and collisions: screen line 200 on flat ground. */
export const CAR_J = 80;
/** Lane offset at row j: 60 % of the road half width (3.5 + n). */
export const laneOffset = (j: number) => Math.round((3.5 + j + 1) * 0.6);
export const LANE_CAR = laneOffset(CAR_J);
/** Lines below the horizon on flat ground for a depth z (stripe depth unit): n = 1000 / z. */
export const depthRow = (z: number) => (z < 1 ? 255 : Math.min(255, Math.round(1000 / z)));
/** Road centre shift (px) at row j for the strongest curve, divided by 32 per level in the engine. */
export const curveShift = (j: number) => Math.round((112 * (119 - j) ** 2) / 119 ** 2);

/** Road row (0-119 below the horizon row 120) -> first kernel line k showing it on a hill level; 255 when
 * the row is not shown (cut by a crest). The kernel shows row hillTable(level)[k] on line horizon + k. */
export function inverseHill(level: number): number[] {
  const t = hillTable(level);
  const lines = 240 - hillHorizon(level);
  return Array.from({ length: ROAD_ROWS }, (_, j) => {
    const row = 120 + j;
    if (t[0]! > row) return 255;
    for (let k = 0; k < lines; k++) if (t[k]! >= row) return k;
    return lines - 1;
  });
}

/** Sound index contract of music.s / sfx.s: the BLUMR-A1 kit (racer/kit/manifest.json `racerSound`). */
export const RACER_SOUND = {
  SONG_TITLE: 0,
  RADIO_SONGS: [1, 2, 3],
  SONG_CLEAR: 4,
  SONG_GAMEOVER: 5,
  SONG_ENDING: 6,
  SFX_CRASH: 0,
  SFX_CP: 1,
  SFX_BUMP: 2,
  SFX_HONK: 3,
  SFX_TIMEOVER: 4,
  SFX_CARD: 5,
  SFX_PAUSE: 6,
  SFX_REV: 7,
  SFX_SKID: 8,
  SFX_START: 9,
} as const;
type SoundMap = { [K in keyof typeof RACER_SOUND]: K extends 'RADIO_SONGS' ? readonly number[] : number };
/** Without a kit: BLUM's songs and effects (engine/audio), the M1 placeholder contract. */
export const PLACEHOLDER_SOUND: SoundMap = {
  SONG_TITLE: 0,
  RADIO_SONGS: [1, 2, 3],
  SONG_CLEAR: 7,
  SONG_GAMEOVER: 8,
  SONG_ENDING: 9,
  SFX_CRASH: 8,
  SFX_CP: 5,
  SFX_BUMP: 2,
  SFX_HONK: 0,
  SFX_TIMEOVER: 4,
  SFX_CARD: 6,
  SFX_PAUSE: 9,
  SFX_REV: 1,
  SFX_SKID: 3,
  SFX_START: 7,
} as const;

/** racer/kit/ (BLUMR-A1 art + music), or null when the folder is absent. */
export function loadKit(racerDir: string): RacerKit | null {
  const dir = path.join(racerDir, 'kit');
  if (!existsSync(path.join(dir, 'manifest.json'))) return null;
  const bin = (f: string) => new Uint8Array(readFileSync(path.join(dir, f)));
  const json = <T>(f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T;
  const pal = json<{ stages: { index: number; backdrop: string }[] }>('palettes.json');
  const stages = [...pal.stages].sort((a, b) => a.index - b.index);
  return {
    backdrops: stages.map((s) => s.backdrop),
    backdropChr: stages.map((s) => bin(`chr/backdrop-${s.index}.chr`)),
    stageBanks: stages.map((s) => bin(`stages/stage${s.index}.bin`)),
    spritesChr: bin('chr/sprites.chr'),
    sprites: json<KitSpriteSheet>('sprites.json'),
    screens: bin('screens.bin'),
    screenChr: ['title-r0', 'title-r1', 'ending-r0', 'ending-r1'].map((n) => bin(`chr/${n}.chr`)),
    titlePalette: bin('title-palette.bin'),
    endingPalette: bin('ending-palette.bin'),
    music: readFileSync(path.join(dir, 'audio', 'music.s'), 'utf8'),
    sfx: readFileSync(path.join(dir, 'audio', 'sfx.s'), 'utf8'),
    source: readFileSync(path.join(dir, 'SOURCE.txt'), 'utf8').split(/\r?\n/)[0]!.trim(),
  };
}

/** Collision half widths (car centre to object centre, px at the car's line) and placed-object speeds. */
const KIND_HIT = { car: 24, cone: 18, bus: 28, plow: 26, pothole: 16 };
const KIND_SPEED = { car: 120, cone: 0, bus: 90, plow: 70, pothole: 0 };

export interface RacerBuild {
  ok: boolean;
  rom: Uint8Array | null;
  log: string;
  labels: Map<string, number>;
  map: string;
  issues: TrackIssue[];
  tracks: Track[];
  assets: RacerAssets | null;
}

export interface RacerOptions {
  /** Extra `NAME = value` lines for gen/racer.inc (START_STAGE, TIME_OVERRIDE, TEST_CHEATS, timing). */
  defines?: Record<string, number>;
  /** Track documents instead of racer/tracks/*.json (tests, the app). */
  tracks?: unknown[];
  /** false = the M1 placeholder art and sound even when racer/kit/ exists (tests). */
  kit?: boolean;
}

/** racer/tracks/*.json in file-name order. */
export function readTrackFiles(racerDir: string): unknown[] {
  const dir = path.join(racerDir, 'tracks');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as unknown);
}

const byteLines = (label: string, b: ArrayLike<number>) => {
  const a = Array.from(b);
  const out = [`${label}:`];
  for (let i = 0; i < a.length; i += 16) out.push(`    .byte ${a.slice(i, i + 16).join(', ')}`);
  return out.join('\n');
};

/** gen/tables.s: lookup tables and HUD strings (RODATA, fixed bank). */
export function racerTables(a: RacerAssets, sound: SoundMap = RACER_SOUND): string {
  const kinds = Object.keys(KIND_ID) as (keyof typeof KIND_ID)[];
  const perKind = (f: (k: keyof typeof KIND_ID) => number) => {
    const t = new Array<number>(6).fill(0);
    for (const k of kinds) t[KIND_ID[k]] = f(k);
    return t;
  };
  const out = ['; generated by src/core/racer/build-racer.ts (racerTables): do not edit', '.segment "RODATA"'];
  out.push(byteLines('text_palette', TEXT_PALETTE));
  out.push(byteLines('hud_template', hudTemplate()));
  HUD_MESSAGES.forEach((m, i) => out.push(byteLines(`msg_${i}`, hudMessage(m))));
  out.push(`msg_lo: .byte ${HUD_MESSAGES.map((_, i) => `<msg_${i}`).join(', ')}`);
  out.push(`msg_hi: .byte ${HUD_MESSAGES.map((_, i) => `>msg_${i}`).join(', ')}`);
  out.push(byteLines('scenery_grass', SCENERY_GRASS));
  out.push(byteLines('radio_song', sound.RADIO_SONGS));
  out.push(byteLines('ntab', Array.from({ length: 256 }, (_, z) => depthRow(z))));
  out.push(byteLines('offtab', Array.from({ length: 120 }, (_, j) => curveShift(j))));
  out.push(byteLines('lanetab', Array.from({ length: 120 }, (_, j) => laneOffset(j))));
  out.push(byteLines('kind_hit', perKind((k) => KIND_HIT[k])));
  out.push(byteLines('kind_speed', perKind((k) => KIND_SPEED[k])));
  out.push(byteLines('kind_tile', a.sprites.kindTile));
  out.push(byteLines('kind_attr', a.sprites.kindAttr));
  // player poses: lean index 0-4 (hard left .. hard right), spin 8 poses (attr $40 = mirrored)
  out.push(byteLines('lean_tile', a.sprites.leanTile));
  out.push(byteLines('lean_attr', a.sprites.leanAttr));
  out.push(byteLines('spin_tile', a.sprites.spinTile));
  out.push(byteLines('spin_attr', a.sprites.spinAttr));
  out.push(byteLines('driver_tile', a.sprites.driverTiles));
  // screens (engine order title, game over, ending, credits): CHR units for R0 / R1
  out.push(byteLines('screen_r0', a.screenLooks.map((l) => l.r0)));
  out.push(byteLines('screen_r1', a.screenLooks.map((l) => l.r1)));
  // fireworks on the ending: 8 bursts (x, y, frame offset); small burst tiles, large burst first tiles
  const fx = a.sprites.fx;
  out.push(byteLines('fw_x', [40, 200, 120, 72, 168, 24, 228, 100]));
  out.push(byteLines('fw_y', [72, 64, 84, 96, 80, 100, 92, 68]));
  out.push(byteLines('fw_phase', [0, 40, 80, 20, 60, 100, 10, 50]));
  out.push(byteLines('fw_small', fx ? fx.burstSmall : [0, 0]));
  out.push(byteLines('fw_large', fx ? fx.burstLarge : [0, 0]));
  // snow flakes (snow storm mode): start x per flake
  out.push(byteLines('snow_x0', [12, 140, 76, 204, 44, 172, 108, 236]));
  out.push(byteLines('size_cols', SIZE_TILES.map((s) => s[0])));
  out.push(byteLines('size_rows', SIZE_TILES.map((s) => s[1])));
  out.push(byteLines('flip_arc', Array.from({ length: 64 }, (_, t) => Math.round(40 * Math.sin((Math.PI * t) / 64)))));
  // frames between random cars per traffic density (+ 0-31 random)
  out.push(byteLines('spawn_gap', [0, 240, 160, 110]));
  // player car sprite offsets (4 x 3 tiles, x relative to the car centre): normal, mirrored, upside down
  const cells = Array.from({ length: 12 }, (_, i) => ({ col: i % 4, row: Math.floor(i / 4) }));
  out.push(byteLines('car_dx', [...cells.map((c) => c.col * 8 - 16), ...cells.map((c) => (3 - c.col) * 8 - 16), ...cells.map((c) => c.col * 8 - 16)].map((v) => v & 0xff)));
  out.push(byteLines('car_dy', [...cells.map((c) => c.row * 8), ...cells.map((c) => c.row * 8), ...cells.map((c) => (2 - c.row) * 8)]));
  // inverse hill tables (fixed bank): road row - 120 -> first kernel line showing it, 255 = behind a crest
  out.push('.segment "INVTAB"');
  const levels = Array.from({ length: HILL_MAX - HILL_MIN + 1 }, (_, i) => HILL_MIN + i);
  for (const lv of levels) out.push(byteLines(`inv_${lv - HILL_MIN}`, inverseHill(lv)));
  out.push(`inv_lo: .byte ${levels.map((lv) => `<inv_${lv - HILL_MIN}`).join(', ')}`);
  out.push(`inv_hi: .byte ${levels.map((lv) => `>inv_${lv - HILL_MIN}`).join(', ')}`);
  out.push('.segment "RODATA"');
  out.push(byteLines('lane_bit', [1, 2, 4]));
  out.push(byteLines('pow10_lo', [1000 & 0xff, 100, 10]));
  out.push(byteLines('pow10_hi', [1000 >> 8, 0, 0]));
  return out.join('\n') + '\n';
}

function racerInc(a: RacerAssets, sound: SoundMap, defines: Record<string, number>): string {
  const msg = (name: string, text: string) => [name, HUD_MESSAGES.indexOf(text as (typeof HUD_MESSAGES)[number])] as const;
  const defs: Record<string, number> = {
    CURVE_MIN: CURVE_MIN & 0xff,
    HILL_MIN: HILL_MIN & 0xff,
    CHR_ROAD_A,
    CHR_BACKDROP0,
    CHR_SPRITES,
    SPR_CAR0: a.sprites.car[0],
    SPR_CAR_L: a.sprites.car[1],
    SPR_CAR_R: a.sprites.car[2],
    SPR_DRIVER: a.sprites.driver,
    FLIP_ROLL: a.sprites.flipRoll ?? 255,
    HAS_FX: a.sprites.fx ? 1 : 0,
    SPR_SMOKE: a.sprites.fx?.smoke[0] ?? 0,
    SPR_HONK: a.sprites.fx?.honk ?? 0,
    SPR_FLAKE: a.sprites.fx?.smoke[1] ?? a.sprites.driver,
    SNOW_GRASS,
    HUD_DIGIT0: fontTile('0'),
    HUD_STAGE_COL: HUD_FIELDS.stage,
    HUD_TIME_COL: HUD_FIELDS.time,
    HUD_SPEED_COL: HUD_FIELDS.speed,
    HUD_DIST_COL: HUD_FIELDS.dist,
    MSG_CONT_COL,
    ...Object.fromEntries([
      msg('MSG_PAUSE', 'PAUSE'),
      msg('MSG_CP', 'POINT DE CONTRÔLE !'),
      msg('MSG_TIMEOVER', 'TEMPS ÉCOULÉ !'),
      msg('MSG_GAMEOVER', 'FIN DE PARTIE'),
      msg('MSG_CONTINUE', 'START : CONTINUER  (0)'),
      msg('MSG_FINISH', 'ÉTAPE RÉUSSIE !'),
      msg('MSG_RADIO0', 'RADIO ANJOU 104,5'),
    ]),
    SCR_TITLE: 0,
    SCR_GAMEOVER: 1,
    SCR_ENDING: 2,
    SCR_CREDITS: 3,
    SONG_TITLE: sound.SONG_TITLE,
    SONG_CLEAR: sound.SONG_CLEAR,
    SONG_GAMEOVER: sound.SONG_GAMEOVER,
    SONG_ENDING: sound.SONG_ENDING,
    SFX_CP: sound.SFX_CP,
    SFX_BUMP: sound.SFX_BUMP,
    SFX_TIMEOVER: sound.SFX_TIMEOVER,
    SFX_CARD: sound.SFX_CARD,
    SFX_CRASH: sound.SFX_CRASH,
    SFX_PAUSE: sound.SFX_PAUSE,
    SFX_HONK: sound.SFX_HONK,
    SFX_REV: sound.SFX_REV,
    SFX_SKID: sound.SFX_SKID,
    SFX_START: sound.SFX_START,
    CAR_J,
    LANE_CAR,
    CRASH_PENALTY: CRASH_PENALTY_S,
    ...defines,
  };
  for (const [k, v] of Object.entries(defs)) if (!Number.isInteger(v) || v < 0) throw new Error(`racer.inc: ${k} = ${v}`);
  return Object.entries(defs).map(([k, v]) => `${k} = ${v}\n`).join('');
}

/** Stage bank: nametables ($8000), palette ($8800), card palette ($8820), stage card ($8C00). */
export function stageBank(a: RacerAssets, i: number): Uint8Array {
  const b = new Uint8Array(0x1000);
  b.set(a.stages[i]!.nametables, 0);
  b.set(a.stages[i]!.palette, 0x800);
  b.set(a.cardPalettes[i]!, 0x820);
  b.set(a.cards[i]!, 0xc00);
  return b;
}

/** Screens bank: 4 x 1 KiB screens, then their 4 palettes (32 bytes each) at +$1000. */
export function screensBank(a: RacerAssets): Uint8Array {
  const b = new Uint8Array(0x1000 + 4 * 32);
  [a.screens.title, a.screens.gameover, a.screens.ending, a.screens.credits].forEach((s, i) => b.set(s, i * 1024));
  a.screenLooks.forEach((l, i) => b.set(l.palette, 0x1000 + i * 32));
  return b;
}

export function buildRacer(racerDir: string, engineDir: string, toolchain: Toolchain, workDir: string, opts: RacerOptions = {}): RacerBuild {
  const fail = (log: string, extra: Partial<RacerBuild> = {}): RacerBuild => ({ ok: false, rom: null, log, labels: new Map(), map: '', issues: [], tracks: [], assets: null, ...extra });
  const docs = opts.tracks ?? readTrackFiles(racerDir);
  const tracks: Track[] = [];
  const issues: TrackIssue[] = [];
  docs.forEach((d, i) => {
    const r = checkTrack(d);
    for (const is of r.issues) issues.push({ ...is, path: `track ${i + 1}/${is.path}` });
    if (r.track) tracks.push(r.track);
  });
  if (docs.length !== STAGE_COUNT) issues.push({ code: 'stage-count', path: 'tracks', fr: `Il faut ${STAGE_COUNT} étapes, il y en a ${docs.length}.`, en: `${STAGE_COUNT} stages needed, found ${docs.length}.` });
  if (issues.length) return fail(issues.map((i) => `${i.path}: ${i.fr}`).join('\n'), { issues });
  if (/[\s\u0080-￿]/.test(workDir)) return fail(`build folder has a space or accent: ${workDir}`);
  if (!toolchainPresent(toolchain)) return fail(`cc65 toolchain not found in ${toolchain.dir}`);

  const kit = opts.kit === false ? null : loadKit(racerDir);
  const sound = kit ? RACER_SOUND : PLACEHOLDER_SOUND;
  let assets: RacerAssets;
  try {
    assets = buildRacerAssets(tracks, kit);
  } catch (e) {
    return fail(String((e as Error).message));
  }
  rmSync(workDir, { recursive: true, force: true });
  for (const d of ['gen', 'obj', 'src']) mkdirSync(path.join(workDir, d), { recursive: true });
  cpSync(path.join(racerDir, 'cfg'), path.join(workDir, 'cfg'), { recursive: true });
  cpSync(path.join(racerDir, 'src'), path.join(workDir, 'src'), { recursive: true });
  // shared, never edited: the FamiStudio engine; the kit's songs/effects (or BLUM's as placeholders)
  for (const f of kit ? ['famistudio_ca65.s'] : ['famistudio_ca65.s', 'music.s', 'sfx.s']) cpSync(path.join(engineDir, 'audio', f), path.join(workDir, 'src', f));
  if (kit) {
    writeFileSync(path.join(workDir, 'src', 'music.s'), kit.music);
    writeFileSync(path.join(workDir, 'src', 'sfx.s'), kit.sfx);
  }
  cpSync(path.join(engineDir, 'audio', 'NoteTables'), path.join(workDir, 'src', 'NoteTables'), { recursive: true });

  const gen = (name: string, data: Uint8Array | string) => writeFileSync(path.join(workDir, 'gen', name), data);
  gen('header.bin', headerForCartridge(DEFAULT_CARTRIDGE));
  gen('chr.bin', assets.chr);
  gen('road0.bin', assets.roadBanks[0]!);
  gen('road1.bin', assets.roadBanks[1]!);
  gen('rowtabs.bin', assets.rowTables);
  tracks.forEach((_, i) => gen(`stage${i}.bin`, stageBank(assets, i)));
  gen('screens.bin', screensBank(assets));
  gen('tables.s', racerTables(assets, sound));
  gen('tracks.s', emitTracksAsm(tracks));
  try {
    gen('racer.inc', racerInc(assets, sound, opts.defines ?? {}));
  } catch (e) {
    return fail(String((e as Error).message));
  }

  const bin = (t: string) => path.join(toolchain.dir, 'bin', `${t}.exe`);
  let log = '';
  const run = (tool: string, args: string[]): boolean => {
    const r = spawnSync(bin(tool), args, { cwd: path.join(workDir, 'src'), encoding: 'utf8', timeout: 60_000, windowsHide: true, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' } });
    log += `${tool} ${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
    return r.status === 0;
  };
  const gdir = path.join(workDir, 'gen');
  const sdir = path.join(workDir, 'src');
  const ok =
    run('ca65', ['-g', '-I', gdir, '-I', sdir, '--bin-include-dir', gdir, '--bin-include-dir', sdir, '-o', path.join(workDir, 'obj', 'sebring.o'), path.join(sdir, 'sebring.s')]) &&
    run('ld65', ['-C', path.join(workDir, 'cfg', 'sebring.cfg'), '-o', path.join(workDir, 'sebring.nes'), '-m', path.join(workDir, 'sebring.map'), '-Ln', path.join(workDir, 'labels.txt'), '--dbgfile', path.join(workDir, 'sebring.dbg'), path.join(workDir, 'obj', 'sebring.o')]);
  if (!ok) return fail(log, { tracks, assets });
  const labelsPath = path.join(workDir, 'labels.txt');
  const labels = existsSync(labelsPath) ? parseLabels(readFileSync(labelsPath, 'utf8')) : new Map<string, number>();
  return { ok: true, rom: new Uint8Array(readFileSync(path.join(workDir, 'sebring.nes'))), log, labels, map: readFileSync(path.join(workDir, 'sebring.map'), 'utf8'), issues: [], tracks, assets };
}
