// M6-T3 / M6-T4: the sample game BLUM (FakeProvider replay) is valid, builds a correct ROM, every stage is
// cleared by its own input script from a debug start, every boss is beaten by its stage script, and a
// cheat build reaches the ending. Writes jsnes traces for the Mesen tier (M6-T8, scripts/test-mesen.mjs).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHEAT, EVENT, GAME_STATE, PROBE } from '../../src/core/engine-data/contract';
import type { ButtonName } from '../../src/core/emu/nes-session';
import { ProjectStore } from '../../src/core/project/store';
import { validateProjectDocs } from '../../src/core/schema/documents';
import { tempDir } from '../helpers';
import { BLUM_STAGE_IDS, blumProject, bootToPlay, buildBlum, readScript } from './blum';
import { harness, ROOT, writeShot } from './rom';

const BOSS_STAGES = new Set(['w1-s2', 'w2-s2', 'w3-s2', 'w4-s2', 'w4-f']);
const TRACE_DIR = path.join(ROOT, '.tmp', 'm6-traces');

describe('M6-T3 BLUM project and ROM', () => {
  it('the replayed project is valid (schemas + world budgets) and matches the shipped sample', async () => {
    const p = await blumProject();
    expect(validateProjectDocs(p.docs).filter((i) => i.severity === 'error')).toEqual([]);
    // resources/samples/BLUM.blum is the same replay (ids and dates aside)
    const copy = path.join(tempDir(), 'BLUM.blum');
    cpSync(path.join(ROOT, 'resources', 'samples', 'BLUM.blum'), copy, { recursive: true });
    const shipped = ProjectStore.open(copy);
    try {
      const strip = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'project.json'));
      expect(strip(shipped.docs())).toEqual(strip(p.docs));
      expect(shipped.journal()).toHaveLength(28);
      expect(shipped.readOnly).toBe(false);
    } finally {
      shipped.close();
    }
  });

  it('release build: header, size, mapper, PRG-RAM, banks within budget, boots to the title', async () => {
    const r = await buildBlum();
    const rom = r.rom!;
    expect(rom.length).toBe(16 + 256 * 1024 + 128 * 1024);
    expect([...rom.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ')).toBe('4e 45 53 1a 10 10 40 08 00 00 07 00 00 00 00 00');
    for (const b of r.banks) expect(b.used, b.label).toBeLessThanOrEqual(b.capacity);
    const h = harness(rom);
    h.step(120);
    const p = h.probe();
    expect(p.magic).toBe('BLUM');
    expect(p.state).toBe(GAME_STATE.title);
    writeShot(h, 'm6-blum-title');
    // the release ROM ignores the cheat byte (testCheats is never passed by an export)
    h.s.poke(PROBE.base + PROBE.cheats, CHEAT.skipStage);
    h.step(2, ['START']);
    h.step(400);
    expect(h.probe().state).not.toBe(GAME_STATE.clear);
  });
});

/** Replays a frame script and records the inputs by probe frame (the Mesen tier keys them that way). */
function replay(h: ReturnType<typeof harness>, script: Array<{ frames: number; hold: ButtonName[] }>, until: (p: ReturnType<typeof h.probe>) => boolean) {
  const inputs: Array<{ f: number; n: number; b: ButtonName[] }> = [];
  let maxLag = 0;
  let hit: ReturnType<typeof h.probe> | null = null;
  let frames = 0;
  outer: for (const st of script) {
    for (let i = 0; i < st.frames; i++) {
      const f = h.probe().frame;
      const last = inputs.at(-1);
      if (last && last.f + last.n === f && last.b.join() === st.hold.join()) last.n++;
      else if (st.hold.length) inputs.push({ f, n: 1, b: st.hold });
      h.step(1, st.hold);
      frames++;
      const p = h.probe();
      maxLag = Math.max(maxLag, p.lagFrames);
      if (until(p)) {
        hit = p;
        break outer;
      }
    }
  }
  return { inputs: inputs.filter((x) => x.b.length), hit, frames, maxLag };
}

function writeTrace(name: string, rom: Uint8Array, data: object) {
  mkdirSync(TRACE_DIR, { recursive: true });
  writeFileSync(path.join(TRACE_DIR, `${name}.json`), JSON.stringify({ name, romSha1: createHash('sha1').update(rom).digest('hex'), ...data }));
}

