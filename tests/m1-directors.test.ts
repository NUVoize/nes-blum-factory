import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirectorRuntime, MAX_TURNS } from '../src/core/directors/runtime';
import { DIRECTORS, STORY_TEMPLATES, toolSpec } from '../src/core/directors/specs';
import { FakeProvider } from '../src/core/llm/fake';
import { OfflineProvider } from '../src/core/llm/offline';
import { pricesSchema } from '../src/core/llm/prices';
import { DIRECTOR_IDS } from '../src/core/project/proposal';
import { ProjectStore } from '../src/core/project/store';
import { tempDir } from './helpers';

const prices = pricesSchema.parse(JSON.parse(readFileSync(new URL('../config/prices.json', import.meta.url), 'utf8')));

function setup(turns: ConstructorParameters<typeof FakeProvider>[0]) {
  const store = ProjectStore.create(path.join(tempDir(), 'Test.blum'), { title: 'Test' });
  const provider = new FakeProvider(turns);
  const rt = new DirectorRuntime({ store, provider, prices });
  return { store, provider, rt };
}

const goodStory = { ...STORY_TEMPLATES.jardin, title: 'BLUM' };
const tooBigStory = {
  ...STORY_TEMPLATES.jardin,
  worlds: Array.from({ length: 9 }, (_, i) => ({ id: `monde-${i + 1}`, name: { fr: `Monde ${i + 1}` }, theme: 'x', stages: [{ id: `niveau-${i + 1}`, name: { fr: 'N' } }] })),
};

