// M2 engine tier: real cc65 builds of the demo project and fixtures, run headless in jsnes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultToolchain } from '../../src/core/build/engine-build';
import { CHR_BANK, EVENT, GAME_STATE, PROBE_FLAG, TUNING } from '../../src/core/engine-data/contract';
import { makeGrid, MT } from '../../src/core/engine-data/demo';
import { tuningBlock } from '../../src/core/engine-data/emit';
import type { Probe } from '../../src/core/emu/harness';
import { parseHeader } from '../../src/core/nes/header';
import { DEFAULT_PHYSICS } from '../../src/core/schema/physics';
import type { Json } from '../../src/core/util/json-pointer';
import { buildFixture, demoProjectDocs, harness, ROOT, runRight, startPlay, writeShot } from './rom';

const demo = () => buildFixture(demoProjectDocs());
const demoRom = () => demo().rom!;

/** Jump points (player x) that clear the demo stage: spikes, pit, wall, pit, block. */
const DEMO_JUMPS = [230, 300, 360, 490, 640];
const CHECKPOINT_X = 30 * 16 + 2;

describe('M2a toolchain, header, boot', () => {
  it('M2-T1 toolchain: pinned SHA-256 and the three binaries answer --version', () => {
    const fetchScript = readFileSync(path.join(ROOT, 'scripts', 'fetch-toolchain.mjs'), 'utf8');
    const pinned = /sha256: '([0-9a-f]{64})'/.exec(fetchScript)![1]!;
    const tc = defaultToolchain(ROOT);
    const version = JSON.parse(readFileSync(path.join(tc.dir, 'VERSION.json'), 'utf8')) as { sha256: string; version: string };
    expect(version.sha256).toBe(pinned);
    const cached = readdirSync(path.join(ROOT, 'resources', 'cache')).filter((f) => f.startsWith('cc65-snapshot-win64-'));
    expect(cached.length).toBeGreaterThan(0);
    const zip = readFileSync(path.join(ROOT, 'resources', 'cache', cached[0]!));
    expect(createHash('sha256').update(zip).digest('hex')).toBe(pinned);
    for (const exe of ['cc65', 'ca65', 'ld65']) {
      const r = spawnSync(path.join(tc.dir, 'bin', `${exe}.exe`), ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      expect(r.status).toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain(`${exe} V2.19 - Git 8d86ca7`);
    }
  });

  it('M2-T2 built ROM: header bytes, size 393232, parsed as MMC3 + 8 KiB PRG-RAM', () => {
    const rom = demoRom();
    expect(Array.from(rom.slice(0, 16))).toEqual([0x4e, 0x45, 0x53, 0x1a, 0x10, 0x10, 0x40, 0x08, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(rom.length).toBe(393232);
    const h = parseHeader(rom);
    expect(h).toMatchObject({ format: 'nes2', mapper: 4, submapper: 0, prgRomBytes: 262144, chrRomBytes: 131072, prgRamBytes: 8192, battery: false, region: 'ntsc' });
  });

  it('M2-T3 boot: 300 frames -> probe BLUM, title, frame counter advancing, picture; Start -> play', () => {
    const h = harness(demoRom());
    h.step(200);
    const at200 = h.probe();
    h.step(100);
    const p = h.probe();
    expect(p.magic).toBe('BLUM');
    expect(p.version).toBe(1);
    expect(p.state).toBe(GAME_STATE.title);
    expect(p.frame).toBeGreaterThan(at200.frame);
    expect(h.frameUniform()).toBe(false);
    writeShot(h, 'M2-T3-title');
    h.step(2, ['START']);
    expect(h.runUntil((q) => q.state === GAME_STATE.play, 60)).toBeGreaterThan(0);
    h.step(30);
    expect(h.frameUniform()).toBe(false);
    writeShot(h, 'M2-T3-play');
  });

  it('M2-T7 determinism: same ROM + same inputs = same framebuffer hash at frame 600', () => {
    const run = () => {
      const h = harness(demoRom());
      h.run([
        { frames: 60 },
        { frames: 2, hold: ['START'] },
        { frames: 100 },
        { frames: 200, hold: ['RIGHT'] },
        { frames: 20, hold: ['RIGHT', 'A'] },
        { frames: 218, hold: ['LEFT'] },
      ]);
      expect(h.frames).toBe(600);
      return h.frameHash();
    };
    expect(run()).toBe(run());
  });

  it('M2-T11 dirty boot: RAM + WRAM pre-filled with $FF or a seeded pattern -> same probe trace as a clean boot', () => {
    const script = [
      { frames: 60 },
      { frames: 2, hold: ['START' as const] },
      { frames: 60 },
      { frames: 130, hold: ['RIGHT' as const] },
      { frames: 25, hold: ['RIGHT' as const, 'A' as const] },
      { frames: 100 },
    ];
    const trace = (prefill?: 0xff | { seed: number }) => {
      const h = harness(demoRom(), prefill);
      const out: string[] = [];
      h.run(script, (p, hh) => {
        if (hh.frames >= 10) out.push(JSON.stringify(p));
      });
      expect(h.probe().state).toBe(GAME_STATE.play);
      return out;
    };
    const clean = trace();
    expect(clean.some((p) => (JSON.parse(p) as Probe).state === GAME_STATE.title)).toBe(true);
    expect(trace(0xff)).toEqual(clean);
    expect(trace({ seed: 20261023 })).toEqual(clean);
  });

  it('M2-T12 hardware-boot layout: STARTUP, VECTORS, NMI/IRQ and bank switching in $E000-$FFFF', () => {
    const b = demo();
    const seg = (n: string) => b.map!.segments.find((s) => s.name === n)!;
    expect(seg('STARTUP').start).toBeGreaterThanOrEqual(0xe000);
    expect(seg('STARTUP').end).toBeLessThanOrEqual(0xffff);
    expect(seg('VECTORS').start).toBe(0xfffa);
    for (const label of ['start', 'nmi', 'irq', 'nmi_sound', 'irq_parser', '_set_prg_8000', 'bank_swap_common', '_set_chr_mode_0', '_set_wram_mode']) {
      expect(b.labels.get(label), label).toBeGreaterThanOrEqual(0xe000);
    }
    // the vectors point into the last bank
    const rom = b.rom!;
    const lastBank = 16 + 31 * 0x2000;
    const word = (addr: number) => rom[lastBank + (addr - 0xe000)]! | (rom[lastBank + (addr - 0xe000) + 1]! << 8);
    expect(word(0xfffa)).toBe(b.labels.get('nmi'));
    expect(word(0xfffc)).toBe(b.labels.get('start'));
    expect(word(0xfffe)).toBe(b.labels.get('irq'));
  });

  it('M2-T13 tuning guard: garbage in $7E00-$7EFF at power-on is replaced by the ROM defaults', () => {
    const expected = Array.from(tuningBlock(DEFAULT_PHYSICS));
    for (const prefill of [0xff as const, { seed: 7 }, { seed: 99 }]) {
      const h = harness(demoRom(), prefill);
      h.step(10);
      expect(Array.from(h.s.mem.slice(TUNING.base, TUNING.base + 256))).toEqual(expected);
    }
  });
});

describe('M2b demo stage, physics, HUD', () => {
  it('M2-T4 movement: run right, tap jump, variable jump height', () => {
    const h = harness(demoRom());
    startPlay(h);

    const jump = (holdFrames: number) => {
      const y0 = h.probe().py;
      let minY = y0;
      h.run([{ frames: holdFrames, hold: ['A'] }, { frames: 90 }], (p) => {
        minY = Math.min(minY, p.py);
      });
      const end = h.probe();
      return { y0, apex: y0 - minY, back: end.py === y0 && (end.flags & PROBE_FLAG.grounded) !== 0 };
    };
    const tap = jump(2);
    expect(tap.apex).toBeGreaterThan(0);
    expect(tap.back).toBe(true);
    const held = jump(40);
    expect(held.back).toBe(true);
    expect(held.apex).toBeGreaterThan(tap.apex + 16);

    const x0 = h.probe().px;
    h.step(120, ['RIGHT']);
    expect(h.probe().px - x0).toBeGreaterThanOrEqual(100);
  });

  it('M2-T5 behaviours: spikes kill (hazard), checkpoint then death respawns there, exit clears the stage', () => {
    // spikes: just hold right
    const a = harness(demoRom());
    startPlay(a);
    const t = runRight(a, [], (p) => p.state === GAME_STATE.dying, 600);
    const dead = t[t.length - 1]!;
    expect(dead.state).toBe(GAME_STATE.dying);
    expect(dead.event).toBe(EVENT.deathHazard);
    expect(dead.flags & PROBE_FLAG.dead).toBeTruthy();

    // checkpoint, then fall in the next pit, respawn at the checkpoint
    const b = harness(demoRom());
    startPlay(b);
    const t2 = runRight(b, DEMO_JUMPS.slice(0, 3), (p) => p.event === EVENT.checkpoint, 1200);
    expect(t2[t2.length - 1]!.checkpoint).toBe(1);
    const t3 = runRight(b, [], (p) => p.state === GAME_STATE.dying, 600);
    expect(t3[t3.length - 1]!.event).toBe(EVENT.deathPit);
    expect(b.runUntil((p) => p.state === GAME_STATE.play, 200)).toBeGreaterThan(0);
    b.step(2);
    const back = b.probe();
    expect(back.event).toBe(EVENT.respawn);
    expect(back.lives).toBe(2);
    expect(Math.abs(back.px - CHECKPOINT_X)).toBeLessThanOrEqual(2);

    // exit
    const c = harness(demoRom());
    startPlay(c);
    const t4 = runRight(c, DEMO_JUMPS, (p) => p.state === GAME_STATE.clear, 3000);
    const end = t4[t4.length - 1]!;
    expect(end.state).toBe(GAME_STATE.clear);
    expect(end.event).toBe(EVENT.exit);
    c.step(4);
    writeShot(c, 'M2-T5-clear');
  });

  it('M2-T6 data drives physics: jumpVelocity +25 % gives a higher apex', () => {
    const apex = (docs: Record<string, Json>) => {
      const h = harness(buildFixture(docs).rom!);
      startPlay(h);
      const y0 = h.probe().py;
      let minY = y0;
      h.run([{ frames: 50, hold: ['A'] }, { frames: 60 }], (p) => {
        minY = Math.min(minY, p.py);
      });
      return y0 - minY;
    };
    const base = demoProjectDocs();
    const boosted = demoProjectDocs();
    const physics = boosted['physics.json'] as { jumpVelocity: number };
    physics.jumpVelocity = Math.round(DEFAULT_PHYSICS.jumpVelocity * 1.25);
    const a = apex(base);
    const b = apex(boosted);
    expect(b).toBeGreaterThan(a * 1.3);
  });

  it('M2-T14 OAM cycling: 5 enemies on the player row are each visible in at least 1 of 2 frames', () => {
    const docs = demoProjectDocs();
    docs['actors/statue.json'] = { schemaVersion: 1, kind: 'enemy', name: { fr: 'Statue' }, pattern: 'walker', speed: 0, hp: 1, damage: 1, turnAtLedge: false, graphics: 'builtin:walker' };
    docs['levels/niveau-1.json'] = {
      ...(docs['levels/niveau-1.json'] as object),
      grid: makeGrid(64, [[MT.exit, [[60, 10]]]]),
      entities: [4, 6, 8, 10, 12].map((col) => ({ actor: 'statue', col, row: 10 })),
    } as unknown as Json;
    const h = harness(buildFixture(docs).rom!);
    startPlay(h);
    h.step(10);
    const enemyX = [4, 6, 8, 10, 12].map((c) => c * 16);
    const line = 10 * 16 + 32 + 8; // a scanline through the middle of the enemies and the player
    const visibleEnemies = () => {
      const onLine = h.sprites().filter((s) => line >= s.y + 1 && line <= s.y + 8);
      const shown = onLine.slice(0, 8); // the PPU shows the first 8 in OAM order
      const set = new Set<number>();
      for (const s of shown) enemyX.forEach((x, i) => s.x >= x && s.x < x + 16 && set.add(i));
      return { set, total: onLine.length };
    };
    for (let f = 0; f < 6; f++) {
      const a = visibleEnemies();
      h.step(1);
      const b = visibleEnemies();
      expect(a.total).toBeGreaterThan(8);
      for (let i = 0; i < 5; i++) expect(a.set.has(i) || b.set.has(i), `enemy ${i} at frame pair ${f}`).toBe(true);
    }
  });

  it('M2-T15 lag: the scripted run through the demo stage has 0 lag frames', () => {
    const h = harness(demoRom());
    startPlay(h);
    const t = runRight(h, DEMO_JUMPS, (p) => p.state === GAME_STATE.clear, 3000);
    expect(t[t.length - 1]!.state).toBe(GAME_STATE.clear);
    expect(Math.max(...t.map((p) => p.lagFrames))).toBe(0);
  });

  it('M2-T17 HUD bank: HUD rows use the HUD/font bank, the playfield the world bank; HUD content on rows 1-3', () => {
    const b = demo();
    const h = harness(b.rom!);
    startPlay(h);
    h.step(10);
    const fontTiles = b.emit!.chr.find((c) => c.bank1k === CHR_BANK.font)!.tiles;
    const hud = h.nametableTiles(0, 0, 32, 4);
    expect(hud.every((t) => t < fontTiles)).toBe(true);
    const blank = hud[0]!;
    expect(hud.slice(0, 32).every((t) => t === blank)).toBe(true); // row 0 stays empty (TV overscan)
    expect(hud.slice(32).some((t) => t !== blank)).toBe(true);
    // bank register read-back: R0 (BG $0000) = font bank before the frame, world bank from scanline ~32
    let select = 0;
    const writes: Array<{ frame: number; line: number; value: number }> = [];
    const unhook = h.s.onMapperWrite((addr, value) => {
      if ((addr & 0xe001) === 0x8000) select = value;
      else if ((addr & 0xe001) === 0x8001 && (select & 7) === 0) writes.push({ frame: h.frames, line: h.s.scanline, value });
    });
    h.step(60, ['RIGHT']);
    unhook();
    const worldBank = CHR_BANK.worldBase;
    for (let f = h.frames - 58; f < h.frames; f++) {
      const w = writes.filter((x) => x.frame === f);
      expect(w.some((x) => x.value === CHR_BANK.font && (x.line < 0 || x.line >= 240)), `font bank before frame ${f}`).toBe(true);
      expect(w.some((x) => x.value === worldBank && x.line >= 30 && x.line <= 33), `world bank at the split, frame ${f}`).toBe(true);
    }
  });

  it('M2-T9 save state -> 60 frames -> load state gives the same framebuffer hash', () => {
    const h = harness(demoRom());
    startPlay(h);
    h.step(40, ['RIGHT']);
    const state = h.s.saveState();
    h.step(60, ['RIGHT']);
    const a = h.frameHash();
    const pa = h.probe();
    h.s.loadState(state);
    h.step(60, ['RIGHT']);
    expect(h.frameHash()).toBe(a);
    expect(h.probe()).toEqual(pa);
  });
});

it('engine tier writes nothing outside .tmp', () => {
  expect(existsSync(path.join(ROOT, 'engine', 'gen'))).toBe(false);
});
