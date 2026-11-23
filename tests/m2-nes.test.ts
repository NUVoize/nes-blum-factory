// M2 unit tier: header, ld65 map/budgets, engine source rules, the engine data contract and the emitter.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildJardinBank } from '../src/core/engine-data/builtin-chr';
import {
  AI_PATTERN,
  BEHAVIOUR,
  EVENT,
  GAME_STATE,
  LEVEL_HEADER,
  LEVEL_ROWS,
  MAX_ENEMIES,
  MAX_ENTITIES,
  MAX_METATILES,
  PROBE,
  PROBE_FLAG,
  TUNING,
  tuningAddress,
} from '../src/core/engine-data/contract';
import { demoDocs, DEMO_LEVEL, JARDIN_TILESET } from '../src/core/engine-data/demo';
import { decodeLevelRle, emitProject, encodeLevelRle, tuningBlock } from '../src/core/engine-data/emit';
import { decodeTile, encodeTile } from '../src/core/nes/chr';
import { headerForCartridge, hex, parseHeader, romSize, writeHeader } from '../src/core/nes/header';
import { bankUsage, parseLd65Map, parseOverflows } from '../src/core/nes/ld65-map';
import { validateDoc } from '../src/core/schema/documents';
import { DEFAULT_AUDIO } from '../src/core/schema/misc';
import { DEFAULT_PHYSICS } from '../src/core/schema/physics';
import { DEFAULT_CARTRIDGE } from '../src/core/schema/project';
import { DEFAULT_STORY } from '../src/core/schema/story';
import type { Json } from '../src/core/util/json-pointer';

const ROOT = path.resolve(import.meta.dirname, '..');
const fixture = (...p: string[]) => readFileSync(path.join(ROOT, 'tests', 'fixtures', ...p), 'utf8');

const docs = (): Record<string, Json> =>
  structuredClone({
    'cartridge.json': DEFAULT_CARTRIDGE,
    'story.json': DEFAULT_STORY,
    'physics.json': DEFAULT_PHYSICS,
    'audio/library.json': DEFAULT_AUDIO,
    ...demoDocs(),
  }) as Record<string, Json>;

const bytes = (s: string) => s.split(/\s+/).map((h) => parseInt(h, 16));

describe('M2-T2 NES 2.0 header', () => {
  const MMC3 = bytes('4E 45 53 1A 10 10 40 08 00 00 07 00 00 00 00 00');
  const MMC3_BATTERY = bytes('4E 45 53 1A 10 10 42 08 00 00 70 00 00 00 00 00');

  it('M2-T2 the cartridge profile writes the exact MMC3 header (and the battery variant)', () => {
    expect(Array.from(headerForCartridge(DEFAULT_CARTRIDGE))).toEqual(MMC3);
    expect(Array.from(headerForCartridge({ ...DEFAULT_CARTRIDGE, battery: true }))).toEqual(MMC3_BATTERY);
    expect(romSize(parseHeader(MMC3))).toBe(393232);
  });

  it('M2-T2 fixtures round-trip: MMC3, MMC3+battery; NROM parses; broken is refused; mapper 30 parse only', () => {
    for (const h of [MMC3, MMC3_BATTERY]) {
      const p = parseHeader(h);
      const { format, ...rest } = p;
      expect(format).toBe('nes2');
      expect(Array.from(writeHeader(rest))).toEqual(h);
    }
    expect(parseHeader(MMC3)).toMatchObject({ mapper: 4, prgRomBytes: 256 * 1024, chrRomBytes: 128 * 1024, prgRamBytes: 8192, prgNvramBytes: 0, battery: false });
    expect(parseHeader(MMC3_BATTERY)).toMatchObject({ mapper: 4, prgRamBytes: 0, prgNvramBytes: 8192, battery: true });

    const nrom = parseHeader(bytes('4E 45 53 1A 02 01 01 00 00 00 00 00 00 00 00 00'));
    expect(nrom).toMatchObject({ format: 'ines', mapper: 0, prgRomBytes: 32768, chrRomBytes: 8192, mirroringBit: 1 });

    expect(() => parseHeader(bytes('4E 45 53 00 10 10 40 08 00 00 07 00 00 00 00 00'))).toThrow(/signature/);
    expect(() => parseHeader(bytes('4E 45 53 1A 10'))).toThrow(/trop court/);

    // UNROM-512 (mapper 30, submapper 1): mapper number only; no claim about its mirroring bits.
    const m30 = parseHeader(bytes('4E 45 53 1A 20 00 E1 18 10 00 00 07 00 00 00 00'));
    expect(m30.mapper).toBe(30);
    expect(m30.submapper).toBe(1);
    expect(m30.chrRamBytes).toBe(8192);
    expect(hex(MMC3)).toBe('4E 45 53 1A 10 10 40 08 00 00 07 00 00 00 00 00');
  });
});

