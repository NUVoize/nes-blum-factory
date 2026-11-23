// M3-T9: world/scene budget validator (PLAN §6.1).
import { describe, expect, it } from 'vitest';
import { convertImage, type PaletteSet } from '../src/core/convert/convert';
import { DEMO_PALETTES, demoDocs } from '../src/core/engine-data/demo';
import { collectWorldScenes, usesOf, validateProjectBudgets, validateWorldScene, type WorldScene } from '../src/core/nes/budgets';
import { validateProjectDocs } from '../src/core/schema/documents';
import type { ConvertSettings, GraphicsDoc } from '../src/core/schema/graphics';
import { DEFAULT_AUDIO } from '../src/core/schema/misc';
import { DEFAULT_PHYSICS } from '../src/core/schema/physics';
import { DEFAULT_CARTRIDGE, type ProjectManifest } from '../src/core/schema/project';
import { DEFAULT_STORY } from '../src/core/schema/story';
import type { Json } from '../src/core/util/json-pointer';
import { fixture } from './fixtures/images';

const WORLD: PaletteSet = DEMO_PALETTES.sets[0]!;

function sprite(name: string, role: 'player' | 'enemy', mode: 'locked' | 'free'): GraphicsDoc {
  const sheet = name === 'character-sheet.png';
  const settings: ConvertSettings = {
    kind: 'sprite',
    role,
    mode,
    world: 'monde-1',
    fit: 'stretch',
    width: sheet ? 64 : 16,
    height: sheet ? 24 : 16,
    frame: sheet ? { w: 16, h: 24 } : { w: 16, h: 16 },
    frameNames: sheet ? ['idle', 'run1', 'run2', 'jump'] : ['walk1'],
    dither: 'none',
    ditherStrength: 0,
  };
  const r = convertImage({ image: fixture(name), settings, id: name.replace('.png', ''), name, paletteSet: WORLD });
  expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  return r.doc!;
}

function scene(docs: Array<[string, GraphicsDoc, 'player' | 'enemy']>): WorldScene {
  return {
    world: 'monde-1',
    set: WORLD,
    bg: [{ source: 'HUD', slot: 0, colors: null }],
    sprites: docs.flatMap(([p, d, role]) => usesOf(p, d).map((u) => ({ ...u, role }))),
    bgTiles: [{ source: 'tilesets/jardin.json', tiles: 40 }],
    spriteBanks: [],
    bosses: [],
    levels: [],
    playerPerLine: 2,
  };
}

const ENEMIES = ['enemy-beetle.png', 'enemy-bird.png', 'enemy-mushroom.png'];
const errorsOf = (issues: ReturnType<typeof validateWorldScene>) => issues.filter((i) => i.severity === 'error');

