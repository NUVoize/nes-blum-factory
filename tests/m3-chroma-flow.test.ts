// M3-T7 (unit half): CHROMA director flow with the FakeProvider: drop image -> proposal -> approve ->
// graphics/<id>.{png,json,chr} written. The engine half (build + ROM frame) is tests/engine/m3-engine.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirectorRuntime } from '../src/core/directors/runtime';
import { DIRECTORS, toolSpec } from '../src/core/directors/specs';
import { FakeProvider } from '../src/core/llm/fake';
import { pricesSchema } from '../src/core/llm/prices';
import { decodeTile } from '../src/core/nes/chr';
import { ProjectStore } from '../src/core/project/store';
import { graphicsDocSchema } from '../src/core/schema/graphics';
import { decodePng } from '../src/core/util/png';
import { HERO_CALL, sourcesOf } from './fixtures/chroma';
import { fixtureBytes } from './fixtures/images';
import { tempDir } from './helpers';

const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'config', 'prices.json'), 'utf8')));

describe('M3-T7 CHROMA director flow', () => {
  it('M3-T7 drop image -> proposal -> approve -> graphics/<id>.{png,json,chr} written, hero switched', async () => {
    const dir = path.join(tempDir(), 'Jeu.blum');
    const store = ProjectStore.create(dir, { title: 'Jeu' });
    const provider = new FakeProvider([
      [{ text: 'Je transforme ton dessin en héros NES.' }, { tool: 'propose_conversion', input: HERO_CALL }],
      [{ text: 'Proposition prête : 4 images, palette du héros.' }],
    ]);
    const runtime = new DirectorRuntime({ store, provider, prices, sources: sourcesOf({ pousse: 'character-sheet.png' }) });
    const r = await runtime.send('visual', 'Fais de mon dessin le héros.');
    expect(r.failure).toBeNull();
    expect(r.proposals).toHaveLength(1);
    // the model saw the dropped image in its context and the conversion tool in its tool list
    const req = provider.requests[0]!;
    const first = req.messages[0]!.content[0]!;
    expect(first.type === 'text' ? first.text : '').toContain('"sources":[{"id":"pousse"');
    expect(req.tools.map((t) => t.name)).toEqual(['propose_conversion', 'propose_palette_set', 'edit_tile']);
    const p = r.proposals[0]!;
    expect(p.summary.fr).toMatch(/Graphisme « Pousse » \(héros, 4 image\(s\)\).*devient le héros/);
    expect(p.ops.map((o) => ('doc' in o ? o.doc : o.path))).toEqual([
      'graphics/sources/pousse.png',
      'graphics/pousse.chr',
      'graphics/pousse.png',
      'graphics/pousse.json',
      'actors/player.json',
    ]);
    // nothing written before approval
    expect(existsSync(path.join(dir, 'graphics', 'pousse.json'))).toBe(false);

    runtime.approve(p.id);
    for (const f of ['graphics/pousse.png', 'graphics/pousse.json', 'graphics/pousse.chr', 'graphics/sources/pousse.png', 'actors/player.json']) {
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    }
    const doc = graphicsDocSchema.parse(JSON.parse(readFileSync(path.join(dir, 'graphics', 'pousse.json'), 'utf8')));
    const chr = new Uint8Array(readFileSync(path.join(dir, 'graphics', 'pousse.chr')));
    expect(chr.length).toBe(2048);
    const preview = decodePng(new Uint8Array(readFileSync(path.join(dir, 'graphics', 'pousse.png'))));
    expect([preview.width, preview.height]).toEqual([64, 24]);
    expect(Array.from(readFileSync(path.join(dir, 'graphics', 'sources', 'pousse.png')))).toEqual(Array.from(fixtureBytes('character-sheet.png')));
    expect(JSON.parse(readFileSync(path.join(dir, 'actors', 'player.json'), 'utf8')).graphics).toBe('graphics/pousse.json');
    expect(doc.frames!.find((f) => f.name === 'jump')!.bank).toBe(1);
    // undo removes it all again (one transaction)
    store.undo();
    expect(existsSync(path.join(dir, 'graphics', 'pousse.json'))).toBe(false);
    // back to the placeholder hero every new project starts with
    expect(JSON.parse(readFileSync(path.join(dir, 'actors', 'player.json'), 'utf8')).graphics).toBe('graphics/heros-blum.json');
    store.close();
  });

  it('M3-T7 an invalid conversion goes back to CHROMA as a tool error, never to Blum', async () => {
    const dir = path.join(tempDir(), 'Jeu.blum');
    const store = ProjectStore.create(dir, { title: 'Jeu' });
    const provider = new FakeProvider([
      [{ tool: 'propose_conversion', input: { ...HERO_CALL, source: 'absente' } }],
      [{ tool: 'propose_conversion', input: { ...HERO_CALL, role: 'boss', frame: { w: 40, h: 32 }, width: 40, height: 32, use: 'none' } }],
      [{ text: 'Je n’y arrive pas.' }],
    ]);
    const runtime = new DirectorRuntime({ store, provider, prices, sources: sourcesOf({ pousse: 'character-sheet.png' }) });
    const r = await runtime.send('visual', 'Convertis.');
    expect(r.proposals).toHaveLength(0);
    const results = provider.requests.slice(1).map((q) => JSON.stringify(q.messages.at(-1)));
    expect(results[0]).toMatch(/introuvable : dépose-la d’abord/);
    expect(results[1]).toMatch(/taille d’image de sprite refusée/);
    store.close();
  });

  it('M3-T7 single-tile edit is a normal proposal: CHR and preview change, undo restores', () => {
    const dir = path.join(tempDir(), 'Jeu.blum');
    const store = ProjectStore.create(dir, { title: 'Jeu' });
    const runtime = new DirectorRuntime({ store, provider: new FakeProvider([]), prices, sources: sourcesOf({ pousse: 'character-sheet.png' }) });
    runtime.approve(runtime.manual('visual', 'propose_conversion', HERO_CALL).id);
    const before = store.asset('graphics/pousse.chr')!;
    const pixels = Array.from({ length: 64 }, (_, i) => (i % 9 === 0 ? 3 : 1));
    const p = runtime.manual('visual', 'edit_tile', { graphic: 'pousse', bank: 1, tile: 2, pixels });
    runtime.approve(p.id);
    const after = store.asset('graphics/pousse.chr')!;
    expect(Array.from(decodeTile(after, 1024 + 2 * 16))).toEqual(pixels);
    expect(Array.from(after.subarray(0, 1024))).toEqual(Array.from(before.subarray(0, 1024)));
    store.undo();
    expect(Array.from(store.asset('graphics/pousse.chr')!)).toEqual(Array.from(before));
    expect(() => runtime.manual('visual', 'edit_tile', { graphic: 'pousse', bank: 1, tile: 60, pixels })).toThrow(/tuile 60 absente/);
    store.close();
  });

  it('M3-T7 the conversion tool schema keeps defaulted fields optional for the model', () => {
    const spec = toolSpec(DIRECTORS.visual.tools[0]!);
    expect(spec.name).toBe('propose_conversion');
    expect((spec.input_schema.required as string[]).sort()).toEqual(['id', 'kind', 'name', 'role', 'source']);
  });
});
