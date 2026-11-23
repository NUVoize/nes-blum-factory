// BLUMZ-PLAN engine spike (docs/RPG-PLAN.md section 2): the RPG ROM builds with the factory toolchain and,
// driven by the bot in jsnes, walks with collision, talks to Madame Bélanger (French accents on screen),
// scrolls to the next room, starts a battle and wins it, with 0 lag frames. The accurate-tier twin is
// scripts/rpg-mesen.mjs (npm run test:rpg-mesen): same bot in Mesen, same outcome.
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { RomHarness } from '../../src/core/emu/harness';
import type { ButtonName } from '../../src/core/emu/nes-session';
import { NES_RGB } from '../../src/core/nes/palette';
import { buildRpgSpike, type RpgSpikeBuild } from '../../src/core/rpg/build-spike';
import { fontPixels } from '../../src/core/rpg/spike-art';
import { BOT_END_X, FLAG_CLOCHE, FLAG_CRAYONS, RPG_SHOTS, SHOT_DELAY, readRpgProbe, rpgBot, rpgFreeCycles, type RpgProbe } from '../../src/core/rpg/spike-run';
import { BOX_BOTTOM, TEXT_COL, TEXT_W, parseWorld } from '../../src/core/rpg/spike-world';
import { JSNES, ROOT, writeShot } from './rom';
import { readFileSync } from 'node:fs';

const FRAMES = 1500;
const world = parseWorld(JSON.parse(readFileSync(path.join(ROOT, 'rpg', 'spike', 'data', 'world.json'), 'utf8')));

interface Seen {
  frame: number;
  probe: RpgProbe;
  rgba: Uint8Array;
}

const px = (rgba: Uint8Array, x: number, y: number) => {
  const i = (y * 256 + x) * 4;
  return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
};
const isColour = (rgba: Uint8Array, x: number, y: number, nes: number) => px(rgba, x, y).join() === NES_RGB[nes]!.join();

/** The 8×8 cell at (col, row) shows glyph ch in window colours (1 = window blue, 2 = white). */
function glyphOnScreen(rgba: Uint8Array, col: number, row: number, ch: string): boolean {
  const g = fontPixels(ch);
  const pal = world.palettes.world[0]!;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (!isColour(rgba, col * 8 + x, row * 8 + y, pal[g[y * 8 + x]!]!)) return false;
  return true;
}
function lineOnScreen(rgba: Uint8Array, row: number, text: string): string[] {
  const bad: string[] = [];
  [...text].forEach((ch, i) => {
    if (!glyphOnScreen(rgba, TEXT_COL + i, row, ch)) bad.push(`${i}:${ch}`);
  });
  return bad;
}

function run(b: RpgSpikeBuild, prefill?: 0xff) {
  const h = new RomHarness(JSNES, b.rom!, prefill ? { prefill } : {});
  const shots = new Map<string, Seen>();
  const first = new Map<string, number>();
  let p = readRpgProbe(h.s.mem);
  let minFree = Infinity;
  let blockedY = 255;
  for (let f = 1; f <= FRAMES; f++) {
    h.step(1, rpgBot(p));
    p = readRpgProbe(h.s.mem);
    if (f > 10) minFree = Math.min(minFree, rpgFreeCycles(p.idle));
    if (p.state === 1 && p.room === 0 && !(p.flags & FLAG_CLOCHE)) blockedY = Math.min(blockedY, p.py);
    for (const s of RPG_SHOTS) if (!first.has(s.name) && s.when(p)) first.set(s.name, f);
    for (const [n, f0] of first) {
      if (!shots.has(n) && f === f0 + SHOT_DELAY) {
        shots.set(n, { frame: f, probe: p, rgba: h.rgba() });
        if (!prefill) writeShot(h, `rpg-spike-${n}`);
      }
    }
  }
  return { last: p, shots, minFree, blockedY, h };
}

/** Holds one direction from boot (no bot): where does the wall stop Blum? */
function hold(b: RpgSpikeBuild, dir: ButtonName, frames: number): RpgProbe {
  const h = new RomHarness(JSNES, b.rom!);
  h.step(frames, [dir]);
  return readRpgProbe(h.s.mem);
}