describe('M3-T9 world/scene budget validator', () => {
  it('M3-T9 player + 3 enemies in locked mode: ≤ 4 sprite subpalettes with the fixed roles', () => {
    const docs: Array<[string, GraphicsDoc, 'player' | 'enemy']> = [
      ['graphics/hero.json', sprite('character-sheet.png', 'player', 'locked'), 'player'],
      ...ENEMIES.map((n, i) => [`graphics/enemy-${i}.json`, sprite(n, 'enemy', 'locked'), 'enemy'] as [string, GraphicsDoc, 'enemy']),
    ];
    for (const [, d, role] of docs) for (const s of d.palettes.slots) expect(role === 'player' ? [0] : [2, 3]).toContain(s.slot);
    expect(errorsOf(validateWorldScene(scene(docs)))).toEqual([]);
  });

  it('M3-T9 the same 4 images in free mode are rejected (> 4 sprite subpalettes) with a French reason', () => {
    const docs: Array<[string, GraphicsDoc, 'player' | 'enemy']> = [
      ['graphics/hero.json', sprite('character-sheet.png', 'player', 'free'), 'player'],
      ...ENEMIES.map((n, i) => [`graphics/enemy-${i}.json`, sprite(n, 'enemy', 'free'), 'enemy'] as [string, GraphicsDoc, 'enemy']),
    ];
    const errs = errorsOf(validateWorldScene(scene(docs)));
    expect(errs).toHaveLength(1);
    expect(errs[0]!.fr).toMatch(/palettes de sprites \(la NES en a 4/);
    expect(errs[0]!.fr).toMatch(/mode verrouillé/);
  });

  it('M3-T9 a 5th BG subpalette, > 256 BG tiles, > 64 tiles in a sprite bank and a 40 px boss are each rejected in French', () => {
    const base = scene([]);
    const free = convertImage({
      image: fixture('photo-gradient.png'),
      settings: { kind: 'tileset', role: 'background', mode: 'free', world: 'monde-1', fit: 'cover', width: 128, height: 112, dither: 'none', ditherStrength: 0, smooth: true },
      id: 'photo',
      name: 'photo',
      paletteSet: WORLD,
    });
    expect(free.ok, JSON.stringify(free.errors)).toBe(true);
    const fifth = errorsOf(validateWorldScene({ ...base, bg: [...base.bg, ...usesOf('graphics/photo.json', free.doc!)] }));
    expect(fifth).toHaveLength(1);
    expect(fifth[0]!.fr).toMatch(/palettes de fond \(la NES en a 4, HUD compris\)/);
    expect(fifth[0]!.doc).toBe('graphics/photo.json');

    const tiles = errorsOf(validateWorldScene({ ...base, bgTiles: [{ source: 'graphics/a.json', tiles: 200 }, { source: 'graphics/b.json', tiles: 100 }] }));
    expect(tiles.map((i) => i.fr).join()).toMatch(/300 tuiles de fond \(max 256\)/);

    const bank = errorsOf(validateWorldScene({ ...base, spriteBanks: [{ source: 'graphics/e.json', name: 'ennemis', tiles: 70 }] }));
    expect(bank.map((i) => i.fr).join()).toMatch(/70 tuiles \(max 64\)/);

    const boss = errorsOf(validateWorldScene({ ...base, bosses: [{ source: 'graphics/yeti.json', width: 40 }] }));
    expect(boss.map((i) => i.fr).join()).toMatch(/40 pixels de large : en sprites, 32 au plus/);
  });

  it('M3-T9 9+ sprites on a scanline from the enemy placement give the flicker warning', () => {
    const base = scene([]);
    const four = [3, 5, 7, 9].map((col) => ({ source: 'actors/rampeur.json', col, row: 10, h: 16, perLine: 2 }));
    const issues = validateWorldScene({ ...base, levels: [{ source: 'levels/niveau-1.json', width: 64, placed: four }] });
    expect(errorsOf(issues)).toEqual([]);
    const w = issues.filter((i) => i.severity === 'warning');
    expect(w).toHaveLength(1);
    expect(w[0]!.fr).toMatch(/10 sprites sur une même ligne.*ça va clignoter/);
    // spread vertically: no warning
    const spread = [3, 5, 7, 9].map((col, i) => ({ source: 'actors/rampeur.json', col, row: 2 + i * 2, h: 16, perLine: 2 }));
    expect(validateWorldScene({ ...base, levels: [{ source: 'levels/niveau-1.json', width: 64, placed: spread }] })).toEqual([]);
    // different screens: no warning
    const apart = [3, 20, 37, 54].map((col) => ({ source: 'actors/rampeur.json', col, row: 10, h: 16, perLine: 2 }));
    expect(validateWorldScene({ ...base, levels: [{ source: 'levels/niveau-1.json', width: 64, placed: apart }] })).toEqual([]);
  });

  it('M3-T9 wired into project validation: the demo project passes; an unadopted free tileset is refused', () => {
    const manifest: ProjectManifest = {
      format: 'nbf-project',
      schemaVersion: 1,
      id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
      title: 'T',
      locale: 'fr',
      engineDataVersion: 1,
      createdAt: '2026-10-19T00:00:00.000Z',
      updatedAt: '2026-10-19T00:00:00.000Z',
    } as ProjectManifest;
    const docs = structuredClone({
      'project.json': manifest,
      'cartridge.json': DEFAULT_CARTRIDGE,
      'story.json': DEFAULT_STORY,
      'physics.json': DEFAULT_PHYSICS,
      'audio/library.json': DEFAULT_AUDIO,
      ...demoDocs(),
    }) as Record<string, Json>;
    expect(collectWorldScenes(docs)).toHaveLength(1);
    expect(validateProjectBudgets(docs)).toEqual([]);
    expect(validateProjectDocs(docs).filter((i) => i.severity === 'error')).toEqual([]);

    const free = convertImage({
      image: fixture('photo-gradient.png'),
      settings: { kind: 'tileset', role: 'background', mode: 'free', world: 'monde-1', fit: 'cover', width: 128, height: 112, dither: 'none', ditherStrength: 0, smooth: true },
      id: 'photo',
      name: 'photo',
      paletteSet: WORLD,
    });
    const tileset = { ...(docs['tilesets/jardin.json'] as object), chr: 'graphics/photo.chr' };
    const next = { ...docs, 'graphics/photo.json': free.doc as unknown as Json, 'tilesets/jardin.json': tileset as unknown as Json };
    const errs = validateProjectDocs(next).filter((i) => i.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.fr).toMatch(/palettes de fond/);
    // adopting its palette set (what a free-mode proposal does) makes it valid
    const adopted = { ...next, 'graphics/palettes.json': { schemaVersion: 1, sets: [free.proposedSet] } as unknown as Json };
    expect(validateProjectDocs(adopted).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
