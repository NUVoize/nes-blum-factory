// BLUM-Q1 fixes (engine tier). Q1-1: the colours the screen shows are the colours of the project palette.
// neslib's normal-brightness table turned $2D into $10, $3D into $20 and $20 into $10, so world 3 of BLUM
// (Le Chantier, light grey $3D) showed white, and any picture converted with those greys changed colour on
// the cartridge and in the built-in emulator, but not in the app previews.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blumProject, bootToPlay } from './blum';
import { buildFixture, ENGINE_DIR, harness } from './rom';

type PaletteSet = { id: string; backdrop: number; bg: number[][]; sprites: number[][] };

/** The 25 colours the PPU shows (backdrop + 3 per sub-palette), from jsnes palette RAM. */
function shownPalette(h: ReturnType<typeof harness>): number[] {
  const v = h.s.patternBytes(0x3f00, 32);
  const at = (i: number) => v[i]! & 0x3f;
  const out = [at(0)];
  for (const base of [0, 16]) for (let p = 0; p < 4; p++) out.push(at(base + 4 * p + 1), at(base + 4 * p + 2), at(base + 4 * p + 3));
  return out;
}
const wanted = (s: PaletteSet) => [s.backdrop, ...s.bg.flat(), ...s.sprites.flat()];

describe('Q1-1 palette RAM = palettes.json', () => {
  it('every BLUM world shows its palette set unchanged (world 3 has $3D)', async () => {
    const p = await blumProject();
    const sets = (p.docs['graphics/palettes.json'] as { sets: PaletteSet[] }).sets;
    for (const [level, world] of [[0, 'potager'], [2, 'cabane'], [4, 'chantier'], [6, 'tempete']] as const) {
      const r = buildFixture(p.docs, { startLevel: level }, p.assets);
      const h = harness(r.rom!);
      bootToPlay(h);
      h.step(10);
      expect({ world, shown: shownPalette(h) }).toEqual({ world, shown: wanted(sets.find((s) => s.id === world)!) });
    }
  });

  it('neslib at normal brightness passes every non-black colour through ($20, $2D, $3D included)', () => {
    const src = readFileSync(path.join(ENGINE_DIR, 'lib', 'neslib.s'), 'utf8');
    const row = (n: number) => {
      const m = new RegExp(`palBrightTable${n}:\\s*\\.byte ([^;\\n]+)`).exec(src);
      return m![1]!.split(',').map((x) => parseInt(x.trim().slice(1), 16));
    };
    const table = [4, 5, 6, 7].flatMap(row);
    expect(table).toHaveLength(64);
    const blacks = new Set([0x0d, 0x0e, 0x0f, 0x1d, 0x1e, 0x1f, 0x2e, 0x2f, 0x3e, 0x3f]);
    const changed = table.flatMap((v, c) => (blacks.has(c) || v === c ? [] : [`$${c.toString(16)} -> $${v.toString(16)}`]));
    expect(changed).toEqual([]);
  });
});
