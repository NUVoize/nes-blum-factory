import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pricesSchema } from '../src/core/llm/prices';
import { blumReplay, BLUM_BOSSES, BLUM_ENEMIES, makeSampleBlum } from '../src/core/sample/blum';
import { BLUM_LEVELS } from '../src/core/sample/blum-levels';
import { validateProjectDocs } from '../src/core/schema/documents';
import { SFX_LIBRARY, SONG_LIBRARY } from '../src/core/engine-data/emit';
import type { Story } from '../src/core/schema/story';
import { proposeLevel } from '../src/core/directors/tableau';
import { NesSession, type JsnesModule } from '../src/core/emu/nes-session';
import { foldRomText } from '../src/core/engine-data/art/font';
import { storyScreens } from '../src/core/engine-data/text-screens';
import { BLUM_STORY } from '../src/core/sample/blum';
import { tempDir } from './helpers';

const prices = pricesSchema.parse(JSON.parse(readFileSync(new URL('../config/prices.json', import.meta.url), 'utf8')));

describe('M6 sample game BLUM (FakeProvider replay, PLAN §12.3)', () => {
  it('music library: the BLUMA floor (3 songs + 6 SFX) and more, M2 ids kept at 0 and 1', () => {
    expect(SONG_LIBRARY.slice(0, 2)).toEqual(['title', 'stage']);
    expect(SFX_LIBRARY.slice(0, 2)).toEqual(['jump', 'pickup']);
    for (const id of ['title', 'stage', 'boss', 'clear', 'gameover', 'ending']) expect(SONG_LIBRARY).toContain(id);
    for (const id of ['jump', 'pickup', 'stomp', 'hurt', 'oneup', 'bosshit']) expect(SFX_LIBRARY).toContain(id);
  });

  it('every proposal of the replay is valid and approved through the runtime', { timeout: 60_000 }, async () => {
    const dir = path.join(tempDir(), 'BLUM.blum');
    const { store, approved } = await makeSampleBlum(dir, prices);
    try {
      const calls = blumReplay().reduce((n, s) => n + s.calls.length, 0);
      expect(approved).toHaveLength(calls);
      expect(approved.every((p) => p.state === 'approved' && p.txId)).toBe(true);
      expect(store.journal()).toHaveLength(calls);
      const docs = store.docs();
      const issues = validateProjectDocs(docs);
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      const story = docs['story.json'] as unknown as Story;
      expect(story.title).toBe('BLUM');
      expect(story.worlds.map((w) => w.stages.length)).toEqual([2, 2, 2, 3]);
      expect(story.worlds.flatMap((w) => w.stages.map((s) => s.id))).toEqual(BLUM_LEVELS.map((l) => l.id));
      for (const e of BLUM_ENEMIES) expect(docs[`actors/${e.id}.json`]).toMatchObject({ kind: 'enemy', pattern: e.pattern });
      for (const b of BLUM_BOSSES) expect(docs[`actors/${b.id}.json`]).toMatchObject({ kind: 'boss', script: b.id });
      // every boss sits in exactly one stage, one per stage
      const bossIds = new Set<string>(BLUM_BOSSES.map((b) => b.id));
      const placed = BLUM_LEVELS.flatMap((l) => (docs[`levels/${l.id}.json`] as unknown as { entities: Array<{ actor: string }> }).entities.filter((e) => bossIds.has(e.actor)).map((e) => e.actor));
      expect(placed.sort()).toEqual([...bossIds].sort());
      // TABLEAU's grid editor sends no boss song: re-proposing a boss stage keeps it
      const w12 = docs['levels/w1-s2.json'] as unknown as { bossMusic?: string; grid: number[][]; width: number; spawn: { col: number; row: number }; entities: unknown[]; music: string };
      expect(w12.bossMusic).toBe('boss');
      const again = proposeLevel.toOps({ id: 'w1-s2', width: w12.width, grid: w12.grid, spawn: w12.spawn, entities: w12.entities as never, music: w12.music as never }, docs);
      expect((again.ops[0] as { value: { bossMusic?: string } }).value.bossMusic).toBe('boss');
      // the replay never claims a cost: zero tokens
      const chat = store.chat('story');
      expect(chat.at(-1)?.costUsd).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe('M6 ROM text line breaks', () => {
  it('a line break in the ending starts a new ROM line and is not a missing glyph', () => {
    expect(foldRomText('A\nB').text).toBe('A\nB');
    expect(foldRomText('A\nB').unknown).toEqual([]);
    const ending = storyScreens({ ...BLUM_STORY, schemaVersion: 1 }).find((s) => s.kind === 'ending')!;
    expect(ending.lines[0]).toBe('BONNE FÊTE BLUM !');
    expect(ending.lines.length).toBeLessThanOrEqual(10);
  });
});

describe('M6 emulator save states keep the pad in sync', () => {
  it('a button held after a load is really pressed (the session resyncs its held set)', async () => {
    const jsnes = (await import('jsnes')) as unknown as JsnesModule;
    const s = new NesSession(jsnes);
    const rom = new Uint8Array(16 + 32768 + 8192);
    rom.set([0x4e, 0x45, 0x53, 0x1a, 2, 1, 0, 0]);
    s.load(rom);
    s.setButtons([]);
    const state = s.saveState(); // pad released
    s.setButtons(['RIGHT']);
    s.step();
    s.loadState(state); // jsnes pad: RIGHT up again
    s.setButtons(['RIGHT']);
    const pad = (s as unknown as { nes: { controllers: Record<number, { state: number[] }> } }).nes.controllers[1]!.state;
    expect(pad[7]).toBe(0x41); // jsnes: RIGHT is index 7, 0x41 = pressed
  });
});
