// BLUMR-M2 (docs/RACER-PLAN.md section 10): the A1 kit wired into the racer build (art, palettes, screens,
// sound contract), the 5 real-route stages (friendly time, whole run in about 10-12 minutes) and the
// data the build writes. No cc65 here; the ROM runs are tests/engine/racer-m2.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RACER_SOUND, loadKit, readTrackFiles, screensBank, stageBank } from '../src/core/racer/build-racer';
import {
  CHR_BACKDROP0,
  CHR_SCREENS,
  CHR_SPRITES,
  CREDITS_ART_LINE,
  PALETTES,
  SPRITE_PALETTES,
  buildRacerAssets,
  stagePalette,
  textTiles,
} from '../src/core/racer/racer-assets';
import { STAGE_COUNT, UNITS_PER_S_MAX, checkTrack, checkpoints, trackLength, type Track } from '../src/core/racer/track';
import { readSebringSample, sebringSample } from '../src/core/racer/sebring-sample';
import { KeyVault } from '../src/main/key-vault';
import { Session } from '../src/main/session';
import { SettingsStore, defaultSettings } from '../src/main/settings';
import { tempDir } from './helpers';

const ROOT = path.resolve(import.meta.dirname, '..');
const RACER = path.join(ROOT, 'racer');
const kit = loadKit(RACER)!;
const tracks = readTrackFiles(RACER).map((d) => checkTrack(d).track!);
const kitJson = <T>(f: string) => JSON.parse(readFileSync(path.join(RACER, 'kit', f), 'utf8')) as T;
const rowText = (nt: Uint8Array, row: number) => Array.from(nt.subarray(row * 32, row * 32 + 32));
const containsText = (nt: Uint8Array, text: string) => {
  const t = textTiles(text).join(',');
  return Array.from({ length: 30 }, (_, r) => rowText(nt, r).join(',')).some((r) => r.includes(t));
};

