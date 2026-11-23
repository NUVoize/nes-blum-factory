// M2b extras: collectible pickup (behaviour 9) and the sound engine producing audio.
import { describe, expect, it } from 'vitest';
import { EVENT, GAME_STATE } from '../../src/core/engine-data/contract';
import { makeGrid, MT } from '../../src/core/engine-data/demo';
import { NesSession } from '../../src/core/emu/nes-session';
import type { Json } from '../../src/core/util/json-pointer';
import { buildFixture, demoProjectDocs, harness, JSNES, runRight, startPlay } from './rom';

describe('M2b behaviours and sound', () => {
  it('M2-T5 collectible: walking through a flower counts it and clears the cell in the nametable', () => {
    const docs = demoProjectDocs();
    docs['levels/niveau-1.json'] = {
      ...(docs['levels/niveau-1.json'] as object),
      grid: makeGrid(64, [[MT.flower, [[6, 10], [8, 10]]], [MT.exit, [[60, 10]]]]),
      entities: [],
    } as unknown as Json;
    const h = harness(buildFixture(docs).rom!);
    startPlay(h);
    const flowerTiles = h.nametableTiles(12, 24, 2, 2); // metatile (6, 10): tiles (12..13, 24..25)
    expect(flowerTiles.some((t) => t !== 0)).toBe(true);
    const t = runRight(h, [], (p) => p.collected === 2, 300);
    const last = t[t.length - 1]!;
    expect(last.collected).toBe(2);
    expect(t.some((p) => p.event === EVENT.pickup)).toBe(true);
    expect(last.state).toBe(GAME_STATE.play);
    h.step(3);
    expect(h.nametableTiles(12, 24, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('M2b sound: the title song and the stage song produce non-silent audio', () => {
    const rom = buildFixture(demoProjectDocs()).rom!;
    let sum = 0;
    let n = 0;
    const s = new NesSession(JSNES, {
      sampleRate: 44100,
      onAudioSample: (l) => {
        sum += l * l;
        n++;
      },
    });
    s.load(rom);
    const rms = (frames: number, hold: Parameters<NesSession['setButtons']>[0] = []) => {
      sum = 0;
      n = 0;
      s.setButtons(hold);
      for (let i = 0; i < frames; i++) s.step();
      return Math.sqrt(sum / Math.max(1, n));
    };
    const title = rms(240);
    rms(2, ['START']);
    const stage = rms(240);
    expect(n).toBeGreaterThan(0);
    expect(title).toBeGreaterThan(0.01);
    expect(stage).toBeGreaterThan(0.01);
  });
});
