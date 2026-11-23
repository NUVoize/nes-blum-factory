// M4-T8 director flows (FakeProvider): PLUME proposes a 3-world story, REBOND a physics preset, TABLEAU
// a stage; all approved -> the project builds with the real toolchain -> the stage is played to its exit
// by an input script in jsnes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirectorRuntime } from '../../src/core/directors/runtime';
import { FakeProvider } from '../../src/core/llm/fake';
import { pricesSchema } from '../../src/core/llm/prices';
import { ProjectStore } from '../../src/core/project/store';
import { GAME_STATE, TUNING, tuningAddress } from '../../src/core/engine-data/contract';
import { PHYSICS_PRESETS } from '../../src/core/schema/physics';
import type { Level } from '../../src/core/schema/engine-docs';
import { tempDir } from '../helpers';
import { buildFixture, harness, ROOT, runRight, writeShot } from './rom';

const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'config', 'prices.json'), 'utf8')));

const STORY = {
  title: 'BLUM ET LES GRAINES',
  premise: { fr: 'Les graines du jardin se sont envolées. Blum part les chercher dans trois mondes.' },
  romLocale: 'fr',
  worlds: [
    { id: 'monde-1', name: { fr: 'Le potager' }, theme: 'jardin', stages: [{ id: 'niveau-1', name: { fr: 'Les rangs' } }], boss: 'Grosse limace', intro: { fr: 'Le potager s’éveille. Trouve la sortie au bout des rangs !' } },
    { id: 'monde-2', name: { fr: 'La serre' }, theme: 'serre', stages: [{ id: 'niveau-2', name: { fr: 'Buée' } }] },
    { id: 'monde-3', name: { fr: 'Le vieux chêne' }, theme: 'arbre', stages: [{ id: 'niveau-3', name: { fr: 'Racines' } }] },
  ],
  ending: { fr: 'Les graines sont rentrées. Bonne fête Blum !' },
};

// 48 columns: ground, a 2-column pit at 14-15, spikes at 24, a plank to collect flowers, the exit at 44
const ROWS = [
  '................................................',
  '................................................',
  '................................................',
  '................................................',
  '................................................',
  '................................................',
  '..........................***...................',
  '.........................=====..................',
  '................................................',
  '................................................',
  '........................^.................E.....',
  '##############..################################',
  '##############..################################',
].map((r) => r.slice(0, 48));

describe('M4-T8 director flows', () => {
  it('M4-T8 PLUME story + REBOND preset + TABLEAU stage, approved -> builds -> stage played to the exit', async () => {
    const dir = path.join(tempDir(), 'Graines.blum');
    const store = ProjectStore.create(dir, { title: 'Graines' });
    const provider = new FakeProvider([
      [{ text: 'Voici une histoire en trois mondes.' }, { tool: 'propose_story', input: STORY }],
      [{ text: 'Proposition prête.' }],
      [{ text: 'Un saut plus léger.' }, { tool: 'propose_physics', input: { preset: 'leger', changes: [], reason: 'sauts légers pour un premier monde' } }],
      [{ text: 'Réglage prêt.' }],
      [{ text: 'Je dessine les rangs.' }, { tool: 'propose_level', input: { id: 'niveau-1', width: 48, rows: ROWS, spawn: { col: 2, row: 10 }, entities: [] } }],
      [{ text: 'Le niveau est prêt.' }],
    ]);
    const runtime = new DirectorRuntime({ store, provider, prices });

    const plume = await runtime.send('story', 'Un jeu en trois mondes pour Blum.');
    expect(plume.failure).toBeNull();
    expect(plume.proposals[0]!.summary.fr).toMatch(/3 monde\(s\), 3 niveau\(x\), dont 2 niveau\(x\) de départ/);
    runtime.approve(plume.proposals[0]!.id);
    expect(Object.keys(store.docs()).filter((p) => p.startsWith('levels/')).sort()).toEqual(['levels/niveau-1.json', 'levels/niveau-2.json', 'levels/niveau-3.json']);

    const rebond = await runtime.send('movement', 'Des sauts plus légers.');
    expect(rebond.failure).toBeNull();
    runtime.approve(rebond.proposals[0]!.id);
    expect((store.docs()['physics.json'] as { gravity: number }).gravity).toBe(PHYSICS_PRESETS.leger.gravity);

    const tableau = await runtime.send('level', 'Dessine le premier niveau.');
    expect(tableau.failure).toBeNull();
    expect(tableau.proposals[0]!.warnings).toEqual([]);
    runtime.approve(tableau.proposals[0]!.id);
    expect((store.docs()['levels/niveau-1.json'] as unknown as Level).width).toBe(48);
    // TABLEAU saw the legend and the stages in its context
    const ctx = provider.requests[4]!.messages.at(-1)!.content[0]!;
    expect(ctx.type === 'text' ? ctx.text : '').toContain('"legend"');

    // build with the real toolchain and play it
    const b = buildFixture(store.docs(), {}, store.assets());
    expect(b.ok).toBe(true);
    const h = harness(b.rom!);
    h.step(60);
    h.step(2, ['START']);
    expect(h.runUntil((p) => p.state === GAME_STATE.story, 60)).toBeGreaterThan(0); // world 1 intro
    h.step(40);
    h.step(2, ['START']);
    expect(h.runUntil((p) => p.state === GAME_STATE.play, 60)).toBeGreaterThan(0);
    // the « léger » preset is what the ROM runs on
    const g = tuningAddress('gravity');
    expect(h.s.mem[g]! | (h.s.mem[g + 1]! << 8)).toBe(PHYSICS_PRESETS.leger.gravity);
    expect(String.fromCharCode(...h.s.mem.slice(TUNING.base, TUNING.base + 4))).toBe('BLMT');
    h.step(5);
    writeShot(h, 'M4-T8-stage');
    const t = runRight(h, [180, 340], (p) => p.state === GAME_STATE.clear || p.state === GAME_STATE.dying, 1500);
    const end = t.at(-1)!;
    expect(end.state).toBe(GAME_STATE.clear);
    expect(Math.max(...t.map((p) => p.lagFrames))).toBe(0);
  });
});