describe('BLUMR-M2 kit', () => {
  it('racer/kit is the A1 kit: source line, every engine file, sizes', () => {
    expect(kit).not.toBeNull();
    expect(kit.source).toMatch(/^NES-BLUM-FACTORY-ASSETS\/sebring @ [0-9a-f]{7}/);
    expect(kit.backdrops).toEqual(['galeries-anjou', 'metropolitaine', 'stade-olympique', 'mont-royal', 'centre-ville']);
    for (const c of kit.backdropChr) expect(c).toHaveLength(2048);
    for (const b of kit.stageBanks) expect(b).toHaveLength(4096);
    expect(kit.spritesChr).toHaveLength(4096);
    expect(kit.screens).toHaveLength(4096);
    for (const c of kit.screenChr) expect(c).toHaveLength(2048);
    expect(kit.music).toMatch(/^music_data_blum_music:/m);
    expect(kit.sfx).toMatch(/^sounds:/m);
  });

  it('palettes: engine constants = A1 palettes.json; each kit stage bank palette = stagePalette(its look)', () => {
    const pal = kitJson<{ racerAssetsPALETTES: Record<string, unknown>; sprites: { indexes: number[] }[]; stages: { index: number; palette: string }[] }>('palettes.json');
    expect(PALETTES).toEqual(pal.racerAssetsPALETTES);
    expect(SPRITE_PALETTES).toEqual(pal.sprites.map((s) => s.indexes));
    for (const s of pal.stages) expect(Array.from(stagePalette(PALETTES[s.palette]!))).toEqual(Array.from(kit.stageBanks[s.index]!.subarray(0x800, 0x820)));
  });

  it('sound contract = the kit manifest (titles, 3 radio stations, jingles, 10 SFX)', () => {
    const m = kitJson<{ music: { racerSound: Record<string, unknown>; songs: unknown[]; sfx: unknown[] } }>('manifest.json');
    expect(RACER_SOUND).toEqual(m.music.racerSound);
    expect(m.music.songs).toHaveLength(7);
    expect(m.music.sfx).toHaveLength(10);
  });

  it('assets from the kit: CHR units (backdrops, sprites, screens), cards with the track text, credits line', () => {
    const a = buildRacerAssets(tracks, kit);
    expect(a.kitSource).toBe(kit.source);
    tracks.forEach((t, i) => {
      const k = kit.backdrops.indexOf(t.backdrop);
      expect(Array.from(a.chr.subarray((CHR_BACKDROP0 + 2 * i) * 1024, (CHR_BACKDROP0 + 2 * i + 2) * 1024))).toEqual(Array.from(kit.backdropChr[k]!));
      expect(Array.from(a.stages[i]!.nametables)).toEqual(Array.from(kit.stageBanks[k]!.subarray(0, 0x800)));
      // the card: the kit postcard with this track's stage number and names
      expect(containsText(a.cards[i]!, `ÉTAPE ${i + 1} / ${STAGE_COUNT}`)).toBe(true);
      expect(containsText(a.cards[i]!, t.name.fr.toUpperCase())).toBe(true);
      expect(Array.from(a.cards[i]!.subarray(2 * 32, 18 * 32))).toEqual(Array.from(kit.stageBanks[k]!.subarray(0xc00 + 2 * 32, 0xc00 + 18 * 32)));
      expect(a.cardPalettes[i]![15]).toBe(0x0f);
      const bank = stageBank(a, i);
      expect(Array.from(bank.subarray(0x820, 0x840))).toEqual(Array.from(a.cardPalettes[i]!));
    });
    expect(Array.from(a.chr.subarray(CHR_SPRITES * 1024, (CHR_SPRITES + 4) * 1024))).toEqual(Array.from(kit.spritesChr));
    kit.screenChr.forEach((c, i) => expect(Array.from(a.chr.subarray((CHR_SCREENS + 2 * i) * 1024, (CHR_SCREENS + 2 * i + 2) * 1024))).toEqual(Array.from(c)));
    // screens: title, game over, ending as drawn by A1; credits with our art line instead of a step id
    expect(Array.from(a.screens.title)).toEqual(Array.from(kit.screens.subarray(0, 1024)));
    expect(Array.from(a.screens.ending)).toEqual(Array.from(kit.screens.subarray(2048, 3072)));
    expect(containsText(a.screens.ending, 'HAPPY BIRTHDAY BLUM!')).toBe(true);
    expect(containsText(a.screens.credits, CREDITS_ART_LINE)).toBe(true);
    expect(containsText(a.screens.credits, 'FAMISTUDIO (MIT)')).toBe(true);
    expect(containsText(a.screens.credits, 'BLUMR-A1')).toBe(false);
    expect(a.screenLooks.map((l) => [l.r0, l.r1])).toEqual([
      [CHR_SCREENS, CHR_SCREENS + 2],
      [CHR_SCREENS, CHR_SCREENS + 2],
      [CHR_SCREENS + 4, CHR_SCREENS + 6],
      [CHR_SCREENS, CHR_SCREENS + 2],
    ]);
    const sb = screensBank(a);
    expect(Array.from(sb.subarray(0x1000, 0x1020))).toEqual(Array.from(kit.titlePalette));
    expect(Array.from(sb.subarray(0x1040, 0x1060))).toEqual(Array.from(kit.endingPalette));
    // sprites: A1 poses (right = left mirrored), 8 spin poses, driver head + shoulders, fireworks
    expect(a.sprites.leanAttr).toEqual([0, 0, 0, 0x40, 0x40]);
    expect(new Set(a.sprites.spinTile).size).toBe(5);
    expect(a.sprites.flipRoll).not.toBeNull();
    expect(a.sprites.driverTiles[1]).toBe(a.sprites.driverTiles[0] + 1);
    expect(a.sprites.fx).not.toBeNull();
  });

  it('a track may pair any palette with any backdrop (the app edits tracks)', () => {
    const t: Track = { ...tracks[0]!, palette: 'nuit', backdrop: 'mont-royal' };
    const a = buildRacerAssets([t, ...tracks.slice(1)], kit);
    expect(Array.from(a.stages[0]!.palette)).toEqual(Array.from(stagePalette(PALETTES.nuit!)));
    expect(Array.from(a.stages[0]!.nametables)).toEqual(Array.from(kit.stageBanks[3]!.subarray(0, 0x800)));
    expect(() => buildRacerAssets([{ ...t, backdrop: 'tour-eiffel' }], kit)).toThrow(/décor inconnu/);
  });
});

