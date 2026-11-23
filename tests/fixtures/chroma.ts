// Shared CHROMA fixtures: dropped-image registry over tests/fixtures/img and the hero conversion call.
import type { SourceImages } from '../../src/core/directors/chroma';
import { decodePng } from '../../src/core/util/png';
import { fixtureBytes } from './images';

export function sourcesOf(map: Record<string, string>): SourceImages {
  return {
    get: (id) => (map[id] ? fixtureBytes(map[id]!) : undefined),
    list: () => Object.entries(map).map(([id, f]) => {
      const img = decodePng(fixtureBytes(f));
      return { id, name: f, width: img.width, height: img.height };
    }),
  };
}

export const HERO_CALL = {
  source: 'pousse',
  id: 'pousse',
  name: 'Pousse',
  kind: 'sprite',
  role: 'player',
  fit: 'stretch',
  frame: { w: 16, h: 24 },
  width: 64,
  height: 24,
  frameNames: ['idle', 'run1', 'run2', 'jump'],
  dither: 'none',
  use: 'player',
  reason: 'Le héros dessiné par Blum.',
};