describe('BLUMZ-PLAN RPG engine spike (jsnes)', () => {
  let b: RpgSpikeBuild;
  let r: ReturnType<typeof run>;

  beforeAll(() => {
    b = buildRpgSpike(path.join(ROOT, 'rpg', 'spike'), defaultToolchain(ROOT), path.join(ROOT, '.tmp', 'engine-builds', 'rpg-spike'));
    if (!b.ok || !b.rom) throw new Error(b.log);
    r = run(b);
  });

  it('boots on the BLUM cartridge (MMC3, 256 KiB PRG, 128 KiB CHR, 8 KiB PRG-RAM)', () => {
    expect(Array.from(b.rom!.subarray(0, 11))).toEqual([0x4e, 0x45, 0x53, 0x1a, 0x10, 0x10, 0x40, 0x08, 0x00, 0x00, 0x07]);
    expect(b.rom!.length).toBe(16 + 256 * 1024 + 128 * 1024);
    expect(r.last.magic).toBe('BLMZ');
  });

  it('plays the whole spike route with 0 lag frames and a small VRAM budget', () => {
    expect(r.last.state).toBe(1);
    expect(r.last.room).toBe(1);
    expect(r.last.px).toBe(BOT_END_X);
    expect(r.last.flags).toBe(FLAG_CLOCHE | FLAG_CRAYONS);
    expect(r.last.items).toBe(1);
    expect(r.last.lag).toBe(0);
    expect(r.last.vpeak).toBeLessThanOrEqual(80); // NMI copies at most 80 bytes per frame (section 2.3)
    expect(r.minFree).toBeGreaterThanOrEqual(15000);
    expect(rpgFreeCycles(r.last.idleMin)).toBeGreaterThanOrEqual(15000);
    expect([...r.shots.keys()].sort()).toEqual(RPG_SHOTS.map((s) => s.name).sort());
  });

  it('collides: walls stop Blum on the left and at the bottom, Madame Bélanger stops him going up', () => {
    expect(hold(b, 'LEFT', 200)).toMatchObject({ px: 13, py: 144, room: 0 });
    expect(hold(b, 'DOWN', 200)).toMatchObject({ px: 112, py: 208, room: 0 });
    expect(r.blockedY).toBe(88); // her 16×16 box, feet hitbox y+8
  });

  it('shows the dialogue with é è à ç ô in the window, page by page', () => {
    const pages = world.dialogue.DLG_BELANGER!;
    pages.forEach((page, i) => {
      const s = r.shots.get(`dialog-${i + 1}`)!;
      expect(s.probe.dRow).toBe(BOX_BOTTOM);
      expect(lineOnScreen(s.rgba, BOX_BOTTOM + 1, page[0])).toEqual([]);
      expect(lineOnScreen(s.rgba, BOX_BOTTOM + 3, page[1])).toEqual([]);
    });
    const all = pages.flat().join('');
    for (const ch of ['é', 'è', 'à', 'ç', 'ô', 'Ç', 'Ô']) expect(all).toContain(ch);
    // the window is gone after the last page: the room floor is back under it
    const after = r.shots.get('after-dialog')!.rgba;
    expect(isColour(after, 8 * (TEXT_COL + 4), 8 * (BOX_BOTTOM + 1) + 3, world.palettes.world[0]![1]!)).toBe(false);
    expect(lineOnScreen(after, BOX_BOTTOM + 1, pages[0]![0]!).length).toBeGreaterThan(TEXT_W / 2);
  });

  it('scrolls to the next room: half indoor, half outdoor mid-way, Blum carried across', () => {
    const mid = r.shots.get('scroll-mid')!;
    expect(mid.probe.state).toBe(2);
    const indoor = world.palettes.world[1]!;
    const outdoor = world.palettes.world[3]!;
    let left = 0;
    let right = 0;
    for (let y = 40; y < 200; y += 4) {
      for (let x = 8; x < 120; x += 4) if (indoor.slice(1).some((c) => isColour(mid.rgba, x, y, c))) left++;
      for (let x = 136; x < 248; x += 4) if (outdoor.slice(1, 3).some((c) => isColour(mid.rgba, x, y, c))) right++;
    }
    expect(left).toBeGreaterThan(800);
    expect(right).toBeGreaterThan(800);
    const room2 = r.shots.get('room-2')!;
    expect(room2.probe.curNt).toBe(1);
    expect(room2.probe.py).toBe(112);
  });

  it('starts the battle on contact and wins it: Pouvoir de classe, then Attaque', () => {
    const intro = r.shots.get('battle-intro')!;
    expect(intro.probe.ehp).toBe(world.battles[0]!.enemy.hp);
    expect(lineOnScreen(intro.rgba, 3, world.battles[0]!.text.intro[0])).toEqual([]);
    const power = r.shots.get('battle-power')!;
    expect(lineOnScreen(power.rgba, 3, 'Coup de cartable !')).toEqual([]);
    const win = r.shots.get('battle-win')!;
    expect(lineOnScreen(win.rgba, 3, world.battles[0]!.text.win[0])).toEqual([]);
    expect(r.last.xp).toBe(world.battles[0]!.xp);
    expect(r.last.turn).toBe(4); // 9 + 5 + 5 + 5 >= 20
    expect(r.last.php).toBe(world.player.hp - 3 * world.battles[0]!.enemy.attack);
    // back on the map, the enemy is gone and Blum walks on
    expect(r.shots.get('after-battle')!.probe.state).toBe(1);
  });

  it('same outcome from a dirty boot (RAM and WRAM full of $FF)', () => {
    const d = run(b, 0xff);
    for (const k of ['state', 'room', 'px', 'py', 'flags', 'xp', 'turn', 'php', 'ehp', 'lag'] as const) expect(d.last[k]).toBe(r.last[k]);
  });
});
