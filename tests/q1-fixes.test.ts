// BLUM-Q1 fixes found by the fresh-install test of the gift (scripts/qa-fresh-install.mjs), test first.
import { cpSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { explainIssue } from '../src/core/build/errors';
import { DirectorRuntime } from '../src/core/directors/runtime';
import { FakeProvider } from '../src/core/llm/fake';
import { pricesSchema } from '../src/core/llm/prices';
import { PLACEHOLDER_ART } from '../src/core/engine-data/art/placeholder-art';
import { decodeTile } from '../src/core/nes/chr';
import { ProjectStore } from '../src/core/project/store';
import { validateProjectDocs } from '../src/core/schema/documents';
import { HERO_CALL, sourcesOf } from './fixtures/chroma';
import { tempDir } from './helpers';

const ROOT = path.join(import.meta.dirname, '..');
const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'config', 'prices.json'), 'utf8')));

function sampleDocs() {
  const copy = path.join(tempDir(), 'BLUM.blum');
  cpSync(path.join(ROOT, 'resources', 'samples', 'BLUM.blum'), copy, { recursive: true });
  const store = ProjectStore.open(copy);
  try {
    return store.docs();
  } finally {
    store.close();
  }
}

describe('BLUM-Q1 texts Blum reads', () => {
  it('Q1-2 a flicker warning names its stage (cards listed « écran 2 » twice with no stage)', () => {
    const flicker = validateProjectDocs(sampleDocs()).filter((i) => /sprites sur une même ligne/.test(i.fr));
    expect(flicker.length).toBeGreaterThan(0);
    for (const i of flicker) {
      expect(i.severity).toBe('warning');
      expect(i.fr).toMatch(/^« [^»]+ », écran \d+ : /);
      expect(i.en).toMatch(/^"[^"]+", screen \d+: /);
    }
    expect(flicker.map((i) => i.fr)).toContainEqual(expect.stringMatching(/^« L'Érablière », écran 2 : /));
  });

  it('Q1-3 BOULON explains a warning as advice, never as a broken rule to undo', () => {
    const [w] = validateProjectDocs(sampleDocs()).filter((i) => i.severity === 'warning');
    const p = explainIssue(w!, 'validate');
    expect(p.what.fr).toBe(w!.fr);
    expect(p.why.fr).toMatch(/^Ce n’est pas une erreur : la ROM marche/);
    expect(p.fix.fr).not.toMatch(/annule|corriger/);
    // an error keeps the old wording
    const e = explainIssue({ ...w!, severity: 'error' }, 'validate');
    expect(e.why.fr).toMatch(/ne respecte pas une règle/);
  });

  it('Q1-4 the text of a later turn is a new sentence (« couleurs.C’est prêt » had no space)', async () => {
    const store = ProjectStore.create(path.join(tempDir(), 'T.blum'), { title: 'T' });
    const streamed: string[] = [];
    const rt = new DirectorRuntime({
      store,
      provider: new FakeProvider([[{ text: 'Voici l’histoire.' }, { tool: 'propose_story', input: { title: 'X' } }], [{ text: 'C’est prêt.' }]]),
      prices,
      onEvent: (e) => void (e.type === 'text' && streamed.push(e.text)),
    });
    const r = await rt.send('story', 'Un jeu');
    expect(r.text).toMatch(/\.\s+C’est prêt\.$/);
    expect(streamed.join('')).toBe(r.text);
    store.close();
  });

  it('Q1-5 saving an unchanged tile is refused at once with a plain reason (approval said « aucun changement »)', () => {
    const store = ProjectStore.create(path.join(tempDir(), 'Jeu.blum'), { title: 'Jeu' });
    const runtime = new DirectorRuntime({ store, provider: new FakeProvider([]), prices, sources: sourcesOf({ pousse: 'character-sheet.png' }) });
    runtime.approve(runtime.manual('visual', 'propose_conversion', HERO_CALL).id);
    const same = Array.from(decodeTile(store.asset('graphics/pousse.chr')!, 1024 + 2 * 16));
    expect(() => runtime.manual('visual', 'edit_tile', { graphic: 'pousse', bank: 1, tile: 2, pixels: same })).toThrow(/rien n’a changé dans cette tuile/);
    const one = same.map((v, i) => (i === 0 ? (v + 1) % 4 : v));
    expect(runtime.manual('visual', 'edit_tile', { graphic: 'pousse', bank: 1, tile: 2, pixels: one }).state).toBe('pending');
    store.close();
  });

  it('Q1-6 names Blum reads carry their accents: library graphics and palette cards (« tempete », « roi cones »)', () => {
    const names = PLACEHOLDER_ART.map((a) => a.doc.name);
    expect(names).toEqual(expect.arrayContaining(['Tuiles Tempête', 'Ennemis Tempête', 'Roi des cônes', 'Gros Frette', 'Yéti']));
    expect(names.filter((n) => /tempete|cones|yeti|^[a-z]/.test(n))).toEqual([]);
    const copy = path.join(tempDir(), 'BLUM.blum');
    cpSync(path.join(ROOT, 'resources', 'samples', 'BLUM.blum'), copy, { recursive: true });
    const store = ProjectStore.open(copy);
    const rt = new DirectorRuntime({ store, provider: new FakeProvider([]), prices });
    const set = (store.docs()['graphics/palettes.json'] as { sets: Array<{ id: string }> }).sets.find((s) => s.id === 'tempete')!;
    expect(rt.manual('visual', 'propose_palette_set', set).summary.fr).toBe('Palettes du monde « La Tempête ».');
    store.close();
  });
});