describe('BLUMR-M2 stages', () => {
  it('the 5 real-route stages, in order, pass the validator', () => {
    expect(tracks.map((t) => t.id)).toEqual(['anjou', 'metropolitaine', 'sherbrooke', 'plateau', 'centre-ville']);
    expect(tracks.map((t) => t.backdrop)).toEqual(kit.backdrops);
    expect(tracks.map((t) => t.palette)).toEqual(['coucher-de-soleil', 'crepuscule', 'soir', 'nuit-tombante', 'nuit']);
    for (const d of readTrackFiles(RACER)) expect(checkTrack(d).issues).toEqual([]);
    const kinds = new Set(tracks.flatMap((t) => t.segments.flatMap((s) => (s.objects ?? []).map((o) => o.kind))));
    expect([...kinds].sort()).toEqual(['bus', 'car', 'cone', 'plow', 'pothole']);
  });

  it('whole run: about 9 minutes at full speed (10-12 for a person), every stage 85-115 s', () => {
    const fullSpeed = tracks.map((t) => trackLength(t) / UNITS_PER_S_MAX);
    for (const s of fullSpeed) expect(s).toBeGreaterThanOrEqual(85), expect(s).toBeLessThanOrEqual(115);
    const total = fullSpeed.reduce((a, b) => a + b, 0);
    expect(total / 60).toBeGreaterThanOrEqual(7.5);
    expect(total / 60).toBeLessThanOrEqual(9.5);
  });

  it('friendly clock: every checkpoint and the finish reachable at 64 % of full speed with 3 s to spare', () => {
    const v = UNITS_PER_S_MAX * 0.64;
    for (const t of tracks) {
      // the clock left on arrival at each checkpoint (the engine caps the clock at 99)
      let clock = t.timeStart;
      let pos = 0;
      for (const cp of checkpoints(t)) {
        clock -= (cp.pos - pos) / v;
        pos = cp.pos;
        expect(clock, `${t.id} at ${cp.pos}`).toBeGreaterThanOrEqual(3);
        clock = Math.min(99, clock + cp.addTime);
      }
    }
  });
});

describe('BLUMR-M2 « Jeu d’exemple SEBRING » in the app', () => {
  const plain = {
    isEncryptionAvailable: () => true,
    encryptString: (x: string) => Buffer.from(x),
    decryptString: (b: Buffer) => b.toString(),
  };
  function session(samplesDir: string) {
    const home = tempDir();
    const userData = path.join(home, 'userdata');
    return new Session({
      userData,
      bundledPrices: path.join(ROOT, 'config', 'prices.json'),
      settings: new SettingsStore(path.join(userData, 'settings.json'), defaultSettings(path.join(home, 'projects'))),
      vault: new KeyVault(path.join(userData, 'key.bin'), plain),
      version: '0.1.0',
      electron: 'test',
      smoke: true,
      forceOffline: true,
      samplesDir,
      emit: () => {},
      log: () => {},
      chooseSavePath: async () => path.join(home, 'x.zip'),
      chooseOpenPath: async () => path.join(home, 'x.zip'),
    });
  }

  it('the shipped tracks file = racer/tracks bundled; it reads back with the 5 stages', () => {
    const shipped = JSON.parse(readFileSync(path.join(ROOT, 'resources', 'samples', 'SEBRING', 'SEBRING-pistes.json'), 'utf8')) as unknown;
    expect(shipped).toEqual(JSON.parse(JSON.stringify(sebringSample(readTrackFiles(RACER)))));
    const r = readSebringSample(shipped);
    expect(r.issues).toEqual([]);
    expect(r.stages.map((s) => s.id)).toEqual(['anjou', 'metropolitaine', 'sherbrooke', 'plateau', 'centre-ville']);
    expect(readSebringSample({ format: 'autre' }).issues[0]!.code).toBe('format');
    const broken = structuredClone(shipped) as { stages: { timeStart: number }[] };
    broken.stages[0]!.timeStart = 5;
    expect(readSebringSample(broken).issues.length).toBeGreaterThan(0);
  });

  it('rom:build "sebring" checks the tracks then hands the prebuilt ROM to the player; errors in FR + EN', () => {
    const s = session(path.join(ROOT, 'resources', 'samples'));
    const r = s.buildRom('sebring');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('SEBRING');
    expect(r.value.rom.length).toBe(393232);
    expect(Array.from(r.value.rom.subarray(0, 4))).toEqual([0x4e, 0x45, 0x53, 0x1a]);
    expect(r.value.route!.map((n) => n.fr)).toEqual(tracks.map((t) => t.name.fr));
    const missing = session(tempDir()).buildRom('sebring');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.en).toMatch(/SEBRING/);
  });
});