describe('M6-T4 BLUM playthrough (one script per stage, bosses, cheat run to the ending)', () => {
  for (const [index, stage] of BLUM_STAGE_IDS.entries()) {
    const scripted = existsSync(path.join(ROOT, 'tests', 'engine', 'blum-scripts', `${stage}.txt`));
    it.runIf(scripted)(`${stage}: its script clears the stage${BOSS_STAGES.has(stage) ? ' and beats the boss' : ''}, 0 lag frames`, async () => {
      const r = await buildBlum({ startLevel: index });
      const h = harness(r.rom!);
      const { inputs, hit, frames, maxLag } = replay(h, readScript(stage), (p) => p.state === GAME_STATE.clear);
      writeShot(h, `m6-${stage}-clear`);
      expect(hit, `${stage} not cleared after ${frames} frames (x ${h.probe().px}, state ${h.probe().state})`).not.toBeNull();
      expect(hit!.event).toBe(BOSS_STAGES.has(stage) ? EVENT.bossDefeated : EVENT.exit);
      expect(maxLag).toBe(0);
      const end = h.probe();
      writeTrace(`blum-${stage}`, r.rom!, { startLevel: index, frames, endFrame: end.frame, inputs, end });
    });
  }

  it('the script list covers every stage', () => {
    const missing = BLUM_STAGE_IDS.filter((s) => !existsSync(path.join(ROOT, 'tests', 'engine', 'blum-scripts', `${s}.txt`)));
    expect(missing).toEqual([]);
  });

  it('cheat build (invincible + stage skip by probe poke) reaches the ending within the frame limit', async () => {
    const r = await buildBlum({ testCheats: true });
    const h = harness(r.rom!);
    const LIMIT = 12_000;
    const seen = new Set<number>();
    let ending = -1;
    const inputs: Array<{ f: number; n: number; b: ButtonName[] }> = [];
    const pokes: Array<{ f: number; v: number }> = [];
    for (let i = 0; i < LIMIT; i++) {
      const p = h.probe();
      if (p.state === GAME_STATE.ending) {
        ending = i;
        break;
      }
      let hold: ButtonName[] = [];
      if (i === 60 || i === 61 || (p.state === GAME_STATE.story && i % 40 === 20)) hold = ['START'];
      if ((p.state === GAME_STATE.play || p.state === GAME_STATE.boss) && p.frame % 30 === 0) {
        h.s.poke(PROBE.base + PROBE.cheats, CHEAT.invincible | CHEAT.skipStage);
        pokes.push({ f: p.frame, v: CHEAT.invincible | CHEAT.skipStage });
        seen.add(p.world * 4 + p.stage);
      }
      if (hold.length) inputs.push({ f: p.frame, n: 1, b: hold });
      h.step(1, hold);
    }
    writeShot(h, 'm6-cheat-ending');
    writeTrace('blum-cheat', r.rom!, { cheat: true, frames: ending, endFrame: h.probe().frame, inputs, pokes: pokes.length, end: h.probe() });
    expect(ending, 'ending not reached').toBeGreaterThan(0);
    expect(h.probe().state).toBe(GAME_STATE.ending);
    expect(seen.size).toBe(BLUM_STAGE_IDS.length);
    // the credits follow the ending
    h.step(30);
    h.step(2, ['START']);
    expect(h.runUntil((p) => p.textScreen === 3, 600)).toBeGreaterThan(0);
    writeShot(h, 'm6-cheat-credits');
  });
});

describe('BLUM-FIX2 continue after a game over (W2 P1-2)', () => {
  it('game over in w2-s2, then Start: back to w2-s1 (first stage of the world) with full lives', async () => {
    const r = await buildBlum({ startLevel: 3 });
    const labels = readFileSync(path.join(r.workDir, 'labels.txt'), 'utf8');
    const addr = (name: string) => parseInt(new RegExp(`^al ([0-9A-F]+) \.${name}$`, 'm').exec(labels)![1]!, 16);
    const h = harness(r.rom!);
    bootToPlay(h);
    expect(h.probe().stage).toBe(3);
    // last life, then the player under the playfield: a pit death
    h.s.poke(addr('_lives'), 1);
    h.s.poke(addr('_py'), 0);
    h.s.poke(addr('_py') + 1, 1);
    expect(h.runUntil((p) => p.state === GAME_STATE.gameOver, 200)).toBeGreaterThan(0);
    h.step(40);
    writeShot(h, 'fix2-gameover');
    h.step(2, ['START']);
    for (let i = 0; i < 600 && h.probe().state !== GAME_STATE.play; i++) h.step(1, h.probe().state === GAME_STATE.story && i % 40 === 20 ? ['START'] : []);
    const p = h.probe();
    expect(p.state).toBe(GAME_STATE.play);
    expect(p.stage).toBe(2);
    expect(p.world).toBe(1);
    expect(p.lives).toBe(3);
    // Select on the game-over screen still goes back to the title
    h.s.poke(addr('_lives'), 1);
    h.s.poke(addr('_py'), 0);
    h.s.poke(addr('_py') + 1, 1);
    expect(h.runUntil((q) => q.state === GAME_STATE.gameOver, 200)).toBeGreaterThan(0);
    h.step(40);
    h.step(2, ['SELECT']);
    expect(h.runUntil((q) => q.state === GAME_STATE.title, 60)).toBeGreaterThanOrEqual(0);
  });
});