describe('M1 directors', () => {
  it('M1-T6 tool call -> ops -> validation -> pending card; approve writes, reject writes nothing', async () => {
    const { store, provider, rt } = setup([
      [{ text: 'Voici une histoire.' }, { tool: 'propose_story', input: goodStory }],
      [{ text: 'Tu peux l’approuver.' }],
      [{ tool: 'propose_story', input: { ...goodStory, title: 'AUTRE' } }],
      [{ text: 'Une autre version.' }],
    ]);
    const before = store.fileHashes();
    const r = await rt.send('story', 'Un jeu de fleur');
    expect(r.failure).toBeNull();
    expect(r.proposals).toHaveLength(1);
    const p = r.proposals[0]!;
    expect(p.state).toBe('pending');
    expect(p.summary.fr).toMatch(/BLUM/);
    // Pending proposals never touch the documents.
    expect(store.fileHashes()).toEqual(before);
    expect(store.proposal(p.id)!.state).toBe('pending');

    // The model got the tools, the cached system prompt and the project context.
    const req = provider.requests[0]!;
    expect(req.tools.map((t) => t.name)).toEqual(['propose_story']);
    expect(req.system).toMatch(/PLUME/);
    expect(JSON.stringify(req.messages[0])).toMatch(/<projet>/);
    // Second request carries the tool result back.
    expect(JSON.stringify(provider.requests[1]!.messages.at(-1))).toMatch(/tool_result/);

    const approved = rt.approve(p.id);
    expect(approved.state).toBe('approved');
    expect(store.doc<{ title: string }>('story.json')!.title).toBe('BLUM');
    expect(store.journal()).toHaveLength(1);
    expect(store.journal()[0]!.proposalId).toBe(p.id);

    const r2 = await rt.send('story', 'Change le titre');
    const after = store.fileHashes();
    rt.reject(r2.proposals[0]!.id);
    expect(store.fileHashes()).toEqual(after);
    expect(store.proposal(r2.proposals[0]!.id)!.state).toBe('rejected');
    expect(store.journal()).toHaveLength(1);
    expect(() => rt.approve(r2.proposals[0]!.id)).toThrow(/déjà traitée/);
    store.close();
  });

  it('M1-T6 an invalid proposal (budget or schema) is never offered and returns a French reason', async () => {
    const { store, provider, rt } = setup([
      [{ tool: 'propose_story', input: tooBigStory }],
      [{ tool: 'propose_story', input: { ...goodStory, title: '' } }],
      [{ tool: 'propose_story', input: tooBigStory }],
      [{ text: 'never reached' }],
    ]);
    const before = store.fileHashes();
    const r = await rt.send('story', 'Un jeu énorme');
    expect(r.proposals).toHaveLength(0);
    expect(store.proposals()).toHaveLength(0);
    expect(store.fileHashes()).toEqual(before);
    expect(r.failure!.fr).toMatch(/^PLUME n’a pas réussi : .*trop de mondes : 9/);
    // The first refusal went back to the model as a tool error, in French.
    const toolResult = provider.requests[1]!.messages.at(-1)!.content[0]!;
    expect(toolResult).toMatchObject({ type: 'tool_result', is_error: true });
    expect((toolResult as { content: string }).content).toMatch(/trop de mondes/);
    // 1 try + 2 retries, then stop.
    expect(provider.callCount).toBe(3);
    store.close();
  });

  it('M1-T6 a schema error is explained, then a corrected retry is offered', async () => {
    const { store, rt } = setup([
      [{ tool: 'propose_physics', input: { changes: [{ pointer: '/gravity', value: 5000 }], reason: 'plus lourd' } }],
      [{ tool: 'propose_physics', input: { changes: [{ pointer: '/gravity', value: 64 }], reason: 'plus lourd' } }],
      [{ text: 'Corrigé.' }],
    ]);
    const r = await rt.send('movement', 'Plus lourd');
    expect(r.failure).toBeNull();
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.ops).toEqual([{ op: 'patch', doc: 'physics.json', pointer: '/gravity', value: 64 }]);
    store.close();
  });

  it(`M1-T6 the tool loop stops at the cap (${MAX_TURNS} model turns per message)`, async () => {
    const turns = Array.from({ length: 10 }, (_, i) => [{ tool: 'propose_physics', input: { changes: [{ pointer: '/gravity', value: 20 + i }], reason: 'x' } }]);
    const { store, provider, rt } = setup(turns);
    const r = await rt.send('movement', 'Boucle');
    expect(provider.callCount).toBe(MAX_TURNS);
    expect(r.turns).toBe(MAX_TURNS);
    expect(r.stoppedAtCap).toBe(true);
    expect(r.failure!.fr).toMatch(/limite de 6 tours/);
    store.close();
  });

  it('M1-T6 every director has a spec, a French system prompt and valid JSON-schema tools', () => {
    for (const id of DIRECTOR_IDS) {
      const d = DIRECTORS[id];
      expect(d.id).toBe(id);
      expect(d.systemPrompt('fr')).toMatch(/NES BLUM FACTORY/);
      for (const t of d.tools) {
        const spec = toolSpec(t);
        expect(spec.input_schema.type).toBe('object');
        expect(spec.input_schema.$schema).toBeUndefined();
      }
    }
  });

  it('M1-T6 usage of each call is costed from config/prices.json', async () => {
    const usage: number[] = [];
    const store = ProjectStore.create(path.join(tempDir(), 'Cost.blum'), { title: 'Cost' });
    const rt = new DirectorRuntime({
      store,
      provider: new FakeProvider([[{ text: 'ok' }]], { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
      prices,
      onUsage: (u) => usage.push(u.costUsd),
    });
    const r = await rt.send('story', 'combien');
    expect(usage).toEqual([2]);
    expect(r.costUsd).toBe(2);
    expect(store.chat('story').at(-1)!.costUsd).toBe(2);
    store.close();
  });

  it('M1-T9 offline: every director answers « mode hors ligne » with its manual path, never a proposal', async () => {
    const store = ProjectStore.create(path.join(tempDir(), 'Off.blum'), { title: 'Off' });
    const provider = new OfflineProvider('fr');
    expect(await provider.available()).toEqual({ ok: false, reason: 'mode hors ligne' });
    const rt = new DirectorRuntime({ store, provider, prices });
    for (const id of DIRECTOR_IDS) {
      const r = await rt.send(id, 'Bonjour');
      expect(r.text.toLowerCase()).toMatch(/^mode hors ligne : /);
      expect(r.proposals).toHaveLength(0);
      expect(r.costUsd).toBe(0);
    }
    const en = new DirectorRuntime({ store, provider: new OfflineProvider('en'), prices });
    expect((await en.send('level', 'Hi')).text).toMatch(/^Offline mode: /);

    // The manual path: templates and presets become normal proposals.
    const story = rt.offline('story', 'usine');
    expect(story.state).toBe('pending');
    rt.approve(story.id);
    expect(store.doc<{ title: string }>('story.json')!.title).toBe('USINE A REVES');
    const preset = rt.offline('movement', 'lourd');
    rt.approve(preset.id);
    expect(store.doc<{ gravity: number }>('physics.json')!.gravity).toBe(64);
    expect(() => rt.offline('story', 'inconnu')).toThrow();
    store.close();
  });
});
