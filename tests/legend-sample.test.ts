// BLUMZ-F2: « Jeu d'exemple THE LEGEND OF BLUM (début) » in the app: rom:build "legend" checks and hands the
// prebuilt slice ROM (resources/samples/LEGEND, written by npm run legend:handover) to the player, with its
// chapters; the battery RAM round-trips through the user data (rom:batteryLoad / rom:batterySave).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGEND_BATTERY_BYTES, LEGEND_CHAPTERS, LEGEND_FOLDER, LEGEND_ROM, checkLegendRom } from '../src/core/rpg/legend/legend-sample';
import { KeyVault } from '../src/main/key-vault';
import { Session } from '../src/main/session';
import { SettingsStore, defaultSettings } from '../src/main/settings';
import { tempDir } from './helpers';

const ROOT = path.resolve(import.meta.dirname, '..');
const SAMPLES = path.join(ROOT, 'resources', 'samples');

const plain = {
  isEncryptionAvailable: () => true,
  encryptString: (x: string) => Buffer.from(x),
  decryptString: (b: Buffer) => b.toString(),
};
function session(samplesDir: string, home = tempDir()) {
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

describe('BLUMZ-F2 « Jeu d’exemple THE LEGEND OF BLUM (début) » in the app', () => {
  it('rom:build "legend" hands the shipped slice ROM (MMC3, battery) to the player with its chapters; errors in FR + EN', () => {
    const r = session(SAMPLES).buildRom('legend');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('THE LEGEND OF BLUM');
    expect(r.value.rom.length).toBe(393232);
    expect(r.value.battery).toBe(true);
    expect(checkLegendRom(r.value.rom)).toBeNull();
    expect(r.value.route).toEqual(LEGEND_CHAPTERS);
    expect(r.value.route!.map((c) => c.fr).join(' / ')).toMatch(/Prologue.*maternelle.*1re année.*À SUIVRE/);
    const missing = session(tempDir()).buildRom('legend');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.en).toMatch(/LEGEND OF BLUM/);
  });

  it('the shipped ROM is the handover ROM (same bytes)', () => {
    const hand = path.join(ROOT, 'release', 'handover', LEGEND_ROM);
    if (!existsSync(hand)) return; // release/ is not in git: checked where the handover exists (box-01)
    expect(Buffer.from(readFileSync(path.join(SAMPLES, LEGEND_FOLDER, LEGEND_ROM))).equals(readFileSync(hand))).toBe(true);
  });

  it('refuses a damaged ROM: not iNES, wrong size, no battery', () => {
    const rom = new Uint8Array(readFileSync(path.join(SAMPLES, LEGEND_FOLDER, LEGEND_ROM)));
    expect(checkLegendRom(rom.subarray(0, 1000))).not.toBeNull();
    const noBattery = Uint8Array.from(rom);
    noBattery[6] = noBattery[6]! & ~2;
    expect(checkLegendRom(noBattery)?.fr).toMatch(/abîmée/);
    const notInes = Uint8Array.from(rom);
    notInes[0] = 0;
    expect(checkLegendRom(notInes)).not.toBeNull();
  });

  it('battery RAM: null before the first save, then the same 8 KiB back in a new session; other sizes and sources refused', () => {
    const home = tempDir();
    const s = session(SAMPLES, home);
    expect(s.batteryLoad('legend')).toBeNull();
    const bytes = new Uint8Array(LEGEND_BATTERY_BYTES).map((_, i) => (i * 7) & 0xff);
    const w = s.batterySave('legend', bytes);
    expect(w.ok).toBe(true);
    expect(Array.from(session(SAMPLES, home).batteryLoad('legend')!)).toEqual(Array.from(bytes));
    expect(s.batterySave('legend', new Uint8Array(10)).ok).toBe(false);
    expect(s.batterySave('blum', bytes).ok).toBe(false);
    expect(() => s.batteryLoad('../x')).toThrow();
  });
});
