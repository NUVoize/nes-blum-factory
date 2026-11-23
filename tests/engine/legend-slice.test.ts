// BLUMZ-M1: THE LEGEND OF BLUM vertical slice in jsnes (the app's emulator). The ROM builds from
// rpg/legend/*.json + the BLUMZ-A1 kit; the bot (src/core/rpg/legend/run.ts) plays the whole slice with each of
// the 5 classes: title, CH00 (class, menu, clochette at the window, Magdi, Nivoix, Mouton battle), CH01
// maternelle (Maxi, Paul, Terreur des Crayons) and 1re (Boulette, billet, door, Marie-Claude), the « À SUIVRE »
// card, with 0 lag frames. Also: battery save + Continuer round trip, dirty boot, the stun and heal enemy
// mechanics on a fixture battle, ROM battle outcomes = simulator. Mesen twin: scripts/legend-mesen.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { RomHarness } from '../../src/core/emu/harness';
import { parseHeader } from '../../src/core/nes/header';
import { buildLegend, legendDocs, type LegendBuild } from '../../src/core/rpg/legend/build';
import { LegendBot, LS, hasFlag, hasItem, loadRoute, playSlice, readLegendProbe, type SliceRun } from '../../src/core/rpg/legend/run';
import { TITLE_COL } from '../../src/core/rpg/legend/compile';
import { simulateBattle } from '../../src/core/rpg/legend/sim';
import { encodeTile } from '../../src/core/nes/chr';
import { fontPixels } from '../../src/core/rpg/spike-art';
import { JSNES, ROOT } from './rom';

const RPG = path.join(ROOT, 'rpg');
const route = loadRoute(RPG);
let b: LegendBuild;
const runs: SliceRun[] = [];
let wramAfterSave: Uint8Array | null = null;
let endHarness: RomHarness | null = null;

const bot = (build: LegendBuild, cls: number) => new LegendBot(build.compiled!.meta, build.data!, route, { cls });
const flag = (n: string) => b.compiled!.meta.flags.get(n)!;

beforeAll(() => {
  b = buildLegend(RPG, path.join(ROOT, 'engine'), defaultToolchain(ROOT), path.join(ROOT, '.tmp', 'engine', 'legend-slice'));
  if (!b.ok) throw new Error(b.log);
  for (let cls = 0; cls < 5; cls++) {
    const h = new RomHarness(JSNES, b.rom!);
    if (cls === 0) endHarness = h;
    let lastSaves = 0;
    runs.push(
      playSlice(h, bot(b, cls), {
        maxFrames: 20000,
        onFrame: (p) => {
          // keep the battery RAM right after the 1re-année autosave (Guerrier run)
          if (cls === 0 && p.saves !== lastSaves) {
            lastSaves = p.saves;
            if (hasFlag(p, flag('F_MAT_FINIE')) && !wramAfterSave) wramAfterSave = Uint8Array.from(h.s.mem.slice(0x6000, 0x6200));
          }
        },
      }),
    );
  }
}, 600_000);

