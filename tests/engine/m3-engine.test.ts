// M3-T7 (engine half): a CHROMA conversion approved through the director flow is built with cc65 and
// shows in the ROM: the frame region around the hero changes, and the hero's jump frame is drawn from
// its own 1 KiB CHR bank (R2 switched per animation group, PLAN §5.4).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirectorRuntime } from '../../src/core/directors/runtime';
import { CHR_BANK } from '../../src/core/engine-data/contract';
import { FakeProvider } from '../../src/core/llm/fake';
import { pricesSchema } from '../../src/core/llm/prices';
import { ProjectStore } from '../../src/core/project/store';
import { encodePng } from '../../src/core/util/png';
import { HERO_CALL, sourcesOf } from '../fixtures/chroma';
import { tempDir } from '../helpers';
import { buildFixture, harness, ROOT, startPlay, writeShot } from './rom';

const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'config', 'prices.json'), 'utf8')));

/** RGBA crop of the current frame. */
function region(rgba: Uint8Array, x0: number, y0: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(255, Math.max(0, x0 + x));
      const sy = Math.min(239, Math.max(0, y0 + y));
      out.set(rgba.subarray((sy * 256 + sx) * 4, (sy * 256 + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return out;
}

describe('M3-T7 CHROMA conversion in the ROM', () => {
  it('M3-T7 drop -> proposal -> approve -> build -> the hero region shows the new tiles; jump uses CHR bank 1', async () => {
    const dir = path.join(tempDir(), 'Jeu.blum');
    const store = ProjectStore.create(dir, { title: 'Jeu' });
    const before = { docs: store.docs(), assets: store.assets() };
    const provider = new FakeProvider([[{ tool: 'propose_conversion', input: HERO_CALL }], [{ text: 'Prêt.' }]]);
    const runtime = new DirectorRuntime({ store, provider, prices, sources: sourcesOf({ pousse: 'character-sheet.png' }) });
    const sent = await runtime.send('visual', 'Fais de mon dessin le héros.');
    expect(sent.proposals).toHaveLength(1);
    runtime.approve(sent.proposals[0]!.id);
    const after = { docs: store.docs(), assets: store.assets() };
    store.close();
    for (const f of ['graphics/pousse.png', 'graphics/pousse.json', 'graphics/pousse.chr']) expect(existsSync(path.join(dir, f))).toBe(true);

    const placeholder = buildFixture(before.docs, {}, before.assets);
    const converted = buildFixture(after.docs, {}, after.assets);
    expect(converted.ok).toBe(true);
    expect(converted.emit!.chr.some((c) => c.name.startsWith('héros Pousse (banque 1)') && c.bank1k === CHR_BANK.player + 1)).toBe(true);

    const shots: Uint8Array[] = [];
    for (const rom of [placeholder.rom!, converted.rom!]) {
      const h = harness(rom);
      startPlay(h);
      h.step(20);
      const p = h.probe();
      expect(p.flags & 1).toBe(1); // grounded at spawn
      const sx = p.px - p.camX;
      const sy = p.py + 31;
      shots.push(region(h.rgba(), sx - 4, sy - 8, 24, 32));
      // R2 holds the idle bank while standing
      expect(Array.from(h.s.patternBytes(0x1000, 1024))).toEqual(Array.from(rom.subarray(16 + 256 * 1024 + CHR_BANK.player * 1024, 16 + 256 * 1024 + (CHR_BANK.player + 1) * 1024)));
      if (rom === converted.rom) {
        writeShot(h, 'm3-t7-hero-idle');
        // jump: airborne frames draw the jump metasprite from bank 1
        h.step(6, ['A']);
        h.step(2, ['A']);
        expect(h.probe().flags & 1).toBe(0);
        const chr = after.assets['graphics/pousse.chr']!;
        expect(Array.from(h.s.patternBytes(0x1000, 1024))).toEqual(Array.from(chr.subarray(1024, 2048)));
        writeShot(h, 'm3-t7-hero-jump');
        h.step(60);
        expect(Array.from(h.s.patternBytes(0x1000, 1024))).toEqual(Array.from(chr.subarray(0, 1024)));
      }
    }
    // the converted hero changes the pixels where the hero stands
    expect(Buffer.from(shots[0]!).equals(Buffer.from(shots[1]!))).toBe(false);
    const out = path.join(ROOT, '.tmp', 'engine-shots');
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'm3-t7-regions.png'), encodePng(new Uint8Array([...shots[0]!, ...shots[1]!]), 24, 64, 4));
  });

  it('M3 a new project (placeholder art) builds a valid MMC3 ROM and plays with the BLUM hero', () => {
    const dir = path.join(tempDir(), 'Jeu.blum');
    const store = ProjectStore.create(dir, { title: 'Jeu' });
    const r = buildFixture(store.docs(), {}, store.assets());
    const heroChr = store.asset('graphics/heros-blum.chr')!;
    store.close();
    const rom = r.rom!;
    expect(rom.length).toBe(393232);
    expect(Array.from(rom.subarray(0, 16))).toEqual([0x4e, 0x45, 0x53, 0x1a, 0x10, 0x10, 0x40, 0x08, 0x00, 0x00, 0x07, 0, 0, 0, 0, 0]);
    // the hero's 3 banks sit at CHR banks 32-34
    const chrBase = 16 + 256 * 1024;
    expect(Array.from(rom.subarray(chrBase + CHR_BANK.player * 1024, chrBase + (CHR_BANK.player + 3) * 1024))).toEqual(Array.from(heroChr));
    for (const b of r.banks) expect(b.used, b.label).toBeLessThanOrEqual(b.capacity);
    const h = harness(rom);
    startPlay(h);
    h.step(10);
    h.step(40, ['RIGHT']);
    expect(h.probe().lagFrames).toBe(0);
    writeShot(h, 'm3-rom-hero-blum-run');
    h.step(4, ['RIGHT', 'A']);
    h.step(8, ['RIGHT', 'A']);
    expect(Array.from(h.s.patternBytes(0x1000, 1024))).toEqual(Array.from(heroChr.subarray(1024, 2048)));
    writeShot(h, 'm3-rom-hero-blum-jump');
  });
});