describe('M2-T8 ld65 map -> per-bank budget', () => {
  it('M2-T8 the demo map gives per-bank usage, SOUND bank against 8 KiB', () => {
    const map = parseLd65Map(fixture('ld65', 'demo-segments.map'));
    expect(map.segments.find((s) => s.name === 'STARTUP')).toMatchObject({ start: 0xe000 });
    const usage = bankUsage(map);
    const sound = usage.find((u) => u.area === 'PRG28')!;
    expect(sound.label).toBe('banque SOUND');
    expect(sound.capacity).toBe(8192);
    expect(sound.used).toBeGreaterThan(0);
    expect(sound.overflowBytes).toBe(0);
    const fixed = usage.find((u) => u.area === 'PRG')!;
    expect(fixed.banks).toEqual([29, 30]);
    expect(fixed.segments).toEqual(expect.arrayContaining(['CODE', 'RODATA']));
    expect(usage.find((u) => u.area === 'PRGE')!.segments).toEqual(expect.arrayContaining(['STARTUP', 'VECTORS']));
  });

  it('M2-T8 an oversized bank gives an overflow entry', () => {
    const out = fixture('ld65', 'sound-overflow.txt');
    expect(parseOverflows(out)).toEqual([{ segment: 'SOUND', area: 'PRG28', bytes: 1647 }]);
    const usage = bankUsage(null, out);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ area: 'PRG28', overflowBytes: 1647, used: 8192 + 1647, capacity: 8192 });
  });
});

