// M3 scope: the original placeholder art set in every new project (hero in 2+ banks, 4 floor enemy
// sheets, 3+ bosses ≤ 32 px wide, tilesets), imported from the BLUMA sample game.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderGraphics } from '../src/core/convert/render';
import { PLACEHOLDER_ART } from '../src/core/engine-data/art/placeholder-art';
import { emitProject } from '../src/core/engine-data/emit';
import { PLACEHOLDER_HERO, placeholderProject } from '../src/core/engine-data/placeholder';
import { validateGraphicsDoc } from '../src/core/nes/budgets';
import { ProjectStore } from '../src/core/project/store';
import { graphicsDocSchema, type GraphicsDoc } from '../src/core/schema/graphics';
import { validateProjectDocs } from '../src/core/schema/documents';
import { tempDir } from './helpers';

describe('M3 placeholder art set', () => {
  it('M3 placeholder: hero in 2+ banks, 4 enemy sheets, 3+ bosses ≤ 32 px wide, 4 tilesets, all valid', () => {
    const docs = PLACEHOLDER_ART.map((a) => graphicsDocSchema.parse(a.doc));
    const byRole = (r: GraphicsDoc['role']) => docs.filter((d) => d.role === r);
    const hero = byRole('player');
    expect(hero).toHaveLength(1);
    expect(hero[0]!.budget.banks.length).toBeGreaterThanOrEqual(2);
    const bankOf = Object.fromEntries(hero[0]!.frames!.map((f) => [f.name, f.bank]));
    expect([bankOf.idle, bankOf.run1, bankOf.jump]).toEqual([0, 0, 1]);
    expect(byRole('enemy')).toHaveLength(4);
    const bosses = byRole('boss');
    expect(bosses.length).toBeGreaterThanOrEqual(3);
    for (const b of bosses) for (const f of b.frames!) expect(f.w).toBeLessThanOrEqual(32);
    expect(docs.filter((d) => d.kind === 'tileset')).toHaveLength(4);
    for (const d of docs) expect(validateGraphicsDoc(`graphics/${d.id}.json`, d), d.id).toEqual([]);
    // every CHR has the size its banks say, and renders
    for (const a of PLACEHOLDER_ART) {
      const chr = Uint8Array.from(atob(a.chr), (c) => c.charCodeAt(0));
      expect(chr.length).toBe(a.doc.bankSize === 4096 ? 4096 : 1024 * a.doc.budget.banks.length);
      const img = renderGraphics(a.doc, chr, null);
      expect(img.width).toBeGreaterThan(0);
    }
  });

  it('M3 placeholder: a new project gets the art on disk, the hero wired in, and still validates and emits', () => {
    const dir = path.join(tempDir(), 'Jeu.blum');
    const store = ProjectStore.create(dir, { title: 'Jeu' });
    expect(store.readOnly).toBe(false);
    for (const f of ['graphics/heros-blum.json', 'graphics/heros-blum.chr', 'graphics/heros-blum.png', 'graphics/tuiles-potager.json', 'tilesets/tuiles-potager.json', 'actors/player.json']) {
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    }
    expect(JSON.parse(readFileSync(path.join(dir, 'actors', 'player.json'), 'utf8')).graphics).toBe(PLACEHOLDER_HERO);
    const docs = store.docs();
    expect(validateProjectDocs(docs).filter((i) => i.severity === 'error')).toEqual([]);
    const emitted = emitProject(docs, { assets: store.assets() });
    expect(emitted.ok, JSON.stringify(emitted.issues)).toBe(true);
    expect(emitted.report!.chr.filter((c) => c.name.startsWith('héros Blum'))).toHaveLength(3);
    // a bare project (tests, sample replay) can still opt out
    const bare = ProjectStore.create(path.join(tempDir(), 'Nu.blum'), { title: 'Nu', placeholderArt: false });
    expect(Object.keys(bare.docs()).some((p) => p.startsWith('graphics/heros'))).toBe(false);
    store.close();
    bare.close();
    // the art set is the same every time
    expect(Object.keys(placeholderProject().assets).sort()).toEqual(Object.keys(placeholderProject().assets).sort());
  });
});