describe('BLUMZ-M1 LEGEND OF BLUM slice ROM (jsnes)', () => {
  it('builds: MMC3, 256 KiB PRG, 128 KiB CHR, battery-backed 8 KiB PRG-RAM, banks within budget', () => {
    const h = parseHeader(b.rom!);
    expect(h.mapper).toBe(4);
    expect(h.prgRomBytes).toBe(256 * 1024);
    expect(h.chrRomBytes).toBe(128 * 1024);
    expect(h.battery).toBe(true);
    expect(h.prgNvramBytes).toBe(8 * 1024);
    expect(b.rom!.length).toBe(16 + 256 * 1024 + 128 * 1024);
    expect(b.issues.filter((i) => i.level === 'error')).toEqual([]);
    for (const seg of ['TEXT', 'WORLD', 'CODE', 'CODE2']) expect(b.map).toMatch(new RegExp(`^${seg}\\s`, 'm'));
  });

  it.each([0, 1, 2, 3, 4])('class %i: the bot plays the whole slice to « À SUIVRE », 0 lag, every screen, every battle won', (cls) => {
    const r = runs[cls]!;
    const p = r.end;
    expect(r.finished, `stopped at frame ${r.frames}, state ${p.state} screen ${p.screen}`).toBe(true);
    expect(p.state).toBe(LS.end);
    expect(p.cls).toBe(cls);
    expect(p.lag).toBe(0);
    expect(r.vpeak).toBeLessThanOrEqual(80);
    expect(r.freeMin).toBeGreaterThan(9000); // busiest frame: a screen's working copy (about 60 % of the frame)
    expect(r.screens.size).toBe(10);
    expect(hasFlag(p, flag('F_SLICE_FINI'))).toBe(true);
    expect(hasItem(p, b.compiled!.meta.items.get('ITEM_CLOCHE')!)).toBe(true); // never lost
    expect(hasItem(p, b.compiled!.meta.items.get('ITEM_BILLET')!)).toBe(true);
    expect(p.level).toBe(4);
    expect(r.battles.map((x) => x.won)).toEqual([true, true, true, true]);
    expect(p.xp).toBe(30);
    expect(r.frames).toBeLessThan(12000);
  });

  it('ROM battles agree with the simulator: every class wins, never slower than the worst-roll simulation', () => {
    const data = b.data!;
    const order = ['BAT_MOUTON', 'BAT_CRAYONS', 'BAT_BOULETTE', 'BAT_MARIE_CLAUDE'];
    const levels = [1, 2, 3, 3];
    runs.forEach((r, cls) => {
      r.battles.forEach((x, i) => {
        const bd = data.battles.battles.find((q) => q.id === order[i])!;
        expect(b.compiled!.meta.battles.get(bd.id)).toBe(x.battle);
        const sim = simulateBattle(data.game, data.classes.classes[cls]!, data.classes.helper, bd, { level: levels[i]!, collations: 0 }, 'worst');
        expect(sim.win).toBe(true);
        expect(x.won).toBe(true);
        expect(x.turns, `${bd.id} class ${cls}`).toBeLessThanOrEqual(sim.turns);
      });
    });
  });

  it('battery save: Continuer restores the 1re-année autosave (screen, flags, items, level) and the slice can be finished from it', () => {
    expect(wramAfterSave).not.toBeNull();
    const h = new RomHarness(JSNES, b.rom!);
    h.s.mem.set(wramAfterSave!, 0x6000);
    // title: DOWN to CONTINUER, then A
    h.step(70, []);
    h.step(2, ['DOWN']);
    h.step(4, []);
    h.step(2, ['A']);
    h.step(60, []);
    const p = readLegendProbe(h.s.mem);
    expect(p.loadOk).toBe(1);
    expect(p.state).toBe(LS.map);
    expect(b.compiled!.meta.screens[p.screen]!.id).toBe('maison');
    expect(hasFlag(p, flag('F_MAT_FINIE'))).toBe(true);
    expect(hasFlag(p, flag('F_MC'))).toBe(false);
    expect(p.level).toBe(3);
    const resumed = bot(b, 0);
    resumed.menuDone = true; // CH00 bot steps that cannot be replayed from a CH01 save
    resumed.talked.add('OBJ_ETOILE_SALON');
    const r = playSlice(h, resumed, { maxFrames: 12000 });
    expect(r.finished).toBe(true);
    expect(r.end.lag).toBe(0);
  });

  it('BLUMZ-F2 title: one arrow only, on the chosen line, after Down and after Up (BLUMZ-W P2-1)', () => {
    const h = new RomHarness(JSNES, b.rom!);
    const row = (JSON.parse(readFileSync(path.join(RPG, 'kit', 'gfx', 'screens', 'title.json'), 'utf8')) as { cursorRow: number }).cursorRow;
    const tile = (col: number, r: number) => {
      const px = h.rgba();
      const out: number[] = [];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const i = ((r * 8 + y) * 256 + col * 8 + x) * 4;
          out.push(px[i]!, px[i + 1]!, px[i + 2]!);
        }
      }
      return out.join(',');
    };
    // an arrow differs from the sky tile left of it; a blank cursor cell is the same sky
    const arrows = () => [row, row + 2].map((r) => tile(TITLE_COL, r) !== tile(TITLE_COL - 1, r));
    h.step(90, []);
    expect(readLegendProbe(h.s.mem).state).toBe(LS.title);
    expect(arrows()).toEqual([true, false]);
    h.step(2, ['DOWN']);
    h.step(8, []);
    expect(readLegendProbe(h.s.mem).selCur).toBe(1);
    expect(arrows()).toEqual([false, true]);
    h.step(2, ['UP']);
    h.step(8, []);
    expect(arrows()).toEqual([true, false]);
  });

  it('BLUMZ-F2 « À SUIVRE »: START goes back to the title (BLUMZ-W P3-2), then COMMENCER starts a new game', () => {
    const h = endHarness!;
    expect(readLegendProbe(h.s.mem).state).toBe(LS.end);
    h.step(60, ['A']);
    expect(readLegendProbe(h.s.mem).state).toBe(LS.end);
    h.step(2, ['START']);
    h.step(90, []);
    const p = readLegendProbe(h.s.mem);
    expect(p.state).toBe(LS.title);
    expect(p.lag).toBe(0);
    h.step(2, ['A']);
    h.step(90, []);
    expect([LS.card, LS.load, LS.dialog, LS.map]).toContain(readLegendProbe(h.s.mem).state);
  });

  it('BLUMZ-F2 font: the redrawn accented capitals are in the ROM UI bank', () => {
    const chr = Buffer.from(b.rom!.subarray(16 + 256 * 1024));
    for (const ch of 'ÉÈÀÇÔ') expect(chr.indexOf(Buffer.from(encodeTile(fontPixels(ch)))), ch).toBeGreaterThanOrEqual(0);
  });

  it('dirty boot (RAM and WRAM full of $FF or noise): title, no false save, the slice still finishes', () => {
    for (const prefill of [0xff, { seed: 7 }] as const) {
      const h = new RomHarness(JSNES, b.rom!, { prefill });
      h.step(70, []);
      h.step(2, ['DOWN']);
      h.step(4, []);
      h.step(2, ['A']);
      h.step(10, []);
      const p = readLegendProbe(h.s.mem);
      expect(p.state).toBe(LS.title);
      expect(p.loadOk).toBe(2);
    }
    const h = new RomHarness(JSNES, b.rom!, { prefill: { seed: 3 } });
    const r = playSlice(h, bot(b, 2), { maxFrames: 20000 });
    expect(r.finished).toBe(true);
    expect(r.end.lag).toBe(0);
  });

  it('enemy mechanics fixture: a stun and a heal on the Mouton (Défense blocks the stun), the battle is still won', () => {
    const docs = structuredClone(legendDocs(RPG)) as Record<string, any>;
    const m = docs.battles.battles.find((x: any) => x.id === 'BAT_MOUTON');
    m.stats.hp = 20;
    m.boss = true; // a longer fight than a normal enemy's 6 turns
    m.flee = false;
    m.moves.push({ id: 'regard', kind: 'stun', text: 'Le mouton te fixe : Blum est figé !' }, { id: 'reprise', kind: 'heal', amount: 4, text: 'Le mouton ramasse sa poussière. +[n] PV.' });
    m.pattern = ['regard', 'reprise', 'souffle'];
    const fb = buildLegend(RPG, path.join(ROOT, 'engine'), defaultToolchain(ROOT), path.join(ROOT, '.tmp', 'engine', 'legend-fixture'), { docs });
    expect(fb.ok, fb.log).toBe(true);
    const h = new RomHarness(JSNES, fb.rom!);
    const mouton = fb.compiled!.meta.flags.get('F_MOUTON')!;
    const r = playSlice(h, bot(fb, 0), { maxFrames: 8000, until: (p) => hasFlag(p, mouton) });
    expect(hasFlag(r.end, mouton)).toBe(true);
    expect(r.stunnedSeen).toBe(true);
    expect(r.enemyHealSeen).toBe(true);
    expect(r.battles[0]!.won).toBe(true);
    expect(r.end.lag).toBe(0);
  });
});