describe('M2-T12 engine source rules (hardware boot)', () => {
  const engineFiles = (): Array<{ file: string; text: string }> => {
    const out: Array<{ file: string; text: string }> = [];
    for (const dir of ['src', 'lib']) {
      for (const f of readdirSync(path.join(ROOT, 'engine', dir))) {
        if (/\.(s|asm)$/.test(f)) out.push({ file: `${dir}/${f}`, text: readFileSync(path.join(ROOT, 'engine', dir, f), 'utf8') });
      }
    }
    return out;
  };
  const code = (line: string) => line.replace(/;.*$/, '');

  it('M2-T12 reset enables WRAM ($A001 = $80) before the C runtime starts', () => {
    const crt0 = readFileSync(path.join(ROOT, 'engine', 'src', 'crt0.s'), 'utf8').split('\n').map(code);
    const start = crt0.findIndex((l) => /^start:/.test(l));
    const wram = crt0.findIndex((l, i) => i > start && /jsr\s+_set_wram_mode/.test(l));
    expect(wram).toBeGreaterThan(start);
    expect(crt0[wram - 1]).toMatch(/lda\s+#\$80/);
    const zerobss = crt0.findIndex((l) => /jsr\s+zerobss/.test(l));
    expect(wram).toBeLessThan(zerobss);
    const mmc3 = readFileSync(path.join(ROOT, 'engine', 'lib', 'mmc3_code.asm'), 'utf8').split('\n').map(code);
    const fn = mmc3.findIndex((l) => /^_set_wram_mode:/.test(l));
    expect(mmc3[fn + 1]).toMatch(/sta\s+\$a001/i);
  });

  it('M2-T12 no $8000/$8001 store outside the shadow routines', () => {
    const allowed = new Set(['bank_swap_common', 'irq_parser', 'nmi_sound']);
    const found: string[] = [];
    for (const { file, text } of engineFiles()) {
      let routine = '';
      for (const raw of text.split('\n')) {
        const line = code(raw);
        const label = /^([A-Za-z_]\w*):/.exec(line);
        if (label) routine = label[1]!;
        if (/\bst[axy]\s+\$800[01]\b/i.test(line)) {
          found.push(`${file}:${routine}`);
          expect(allowed.has(routine), `${file}: store to $8000/$8001 in ${routine}`).toBe(true);
        }
      }
    }
    expect(found.length).toBeGreaterThan(0);
    // each allowed routine keeps the shadow copy of $8000 in sync
    for (const { text } of engineFiles()) {
      for (const r of allowed) {
        const i = text.indexOf(`\n${r}:`);
        if (i < 0) continue;
        const body = text.slice(i, i + 1500);
        expect(body, r).toMatch(/mmc3_8000/);
      }
    }
  });

  it('M2-T12 MMC3 IRQ latch is never 0 and the CHR layout is not inverted', () => {
    const mmc3 = readFileSync(path.join(ROOT, 'engine', 'lib', 'mmc3_code.asm'), 'utf8');
    expect(mmc3).toMatch(/^\.define A12_INVERT \$00/m);
    const game = readFileSync(path.join(ROOT, 'engine', 'src', 'game.c'), 'utf8');
    // M3 added the player CHR bank (F9) before the scanline value: the latch moved to [4]
    expect(game).toMatch(/irq_array\[4\] = HUD_SPLIT_LINE/);
    // the NMI rewrites the double-buffered bytes at the same offsets game.c gives them
    const nmi = readFileSync(path.join(ROOT, 'engine', 'lib', 'neslib.s'), 'utf8');
    expect(game).toMatch(/irq_array\[3\] = CHR_PLAYER;/);
    expect(game).toMatch(/irq_array\[6\] = 0x88/);
    expect(game).toMatch(/irq_array\[8\] = \(unsigned char\)cam_x;/);
    expect(nmi).toMatch(/ldy #3\s+;.*\r?\n\s+lda <NBF_PLAYER_CHR/);
    expect(nmi).toMatch(/ldy #6\s*\r?\n\s+lda <NBF_SPLIT_CTRL/);
    expect(nmi).toMatch(/ldy #8\s*\r?\n\s+lda <NBF_SPLIT_X/);
    const gen = emitProject(docs());
    expect(gen.files['gen/config.h']).toMatch(/#define HUD_SPLIT_LINE (\d+)/);
    expect(Number(/#define HUD_SPLIT_LINE (\d+)/.exec(gen.files['gen/config.h'] as string)![1])).toBeGreaterThan(0);
  });
});

describe('ENGINE_DATA_VERSION 1 contract (engine.h <-> contract.ts)', () => {
  const header = readFileSync(path.join(ROOT, 'engine', 'src', 'engine.h'), 'utf8');
  const defines = new Map<string, number>();
  for (const m of header.matchAll(/^#define (\w+) (0x[0-9A-Fa-f]+|\d+)\s*$/gm)) defines.set(m[1]!, Number(m[2]));
  const check = (prefix: string, table: Record<string, number>, names: Record<string, string>) => {
    for (const [key, cName] of Object.entries(names)) expect(defines.get(prefix + cName), `${prefix}${cName}`).toBe(table[key]);
  };

  it('states, behaviours, events, flags, AI patterns, probe offsets and level header agree', () => {
    check('ST_', GAME_STATE, { boot: 'BOOT', title: 'TITLE', story: 'STORY', play: 'PLAY', dying: 'DYING', clear: 'CLEAR', boss: 'BOSS', ending: 'ENDING', gameOver: 'GAMEOVER' });
    check('BEH_', BEHAVIOUR, { empty: 'EMPTY', solid: 'SOLID', oneWay: 'ONEWAY', ladder: 'LADDER', wall: 'WALL', wallSlippery: 'WALL_SLIP', hazard: 'HAZARD', water: 'WATER', breakable: 'BREAKABLE', collectible: 'COLLECT', checkpoint: 'CHECKPOINT', exit: 'EXIT', door: 'DOOR' });
    check('EV_', EVENT, { none: 'NONE', deathHazard: 'DEATH_HAZARD', deathPit: 'DEATH_PIT', deathEnemy: 'DEATH_ENEMY', checkpoint: 'CHECKPOINT', pickup: 'PICKUP', exit: 'EXIT', respawn: 'RESPAWN', hurt: 'HURT' });
    check('PF_', PROBE_FLAG, { grounded: 'GROUNDED', ladder: 'LADDER', wallGrab: 'WALLGRAB', water: 'WATER', invincible: 'INVINCIBLE', jumping: 'JUMPING', dead: 'DEAD' });
    check('AI_', AI_PATTERN, { none: 'NONE', walker: 'WALKER', hopper: 'HOPPER', flyer: 'FLYER', shooter: 'SHOOTER' });
    check('PR_', PROBE, { state: 'STATE', world: 'WORLD', stage: 'STAGE', frame: 'FRAME', px: 'PX', py: 'PY', hp: 'HP', lives: 'LIVES', flags: 'FLAGS', event: 'EVENT', bossHp: 'BOSSHP', enemies: 'ENEMIES', checkpoint: 'CHECKPOINT', lag: 'LAG', collected: 'COLLECT', camX: 'CAMX', stressErrors: 'STRESS_ERR' });
    check('LH_', LEVEL_HEADER, { width: 'WIDTH', spawnCol: 'SPAWN_COL', spawnRow: 'SPAWN_ROW', world: 'WORLD', chrBg: 'CHR_BG', chrEnemies: 'CHR_ENEMIES', song: 'SONG', mtCount: 'MT_COUNT', mtPtr: 'MT_PTR', entPtr: 'ENT_PTR', rlePtr: 'RLE_PTR', emptyMt: 'EMPTY_MT', bossSong: 'BOSS_SONG', size: 'SIZE' });
    expect(defines.get('LEVEL_ROWS')).toBe(LEVEL_ROWS);
    expect(defines.get('MAX_METATILES')).toBe(MAX_METATILES);
    expect(defines.get('MAX_ENTITIES')).toBe(MAX_ENTITIES);
    expect(defines.get('MAX_ENEMIES')).toBe(MAX_ENEMIES);
    expect(PROBE.lag).toBe(0x14);
    expect(PROBE.base + PROBE.size).toBeLessThanOrEqual(0x7f40);
  });
});

describe('emitter v1', () => {
  it('emits every gen file for the demo project', () => {
    const r = emitProject(docs());
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.files).sort()).toEqual(['gen/chr.bin', 'gen/config.h', 'gen/config.inc', 'gen/data.s', 'gen/header.inc']);
    expect((r.files['gen/chr.bin'] as Uint8Array).length).toBe(128 * 1024);
    expect(r.files['gen/header.inc']).toContain('$4e,$45,$53,$1a,$10,$10,$40,$08,$00,$00,$07');
    expect(r.report!.levels).toEqual([expect.objectContaining({ id: 'niveau-1', bank: 0, width: 64, enemies: 2 })]);
  });

  it('tuning block: magic BLMT, version, fields little-endian at fixed addresses', () => {
    const b = tuningBlock(DEFAULT_PHYSICS);
    expect(String.fromCharCode(...b.slice(0, 4))).toBe('BLMT');
    expect(b[TUNING.versionOffset]).toBe(1);
    const at = (f: Parameters<typeof tuningAddress>[0]) => {
      const o = tuningAddress(f) - TUNING.base;
      return b[o]! | (b[o + 1]! << 8);
    };
    expect(at('gravity')).toBe(DEFAULT_PHYSICS.gravity);
    expect(at('jumpVelocity')).toBe(DEFAULT_PHYSICS.jumpVelocity);
    expect(at('hp')).toBe(DEFAULT_PHYSICS.health.hp);
    expect(tuningAddress('walkAccel')).toBe(0x7e10);
  });

  it('level RLE round-trips (column-major, 13 rows)', () => {
    const rle = encodeLevelRle(DEMO_LEVEL.grid, DEMO_LEVEL.width);
    expect(decodeLevelRle(rle, DEMO_LEVEL.width)).toEqual(DEMO_LEVEL.grid);
    expect(rle.length).toBeLessThan(DEMO_LEVEL.width * 13);
  });

  it('demo level and tileset pass their schemas; jardin tile indices are stable', () => {
    expect(validateDoc('levels/niveau-1.json', DEMO_LEVEL as unknown as Json)).toEqual([]);
    expect(validateDoc('tilesets/jardin.json', JARDIN_TILESET as unknown as Json)).toEqual([]);
    const { quads, bank } = buildJardinBank();
    expect(JARDIN_TILESET.metatiles.find((m) => m.name === 'herbe')!.tiles).toEqual(quads['grass']);
    expect(bank.count).toBeLessThanOrEqual(256);
  });

  it('refuses stretch features with a French reason', () => {
    const wide = docs();
    const level = wide['levels/niveau-1.json'] as unknown as typeof DEMO_LEVEL;
    level.width = 160;
    level.grid = level.grid.map((r) => [...r, ...Array<number>(96).fill(0)]);
    const r1 = emitProject(wide);
    expect(r1.ok).toBe(false);
    expect(r1.issues[0]!.fr).toMatch(/trop large/);

    const water = docs();
    (water['tilesets/jardin.json'] as unknown as typeof JARDIN_TILESET).metatiles[0]!.behaviour = 'water';
    expect(emitProject(water).issues[0]!.fr).toMatch(/n’est pas encore disponible/);

    // hopper became a built floor pattern in M4a; turret is still stretch
    const turret = docs();
    (turret['actors/rampeur.json'] as { pattern: string }).pattern = 'turret';
    expect(emitProject(turret).issues[0]!.fr).toMatch(/« turret » n’est pas encore disponible/);

    const missing = docs();
    delete missing['levels/niveau-1.json'];
    expect(emitProject(missing).issues[0]!.fr).toMatch(/document manquant/);
  });
});

describe('CHR codec', () => {
  it('golden patterns and random round trips', () => {
    const px = new Uint8Array(64);
    px[0] = 1;
    px[63] = 3;
    px[9] = 2;
    const b = encodeTile(px);
    expect(b[0]).toBe(0x80);
    expect(b[8]).toBe(0x00);
    expect(b[1]).toBe(0x00);
    expect(b[9]).toBe(0x40);
    expect(b[7]).toBe(0x01);
    expect(b[15]).toBe(0x01);
    let seed = 1;
    for (let n = 0; n < 50; n++) {
      const t = Uint8Array.from({ length: 64 }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 3);
      expect(Array.from(decodeTile(encodeTile(t)))).toEqual(Array.from(t));
    }
  });
});
